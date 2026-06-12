// ─── IRON COMMAND — Integration layer (DESIGN §13.4) ─────────────────────────
// Wires sim ↔ ai ↔ gfx ↔ ui. Fixed-step 30 Hz sim inside a rAF loop,
// input state machine (normal / placing / targeting), selection model,
// control groups, camera keys, pause, rematch/teardown, EVA wiring, test hooks.

// ── Test hooks: error collector (must be first) ──────────────────────────────
window.__ERRS = [];
window.addEventListener('error', (e) => {
  window.__ERRS.push(String((e && (e.message || e.error)) || 'error'));
});
window.addEventListener('unhandledrejection', (e) => {
  window.__ERRS.push('rejection: ' + ((e.reason && e.reason.message) || e.reason));
});

import { Game } from './sim/game.js';
import { FACTIONS } from './sim/factions.js';
import { AIController } from './sim/ai.js';
import { GfxEngine } from './gfx/renderer.js';
import { Menu } from './ui/menu.js';
import { HUD } from './ui/hud.js';
import { createSfx, createMusic } from './audio/sfx.js';

const canvas = document.getElementById('game-canvas');
const uiRoot = document.getElementById('ui-root');

const TICK = 1 / 30;
const MAX_STEPS = 5;          // accumulator clamp
const HUD_INTERVAL = 0.1;     // ~10 Hz DOM updates
const DRAG_PX = 6;            // box-select threshold
const EDGE_PX = 24;           // edge-pan band
const PAN_SPEED = 34;         // world units / s
const SUPER_RADIUS = 10;

// Reticle radii per general's power (DESIGN §8 effect areas).
const POWER_RADIUS = {
  spyDrone: 12, paradrop: 4, strikeWing: 6, fuelAir: 10,
  artilleryBarrage: 8, cashHack: 10, clusterMines: 8, empBomb: 12,
  ambush: 4, sneakAttack: 2.5, anthraxBomb: 10,
};

// Abilities that need a target click (everything except 'deploy').
const TARGETED_ABILITIES = {
  flashbang: { r: 3 }, c4: { r: 2 }, knife: { r: 1.5 },
  disable: { r: 10 }, cashHack: { r: 8 }, crewSnipe: { r: 2 },
};

// EVA text table — all §10 keys.
const EVA_TEXT = {
  constructionComplete: 'Construction complete.',
  unitReady: 'Unit ready.',
  lowPower: 'Warning: low power.',
  baseUnderAttack: 'Our base is under attack!',
  unitsUnderAttack: 'Our forces are under attack!',
  harvesterUnderAttack: 'Our harvesters are under attack!',
  enemySuperDetected: 'Warning: enemy superweapon detected.',
  enemySuperReady: 'Warning: enemy superweapon ready!',
  superLaunchDetected: 'Superweapon launch detected!',
  ourSuperReady: 'Superweapon ready. Select a target.',
  promotion: 'General promoted — promotion point available.',
  capturedDerrick: 'Oil derrick captured.',
  insufficientFunds: 'Insufficient funds.',
  victory: 'Victory! Enemy command destroyed.',
  defeat: 'Defeat. Our command has fallen.',
};
const ATTACK_EVA = new Set(['baseUnderAttack', 'unitsUnderAttack', 'harvesterUnderAttack', 'superLaunchDetected']);

let seedCounter = 0;
let session = null;
let menu = null;
const music = createMusic();
let audioMuted = false;

function randomFaction() {
  const keys = Object.keys(FACTIONS);
  return keys[(Math.random() * keys.length) | 0];
}

function showMenu() {
  if (menu) { menu.destroy(); menu = null; }
  document.title = 'Iron Command';
  music.play('menu');
  menu = Menu(uiRoot, {
    factions: FACTIONS,
    onStart: (factionKey, difficulty) => startGame(factionKey, difficulty),
  });
}

function startGame(factionKey, difficulty, opts = {}) {
  if (session) { session.teardown(); session = null; }
  if (menu) { menu.destroy(); menu = null; }
  session = createSession(
    FACTIONS[factionKey] ? factionKey : 'coalition',
    ['easy', 'hard', 'brutal'].includes(difficulty) ? difficulty : 'hard',
    opts,
  );
}

function backToMenu() {
  if (session) { session.teardown(); session = null; }
  showMenu();
}

// ═════════════════════════════════════════════════════════════════════════════
function createSession(playerFaction, difficulty, opts) {
  const autodrive = !!opts.autodrive;

  // AI faction: random, different from player's.
  const others = Object.keys(FACTIONS).filter((k) => k !== playerFaction);
  const aiFaction = others[(Math.random() * others.length) | 0];

  const game = new Game({ playerFaction, aiFaction, difficulty, seed: ++seedCounter });
  const enemyAI = new AIController(game, 'enemy', difficulty);
  const playerAI = autodrive ? new AIController(game, 'player', difficulty) : null;

  const gfx = new GfxEngine(canvas);
  gfx.attach(game);
  const sfx = createSfx(game, { listenerPos: () => gfx.cameraLook() });
  sfx.setMuted(audioMuted);
  music.play('game');

  // ── listener registries for clean teardown ──
  const domListeners = [];
  const listen = (target, type, fn, opt) => {
    target.addEventListener(type, fn, opt);
    domListeners.push([target, type, fn, opt]);
  };
  const gameListeners = [];
  const gon = (ev, fn) => { game.on(ev, fn); gameListeners.push([ev, fn]); };

  // ── session state ──
  let raf = 0;
  let last = performance.now();
  let acc = 0;
  let hudAcc = 1;            // force first hud update immediately
  let lastTitleT = -1;
  let paused = false;
  let over = false;
  let minimapBase = null;

  let selection = [];        // entity ids (player side)
  const groups = {};         // '1'..'9' → [ids]
  let lastGroupTap = { key: null, t: 0 };
  let attackMoveArmed = false;
  let mode = { name: 'normal' };  // | {name:'placing',key,builderId} | {name:'targeting',kind,key,unitId,radius,color} | {name:'rally',structureId}
  const keysDown = new Set();
  let lastClient = null;     // mouse pos for edge pan / ghost
  let hoverAt = 0;
  let dragStart = null;      // {x,y}
  let boxActive = false;
  const pendingPings = [];   // transient radar pings for HUD
  let lastPing = null;       // for Space jump

  // box-select marquee (DOM, owned by main)
  const marquee = document.createElement('div');
  marquee.style.cssText =
    'position:fixed;border:1px solid rgba(120,200,255,.9);background:rgba(80,160,255,.12);' +
    'pointer-events:none;display:none;z-index:50;';
  document.body.appendChild(marquee);

  // ── helpers ───────────────────────────────────────────────────────────────
  const alive = (id) => { const e = game.entity(id); return !!(e && e.hp > 0 && e.side === 'player'); };
  function setSelection(ids) {
    const prevPrimary = selection[0];
    selection = [...new Set(ids)].filter(alive);
    gfx.setSelected(selection);
    if (selection.length && selection[0] !== prevPrimary) {
      const e = game.entity(selection[0]);
      if (e && e.kind === 'unit') sfx.ack(e.key, 'select');
    }
  }
  function liveSel() { return selection.map((id) => game.entity(id)).filter((e) => e && e.hp > 0); }
  function selUnits() { return liveSel().filter((e) => e.kind === 'unit'); }
  function selUnitIds() { return selUnits().map((u) => u.id); }

  const MOVE_ACK = new Set(['move', 'garrison', 'harvest', 'repairTarget', 'capture']);
  const ATTACK_ACK = new Set(['attack', 'attackMove']);
  function issueP(cmd) {
    const res = game.issue('player', cmd);
    if (res.ok) {
      const action = MOVE_ACK.has(cmd.type) ? 'move' : ATTACK_ACK.has(cmd.type) ? 'attack' : null;
      const aid = (cmd.ids && cmd.ids[0]) ?? cmd.id;
      if (action && aid != null) {
        const e = game.entity(aid);
        if (e && e.kind === 'unit') sfx.ack(e.key, action);
      }
    }
    if (!res.ok && /insufficient funds/i.test(res.reason || '')) {
      hud.eva('insufficientFunds', EVA_TEXT.insufficientFunds);
      sfx.eva('insufficientFunds');
    }
    return res;
  }

  function setMode(m) {
    if (mode.name === 'placing') gfx.hideGhost();
    if (mode.name === 'targeting' || mode.name === 'rally') gfx.hideReticle();
    mode = m;
    hud.setMode(m.name === 'placing' ? 'placing'
      : (m.name === 'targeting' || m.name === 'rally') ? 'targeting' : 'normal');
  }

  function findIdleBuilder() {
    let any = null;
    for (const e of game.entities.values()) {
      if (e.side !== 'player' || e.kind !== 'unit' || !e.def.builder || e.hp <= 0) continue;
      any = any || e;
      if (e.state === 'idle' && !e.build) return e;
    }
    return any;
  }

  // Selection entities resolved for HUD ctx (snapshot-ish shape the HUD expects).
  function selEntityFor(id) {
    const e = game.entity(id);
    if (!e || e.hp <= 0) return null;
    return {
      id: e.id, side: e.side, kind: e.kind, key: e.key, faction: e.faction,
      x: e.x, z: e.z, hp: e.hp, maxHp: e.maxHp, vet: e.vet || 0,
      stealthed: !!e.stealthed, state: e.state,
      building: e.building, queue: e.queue, rally: e.rally,
      garrison: (e.garrisonList && e.garrisonList.length) ? [...e.garrisonList] : undefined,
      abilityCd: e.abilityCd, research: e.research || null,
      carrying: e.carrying || 0,
    };
  }

  // ── HUD ───────────────────────────────────────────────────────────────────
  const hud = HUD(uiRoot, {
    onBuildSelect(key) {
      const builder = selUnits().find((u) => u.def.builder) || findIdleBuilder();
      if (!builder) return;
      setMode({ name: 'placing', key, builderId: builder.id });
      if (lastClient) updateGhost(lastClient.x, lastClient.y);
    },
    onQueueUnit(structureId, key) { issueP({ type: 'queueUnit', structureId, key }); },
    onCancelQueue(structureId, i) { issueP({ type: 'cancelQueue', structureId, index: i }); },
    onSell(id) { issueP({ type: 'sell', id }); },
    onUpgrade(structureId, key) { issueP({ type: 'upgrade', structureId, key }); },
    onSetRally(structureId) {
      setMode({ name: 'rally', structureId });
    },
    onEvacuate(id) { issueP({ type: 'evacuate', id }); },
    onAbility(id, abilityKey) {
      if (abilityKey === 'deploy') { issueP({ type: 'ability', id, abilityKey }); return; }
      const spec = TARGETED_ABILITIES[abilityKey] || { r: 3 };
      setMode({ name: 'targeting', kind: 'ability', key: abilityKey, unitId: id, radius: spec.r, color: 0x7ce0ff });
    },
    onChoosePower(key) { issueP({ type: 'choosePower', key }); },
    onUsePower(key) {
      setMode({ name: 'targeting', kind: 'power', key, radius: POWER_RADIUS[key] || 6, color: 0xffb347 });
    },
    onFireSuper() { enterSuperTargeting(); },
    onPause() { togglePause(); },
    onMinimapNav(x, z) { gfx.jumpTo(x, z); },
    onMinimapTarget(x, z) {
      const ids = selUnitIds();
      if (ids.length) issueP({ type: 'move', ids, x, z });
    },
  });

  function enterSuperTargeting() {
    const sup = game.state && game.state.player && game.state.player.super;
    if (sup && sup.ready) setMode({ name: 'targeting', kind: 'super', radius: SUPER_RADIUS, color: 0xff5544 });
  }

  // ── pause / game over / restart ───────────────────────────────────────────
  function togglePause() {
    if (over) return;
    if (paused) { paused = false; hud.hidePause(); }
    else {
      paused = true;
      hud.showPause({
        onResume: () => { paused = false; },
        onRestart: () => restart(),
        onMenu: () => backToMenu(),
      });
    }
  }
  function restart() { startGame(playerFaction, difficulty, opts); }

  // ── sim event wiring ──────────────────────────────────────────────────────
  gon('eva', (ev) => {
    if (!ev || !ev.key) return;
    hud.eva(ev.key, EVA_TEXT[ev.key]);
    sfx.eva(ev.key);
    if (ev.x != null && ev.z != null) {
      const kind = ATTACK_EVA.has(ev.key) ? 'attack' : 'info';
      pendingPings.push({ x: ev.x, z: ev.z, kind });
      lastPing = { x: ev.x, z: ev.z };
    }
  });
  gon('radarPing', (ev) => {
    if (ev && ev.x != null) { pendingPings.push({ x: ev.x, z: ev.z, kind: ev.kind || 'info' }); lastPing = { x: ev.x, z: ev.z }; }
  });
  gon('superLaunch', (ev) => {
    if (ev && ev.x != null) { pendingPings.push({ x: ev.x, z: ev.z, kind: 'attack' }); lastPing = { x: ev.x, z: ev.z }; }
  });
  gon('gameOver', (ev) => {
    over = true;
    paused = false;
    hud.hidePause();
    setMode({ name: 'normal' });
    hud.showGameOver(ev.winner === 'player' ? 'win' : 'lose', ev.stats || {}, {
      onRematch: () => restart(),
      onMenu: () => backToMenu(),
    });
  });

  // ── input: pointer ────────────────────────────────────────────────────────
  function updateGhost(cx, cy) {
    const p = gfx.pick(cx, cy);
    const valid = game.canPlace('player', mode.key, p.x, p.z).ok;
    gfx.showGhost(mode.key, playerFaction, p.x, p.z, valid);
  }

  function onPointerMove(e) {
    lastClient = { x: e.clientX, y: e.clientY };
    if (dragStart && !boxActive &&
        (Math.abs(e.clientX - dragStart.x) >= DRAG_PX || Math.abs(e.clientY - dragStart.y) >= DRAG_PX)) {
      boxActive = true;
      marquee.style.display = 'block';
    }
    if (boxActive) {
      const x = Math.min(dragStart.x, e.clientX), y = Math.min(dragStart.y, e.clientY);
      marquee.style.left = x + 'px'; marquee.style.top = y + 'px';
      marquee.style.width = Math.abs(e.clientX - dragStart.x) + 'px';
      marquee.style.height = Math.abs(e.clientY - dragStart.y) + 'px';
      return;
    }
    if (mode.name === 'placing') { updateGhost(e.clientX, e.clientY); return; }
    if (mode.name === 'targeting' || mode.name === 'rally') {
      const p = gfx.pick(e.clientX, e.clientY);
      gfx.showReticle(p.x, p.z, mode.radius || 3, mode.color || 0xffb347);
      return;
    }
    const now = performance.now();
    if (now - hoverAt > 60) {
      hoverAt = now;
      const p = gfx.pick(e.clientX, e.clientY);
      gfx.setHover(p.entityId);
    }
  }

  function onPointerDown(e) {
    if (e.target !== canvas) return;
    if (e.button === 0) {
      if (mode.name === 'placing') {
        const p = gfx.pick(e.clientX, e.clientY);
        const res = issueP({ type: 'build', builderId: mode.builderId, key: mode.key, x: p.x, z: p.z });
        if (res.ok && !e.shiftKey) setMode({ name: 'normal' });
        return;
      }
      if (mode.name === 'targeting') {
        const p = gfx.pick(e.clientX, e.clientY);
        if (mode.kind === 'power') issueP({ type: 'usePower', key: mode.key, x: p.x, z: p.z });
        else if (mode.kind === 'super') issueP({ type: 'fireSuper', x: p.x, z: p.z });
        else if (mode.kind === 'ability') {
          issueP({ type: 'ability', id: mode.unitId, abilityKey: mode.key, x: p.x, z: p.z, targetId: p.entityId ?? undefined });
        }
        setMode({ name: 'normal' });
        return;
      }
      if (mode.name === 'rally') {
        const p = gfx.pick(e.clientX, e.clientY);
        const res = issueP({ type: 'setRally', structureId: mode.structureId, x: p.x, z: p.z });
        if (res.ok) gfx.flashRally(mode.structureId, p.x, p.z);
        setMode({ name: 'normal' });
        return;
      }
      dragStart = { x: e.clientX, y: e.clientY };
      boxActive = false;
      return;
    }
    if (e.button === 2) {
      if (mode.name !== 'normal') { setMode({ name: 'normal' }); return; }
      if (attackMoveArmed) { attackMoveArmed = false; return; }
      contextOrder(gfx.pick(e.clientX, e.clientY));
    }
  }

  function onPointerUp(e) {
    if (e.button !== 0) return;
    const hadDrag = boxActive;
    const start = dragStart;
    dragStart = null;
    boxActive = false;
    marquee.style.display = 'none';
    if (mode.name !== 'normal') return;
    if (!start) return;

    if (hadDrag) {
      const ids = gfx.pickRect(start.x, start.y, e.clientX, e.clientY);
      setSelection(e.shiftKey ? selection.concat(ids) : ids);
      return;
    }
    if (e.target !== canvas) return;

    const p = gfx.pick(e.clientX, e.clientY);

    if (attackMoveArmed) {
      attackMoveArmed = false;
      const ids = selUnitIds();
      if (ids.length) issueP({ type: 'attackMove', ids, x: p.x, z: p.z });
      return;
    }

    const ent = p.entityId != null ? game.entity(p.entityId) : null;
    if (ent && ent.side === 'player' && ent.hp > 0) {
      if (e.detail >= 2 && ent.kind === 'unit') {
        // double-click: all of same type on screen
        const all = gfx.pickRect(0, 0, window.innerWidth, window.innerHeight)
          .filter((id) => { const u = game.entity(id); return u && u.key === ent.key; });
        setSelection(all.length ? all : [ent.id]);
        return;
      }
      if (e.shiftKey) {
        setSelection(selection.includes(ent.id)
          ? selection.filter((i) => i !== ent.id)
          : [...selection, ent.id]);
      } else {
        setSelection([ent.id]);
      }
      return;
    }
    if (!e.shiftKey) setSelection([]);
  }

  // Right-click context order (DESIGN §12).
  function contextOrder(p) {
    const units = selUnits();
    if (!units.length) return;
    const ids = units.map((u) => u.id);
    const ent = p.entityId != null ? game.entity(p.entityId) : null;

    if (!ent || ent.hp <= 0) { issueP({ type: 'move', ids, x: p.x, z: p.z }); return; }

    if (ent.side === 'player') {
      if (ent.kind === 'structure') {
        const builder = units.find((u) => u.def.builder);
        if (builder && ent.hp < ent.maxHp && ent.building == null) {
          issueP({ type: 'repairTarget', id: builder.id, targetId: ent.id });
          return;
        }
        if ((ent.garrisonSlots || 0) > 0 && units.some((u) => u.def.armor === 'infantry' && !u.def.builder)) {
          issueP({ type: 'garrison', ids, targetId: ent.id });
          return;
        }
      }
      issueP({ type: 'move', ids, x: p.x, z: p.z });
      return;
    }

    if (ent.side === 'neutral') {
      if (ent.key === 'oilDerrick') {
        const cap = units.find((u) => u.def.capture);
        if (cap) {
          issueP({ type: 'capture', id: cap.id, targetId: ent.id });
          const rest = ids.filter((i) => i !== cap.id);
          if (rest.length) issueP({ type: 'move', ids: rest, x: p.x, z: p.z });
          return;
        }
      }
      if ((ent.garrisonSlots || 0) > 0 && units.some((u) => u.def.armor === 'infantry' && !u.def.builder)) {
        issueP({ type: 'garrison', ids, targetId: ent.id });
        return;
      }
      if (ent.key === 'supplyDock' && units.some((u) => u.def.harvester)) {
        issueP({ type: 'harvest', ids, dockId: ent.id });
        return;
      }
      if (ent.kind === 'husk') { issueP({ type: 'move', ids, x: p.x, z: p.z }); return; }
      issueP({ type: 'move', ids, x: p.x, z: p.z });
      return;
    }

    // enemy entity
    const capturers = units.filter((u) => u.def.capture);
    const onlyCapturers = capturers.length && units.every((u) => u.def.capture || !u.def.weapon);
    if (ent.kind === 'structure' && ent.def && ent.def.builds && onlyCapturers) {
      issueP({ type: 'capture', id: capturers[0].id, targetId: ent.id });
      return;
    }
    issueP({ type: 'attack', ids, targetId: ent.id });
  }

  // ── input: keyboard ───────────────────────────────────────────────────────
  const PAN_KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);

  function selectSameType() {
    const keys = new Set(selUnits().map((u) => u.key));
    if (!keys.size) return;
    const all = gfx.pickRect(0, 0, window.innerWidth, window.innerHeight)
      .filter((id) => { const u = game.entity(id); return u && keys.has(u.key); });
    if (all.length) setSelection(all);
  }
  function jumpHome() {
    for (const e of game.entities.values()) {
      if (e.side === 'player' && e.kind === 'structure' && e.key === 'commandCenter' && e.hp > 0) {
        gfx.jumpTo(e.x, e.z);
        return;
      }
    }
  }
  function centerOnGroup(ids) {
    let x = 0, z = 0, n = 0;
    for (const id of ids) { const e = game.entity(id); if (e) { x += e.x; z += e.z; n++; } }
    if (n) gfx.jumpTo(x / n, z / n);
  }

  function onKeyDown(e) {
    const k = e.key.toLowerCase();
    if (PAN_KEYS.has(k)) keysDown.add(k);
    if (e.repeat) return;
    if (k === 'escape') {
      e.preventDefault();
      if (mode.name !== 'normal') { setMode({ name: 'normal' }); return; }
      if (attackMoveArmed) { attackMoveArmed = false; return; }
      togglePause();
      return;
    }
    if (k === 'p') { togglePause(); return; }
    if (k === 'm') {
      audioMuted = sfx.toggleMuted();
      music.setMuted(audioMuted);
      hud.eva('audio', audioMuted ? 'Audio muted.' : 'Audio on.');
      return;
    }
    if (paused || over) return;
    switch (k) {
      case 'a': attackMoveArmed = true; break;
      case 's': { const ids = selUnitIds(); if (ids.length) issueP({ type: 'stop', ids }); break; }
      case 'g': { const ids = selUnitIds(); if (ids.length) issueP({ type: 'guard', ids }); break; }
      case 'e': selectSameType(); break;
      case 'h': jumpHome(); break;
      case 'b': {
        const b = findIdleBuilder();
        if (b) setSelection([b.id]);
        break;
      }
      case 'f': enterSuperTargeting(); break;
      case ' ':
        e.preventDefault();
        if (lastPing) gfx.jumpTo(lastPing.x, lastPing.z);
        break;
      default: {
        if (k >= '1' && k <= '9') {
          if (e.ctrlKey) {
            groups[k] = [...selection];
            e.preventDefault();
          } else {
            const g = (groups[k] || []).filter(alive);
            if (g.length) {
              setSelection(g);
              const now = performance.now();
              if (lastGroupTap.key === k && now - lastGroupTap.t < 400) centerOnGroup(g);
              lastGroupTap = { key: k, t: now };
            }
          }
        }
      }
    }
  }
  function onKeyUp(e) { keysDown.delete(e.key.toLowerCase()); }

  function applyPan(dt) {
    let dx = 0, dz = 0;
    if (keysDown.has('w') || keysDown.has('arrowup')) dz -= 1;
    if (keysDown.has('s') || keysDown.has('arrowdown')) dz += 1;
    if (keysDown.has('a') || keysDown.has('arrowleft')) dx -= 1;
    if (keysDown.has('d') || keysDown.has('arrowright')) dx += 1;
    if (lastClient) {
      const W = window.innerWidth, H = window.innerHeight;
      if (lastClient.x <= EDGE_PX) dx -= 1;
      else if (lastClient.x >= W - EDGE_PX) dx += 1;
      if (lastClient.y <= EDGE_PX) dz -= 1;
      else if (lastClient.y >= H - EDGE_PX) dz += 1;
    }
    if (dx || dz) {
      const m = PAN_SPEED * dt / Math.hypot(dx, dz);
      gfx.panCamera(dx * m, dz * m);
    }
  }

  listen(window, 'pointermove', onPointerMove);
  listen(window, 'pointerdown', onPointerDown);
  listen(window, 'pointerup', onPointerUp);
  listen(canvas, 'contextmenu', (e) => e.preventDefault());
  listen(canvas, 'wheel', (e) => { e.preventDefault(); gfx.zoomCamera(e.deltaY); }, { passive: false });
  listen(window, 'keydown', onKeyDown);
  listen(window, 'keyup', onKeyUp);
  listen(window, 'blur', () => { keysDown.clear(); attackMoveArmed = false; });
  listen(window, 'mouseout', (e) => { if (!e.relatedTarget) lastClient = null; });

  // ── HUD update (~10 Hz) ───────────────────────────────────────────────────
  function updateHud() {
    // prune dead/captured ids
    const pruned = selection.filter(alive);
    if (pruned.length !== selection.length) setSelection(pruned);

    const state = game.state;
    if (!state) return;
    // enrich super snapshots with their structure key for HUD naming/glyphs
    if (state.player && state.player.super && !state.player.super.key) {
      state.player.super.key = FACTIONS[playerFaction].superKey;
    }
    if (state.enemy && state.enemy.super && !state.enemy.super.key) {
      state.enemy.super.key = FACTIONS[aiFaction].superKey;
    }
    // transient ping array (HUD consumes + nulls it)
    state.radarPings = pendingPings.length ? pendingPings.splice(0, pendingPings.length) : null;

    if (!minimapBase) { try { minimapBase = gfx.minimapBase(); } catch (_) { /* retry next update */ } }

    hud.update(state, {
      selection: selection.map(selEntityFor).filter(Boolean),
      factionData: FACTIONS[playerFaction],
      minimapBase,
      cameraQuad: gfx.cameraQuad(),
      fog: game.fog,
    });
  }

  // ── fixed-step loop ───────────────────────────────────────────────────────
  // Hybrid scheduler: rAF when the compositor is pumping frames, with a
  // setTimeout fallback so the game still runs under headless virtual-time
  // (where rAF never fires) or throttled tabs.
  let timer = 0;
  let stopped = false;
  function schedule() {
    if (stopped) return;
    raf = requestAnimationFrame(frame);
    timer = setTimeout(() => { cancelAnimationFrame(raf); frame(performance.now()); }, 50);
  }
  function frame(now) {
    clearTimeout(timer);
    const real = Math.min(0.25, Math.max(0, (now - last) / 1000));
    last = now;

    if (!paused && !over) {
      acc += real;
      let steps = 0;
      while (acc >= TICK && steps < MAX_STEPS) {
        enemyAI.tick(TICK);
        if (playerAI) playerAI.tick(TICK);
        game.tick(TICK);
        acc -= TICK;
        steps++;
      }
      if (steps >= MAX_STEPS) acc = 0; // drop backlog, never spiral
    }

    applyPan(real);
    gfx.update(real, game.state);

    hudAcc += real;
    if (hudAcc >= HUD_INTERVAL) { hudAcc = 0; updateHud(); }

    // test hook: heartbeat title every sim-second
    const t = Math.floor((game.state && game.state.time) || 0);
    if (t !== lastTitleT) {
      lastTitleT = t;
      const errs = window.__ERRS.length;
      document.title = `${errs ? 'IC_ERR' : 'IC_OK'} t=${t} errs=${errs}`;
    }
    schedule();
  }
  schedule();

  // center camera on player base at start
  jumpHome();

  // ── teardown ──────────────────────────────────────────────────────────────
  function teardown() {
    stopped = true;
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    for (const [target, type, fn, opt] of domListeners) target.removeEventListener(type, fn, opt);
    for (const [ev, fn] of gameListeners) game.off(ev, fn);
    marquee.remove();
    hud.destroy();
    sfx.dispose();
    gfx.dispose();
    document.title = 'Iron Command';
  }

  return { teardown };
}

// ═════════════════════════════════════════════════════════════════════════════
// Boot: test hooks + autostart, else menu.
window.__START = (faction, difficulty, opts) => startGame(faction || randomFaction(), difficulty || 'hard', opts || {});

const qs = new URLSearchParams(window.location.search);
const auto = qs.get('autostart');
if (auto) {
  const pf = qs.get('pf');
  startGame(pf && FACTIONS[pf] ? pf : randomFaction(), auto, { autodrive: true });
} else {
  showMenu();
}

// ─── IRON COMMAND — Integration (main.js) ────────────────────────────────────
// Wires sim ↔ gfx ↔ ui. Fixed-step 60hz sim inside a rAF loop.

// ── Error collector (kept for headless smoke-testing; harmless in prod) ──────
window.__ERRS = [];
function _recordErr(msg) {
  window.__ERRS.push(String(msg));
  const n = document.getElementById('err');
  if (n) n.textContent = window.__ERRS.join(' | ');
}
window.onerror = (msg, src, line) => { _recordErr(`${msg} @${src}:${line}`); };
window.addEventListener('unhandledrejection', (e) => {
  _recordErr('rejection: ' + (e.reason?.message || e.reason));
});

import { Game } from './sim/game.js';
import { AIController } from './sim/ai.js';
import { GENERALS } from './sim/units.js';
import { GfxEngine } from './gfx/renderer.js';
import { Menu } from './ui/menu.js';
import { HUD } from './ui/hud.js';

const canvas = document.getElementById('game-canvas');
const uiRoot = document.getElementById('ui-root');

const STEP = 1 / 60;
const RETICLE_RADIUS = { steel: 3, phantom: 4, hammer: 3 };
const EDGE_PAN_PX = 24;
const PAN_SPEED = 9; // tiles/sec

// ── Session state ─────────────────────────────────────────────────────────────
let game = null;
let ai = null;
let autoAi = null;          // hidden player-side AI for ?autostart smoke runs
let gfx = null;
let hud = null;
let paused = false;
let gameOverShown = false;
let lastConfig = null;       // { general, difficulty, autodrive }
let playerGeneralKey = null;
let stats = null;
let acc = 0;

// interaction mode: { type:'none' } | { type:'deploy', key } | { type:'power' }
let mode = { type: 'none' };
let selectedId = null;
let lastMouse = null;        // { x, y } client coords
const keysDown = new Set();

// ── Menu ──────────────────────────────────────────────────────────────────────
const menu = Menu(uiRoot, {
  generals: GENERALS,
  onStart: ({ general, difficulty }) => startGame({ general, difficulty }),
});

// ── Game lifecycle ────────────────────────────────────────────────────────────
function pickAiGeneral(playerKey) {
  const others = Object.keys(GENERALS).filter((k) => k !== playerKey);
  return others[Math.floor(Math.random() * others.length)];
}

function startGame(cfg) {
  teardownGame();
  lastConfig = cfg;
  playerGeneralKey = cfg.general;
  const aiGeneral = pickAiGeneral(cfg.general);

  game = new Game({ playerGeneral: cfg.general, aiGeneral, difficulty: cfg.difficulty });
  ai = new AIController(game, 'enemy', cfg.difficulty);
  autoAi = cfg.autodrive ? new AIController(game, 'player', cfg.difficulty) : null;

  gfx = new GfxEngine(canvas);
  gfx.attach(game);
  gfx.recenter();

  hud = HUD(uiRoot, {
    onDeployRequest: (unitKey) => {
      if (mode.type === 'deploy' && mode.key === unitKey) cancelMode();
      else enterDeployMode(unitKey);
    },
    onPowerRequest: () => {
      if (mode.type === 'power') cancelMode();
      else enterPowerMode();
    },
    onPause: () => togglePause(),
    onCardCancel: () => cancelMode(),
  });

  stats = { unitsBuilt: 0, unitsLost: 0, damageDealt: 0, time: 0 };
  game.on('spawn', ({ unit }) => { if (unit.side === 'player') stats.unitsBuilt++; });
  game.on('death', ({ unit }) => {
    if (unit.side === 'player') stats.unitsLost++;
    else stats.damageDealt += unit.maxHp;
  });
  game.on('gameOver', ({ winner }) => {
    stats.time = game.state.time;
    stats.damageDealt += (1000 - game.state.baseHp.enemy);
    const result = winner === 'player' ? 'win' : 'lose';
    const snapshot = { ...stats };
    setTimeout(() => {
      if (!game || gameOverShown) return;
      gameOverShown = true;
      hud.showGameOver(result, snapshot, {
        onRematch: () => startGame(lastConfig),
        onMenu: () => goToMenu(),
      });
    }, 1800);
  });

  paused = false;
  gameOverShown = false;
  acc = 0;
  cancelMode();
  setSelected(null);
  menu.hide();
}

function teardownGame() {
  if (hud) { hud.destroy(); hud = null; }
  if (gfx) { gfx.dispose(); gfx = null; }
  game = null;
  ai = null;
  autoAi = null;
  stats = null;
  paused = false;
  gameOverShown = false;
  mode = { type: 'none' };
  selectedId = null;
}

function goToMenu() {
  teardownGame();
  menu.show();
}

// ── Modes / selection ─────────────────────────────────────────────────────────
function enterDeployMode(unitKey) {
  if (!game || game.state.over) return;
  const def = GENERALS[playerGeneralKey].unitDefs[unitKey];
  if (!def) return;
  if ((game.state.cooldowns.player[unitKey] ?? 0) > 0) return;
  if (game.state.credits.player < def.cost) return;
  if (def.hero && game.state.units.some((u) => u.side === 'player' && u.def.hero)) return;
  mode = { type: 'deploy', key: unitKey };
  hud.setActiveCard(unitKey);
  gfx.showDeployZone('player', unitKey);
  gfx.hideReticle();
}

function enterPowerMode() {
  if (!game || game.state.over) return;
  if (game.state.powerCd.player > 0) return;
  mode = { type: 'power' };
  hud.setActiveCard('__power__');
  gfx.showDeployZone(null);
  if (lastMouse) {
    const p = gfx.pick(lastMouse.x, lastMouse.y);
    if (p) gfx.showReticle(p.x, p.z, RETICLE_RADIUS[playerGeneralKey] ?? 3);
  }
}

function cancelMode() {
  mode = { type: 'none' };
  if (hud) hud.setActiveCard(null);
  if (gfx) { gfx.showDeployZone(null); gfx.hideReticle(); }
}

function setSelected(unitId) {
  selectedId = unitId;
  if (gfx) gfx.setSelected(unitId);
}

function togglePause() {
  if (!game || game.state.over) return;
  if (paused) {
    paused = false;
    hud.hidePause();
  } else {
    paused = true;
    cancelMode();
    hud.showPause({
      onResume: () => { paused = false; },
      onRestart: () => startGame(lastConfig),
      onMenu: () => goToMenu(),
    });
  }
}

// ── Pointer handling ──────────────────────────────────────────────────────────
canvas.addEventListener('mousemove', (e) => {
  lastMouse = { x: e.clientX, y: e.clientY };
  if (!game || !gfx) return;
  const p = gfx.pick(e.clientX, e.clientY);
  if (!p) { gfx.setHover(null); return; }
  gfx.setHover(p.x, p.z);
  if (mode.type === 'power') {
    gfx.showReticle(p.x, p.z, RETICLE_RADIUS[playerGeneralKey] ?? 3);
  }
});

canvas.addEventListener('mouseleave', () => {
  lastMouse = null;
  if (gfx) gfx.setHover(null);
});

canvas.addEventListener('click', (e) => {
  if (!game || !gfx || paused || game.state.over) return;
  const p = gfx.pick(e.clientX, e.clientY);
  if (!p) return;

  if (mode.type === 'deploy') {
    const unit = game.deploy('player', mode.key, p.x, p.z);
    if (unit) cancelMode();
    return;
  }
  if (mode.type === 'power') {
    // Napalm: midpoint of strafe line == clicked point (line is centered on x)
    if (game.usePower('player', p.x, p.z)) cancelMode();
    return;
  }
  // Selection
  if (p.unitId != null) {
    const u = game.state.units.find((x) => x.id === p.unitId);
    if (u && u.side === 'player') { setSelected(u.id); return; }
  }
  setSelected(null);
});

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (!game || !gfx || paused || game.state.over) return;
  if (mode.type !== 'none') { cancelMode(); return; }
  if (selectedId != null) {
    const stillAlive = game.state.units.some((u) => u.id === selectedId);
    if (!stillAlive) { setSelected(null); return; }
    const p = gfx.pick(e.clientX, e.clientY);
    if (p) game.orderMove(selectedId, p.x, p.z);
  }
});

canvas.addEventListener('wheel', (e) => {
  if (!gfx) return;
  e.preventDefault();
  gfx.zoomCamera(e.deltaY);
}, { passive: false });

// ── Keyboard ──────────────────────────────────────────────────────────────────
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  keysDown.add(k);
  if (!game) return;
  if (e.repeat) return;

  if (k === 'escape') {
    if (mode.type !== 'none') { cancelMode(); return; }
    togglePause();
    return;
  }
  if (k === 'p') { togglePause(); return; }
  if (paused || game.state.over) return;

  if (k >= '1' && k <= '7') {
    const roster = GENERALS[playerGeneralKey].units;
    const key = roster[Number(k) - 1];
    if (key) {
      if (mode.type === 'deploy' && mode.key === key) cancelMode();
      else enterDeployMode(key);
    }
  } else if (k === 'q') {
    if (mode.type === 'power') cancelMode();
    else enterPowerMode();
  } else if (k === ' ') {
    e.preventDefault();
    gfx.recenter();
  } else if (k === 'h') {
    const hero = game.state.units.find((u) => u.side === 'player' && u.def.hero);
    setSelected(hero ? hero.id : null);
  }
});

window.addEventListener('keyup', (e) => keysDown.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keysDown.clear());

function tickCamera(dt) {
  if (!gfx) return;
  let dx = 0, dz = 0;
  if (keysDown.has('w')) dz -= 1;
  if (keysDown.has('s')) dz += 1;
  if (keysDown.has('a')) dx -= 1;
  if (keysDown.has('d')) dx += 1;
  // edge pan
  if (lastMouse && !paused) {
    if (lastMouse.x <= EDGE_PAN_PX) dx -= 1;
    else if (lastMouse.x >= window.innerWidth - EDGE_PAN_PX) dx += 1;
    if (lastMouse.y <= EDGE_PAN_PX) dz -= 1;
    else if (lastMouse.y >= window.innerHeight - EDGE_PAN_PX) dz += 1;
  }
  if (dx || dz) gfx.panCamera(dx * PAN_SPEED * dt, dz * PAN_SPEED * dt);
}

// ── Main loop: fixed-step sim accumulator inside rAF ──────────────────────────
let lastT = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastT) / 1000, 0.25);
  lastT = now;

  if (!game || !gfx) return;

  if (!paused && !game.state.over) {
    acc += dt;
    while (acc >= STEP) {
      ai.tick(STEP);
      if (autoAi) autoAi.tick(STEP);
      game.tick(STEP);
      acc -= STEP;
    }
  }

  tickCamera(dt);
  gfx.update(dt, game.state);      // keep rendering even while paused
  if (hud) hud.update(game.state, GENERALS, playerGeneralKey);
}
requestAnimationFrame(frame);

// ── Test hooks (?autostart=<difficulty> and window.__START) ───────────────────
window.__START = (g = 'steel', d = 'hard') => startGame({ general: g, difficulty: d });

const params = new URLSearchParams(location.search);
if (params.has('autostart')) {
  const d = params.get('autostart');
  const difficulty = ['easy', 'hard', 'brutal'].includes(d) ? d : 'hard';
  const errNode = document.createElement('div');
  errNode.id = 'err';
  errNode.style.cssText = 'position:fixed;left:4px;top:4px;z-index:999;color:#f66;font:11px monospace;pointer-events:none;max-width:60vw;';
  document.body.appendChild(errNode);
  startGame({ general: 'steel', difficulty, autodrive: true });
  // Optional pre-roll: ?autostart=hard&t=45 fast-forwards 45 sim-seconds
  const pre = Math.min(300, Number(params.get('t')) || 0);
  for (let i = 0; i < pre * 60 && !game.state.over; i++) {
    ai.tick(STEP);
    autoAi.tick(STEP);
    game.tick(STEP);
  }
  setTimeout(() => {
    const errs = window.__ERRS;
    const s = game ? game.state : null;
    document.title = errs.length
      ? 'ERR: ' + errs.slice(0, 3).join(' | ')
      : `OK t=${s ? s.time.toFixed(1) : '?'} units=${s ? s.units.length : '?'} hp=${s ? Math.round(s.baseHp.player) + '/' + Math.round(s.baseHp.enemy) : '?'}`;
    errNode.textContent = document.title;
    errNode.style.color = errs.length ? '#f66' : '#6f6';
  }, 10000);
}

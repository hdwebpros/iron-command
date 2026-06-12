// ─── FREEDOM FIGHT — GFX preview harness (dev only, not part of the game) ────
// Standalone visual test bed: instantiates GfxEngine against a mock game.
//   gfx-preview.html?scene=coalition|dominion|syndicate|neutral|effects|fog
import * as THREE from 'three';
import { GfxEngine } from './renderer.js';

const ERRS = (window.__ERRS = window.__ERRS || []);
window.addEventListener('error', (e) => ERRS.push(String(e.message || e.error || 'err')));
window.addEventListener('unhandledrejection', (e) => ERRS.push(String(e.reason || 'rejection')));

const PARAMS = new URLSearchParams(location.search);
const SCENE = PARAMS.get('scene') || 'coalition';
const LOOK = (PARAMS.get('look') || '').split(',').map(Number);   // ?look=x,z
const ZOOM = Number(PARAMS.get('zoom') || 0);                     // ?zoom=dist
const WARP = Number(PARAMS.get('warp') || 0);                     // ?warp=secs — fast-forward scene

/* ── mock game ──────────────────────────────────────────────────────────── */
let NEXT_ID = 1;
class MockGame {
  constructor() {
    this._h = {};
    this.fog = { w: 64, h: 64, cell: 2, grid: new Uint8Array(64 * 64).fill(2) };
    this.state = {
      time: 0, over: null,
      player: { faction: 'coalition', money: 10000, lowPower: false, super: null },
      enemy: { faction: 'dominion', rank: 0, super: null },
      entities: [],
    };
  }
  on(ev, fn) { (this._h[ev] = this._h[ev] || []).push(fn); }
  off(ev, fn) { const a = this._h[ev]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } }
  emit(ev, p) { const a = this._h[ev]; if (a) for (const f of [...a]) f(p); }
  entity(id) { return this.state.entities.find((e) => e.id === id); }
}

const game = new MockGame();
const E = (props) => {
  const e = {
    id: NEXT_ID++, side: 'player', kind: 'unit', key: 'trooper', faction: 'coalition',
    x: 0, z: 0, angle: -Math.PI / 2, hp: 100, maxHp: 100, vet: 0, sel: 0.8, visible: true,
    state: 'idle', powered: true,
    ...props,
  };
  game.state.entities.push(e);
  return e;
};
const removeEnt = (id) => {
  const i = game.state.entities.findIndex((e) => e.id === id);
  if (i >= 0) game.state.entities.splice(i, 1);
};

/* ── labels (preview-only text sprites) ─────────────────────────────────── */
function makeLabel(text, x, z, y = 2.2, big = false) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const c = cv.getContext('2d');
  c.font = `bold ${big ? 44 : 30}px system-ui, sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.lineWidth = 7;
  c.strokeStyle = 'rgba(10,8,6,0.9)';
  c.strokeText(text, 128, 32);
  c.fillStyle = big ? '#ffd84d' : '#f3ead8';
  c.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(cv);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
  s.scale.set(big ? 7 : 4.4, big ? 1.75 : 1.1, 1);
  s.position.set(x, y, z);
  gfx.scene.add(s);
  return s;
}

/* ── canonical keys (DESIGN §13.5) ──────────────────────────────────────── */
const KEYS = {
  coalition: {
    units: ['trooper', 'javelin', 'marksman', 'ghost', 'dozer', 'pelican', 'outrider', 'paladin', 'tempest', 'specter', 'falcon', 'meteor'],
    structures: ['commandCenter', 'fusionReactor', 'barracks', 'supplyCenter', 'warFactory', 'airfield', 'aegis', 'uplink', 'dropZone', 'orbitalLance'],
  },
  dominion: {
    units: ['conscript', 'hunter', 'hacker', 'mantis', 'dozer', 'supplyTruck', 'warmaster', 'shredder', 'dragon', 'hellstorm', 'emperor', 'vulture'],
    structures: ['commandCenter', 'fissionReactor', 'barracks', 'supplyCenter', 'warFactory', 'airfield', 'gatling', 'bunker', 'warCouncil', 'nuclearMissile'],
  },
  syndicate: {
    units: ['worker', 'militant', 'stinger', 'fanatic', 'cobra', 'technical', 'scorpion', 'quad', 'toxinTractor', 'buggy', 'scud'],
    structures: ['commandCenter', 'supplyStash', 'barracks', 'armsBazaar', 'stingerNest', 'tunnel', 'demoTrap', 'citadel', 'blackMarket', 'viperStorm'],
  },
};
const SUPER_KEY = { coalition: 'orbitalLance', dominion: 'nuclearMissile', syndicate: 'viperStorm' };

/* ── boot ───────────────────────────────────────────────────────────────── */
const canvas = document.getElementById('cv');
const gfx = new GfxEngine(canvas);
gfx.attach(game);

let tick = null;       // scene script, called every frame
const after = [];      // delayed one-shots: {t, fn}
const delay = (t, fn) => after.push({ t, fn });

/* ── faction showcase scenes ────────────────────────────────────────────── */
function buildFactionScene(faction) {
  game.state.player.faction = faction;
  const { units, structures } = KEYS[faction];
  makeLabel(faction.toUpperCase(), 0, 26, 5, true);

  const ROWS = PARAMS.get('rows') || 'all';   // debug: usv combo — u=units, s=structures+states, v=vignette
  const has = (c) => ROWS === 'all' || ROWS.includes(c);

  // units row
  const us = 3.4;
  const ux0 = -((units.length - 1) / 2) * us;
  const NU = Number(PARAMS.get('n') || units.length);   // debug: only first N units
  if (has('u')) units.slice(0, NU).forEach((key, i) => {
    E({ key, faction, x: ux0 + i * us, z: 16, angle: 0 });   // angle 0 → correct units face screen-right (side profile)
    makeLabel(key, ux0 + i * us, 16 + 1.6, key === 'pelican' || key === 'specter' || key === 'falcon' || key === 'meteor' || key === 'vulture' ? 7.6 : 2.4);
  });
  if (has('s')) {

  // structures row
  const ss = 7.5;
  const sx0 = -((structures.length - 1) / 2) * ss;
  let superId = null;
  structures.forEach((key, i) => {
    const e = E({ key, faction, kind: 'structure', x: sx0 + i * ss, z: 2, hp: 2000, maxHp: 2000, sel: 2.6 });
    if (key === SUPER_KEY[faction]) superId = e.id;
    makeLabel(key, sx0 + i * ss, 2 + 3.6, 5.4);
  });
  game.state.player.super = { id: superId, charge: 168, total: 240, ready: false };

  // state-variations row
  const sv = [
    ['constructing', { key: 'barracks', kind: 'structure', building: 0.45, hp: 400, maxHp: 1000 }],
    ['damaged 40%', { key: 'warFactory', kind: 'structure', hp: 800, maxHp: 2000 }],
    ['burning 15%', { key: 'commandCenter', kind: 'structure', hp: 600, maxHp: 4000 }],
    ['power off', { key: faction === 'coalition' ? 'uplink' : faction === 'dominion' ? 'warCouncil' : 'citadel', kind: 'structure', powered: false }],
    ['husk', { key: units[7] || 'paladin', kind: 'husk', side: 'neutral' }],
    ['veteran x3', { key: units[7] || 'paladin', vet: 3 }],
    ['stealthed', { key: units[3], stealthed: true }],
    ['enemy tint', { key: units[7] || 'paladin', side: 'enemy' }],
  ];
  const vx0 = -((sv.length - 1) / 2) * 8;
  sv.forEach(([name, props], i) => {
    E({ faction, x: vx0 + i * 8, z: -14, ...props });
    makeLabel(name, vx0 + i * 8, -14 + 2.6, 4.6);
  });
  }
  if (!game.state.player.super) game.state.player.super = { id: null, charge: 168, total: 240, ready: false };

  // base vignette
  if (has('v')) {
  const bx = 0, bz = -32;
  makeLabel('base vignette', bx, bz + 9, 5);
  E({ key: 'commandCenter', faction, kind: 'structure', x: bx, z: bz, sel: 3 });
  E({ key: structures[1], faction, kind: 'structure', x: bx - 9, z: bz + 1.5, sel: 2 });
  E({ key: 'barracks', faction, kind: 'structure', x: bx + 9, z: bz + 1, sel: 2.3 });
  E({ key: structures[3], faction, kind: 'structure', x: bx - 8, z: bz - 7, sel: 2.6 });
  E({ key: structures[4], faction, kind: 'structure', x: bx + 9, z: bz - 7.5, sel: 2.8 });
  const dKey = faction === 'coalition' ? 'aegis' : faction === 'dominion' ? 'gatling' : 'stingerNest';
  E({ key: dKey, faction, kind: 'structure', x: bx - 3, z: bz + 6.5, sel: 1.4 });
  E({ key: dKey, faction, kind: 'structure', x: bx + 3.5, z: bz + 6.8, sel: 1.4 });
  for (let i = 0; i < 5; i++) E({ key: units[Math.min(7, 1 + i)], faction, x: bx - 5 + i * 2.4, z: bz + 10.5 });
  }

  gfx.jumpTo(0, -2);
  gfx._distT = gfx._dist = 52;
  tick = (t, dt) => {
    // slow camera drift over rows for screenshots
    game.state.player.super.charge = (game.state.player.super.charge + dt * 10) % 240;
  };
}

/* ── neutral scene ──────────────────────────────────────────────────────── */
function buildNeutralScene() {
  makeLabel('NEUTRAL / WORLD', 0, 16, 5, true);
  const items = [
    ['supplyDock', { key: 'supplyDock', kind: 'structure', side: 'neutral', faction: null, sel: 2.4 }],
    ['supplyPile', { key: 'supplyPile', kind: 'structure', side: 'neutral', faction: null, sel: 1.2 }],
    ['oilDerrick', { key: 'oilDerrick', kind: 'structure', side: 'neutral', faction: null, sel: 1.7 }],
    ['civBuilding', { key: 'civBuilding', kind: 'structure', side: 'neutral', faction: null, sel: 2 }],
    ['crate', { key: 'crate', kind: 'crate', side: 'neutral', faction: null, sel: 0.6 }],
  ];
  const x0 = -((items.length - 1) / 2) * 9;
  items.forEach(([name, props], i) => {
    E({ x: x0 + i * 9, z: 6, ...props });
    makeLabel(name, x0 + i * 9, 6 + 3, 4);
  });

  // garrisoned civ building (player flag) + capture-in-progress derrick
  const troop = E({ key: 'trooper', faction: 'coalition', x: -40, z: -10 });
  const civ = E({ key: 'civBuilding', kind: 'structure', side: 'neutral', faction: null, x: -14, z: -10, sel: 2, garrison: [troop.id] });
  makeLabel('garrisoned (player)', -14, -7, 4);
  E({ key: 'oilDerrick', kind: 'structure', side: 'neutral', faction: null, x: 0, z: -10, sel: 1.7, capture: { by: 'player', progress: 0.6 } });
  makeLabel('capturing 60%', 0, -7, 4);

  // husks of each faction's tank
  const husks = [['paladin', 'coalition'], ['warmaster', 'dominion'], ['scorpion', 'syndicate']];
  husks.forEach(([key, faction], i) => {
    E({ key, faction, kind: 'husk', side: 'neutral', x: 12 + i * 6, z: -10 });
    makeLabel('husk:' + key, 12 + i * 6, -7.6, 3.2);
  });

  gfx.jumpTo(0, -2);
  gfx._distT = gfx._dist = 34;
  let capT = 0;
  tick = (t, dt) => {
    capT += dt;
    const d = game.state.entities.find((e) => e.capture);
    if (d) d.capture.progress = (capT * 0.12) % 1;
  };
}

/* ── effects scene ──────────────────────────────────────────────────────── */
function buildEffectsScene() {
  game.state.player.faction = 'coalition';
  game.state.enemy.faction = 'dominion';
  makeLabel('EFFECTS', 0, 30, 6, true);

  // two firing lines
  const blue = [], red = [];
  for (let i = 0; i < 4; i++) {
    blue.push(E({ key: 'paladin', faction: 'coalition', x: -12, z: -6 + i * 4, angle: 0, vet: i % 4 }));
    red.push(E({ key: 'warmaster', faction: 'dominion', side: 'enemy', x: 12, z: -6 + i * 4, angle: Math.PI }));
  }
  const inf = [];
  for (let i = 0; i < 4; i++) {
    inf.push(E({ key: 'trooper', faction: 'coalition', x: -9, z: -8 + i * 1.6, angle: 0 }));
    inf.push(E({ key: 'conscript', faction: 'dominion', side: 'enemy', x: 9, z: -8 + i * 1.6, angle: Math.PI }));
  }
  const dragon = E({ key: 'dragon', faction: 'dominion', side: 'enemy', x: 8, z: 8, angle: Math.PI });
  const toxin = E({ key: 'toxinTractor', faction: 'syndicate', side: 'enemy', x: 8, z: 12, angle: Math.PI });
  const sniper = E({ key: 'marksman', faction: 'coalition', x: -9, z: 10, angle: 0 });
  const tempest = E({ key: 'tempest', faction: 'coalition', x: -16, z: 12, angle: 0 });
  const buggy = E({ key: 'buggy', faction: 'syndicate', side: 'enemy', x: 16, z: -12, angle: Math.PI, salvage: 2 });

  // superweapon structures (idle glow / charging / ready states)
  const lance = E({ key: 'orbitalLance', faction: 'coalition', kind: 'structure', x: -30, z: 20, sel: 2.8 });
  const nuke = E({ key: 'nuclearMissile', faction: 'dominion', side: 'enemy', kind: 'structure', x: 30, z: 20, sel: 2.8 });
  const viper = E({ key: 'viperStorm', faction: 'syndicate', side: 'enemy', kind: 'structure', x: 30, z: -22, sel: 2.7 });
  makeLabel('orbitalLance (charging)', -30, 25.5, 6);
  makeLabel('nuclearMissile (READY)', 30, 25.5, 6);
  makeLabel('viperStorm (READY)', 30, -17, 6);
  game.state.player.super = { id: lance.id, charge: 120, total: 240, ready: false };
  game.state.enemy.super = { charge: 300, total: 300, ready: true };

  gfx.setSelected([blue[0].id, blue[1].id]);
  gfx.showReticle(0, -22, 6, 0xffb347);
  gfx.showGhost('barracks', 'coalition', -26, -16, true);
  makeLabel('placement ghost', -26, -11.5, 4.4);
  gfx.jumpTo(0, 0);
  gfx._distT = gfx._dist = 46;

  const fireT = { cannon: 0, small: 0.3, flame: 0.8, arty: 2, death: 4, superT: 1.5, crate: 3, rally: 2 };
  let superPhase = 0;
  tick = (t, dt) => {
    // cannon duel
    fireT.cannon -= dt;
    if (fireT.cannon <= 0) {
      fireT.cannon = 1.1;
      for (let i = 0; i < blue.length; i++) {
        const a = blue[i], b = red[i % red.length];
        game.emit('attack', { id: a.id, targetId: b.id, weapon: 'cannon' });
        game.emit('projectile', { fromX: a.x, fromZ: a.z, toX: b.x, toZ: b.z, weapon: 'cannon', flightTime: 0.5, arc: false });
        delay(0.5, () => game.emit('hit', { x: b.x, z: b.z, weapon: 'cannon', radius: 1.5 }));
        const t2 = blue[(i + 1) % blue.length];
        game.emit('attack', { id: b.id, targetId: t2.id, weapon: 'cannon' });
        game.emit('projectile', { fromX: b.x, fromZ: b.z, toX: t2.x, toZ: t2.z, weapon: 'cannon', flightTime: 0.5, arc: false });
        delay(0.55, () => game.emit('hit', { x: t2.x, z: t2.z, weapon: 'cannon', radius: 1.5 }));
      }
    }
    // small arms + sniper
    fireT.small -= dt;
    if (fireT.small <= 0) {
      fireT.small = 0.55;
      for (let i = 0; i < inf.length; i += 2) {
        game.emit('attack', { id: inf[i].id, targetId: inf[i + 1].id, weapon: 'smallArms' });
        game.emit('attack', { id: inf[i + 1].id, targetId: inf[i].id, weapon: 'smallArms' });
      }
      game.emit('attack', { id: sniper.id, targetId: dragon.id, weapon: 'sniper' });
    }
    // flame + toxin cones
    fireT.flame -= dt;
    if (fireT.flame <= 0) {
      fireT.flame = 1.4;
      game.emit('attack', { id: dragon.id, targetId: inf[0].id, weapon: 'flame' });
      game.emit('attack', { id: toxin.id, targetId: inf[2].id, weapon: 'toxin' });
      delay(0.4, () => game.emit('hit', { x: inf[0].x, z: inf[0].z, weapon: 'flame', radius: 1.5 }));
      delay(0.4, () => game.emit('hit', { x: inf[2].x, z: inf[2].z, weapon: 'toxin', radius: 1.5 }));
    }
    // arcing artillery + buggy volley
    fireT.arty -= dt;
    if (fireT.arty <= 0) {
      fireT.arty = 3.4;
      game.emit('attack', { id: tempest.id, targetId: buggy.id, weapon: 'missile' });
      game.emit('projectile', { fromX: tempest.x, fromZ: tempest.z, toX: buggy.x, toZ: buggy.z, weapon: 'missile', flightTime: 1.4, arc: true });
      delay(1.4, () => game.emit('hit', { x: buggy.x, z: buggy.z, weapon: 'missile', radius: 3 }));
      game.emit('attack', { id: buggy.id, targetId: tempest.id, weapon: 'missile' });
      for (let s = 0; s < 4; s++) {
        delay(s * 0.12, () => game.emit('projectile', { fromX: buggy.x, fromZ: buggy.z, toX: tempest.x + s * 0.8 - 1.6, toZ: tempest.z, weapon: 'missile', flightTime: 1.1, arc: true }));
        delay(s * 0.12 + 1.1, () => game.emit('hit', { x: tempest.x + s * 0.8 - 1.6, z: tempest.z, weapon: 'missile', radius: 2 }));
      }
    }
    // deaths + respawns
    fireT.death -= dt;
    if (fireT.death <= 0) {
      fireT.death = 6.5;
      const m = E({ key: 'militant', faction: 'syndicate', side: 'enemy', x: 4, z: -10 });
      const s = E({ key: 'scorpion', faction: 'syndicate', side: 'enemy', x: 0, z: -14 });
      const f = E({ key: 'falcon', faction: 'coalition', x: -4, z: -18 });
      delay(1.0, () => { game.emit('death', { id: m.id, x: m.x, z: m.z, key: m.key, kind: 'unit', side: m.side }); removeEnt(m.id); });
      delay(1.5, () => { game.emit('death', { id: s.id, x: s.x, z: s.z, key: s.key, kind: 'unit', side: s.side }); removeEnt(s.id); });
      delay(2.4, () => { game.emit('death', { id: f.id, x: f.x, z: f.z, key: f.key, kind: 'unit', side: f.side }); removeEnt(f.id); });
      delay(1.6, () => game.emit('crateSpawn', { id: 0, x: 0, z: -14 }));
      const b = E({ key: 'supplyCenter', faction: 'dominion', side: 'enemy', kind: 'structure', x: -2, z: -26, sel: 2.6 });
      delay(3.2, () => { game.emit('death', { id: b.id, x: b.x, z: b.z, key: b.key, kind: 'structure', side: b.side }); removeEnt(b.id); });
    }
    // superweapon spectacle cycle: lance → nuke → viper, every 8s
    fireT.superT -= dt;
    if (fireT.superT <= 0) {
      fireT.superT = 8;
      const phase = superPhase++ % 3;
      if (phase === 0) game.emit('superLaunch', { side: 'player', key: 'orbitalLance', x: 0, z: -24 });
      else if (phase === 1) {
        game.emit('superLaunch', { side: 'enemy', key: 'nuclearMissile', x: 0, z: -24 });
        delay(4.2, () => game.emit('superImpact', { side: 'enemy', key: 'nuclearMissile', x: 0, z: -24 }));
      } else {
        game.emit('superLaunch', { side: 'enemy', key: 'viperStorm', x: 0, z: -24 });
        delay(8, () => game.emit('superImpact', { side: 'enemy', key: 'viperStorm', x: 0, z: -24 }));
      }
    }
    // crate glint + capture flash + rally flash
    fireT.crate -= dt;
    if (fireT.crate <= 0) {
      fireT.crate = 5;
      game.emit('cratePickup', { id: 0, x: 16, z: -12 });
      game.emit('captureComplete', { id: 0, newSide: 'player' });
    }
    fireT.rally -= dt;
    if (fireT.rally <= 0) {
      fireT.rally = 4;
      gfx.flashRally(lance.id, -22, 6);
    }
    // charge the lance
    const sup = game.state.player.super;
    sup.charge = Math.min(sup.total, sup.charge + dt * 8);
    sup.ready = sup.charge >= sup.total;
  };
}

/* ── fog scene ──────────────────────────────────────────────────────────── */
function buildFogScene() {
  makeLabel('FOG OF WAR', 0, 30, 7, true);
  // grid: west band visible, mid band explored, east band shroud + scout circle
  const grid = game.fog.grid;
  for (let cz = 0; cz < 64; cz++) {
    for (let cx = 0; cx < 64; cx++) {
      const x = cx * 2 - 64 + 1;
      grid[cz * 64 + cx] = x < -12 ? 2 : x < 14 ? 1 : 0;
    }
  }
  // scout vision bubble in the shroud
  const scout = { x: 34, z: 8, r: 9 };
  for (let cz = 0; cz < 64; cz++) {
    for (let cx = 0; cx < 64; cx++) {
      const x = cx * 2 - 64 + 1, z = cz * 2 - 64 + 1;
      if (Math.hypot(x - scout.x, z - scout.z) < scout.r) grid[cz * 64 + cx] = 2;
      else if (Math.hypot(x - scout.x, z - scout.z) < scout.r + 5 && grid[cz * 64 + cx] === 0) grid[cz * 64 + cx] = 1;
    }
  }
  makeLabel('visible', -36, 24, 4);
  makeLabel('explored (dim)', 0, 24, 4);
  makeLabel('shroud', 40, 24, 4);

  // player units everywhere (always visible)
  E({ key: 'paladin', faction: 'coalition', x: -36, z: 0 });
  E({ key: 'trooper', faction: 'coalition', x: -32, z: 4 });
  E({ key: 'outrider', faction: 'coalition', x: scout.x, z: scout.z });
  E({ key: 'marksman', faction: 'coalition', x: -30, z: -6, stealthed: true });
  makeLabel('own stealth (ghosted)', -30, -3.6, 3.4);

  // enemy: visible in lit area, hidden elsewhere
  E({ key: 'warmaster', faction: 'dominion', side: 'enemy', x: -40, z: -10, visible: true });
  E({ key: 'warmaster', faction: 'dominion', side: 'enemy', x: 0, z: -10, visible: false });
  E({ key: 'warFactory', faction: 'dominion', side: 'enemy', kind: 'structure', x: 4, z: 6, sel: 2.8, visible: true }); // explored structure stays
  E({ key: 'warmaster', faction: 'dominion', side: 'enemy', x: 40, z: -8, visible: false });
  E({ key: 'gatling', faction: 'dominion', side: 'enemy', kind: 'structure', x: 36, z: 12, sel: 1.4, visible: true }); // inside scout bubble
  makeLabel('enemy hidden here', 0, -7, 3.4);

  gfx.jumpTo(0, 2);
  gfx._distT = gfx._dist = 56;
  tick = () => {};
}

/* ── air scene: aircraft tucked behind tall structures — they must render on
   top (depth-cleared AIR_LAYER pass), never clipped by the buildings ──────── */
function buildAirScene() {
  makeLabel('AIR ON TOP', 0, 30, 7, true);
  // tall structures in front (camera looks from +z), aircraft right behind them
  E({ key: 'orbitalLance', faction: 'coalition', kind: 'structure', x: -8, z: 0, sel: 2.8 });
  E({ key: 'pelican', faction: 'coalition', x: -8, z: -2.5 });
  makeLabel('pelican behind lance', -8, 8.5, 4);
  E({ key: 'uplink', faction: 'coalition', kind: 'structure', x: 8, z: 0, sel: 2.8 });
  E({ key: 'falcon', faction: 'coalition', x: 8, z: -2 });
  makeLabel('falcon behind uplink', 8, 8.5, 4);
  gfx.jumpTo(0, -1);
  gfx._distT = gfx._dist = 22;
  tick = () => {};
}

/* ── perf scene: 160 entities under combat load ─────────────────────────── */
function buildPerfScene() {
  makeLabel('PERF 160', 0, 30, 6, true);
  const all = [];
  const fac = ['coalition', 'dominion', 'syndicate'];
  const uk = { coalition: KEYS.coalition.units, dominion: KEYS.dominion.units, syndicate: KEYS.syndicate.units };
  for (let i = 0; i < 120; i++) {
    const f = fac[i % 3];
    const keys = uk[f];
    all.push(E({
      key: keys[i % keys.length], faction: f, side: i % 2 ? 'enemy' : 'player',
      x: -45 + (i % 16) * 6, z: -36 + Math.floor(i / 16) * 6, vet: i % 4,
      hp: 40 + (i % 60), maxHp: 100,
    }));
  }
  for (let i = 0; i < 40; i++) {
    const f = fac[i % 3];
    const keys = KEYS[f].structures;
    all.push(E({
      key: keys[i % keys.length], faction: f, side: i % 2 ? 'enemy' : 'player', kind: 'structure',
      x: -48 + (i % 10) * 10.5, z: 14 + Math.floor(i / 10) * 11, sel: 2.5,
      hp: 700, maxHp: 2000,
    }));
  }
  gfx.jumpTo(0, 0);
  gfx._distT = gfx._dist = 58;
  let ft = 0;
  tick = (t, dt) => {
    ft -= dt;
    if (ft <= 0) {
      ft = 0.5;
      for (let i = 0; i < 10; i++) {
        const a = all[(Math.random() * 120) | 0], b = all[(Math.random() * 120) | 0];
        game.emit('attack', { id: a.id, targetId: b.id, weapon: 'smallArms' });
      }
      game.emit('projectile', { fromX: -20, fromZ: 0, toX: 20, toZ: 0, weapon: 'missile', flightTime: 1, arc: true });
      delay(1, () => game.emit('hit', { x: 20, z: 0, weapon: 'missile', radius: 2 }));
    }
    // everyone strolls
    for (let i = 0; i < all.length; i++) {
      const e = all[i];
      if (e.kind !== 'unit') continue;
      e.x += Math.sin(t * 0.6 + i) * dt * 1.5;
      e.z += Math.cos(t * 0.5 + i * 1.3) * dt * 1.5;
    }
  };
}

/* ── model-pack evaluation scene (CC0 packs in /public/models) ──────────── */
// ?scene=models — lays out downloaded GLTF/FBX models next to the current
// procedural units for a side-by-side art-direction comparison.
const mixers = [];
async function buildModelsScene() {
  makeLabel('MODEL PACK EVAL', 0, 36, 6, true);
  gfx.jumpTo(0, 4);
  gfx._distT = gfx._dist = 56;
  tick = (t, dt) => { for (const m of mixers) m.update(dt); };
  const [{ GLTFLoader }, { FBXLoader }] = await Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/loaders/FBXLoader.js'),
  ]);
  const gltf = new GLTFLoader();
  const fbx = new FBXLoader();

  // fit: 'h' scales to a target height, 'l' to a target footprint length
  const fitAndPlace = (obj, fit, size, x, z, rotY) => {
    const box = new THREE.Box3().setFromObject(obj);
    const d = box.getSize(new THREE.Vector3());
    const cur = fit === 'h' ? d.y : Math.max(d.x, d.z);
    obj.scale.multiplyScalar(size / (cur || 1));
    obj.rotation.y = rotY ?? Math.PI;
    box.setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3());
    obj.position.x += x - c.x;
    obj.position.z += z - c.z;
    obj.position.y += -box.min.y;
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
    gfx.scene.add(obj);
  };
  const playClip = (obj, clips) => {
    if (!clips || !clips.length) return;
    const clip = clips.find((c) => /idle/i.test(c.name)) || clips[0];
    const mx = new THREE.AnimationMixer(obj);
    mx.clipAction(clip).play();
    mixers.push(mx);
  };
  const load = async (m) => {
    try {
      if (m.url.endsWith('.fbx')) {
        const obj = await fbx.loadAsync(m.url);
        fitAndPlace(obj, m.fit, m.size, m.x, m.z, m.rotY);
        playClip(obj, obj.animations);
        return obj;
      }
      const g = await gltf.loadAsync(m.url);
      fitAndPlace(g.scene, m.fit, m.size, m.x, m.z, m.rotY);
      playClip(g.scene, g.animations);
      return g.scene;
    } catch (e) {
      ERRS.push(m.url + ': ' + (e.message || e));
      return null;
    }
  };

  const rows = [
    ['TANKS (Quaternius animated)', 28, [
      ...['Tank', 'Tank2', 'Tank3', 'Tank4'].map((n, i) => ({ url: `/models/tanks/${n}.fbx`, label: n, fit: 'l', size: 3.4, x: -22 + i * 5 })),
      { url: '/models/toonshooter/env/Tank.gltf', label: 'ToonShooter Tank', fit: 'l', size: 3.4, x: -2 },
    ], [['paladin', 'coalition'], ['warmaster', 'dominion'], ['scorpion', 'syndicate']]],
    ['MECHS (textured)', 18, ['George', 'Leela', 'Mike', 'Stan'].map((n, i) => ({ url: `/models/mech/${n}.gltf`, label: n, fit: 'h', size: 2.4, x: -22 + i * 5.5 })),
      [['emperor', 'dominion'], ['shredder', 'dominion']]],
    ['TURRETS', 9, ['Cannon_1', 'Cannon_4', 'Cannon_6', 'Gun_8', 'Gun_10', 'Laser_Doble', 'Laser_MachineGun', 'Long_1', 'Long_2'].map((n, i) => ({ url: `/models/turrets/${n}.fbx`, label: n, fit: 'h', size: 1.8, x: -24 + i * 4 })),
      [['gatling', 'dominion', 'structure'], ['aegis', 'coalition', 'structure']]],
    ['INFANTRY (animated)', 0, ['Character_Soldier', 'Character_Enemy', 'Character_Hazmat'].map((n, i) => ({ url: `/models/toonshooter/chars/${n}.gltf`, label: n.replace('Character_', ''), fit: 'h', size: 1.3, x: -22 + i * 3 })),
      [['trooper', 'coalition'], ['conscript', 'dominion'], ['militant', 'syndicate']]],
    ['STRUCTURES (ToonShooter env)', -12, [
      ...[1, 2, 3, 4].map((n, i) => ({ url: `/models/toonshooter/env/Structure_${n}.gltf`, label: 'Structure_' + n, fit: 'h', size: 4.5, x: -26 + i * 8 })),
      { url: '/models/toonshooter/env/SackTrench.gltf', label: 'SackTrench', fit: 'l', size: 2.6, x: 6 },
      { url: '/models/toonshooter/env/Barrier_Large.gltf', label: 'Barrier', fit: 'l', size: 2.4, x: 11 },
    ], [['barracks', 'coalition', 'structure'], ['bunker', 'dominion', 'structure']]],
  ];

  for (const [title, z, models, compare] of rows) {
    makeLabel(title, -32, z, 4.4);
    for (const m of models) {
      load({ ...m, z });
      makeLabel(m.label, m.x, z + 1.8, m.fit === 'h' && m.size > 3 ? 6 : 2.6);
    }
    // current procedural units, right of the row, for comparison
    (compare || []).forEach(([key, faction, kind], i) => {
      E({ key, faction, kind: kind || 'unit', x: 18 + i * 5, z, sel: kind ? 2.4 : 0.9 });
      makeLabel('now: ' + key, 18 + i * 5, z + 2, kind ? 5 : 2.8);
    });
  }

  // faction-tint probe: soldier lerped toward each faction color
  const SkeletonUtils = await import('three/addons/utils/SkeletonUtils.js');
  const tintBase = await gltf.loadAsync('/models/toonshooter/chars/Character_Soldier.gltf').catch(() => null);
  if (tintBase) {
    makeLabel('tint probe', -32, -22, 4.4);
    const tints = [['coalition', 0x3f7fd2], ['dominion', 0xc23b2e], ['syndicate', 0xc9a227]];
    tints.forEach(([name, color], i) => {
      const clone = SkeletonUtils.clone(tintBase.scene);
      clone.traverse((o) => {
        if (!o.isMesh) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        o.material = Array.isArray(o.material) ? mats.map((m) => m.clone()) : mats[0].clone();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.color.lerp(new THREE.Color(color), 0.45));
      });
      fitAndPlace(clone, 'h', 1.05, -26 + i * 3, -22);
      playClip(clone, tintBase.animations);
      makeLabel(name, -26 + i * 3, -20.2, 2.6);
    });
  }

}

/* ── debug: bare createModelMesh instances, no renderer records ─────────── */
async function buildInstScene() {
  const M = await import('./models.js');
  if (!PARAMS.get('early')) await M.preloadModels();
  const list = [];
  for (const f of ['coalition', 'dominion', 'syndicate'])
    for (const k of Object.keys({ trooper: 1, javelin: 1, marksman: 1, ghost: 1, conscript: 1, hunter: 1, hacker: 1, mantis: 1, worker: 1, militant: 1, stinger: 1, fanatic: 1, cobra: 1 }))
      if (PARAMS.get('early') ? KEYS[f].units.includes(k) : M.hasModel(f, k)) list.push([f, k]);
  const { createEntityMesh } = await import('./meshes.js');
  list.forEach(([f, k], i) => {
    const x = -18 + (i % 8) * 5, z = 12 - Math.floor(i / 8) * 6;
    if (PARAMS.get('mock')) {
      E({ key: k, faction: f, x, z, angle: 0 });
    } else {
      const g = PARAMS.get('ent') ? createEntityMesh({ key: k, faction: f, side: 'player', kind: 'unit' }) : M.createModelMesh(f, k);
      g.position.set(x, 0, z);
      gfx.scene.add(g);
      if (g.userData.anim) mixers.push(g.userData.anim.mixer);
    }
    makeLabel(`${f.slice(0, 3)}:${k}`, x, z + 1.8, 2.2);
  });
  if (LOOK.length === 2 && !Number.isNaN(LOOK[0])) gfx.jumpTo(LOOK[0], LOOK[1]);
  else gfx.jumpTo(0, 4);
  gfx._distT = gfx._dist = ZOOM || 30;
  tick = (t, dt) => { for (const m of mixers) m.update(dt); };
}

/* ── debug: dump FBX hierarchy + animation tracks as <pre> (dev only) ───── */
async function buildDumpScene() {
  const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
  const url = PARAMS.get('url') || '/models/tanks/Tank2.fbx';
  let obj;
  if (PARAMS.get('inst')) {
    const M = await import('./models.js');
    await M.preloadModels();
    obj = M.createModelMesh(PARAMS.get('f') || 'coalition', PARAMS.get('k') || 'paladin');
    obj.updateWorldMatrix(true, true);
    const lines2 = ['INSTANCE ' + (PARAMS.get('k') || 'paladin')];
    const wp = new THREE.Vector3(), ws = new THREE.Vector3();
    obj.traverse((o) => {
      if (!o.name && !o.isMesh) return;
      o.getWorldPosition(wp); o.getWorldScale(ws);
      const bb = o.isMesh ? new THREE.Box3().setFromObject(o) : null;
      lines2.push(`${o.type} "${o.name}" world=(${wp.toArray().map((v) => v.toFixed(2))}) wscl=(${ws.toArray().map((v) => v.toFixed(4))})` +
        (bb ? ` bbox=(${bb.min.toArray().map((v) => v.toFixed(2))})..(${bb.max.toArray().map((v) => v.toFixed(2))})` : ''));
    });
    const pre2 = document.createElement('pre');
    pre2.id = 'dump';
    pre2.textContent = lines2.join('\n');
    document.body.appendChild(pre2);
    tick = () => {};
    return;
  }
  if (PARAMS.get('parse')) {
    const buf = await (await fetch(url)).arrayBuffer();
    obj = new FBXLoader().parse(buf, PARAMS.get('path') ?? '');
  } else {
    obj = await new FBXLoader().loadAsync(url);
  }
  const lines = ['URL ' + url + (PARAMS.get('parse') ? ' (fetch+parse)' : ' (loadAsync)')];
  obj.updateWorldMatrix(true, true);
  for (const nm of ['Tank_Turret', 'Tank_Gun', 'Tank_body', 'TrackMeshL']) {
    const n = obj.getObjectByName(nm);
    if (!n) continue;
    const bb = new THREE.Box3().setFromObject(n);
    lines.push(`BBOX ${nm}: (${bb.min.toArray().map((v) => v.toFixed(1))})..(${bb.max.toArray().map((v) => v.toFixed(1))})`);
  }
  obj.traverse((o) => {
    let d = 0, p = o;
    while (p !== obj && p.parent) { d++; p = p.parent; }
    lines.push(
      '  '.repeat(d) + `${o.type} "${o.name}" pos=(${o.position.toArray().map((v) => v.toFixed(2))}) scl=(${o.scale.toArray().map((v) => v.toFixed(3))}) rot=(${o.rotation.toArray().slice(0, 3).map((v) => Number(v).toFixed(3))})` +
      (o.isSkinnedMesh ? ` bones=${o.skeleton.bones.length}` : '')
    );
  });
  for (const a of obj.animations || []) {
    lines.push(`CLIP "${a.name}" dur=${a.duration.toFixed(2)}`);
    for (const t of a.tracks) lines.push(`  TRACK ${t.name} n=${t.times.length} v0=(${[...t.values.slice(0, 4)].map((v) => Number(v).toFixed(2))})`);
  }
  const pre = document.createElement('pre');
  pre.id = 'dump';
  pre.textContent = lines.join('\n');
  document.body.appendChild(pre);
  tick = () => {};
}

/* ── scene select ───────────────────────────────────────────────────────── */
switch (SCENE) {
  case 'dominion': buildFactionScene('dominion'); break;
  case 'syndicate': buildFactionScene('syndicate'); break;
  case 'neutral': buildNeutralScene(); break;
  case 'effects': buildEffectsScene(); break;
  case 'fog': buildFogScene(); break;
  case 'air': buildAirScene(); break;
  case 'perf': buildPerfScene(); break;
  case 'models': tick = () => {}; buildModelsScene(); break;
  case 'inst': tick = () => {}; buildInstScene(); break;
  case 'dump': tick = () => {}; buildDumpScene(); break;
  default: buildFactionScene('coalition');
}

// optional camera override for close-up screenshots
if (LOOK.length === 2 && Number.isFinite(LOOK[0]) && Number.isFinite(LOOK[1])) gfx.jumpTo(LOOK[0], LOOK[1]);
if (ZOOM > 0) { gfx._distT = gfx._dist = ZOOM; }

/* ── minimap snapshot in the corner ─────────────────────────────────────── */
try {
  const mm = gfx.minimapBase();
  mm.style.cssText = 'position:fixed;right:10px;bottom:10px;width:160px;height:160px;border:2px solid #fff5;z-index:5;';
  document.body.appendChild(mm);
} catch (e) { ERRS.push('minimap: ' + e.message); }

/* ── main loop ──────────────────────────────────────────────────────────── */
let last = null;
let elapsed = 0;
function step(dt) {
  elapsed += dt;
  game.state.time = elapsed;
  for (let i = after.length - 1; i >= 0; i--) {
    after[i].t -= dt;
    if (after[i].t <= 0) { const fn = after[i].fn; after.splice(i, 1); try { fn(); } catch (e) { ERRS.push(String(e)); } }
  }
  try { tick?.(elapsed, dt); } catch (e) { ERRS.push(String(e)); }
  try {
    const t0 = performance.now();
    gfx.update(dt, game.state);
    updMs = updMs * 0.95 + (performance.now() - t0) * 0.05;   // rolling avg
  } catch (e) { ERRS.push(String(e)); }
}
let updMs = 0;
function frame(now) {
  const dt = last == null ? 0.016 : Math.max(0.001, Math.min(0.1, (now - last) / 1000));
  last = now;
  // fast-forward without compositing (screenshot harness)
  if (elapsed < WARP) {
    gfx.skipRender = true;
    let guard = 0;
    while (elapsed < WARP && guard++ < 40) step(1 / 30);
    gfx.skipRender = false;
  }
  step(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

setInterval(() => {
  document.title = ERRS.length
    ? ('GFX_ERR ' + ERRS.length + ': ' + ERRS[0]).slice(0, 150)
    : 'GFX_OK ' + SCENE + ' t=' + elapsed.toFixed(1) + ' upd=' + updMs.toFixed(1) + 'ms';
}, 400);

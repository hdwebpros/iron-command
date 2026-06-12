// ════════════════════════════════════════════════════════════════════════════
// IRON COMMAND — UI dev harness (NOT shipped). Cycles hand-built mock states
// through scenarios via ?scene=. Collects console errors into document.title.
//   scenes: menu, hud-early, hud-production, hud-army, hud-general, hud-super,
//           hud-lowpower, gameover, pause
// ════════════════════════════════════════════════════════════════════════════
import { Menu } from './menu.js';
import { HUD } from './hud.js';

// ── Error collection → document.title ────────────────────────────────────────
const ERRS = [];
window.__ERRS = ERRS;
window.addEventListener('error', (e) => { ERRS.push(String(e.message || e.error || e)); refreshTitle(); });
window.addEventListener('unhandledrejection', (e) => { ERRS.push('promise:' + String(e.reason)); refreshTitle(); });
const _err = console.error;
console.error = function (...a) { ERRS.push(a.map(String).join(' ')); refreshTitle(); _err.apply(console, a); };
function refreshTitle() { document.title = `UI scene=${SCENE} errs=${ERRS.length}` + (ERRS.length ? ' :: ' + ERRS[0].slice(0, 120) : ''); }

const params = new URLSearchParams(location.search);
const SCENE = params.get('scene') || 'menu';
refreshTitle();

const root = document.getElementById('ui-root');

// ── Mock faction data (shape per DESIGN §13.1) ───────────────────────────────
const FACTIONS = {
  coalition: {
    name: 'Coalition', general: 'Kira "Phantom" Voss', color: '#2e7bff',
    blurb: 'Expensive high-tech doctrine. Air superiority, laser defenses, and stealth aircraft strike from beyond the horizon.',
    superweapon: 'Orbital Lance',
    highlights: [{ key: 'falcon', name: 'Falcon Strike Fighter' }, { key: 'paladin', name: 'Paladin MBT' }, { key: 'ghost', name: 'Ghost', hero: true }],
  },
  dominion: {
    name: 'Dominion', general: 'Vance "Steel" Karov', color: '#e03c2e',
    blurb: 'Tank and infantry hordes. Cheap masses gain firepower in numbers; napalm and nuclear fire level the field.',
    superweapon: 'Nuclear Missile',
    highlights: [{ key: 'emperor', name: 'Emperor Overlord' }, { key: 'conscript', name: 'Conscript Horde' }, { key: 'mantis', name: 'Mantis', hero: true }],
  },
  syndicate: {
    name: 'Syndicate', general: 'Marcus "Hammer" Drago', color: '#3da64b',
    blurb: 'Cheap swarms, stealth, and salvage. No power grid to defend — scavenge scrap and bury the enemy in numbers.',
    superweapon: 'Viper Storm',
    highlights: [{ key: 'scorpion', name: 'Scorpion Tank' }, { key: 'fanatic', name: 'Fanatic (suicide)' }, { key: 'cobra', name: 'Cobra', hero: true }],
  },
};

// ── Mock minimap base canvas ─────────────────────────────────────────────────
function mockMinimapBase() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 256, 256);
  grd.addColorStop(0, '#3a3018'); grd.addColorStop(0.5, '#4a3c22'); grd.addColorStop(1, '#2a2212');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  // a few rock blotches
  g.fillStyle = '#221a10';
  for (let i = 0; i < 16; i++) { const x = Math.random() * 256, y = Math.random() * 256, r = 6 + Math.random() * 14; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  return c;
}
const MINIMAP_BASE = mockMinimapBase();

// ── Mock fog (64×64): center clear, surroundings explored/shroud ─────────────
function mockFog() {
  const w = 64, h = 64, grid = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const cx = x - 16, cy = y - 16; const d = Math.hypot(cx, cy);
    grid[y * w + x] = d < 14 ? 2 : d < 30 ? 1 : 0;
  }
  return { w, h, cell: 2, grid };
}

const CAMERA_QUAD = [{ x: -52, z: -52 }, { x: -22, z: -52 }, { x: -22, z: -22 }, { x: -52, z: -22 }];

// ── Mock entities helper ─────────────────────────────────────────────────────
let _id = 1;
function ent(o) { return Object.assign({ id: _id++, side: 'player', kind: 'unit', x: 0, z: 0, angle: 0, hp: 100, maxHp: 100, visible: true, vet: 0, sel: 1 }, o); }
function scatterEntities() {
  const out = [];
  out.push(ent({ kind: 'structure', key: 'commandCenter', x: -42, z: -42, hp: 4000, maxHp: 4000 }));
  out.push(ent({ kind: 'structure', key: 'barracks', x: -38, z: -46, hp: 1000, maxHp: 1000 }));
  for (let i = 0; i < 14; i++) out.push(ent({ key: i % 3 ? 'paladin' : 'trooper', x: -46 + Math.random() * 20, z: -46 + Math.random() * 20 }));
  // enemy (visible few)
  out.push(ent({ side: 'enemy', kind: 'structure', key: 'commandCenter', x: 42, z: 42, hp: 4000, maxHp: 4000, visible: false }));
  for (let i = 0; i < 5; i++) out.push(ent({ side: 'enemy', key: 'conscript', x: 8 + Math.random() * 6, z: 6 + Math.random() * 6, visible: true }));
  // neutral
  out.push(ent({ side: 'neutral', kind: 'structure', key: 'oilDerrick', x: -2, z: -34, visible: true }));
  return out;
}

function baseState(over) {
  return Object.assign({
    time: 372,
    over: null,
    player: {
      faction: 'coalition', money: 4250, powerOut: 20, powerUse: 14, lowPower: false, radar: true,
      pop: 38, popCap: 80, rank: 2, xp: 600, nextXp: 1500, points: 0, powers: {}, powerCd: {},
      super: null, upgrades: {},
    },
    enemy: { faction: 'dominion', rank: 2, super: null },
    entities: scatterEntities(),
    radarPings: [{ x: 10, z: 8, kind: 'attack' }],
  }, over);
}

// ── Build context per scene ──────────────────────────────────────────────────
function ctxFor() {
  return { selection: [], factionData: FACTIONS.coalition, minimapBase: MINIMAP_BASE, cameraQuad: CAMERA_QUAD, fog: mockFog() };
}

function findEnt(state, pred) { return state.entities.find(pred); }

// ════════════════════════════════════════════════════════════════════════════
function runMenu() {
  Menu(root, { factions: FACTIONS, onStart: (f, d) => console.log('start', f, d) });
  // Harness deep-link: ?step=faction|difficulty auto-advances for screenshots.
  const stepTo = params.get('step');
  if (stepTo === 'faction' || stepTo === 'difficulty') {
    setTimeout(() => {
      const nb = root.querySelector('[data-act="new"]'); if (nb) nb.click();
      if (stepTo === 'difficulty') setTimeout(() => { const c = root.querySelector('.ic-fac-card'); if (c) c.click(); }, 60);
    }, 60);
  }
}

function runHUD(scene) {
  const cb = {};
  ['onBuildSelect','onQueueUnit','onCancelQueue','onSell','onUpgrade','onAbility','onChoosePower','onUsePower','onFireSuper','onSetRally','onEvacuate','onPause','onMinimapNav','onMinimapTarget']
    .forEach(k => cb[k] = (...a) => console.log(k, ...a));
  const hud = HUD(root, cb);

  const state = baseState();
  const ctx = ctxFor();

  if (scene === 'hud-early') {
    // builder (dozer) selected → build menu
    const dozer = ent({ key: 'dozer', x: -40, z: -40, hp: 250, maxHp: 250 });
    state.entities.push(dozer);
    ctx.selection = [dozer];
  } else if (scene === 'hud-production') {
    const bk = findEnt(state, e => e.key === 'barracks');
    bk.queue = [{ key: 'trooper', progress: 0.6 }, { key: 'javelin', progress: 0 }, { key: 'marksman', progress: 0 }];
    bk.rally = { x: -30, z: -30 };
    ctx.selection = [bk];
  } else if (scene === 'hud-army') {
    const sel = [];
    const mix = ['trooper','trooper','paladin','paladin','javelin','marksman','outrider','tempest','specter','falcon','ghost','trooper'];
    mix.forEach((k, i) => sel.push(ent({ key: k, x: -40 + i, z: -40, hp: 60 + (i * 13) % 120, maxHp: 180, vet: i % 4, stealthed: k === 'ghost', abilityCd: k === 'ghost' ? { c4: 8 } : (k === 'trooper' ? { flashbang: 0 } : {}) })));
    ctx.selection = sel;
  } else if (scene === 'hud-general') {
    state.player.rank = 3; state.player.points = 2; state.player.xp = 900; state.player.nextXp = 2500;
    state.player.powers = { spyDrone: 1, strikeWing: 2 };
    state.player.powerCd = { strikeWing: 142 };
  } else if (scene === 'hud-super') {
    state.player.super = { id: 'orbitalLance', key: 'orbitalLance', charge: 198, total: 240, ready: false };
    state.enemy.super = { key: 'nuclearMissile', charge: 300, total: 300, ready: true };
    state.player.points = 1; state.player.powers = { strikeWing: 1 };
  } else if (scene === 'hud-lowpower') {
    state.player.powerOut = 10; state.player.powerUse = 18; state.player.lowPower = true;
    state.player.radar = false;
  }

  // initial render
  hud.update(state, ctx);

  // scene-specific EVA / supers
  if (scene === 'hud-super') {
    hud.eva('enemySuperReady');
    setTimeout(() => hud.eva('superLaunchDetected'), 300);
  } else if (scene === 'hud-lowpower') {
    hud.eva('lowPower');
  } else if (scene === 'hud-early') {
    hud.eva('constructionComplete');
  }

  // keep a light animation so progress/cooldowns visibly tick (and exercise loop)
  let t = state.time;
  const loop = () => {
    t += 1 / 30;
    state.time = t;
    if (state.player.super && !state.player.super.ready) state.player.super.charge = Math.min(state.player.super.total, state.player.super.charge + 1 / 30);
    if (state.player.powerCd.strikeWing) state.player.powerCd.strikeWing = Math.max(0, state.player.powerCd.strikeWing - 1 / 30);
    const bk = findEnt(state, e => e.key === 'barracks');
    if (bk && bk.queue && bk.queue[0]) bk.queue[0].progress = Math.min(1, bk.queue[0].progress + 0.05 / 30);
    state.radarPings = null;
    hud.update(state, ctx);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  if (scene === 'pause') hud.showPause({ onResume: () => console.log('resume'), onRestart: () => console.log('restart'), onMenu: () => console.log('menu') });
  if (scene === 'gameover') {
    const win = !params.has('lose');
    hud.showGameOver(win ? 'win' : 'lose', {
      unitsBuilt: 142, unitsLost: 67, kills: 198, moneyEarned: 84200, supersFired: 3, time: 921, rank: 4,
    }, { onRematch: () => console.log('rematch'), onMenu: () => console.log('menu') });
  }
}

// ── Dispatch ─────────────────────────────────────────────────────────────────
try {
  if (SCENE === 'menu') runMenu();
  else runHUD(SCENE);
} catch (e) {
  ERRS.push('dispatch:' + String(e && e.stack || e)); refreshTitle(); throw e;
}

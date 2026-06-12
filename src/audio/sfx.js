// src/audio/sfx.js — runtime audio: weapon/explosion SFX, EVA announcer, unit acks.
// Clips are ElevenLabs-generated mp3s served from public/sfx/ (see scripts/gen-sfx.sh
// and scripts/gen-voices.sh). Entirely event-driven off the sim; every path is a safe
// no-op when a file is missing or the AudioContext can't run (headless QA).
import { FACTIONS } from '../sim/factions.js';
import { VOICES } from './voices.js';

const BASE = (import.meta.env?.BASE_URL || './') + 'sfx/';

const SHOT = {
  smallArms: 'shot_rifle', gatling: 'shot_gatling', cannon: 'shot_cannon',
  missile: 'shot_missile', flame: 'shot_flame', toxin: 'shot_toxin',
  sniper: 'shot_sniper', beam: 'shot_beam',
};
const SUPER = { orbitalLance: 'super_beam', nuclearMissile: 'super_nuke', viperStorm: 'exp_big' };
// per-clip shot volume (default 0.7) — rapid-fire, missile, sniper and beam stay subtle
const SHOT_VOL = { shot_rifle: 0.45, shot_gatling: 0.45, shot_missile: 0.3, shot_sniper: 0.4, shot_beam: 0.4 };

// infantry keys (for death-sound choice) — defs are gone by the time 'death' fires
const INFANTRY = new Set();
for (const f of Object.values(FACTIONS)) {
  for (const [k, d] of Object.entries(f.units || {})) if (d.armor === 'infantry') INFANTRY.add(k);
}

// App-level looping music ("Dust Doctrine"): menu theme + quiet in-game track.
// One instance for the whole app — survives session teardown, crossfades on switch.
export function createMusic() {
  const TRACKS = {
    menu: { file: 'music_menu.mp3', vol: 0.45 },
    game: { file: 'music_game.mp3', vol: 0.14 },   // subtle under battle SFX
  };
  let el = null, current = null, target = 0, muted = false, fade = 0;

  function ensureEl() {
    if (el) return el;
    el = new Audio();
    el.loop = true;
    el.volume = 0;
    // autoplay is gated behind a user gesture — retry on the first one
    const kick = () => { if (el && el.paused && current) el.play().catch(() => {}); };
    window.addEventListener('pointerdown', kick);
    window.addEventListener('keydown', kick);
    return el;
  }

  function stepFade() {
    if (!el) return;
    const goal = muted ? 0 : target;
    const d = goal - el.volume;
    if (Math.abs(d) < 0.012) { el.volume = goal; clearInterval(fade); fade = 0; return; }
    el.volume += d * 0.15;
  }

  function play(name) {
    const t = TRACKS[name];
    if (!t || current === name) return;
    current = name;
    ensureEl();
    el.src = (import.meta.env?.BASE_URL || './') + 'sfx/' + t.file;
    target = t.vol;
    el.volume = muted ? 0 : t.vol * 0.3;           // start low, fade up
    el.play().catch(() => {});                      // blocked until gesture; kick retries
    if (!fade) fade = setInterval(stepFade, 80);
  }

  function setMuted(m) {
    muted = !!m;
    if (el && !fade) fade = setInterval(stepFade, 80);
  }

  return { play, setMuted };
}

export function createSfx(game, { listenerPos } = {}) {
  let ctx = null, master = null, fxBus = null, voiceBus = null;
  let muted = false, disposed = false;
  const buffers = new Map();   // name → AudioBuffer | null (null = failed, don't retry)
  const inflight = new Map();
  const lastAt = new Map();    // name → last play time (per-clip throttle)
  let active = 0;              // concurrent voices cap
  let evaBusyUntil = 0;        // serialize announcer lines
  const evaLast = new Map();   // key → last spoken (dedupe)
  let ackAt = 0, selAckAt = 0;

  function ensureCtx() {
    if (ctx || disposed) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (_) { return null; }
    master = ctx.createGain(); master.gain.value = 0.6; master.connect(ctx.destination);
    fxBus = ctx.createGain(); fxBus.connect(master);
    voiceBus = ctx.createGain(); voiceBus.connect(master);
    return ctx;
  }
  // browsers gate playback behind a user gesture — resume on the first one
  const resume = () => { ensureCtx(); if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); };
  window.addEventListener('pointerdown', resume);
  window.addEventListener('keydown', resume);

  function load(name) {
    if (buffers.has(name)) return Promise.resolve(buffers.get(name));
    if (inflight.has(name)) return inflight.get(name);
    const p = fetch(BASE + name + '.mp3')
      .then((r) => { if (!r.ok) throw new Error(); return r.arrayBuffer(); })
      .then((ab) => ctx.decodeAudioData(ab))
      .then((buf) => { buffers.set(name, buf); return buf; })
      .catch(() => { buffers.set(name, null); return null; })
      .finally(() => inflight.delete(name));
    inflight.set(name, p);
    return p;
  }

  // opts: x/z world pos (distance attenuation vs camera), vol, bus 'fx'|'voice',
  // gapMs per-clip throttle, rate playback speed (default: slight random pitch).
  function play(name, { x, z, vol = 1, bus = 'fx', gapMs = 90, rate } = {}) {
    if (muted || disposed || !ensureCtx() || ctx.state !== 'running') return;
    let g = vol;
    if (x != null && listenerPos) {
      const L = listenerPos();
      const d = Math.hypot(x - L.x, z - L.z);
      if (d > 75) return;
      g *= Math.max(0.18, 1 - d / 85);
    }
    const now = performance.now();
    if (now - (lastAt.get(name) || -1e9) < gapMs) return;
    lastAt.set(name, now);
    if (active >= 16) return;
    load(name).then((buf) => {
      if (!buf || muted || disposed) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate != null ? rate : 0.94 + Math.random() * 0.12;
      const gain = ctx.createGain(); gain.gain.value = g;
      src.connect(gain); gain.connect(bus === 'voice' ? voiceBus : fxBus);
      active++;
      src.onended = () => { active--; };
      try { src.start(); } catch (_) { active--; }
    });
  }

  // EVA announcer: one line at a time, same key at most every 6s
  function eva(key) {
    if (muted || disposed) return;
    const now = performance.now();
    if (now - (evaLast.get(key) || -1e9) < 6000) return;
    evaLast.set(key, now);
    const startIn = Math.max(0, evaBusyUntil - now);
    evaBusyUntil = Math.max(evaBusyUntil, now) + 2400;
    setTimeout(() => play('eva_' + key, { vol: 0.9, bus: 'voice', gapMs: 0, rate: 1 }), startIn);
  }

  // unit acknowledgment: action = 'select' | 'move' | 'attack'
  function ack(unitKey, action) {
    const set = VOICES[unitKey];
    const list = set && set[action];
    if (!list || !list.length) return;
    const now = performance.now();
    if (action === 'select') { if (now - selAckAt < 700) return; selAckAt = now; }
    else { if (now - ackAt < 600) return; ackAt = now; }
    const file = list[(Math.random() * list.length) | 0].replace(/\.mp3$/, '');
    play(file, { vol: 0.85, bus: 'voice', gapMs: 0, rate: 1 });
  }

  // ── sim events ─────────────────────────────────────────────────────────────
  const offs = [];
  const on = (ev, fn) => { game.on(ev, fn); offs.push([ev, fn]); };

  on('attack', (ev) => {
    const e = game.entity(ev.id);
    const n = SHOT[ev.weapon];
    if (!e || !n) return;
    play(n, { x: e.x, z: e.z, vol: SHOT_VOL[n] ?? 0.7, gapMs: 130 });
  });
  on('hit', (ev) => {
    if (ev.weapon === 'flashbang') { play('flash', { x: ev.x, z: ev.z, vol: 0.7 }); return; }
    if (!(ev.radius > 0)) return;                       // hitscan impacts: shot sound covers it
    if (ev.weapon === 'toxin' || ev.weapon === 'flame') return;
    const big = ev.radius >= 8;
    play(big ? 'exp_big' : 'exp_small', { x: ev.x, z: ev.z, vol: big ? 1 : 0.65, gapMs: 120 });
  });
  on('death', (ev) => {
    if (ev.kind === 'structure') play('die_structure', { x: ev.x, z: ev.z, vol: 0.9, gapMs: 200 });
    else if (ev.kind === 'unit') {
      play(INFANTRY.has(ev.key) ? 'die_infantry' : 'die_vehicle', { x: ev.x, z: ev.z, vol: 0.6, gapMs: 150 });
    }
  });
  on('superLaunch', () => play('super_launch', { vol: 1, gapMs: 500 }));
  on('superImpact', (ev) => { const n = SUPER[ev.key]; if (n) play(n, { vol: 1, gapMs: 400 }); });
  on('constructionStart', (ev) => { const e = game.entity(ev.id); if (e) play('build_place', { x: e.x, z: e.z, vol: 0.35, gapMs: 2000 }); });
  on('constructionComplete', (ev) => { const e = game.entity(ev.id); if (e && e.side === 'player') play('build_done', { vol: 0.55 }); });
  on('spawn', (ev) => { const e = ev.entity; if (e && e.side === 'player' && e.kind === 'unit') play('unit_ready', { vol: 0.4, gapMs: 400 }); });
  on('sold', () => play('sold', { vol: 0.7, gapMs: 300 }));
  on('cratePickup', (ev) => play('crate', { x: ev.x, z: ev.z, vol: 0.8 }));
  on('rankUp', (ev) => { if (ev.side === 'player') play('rankup', { vol: 0.9 }); });
  on('gameOver', (ev) => {
    setTimeout(() => play(ev.winner === 'player' ? 'win' : 'lose', { vol: 0.9, bus: 'voice', gapMs: 0, rate: 1 }), 600);
  });

  function setMuted(m) {
    muted = !!m;
    if (master) master.gain.value = muted ? 0 : 0.6;
  }
  function dispose() {
    disposed = true;
    for (const [ev, fn] of offs) game.off(ev, fn);
    window.removeEventListener('pointerdown', resume);
    window.removeEventListener('keydown', resume);
    try { if (ctx) ctx.close(); } catch (_) {}
    ctx = null;
  }

  return { play, eva, ack, setMuted, toggleMuted: () => { setMuted(!muted); return muted; }, dispose };
}

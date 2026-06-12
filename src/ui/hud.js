// ════════════════════════════════════════════════════════════════════════════
// FREEDOM FIGHT — In-match HUD  (DESIGN §13.3)
//
// export function HUD(rootEl, cb) → {
//   update(state, ctx),                  // ctx = {selection, factionData, minimapBase, cameraQuad, fog}
//   showGameOver(result, stats, {onRematch,onMenu}),
//   showPause({onResume,onRestart,onMenu}), hidePause(),
//   setMode(mode),                       // 'normal'|'placing'|'targeting'
//   eva(key, text),                      // banner + optional audio blip
//   destroy(), el }
//
// Callbacks cb: onBuildSelect, onQueueUnit, onCancelQueue, onSell, onUpgrade,
//   onAbility, onChoosePower, onUsePower, onFireSuper, onSetRally, onEvacuate,
//   onPause, onMinimapNav, onMinimapTarget.
//
// Plain DOM/CSS, no framework, no external assets. Coded defensively against
// missing/partial state with sensible fallbacks from meta.js.
// ════════════════════════════════════════════════════════════════════════════

import {
  svg, glyph, powerGlyph, abilityGlyph, pretty,
  unitMeta, structMeta, powerMeta, abilityMeta,
  UNIT_META, STRUCT_META, POWER_META,
} from './meta.js';
import { MAP } from '../sim/map.js';
import { entityIcon, emblemIcon } from './icons.js';

const C = 'currentColor';
const FACTION_COLOR = { coalition: '#2e7bff', dominion: '#e03c2e', syndicate: '#3da64b' };
const QUEUE_SLOTS = 9; // matches sim queue cap (game.js queue full check)

// Build menus per faction (canonical structure keys, in build order).
const BUILD_MENUS = {
  coalition: ['commandCenter','fusionReactor','barracks','supplyCenter','warFactory','airfield','aegis','uplink','dropZone','orbitalLance'],
  dominion:  ['commandCenter','fissionReactor','barracks','supplyCenter','warFactory','airfield','gatling','bunker','warCouncil','nuclearMissile'],
  syndicate: ['commandCenter','supplyStash','barracks','armsBazaar','stingerNest','tunnel','demoTrap','citadel','blackMarket','viperStorm'],
};
// Which structures produce which units (fallback when factionData absent).
const PRODUCERS = {
  commandCenter: { coalition:['dozer'], dominion:['dozer'], syndicate:['worker'] },
  barracks: { coalition:['trooper','javelin','marksman','ghost'], dominion:['conscript','hunter','hacker','mantis'], syndicate:['worker','militant','stinger','fanatic','cobra'] },
  supplyCenter: { coalition:['pelican'], dominion:['supplyTruck'] },
  supplyStash: { syndicate:['worker'] },
  warFactory: { coalition:['dozer','outrider','paladin','tempest'], dominion:['dozer','supplyTruck','warmaster','shredder','dragon','hellstorm','emperor'] },
  armsBazaar: { syndicate:['technical','scorpion','quad','toxinTractor','buggy','scud'] },
  airfield: { coalition:['specter','falcon','meteor'], dominion:['vulture'] },
};
// Upgrades researched at structures (fallback).
const UPGRADES_AT = {
  fusionReactor: [{key:'controlRods', n:'Control Rods', c:500}],
  supplyCenter:  [{key:'supplyLines', n:'Supply Lines', c:800}],
  uplink:        [{key:'laserWarheads', n:'Laser Warheads', c:1500}],
  warCouncil:    [{key:'nationalism', n:'Nationalism', c:2000},{key:'uraniumShells', n:'Uranium Shells', c:2500},{key:'blackNapalm', n:'Black Napalm', c:2000}],
  blackMarket:   [{key:'apRockets', n:'AP Rockets', c:2000},{key:'toxinShells', n:'Toxin Shells', c:2000},{key:'junkRepair', n:'Junk Repair', c:2000}],
};
// Abilities by unit key (fallback).
const ABILITIES_OF = {
  trooper: ['flashbang'], ghost: ['c4'], hacker: ['deploy'],
  mantis: ['disable','cashHack'], cobra: ['crewSnipe'],
};
// General's powers list per faction (fallback ordering; matches §8).
const POWERS_OF = {
  coalition: ['spyDrone','paradrop','strikeWing','fuelAir'],
  dominion:  ['artillery','cashHackP','clusterMines','empBomb'],
  syndicate: ['ambush','cashBounty','sneakAttack','anthrax'],
};

// ── Hotkey reference (DESIGN §12) ────────────────────────────────────────────
const KEYREF = [
  ['L-Click', 'Select / order (move, attack…)'], ['L-Drag', 'Box select'],
  ['Dbl-Click', 'Select all of type'], ['Shift+Click', 'Add / remove'],
  ['Ctrl+Click', 'Force attack'], ['R-Click', 'Deselect / cancel'],
  ['R-Hold+Move', 'Scroll map'], ['A + Click', 'Attack-move'],
  ['S', 'Stop'], ['G', 'Guard'], ['Q', 'Select all combat units'],
  ['E', 'Same type on screen (×2 map)'],
  ['Ctrl+1–9', 'Assign group'], ['1–9', 'Select group (×2 center)'], ['Alt+1–9', 'View group'],
  ['H', 'Jump to Command Center'], ['Space', 'Jump to last event'],
  ['Arrows / Edge', 'Pan camera'], ['Wheel', 'Zoom'],
  ['B', 'Select builder'], ['F', 'Fire superweapon'], ['Esc / P', 'Pause'],
];

const TIPS = [
  'Capture oil derricks with rifle infantry for bonus income.',
  'Build a second Supply Center near the contested center docks.',
  'Garrison civilian buildings — infantry inside gain +2 range.',
  'Low power halts your superweapon and disables base defenses.',
  'Snipers and stealth units are revealed when they fire.',
  'Spend promotion points the moment you earn them.',
  'Heroes are limited to one alive at a time — protect yours.',
  'Sell damaged structures for a 50% refund before they fall.',
];

const SVG_NS = 'http://www.w3.org/2000/svg';
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
function fmtClock(t) {
  const s = Math.max(0, Math.floor(t || 0));
  const m = Math.floor(s / 60), ss = s % 60;
  return `${m}:${ss < 10 ? '0' : ''}${ss}`;
}
function fmtCount(t) {
  const s = Math.max(0, Math.ceil(t || 0));
  if (s >= 60) { const m = Math.floor(s / 60), ss = s % 60; return `${m}:${ss < 10 ? '0' : ''}${ss}`; }
  return s + 's';
}
function hpColor(frac) {
  if (frac > 0.5) return 'var(--ic-green)';
  if (frac > 0.25) return 'var(--ic-amber)';
  return 'var(--ic-red)';
}
function facColor(faction) { return FACTION_COLOR[faction] || 'var(--ic-amber)'; }

// EVA severity by key.
const EVA_SEV = {
  lowPower: 'warn', baseUnderAttack: 'danger', unitsUnderAttack: 'warn', harvesterUnderAttack: 'warn',
  enemySuperDetected: 'danger', enemySuperReady: 'danger', superLaunchDetected: 'critical',
  ourSuperReady: 'good', promotion: 'good', capturedDerrick: 'good', constructionComplete: 'info',
  unitReady: 'info', insufficientFunds: 'warn', victory: 'good', defeat: 'danger',
};
const EVA_TEXT = {
  constructionComplete: 'Construction complete.', unitReady: 'Unit ready.', lowPower: 'Low power!',
  baseUnderAttack: 'Our base is under attack!', unitsUnderAttack: 'Our units are under attack!',
  harvesterUnderAttack: 'Harvester under attack!', enemySuperDetected: 'Enemy superweapon detected.',
  enemySuperReady: 'Enemy superweapon ready!', superLaunchDetected: 'Superweapon launch detected!',
  ourSuperReady: 'Superweapon ready.', promotion: 'Promotion earned!', capturedDerrick: 'Oil derrick captured.',
  insufficientFunds: 'Insufficient funds.', victory: 'Victory!', defeat: 'Defeat.',
};

// ════════════════════════════════════════════════════════════════════════════
export function HUD(rootEl, cb = {}) {
  const noop = () => {};
  const on = (k) => (typeof cb[k] === 'function' ? cb[k] : noop);
  const onBuildSelect = on('onBuildSelect'), onQueueUnit = on('onQueueUnit'),
    onCancelQueue = on('onCancelQueue'), onSell = on('onSell'), onUpgrade = on('onUpgrade'),
    onAbility = on('onAbility'), onChoosePower = on('onChoosePower'), onUsePower = on('onUsePower'),
    onFireSuper = on('onFireSuper'), onSetRally = on('onSetRally'), onEvacuate = on('onEvacuate'),
    onPause = on('onPause'), onMinimapNav = on('onMinimapNav'), onMinimapTarget = on('onMinimapTarget');

  // ── Root ────────────────────────────────────────────────────────────────
  const root = el('div', 'ic-hud');
  rootEl.appendChild(root);

  // ── Top bar ───────────────────────────────────────────────────────────────
  const topbar = el('div', 'ic-topbar');
  topbar.innerHTML = `
    <div class="ic-top-panel ic-credits">
      <div class="ic-credits-label">Credits</div>
      <div class="ic-credits-val"><span class="ic-credits-cr">$</span><span class="ic-credits-amt" data-credits>0</span></div>
      <div class="ic-credits-delta" data-credits-delta></div>
    </div>
    <div class="ic-top-panel ic-power-panel" data-powerpanel>
      <div class="ic-power-head"><span class="ic-power-title">Power</span><span class="ic-power-status" data-powerstatus></span></div>
      <div class="ic-power-bar"><div class="ic-power-fill" data-powerfill></div><div class="ic-power-use" data-poweruse></div></div>
    </div>
    <div class="ic-top-panel ic-forces">
      <div class="ic-forces-label">Forces</div>
      <div class="ic-forces-val"><span data-pop>0</span><span class="ic-forces-cap">/<span data-popcap>80</span></span></div>
    </div>
    <div class="ic-top-panel ic-center">
      <div class="ic-clock-label">Mission Time</div>
      <div class="ic-clock" data-clock>0:00</div>
    </div>
    <div class="ic-supers" data-supers></div>
    <div class="ic-top-panel ic-icon-btn" data-pause title="Pause (Esc)">
      ${svg('0 0 24 24', `<rect x="6" y="5" width="4" height="14" rx="1" fill="${C}"/><rect x="14" y="5" width="4" height="14" rx="1" fill="${C}"/>`)}
    </div>
  `;
  root.appendChild(topbar);

  // ── EVA banner queue (top-center) ─────────────────────────────────────────
  const evaWrap = el('div', 'ic-eva-wrap');
  root.appendChild(evaWrap);
  // Superweapon full-width launch warning
  const superWarn = el('div', 'ic-superwarn ic-hidden');
  root.appendChild(superWarn);

  // ── Mode hint chip ────────────────────────────────────────────────────────
  const modeHint = el('div', 'ic-modehint ic-hidden');
  root.appendChild(modeHint);

  // ── Bottom-left: minimap ──────────────────────────────────────────────────
  const minimapWrap = el('div', 'ic-minimap');
  minimapWrap.innerHTML = `
    <div class="ic-minimap-frame">
      <canvas class="ic-minimap-canvas" width="240" height="240"></canvas>
      <div class="ic-radar-offline ic-hidden" data-radaroff><span>RADAR OFFLINE</span></div>
    </div>
  `;
  root.appendChild(minimapWrap);
  const mmCanvas = minimapWrap.querySelector('.ic-minimap-canvas');
  const mmCtx = mmCanvas.getContext('2d');
  const radarOff = minimapWrap.querySelector('[data-radaroff]');

  // ── Bottom-center: command panel ──────────────────────────────────────────
  const cmdPanel = el('div', 'ic-cmd');
  cmdPanel.innerHTML = `
    <div class="ic-cmd-info" data-cmdinfo></div>
    <div class="ic-cmd-grid" data-cmdgrid></div>
  `;
  root.appendChild(cmdPanel);
  const cmdInfo = cmdPanel.querySelector('[data-cmdinfo]');
  const cmdGrid = cmdPanel.querySelector('[data-cmdgrid]');

  // ── Bottom-right: general's panel ─────────────────────────────────────────
  const genPanel = el('div', 'ic-gen');
  genPanel.innerHTML = `
    <div class="ic-gen-rank">
      <div class="ic-gen-stars" data-stars></div>
      <div class="ic-gen-rankrow">
        <span class="ic-gen-ranklabel">Rank</span>
        <span class="ic-gen-points ic-hidden" data-points>0</span>
      </div>
      <div class="ic-gen-xp"><div class="ic-gen-xp-fill" data-xpfill></div></div>
    </div>
    <div class="ic-gen-powers" data-powers></div>
  `;
  root.appendChild(genPanel);
  const starsEl = genPanel.querySelector('[data-stars]');
  const pointsEl = genPanel.querySelector('[data-points]');
  const xpFill = genPanel.querySelector('[data-xpfill]');
  const powersEl = genPanel.querySelector('[data-powers]');

  // Power picker overlay
  const powerPicker = el('div', 'ic-power-picker ic-hidden');
  root.appendChild(powerPicker);

  // ── Overlays ──────────────────────────────────────────────────────────────
  const gameOverEl = el('div', 'ic-overlay ic-scanlines ic-hidden');
  root.appendChild(gameOverEl);
  const pauseEl = el('div', 'ic-overlay ic-scanlines ic-hidden');
  root.appendChild(pauseEl);

  // ── Refs / cache ──────────────────────────────────────────────────────────
  const R = {
    credits: topbar.querySelector('[data-credits]'),
    creditsDelta: topbar.querySelector('[data-credits-delta]'),
    powerPanel: topbar.querySelector('[data-powerpanel]'),
    powerStatus: topbar.querySelector('[data-powerstatus]'),
    powerFill: topbar.querySelector('[data-powerfill]'),
    powerUse: topbar.querySelector('[data-poweruse]'),
    pop: topbar.querySelector('[data-pop]'),
    popcap: topbar.querySelector('[data-popcap]'),
    clock: topbar.querySelector('[data-clock]'),
    supers: topbar.querySelector('[data-supers]'),
    pause: topbar.querySelector('[data-pause]'),
  };
  R.pause.addEventListener('click', () => onPause());

  const cache = {
    credits: null, creditsDisplay: 0, clock: '', pop: -1, popcap: -1,
    lowPower: null, powerOut: -1, powerUse: -1,
    selSig: '', rank: -1, points: -1, xpFrac: -1, powersSig: '',
    supersSig: '', mode: 'normal', evaIds: 0, tipIdx: 0, tipAt: 0,
    radar: null,
  };

  // ════════════════════════════════════════════════════════════════════════
  // Audio (procedural blips, behind mute toggle; degrade silently)
  // ════════════════════════════════════════════════════════════════════════
  let audioCtx = null, muted = false;
  function ensureAudio() {
    if (audioCtx || muted) return audioCtx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    } catch (_) { audioCtx = null; }
    return audioCtx;
  }
  function blip(freq, dur, type, gainv) {
    if (muted) return;
    const ac = ensureAudio();
    if (!ac) return;
    try {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type || 'square'; o.frequency.value = freq || 440;
      g.gain.value = 0.0001;
      o.connect(g); g.connect(ac.destination);
      const t = ac.currentTime;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gainv || 0.05, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.08));
      o.start(t); o.stop(t + (dur || 0.08) + 0.02);
    } catch (_) {}
  }
  // Mute toggle (in minimap frame corner)
  const muteBtn = el('div', 'ic-mute', muteSvg(false));
  minimapWrap.querySelector('.ic-minimap-frame').appendChild(muteBtn);
  muteBtn.addEventListener('click', () => { muted = !muted; muteBtn.innerHTML = muteSvg(muted); });
  function muteSvg(m) {
    return svg('0 0 24 24', m
      ? `<path d="M4 9 h4 l5 -4 v14 l-5 -4 H4z" fill="${C}"/><path d="M16 9 l5 6 m0 -6 l-5 6" stroke="${C}" stroke-width="2"/>`
      : `<path d="M4 9 h4 l5 -4 v14 l-5 -4 H4z" fill="${C}"/><path d="M16 8 q4 4 0 8 M18 5 q7 7 0 14" stroke="${C}" stroke-width="2" fill="none"/>`);
  }

  // ════════════════════════════════════════════════════════════════════════
  // factionData helpers — read meta from ctx.factionData with fallback.
  // ════════════════════════════════════════════════════════════════════════
  function fd(ctx) { return (ctx && ctx.factionData) || null; }
  function defUnit(ctx, key) {
    const f = fd(ctx);
    if (f && f.units && f.units[key]) return f.units[key];
    return null;
  }
  function defStruct(ctx, key) {
    const f = fd(ctx);
    if (f && f.structures && f.structures[key]) return f.structures[key];
    return null;
  }
  function unitName(ctx, key) { const d = defUnit(ctx, key); return (d && d.name) || unitMeta(key).n; }
  function unitCost(ctx, key) { const d = defUnit(ctx, key); return (d && d.cost) != null ? d.cost : unitMeta(key).c; }
  function unitTime(ctx, key) { const d = defUnit(ctx, key); return (d && (d.buildTime ?? d.time)) != null ? (d.buildTime ?? d.time) : unitMeta(key).t; }
  function unitIsHero(ctx, key) { const d = defUnit(ctx, key); return (d && d.hero) || unitMeta(key).hero || false; }
  function structName(ctx, key) { const d = defStruct(ctx, key); return (d && d.name) || structMeta(key).n; }
  function structCost(ctx, key) { const d = defStruct(ctx, key); return (d && d.cost) != null ? d.cost : structMeta(key).c; }
  function structTime(ctx, key) { const d = defStruct(ctx, key); return (d && (d.buildTime ?? d.time)) != null ? (d.buildTime ?? d.time) : structMeta(key).t; }

  function playerFaction(state) { return (state && state.player && state.player.faction) || null; }

  // ════════════════════════════════════════════════════════════════════════
  // UPDATE
  // ════════════════════════════════════════════════════════════════════════
  function update(state, ctx) {
    if (!state) return;
    ctx = ctx || {};
    const p = state.player || {};
    const faction = p.faction || null;

    // ── Credits (animated count + flash + delta) ──
    const credits = Math.floor(p.money || 0);
    if (cache.credits === null) { cache.credits = credits; cache.creditsDisplay = credits; R.credits.textContent = credits; }
    if (credits !== cache.credits) {
      const diff = credits - cache.credits;
      R.credits.classList.remove('ic-flash-up','ic-flash-down');
      void R.credits.offsetWidth;
      R.credits.classList.add(diff > 0 ? 'ic-flash-up' : 'ic-flash-down');
      if (Math.abs(diff) >= 10) {
        R.creditsDelta.textContent = (diff > 0 ? '+' : '') + diff;
        R.creditsDelta.className = 'ic-credits-delta ic-show ' + (diff > 0 ? 'ic-up' : 'ic-down');
        clearTimeout(R._deltaTO);
        R._deltaTO = setTimeout(() => R.creditsDelta.classList.remove('ic-show'), 700);
      }
      cache.credits = credits;
    }
    if (cache.creditsDisplay !== credits) {
      const gap = credits - cache.creditsDisplay;
      const stepv = Math.max(1, Math.ceil(Math.abs(gap) * 0.25));
      cache.creditsDisplay = Math.abs(gap) <= stepv ? credits : cache.creditsDisplay + (gap > 0 ? stepv : -stepv);
      R.credits.textContent = cache.creditsDisplay;
    }

    // ── Power meter (hidden entirely for Syndicate) ──
    const hidePower = faction === 'syndicate';
    if (R.powerPanel.classList.contains('ic-hidden') !== hidePower) {
      R.powerPanel.classList.toggle('ic-hidden', hidePower);
    }
    if (!hidePower) {
      const out = Math.max(0, p.powerOut || 0);
      const use = Math.max(0, p.powerUse || 0);
      const low = !!p.lowPower;
      const maxScale = Math.max(out, use, 10);
      if (out !== cache.powerOut || use !== cache.powerUse) {
        cache.powerOut = out; cache.powerUse = use;
        R.powerFill.style.width = Math.min(100, (out / maxScale) * 100) + '%';
        R.powerUse.style.width = Math.min(100, (use / maxScale) * 100) + '%';
        R.powerStatus.textContent = `${use} / ${out}`;
      }
      if (low !== cache.lowPower) {
        cache.lowPower = low;
        R.powerPanel.classList.toggle('ic-lowpower', low);
        R.powerStatus.classList.toggle('ic-low', low);
      }
      if (low) R.powerStatus.dataset.label = 'LOW POWER';
      else delete R.powerStatus.dataset.label;
    }

    // ── Forces / pop ──
    const pop = p.pop || 0, popCap = p.popCap || 80;
    if (pop !== cache.pop) { cache.pop = pop; R.pop.textContent = pop; R.pop.classList.toggle('ic-full', pop >= popCap); }
    if (popCap !== cache.popcap) { cache.popcap = popCap; R.popcap.textContent = popCap; }

    // ── Clock ──
    const clk = fmtClock(state.time);
    if (clk !== cache.clock) { cache.clock = clk; R.clock.textContent = clk; }

    // ── Superweapon chips ──
    updateSupers(state, faction);

    // ── Minimap ──
    drawMinimap(state, ctx);

    // ── Radar offline ──
    const radarOn = p.radar !== false;
    if (radarOn !== cache.radar) { cache.radar = radarOn; radarOff.classList.toggle('ic-hidden', radarOn); }

    // ── Command panel (contextual on selection) ──
    updateCommandPanel(state, ctx);

    // ── General's panel ──
    updateGeneralPanel(state, ctx, faction);

    // ── Tip ticker advance ──
    if (state.time - cache.tipAt > 9) { cache.tipAt = state.time; cache.tipIdx = (cache.tipIdx + 1) % TIPS.length; refreshTipIfShown(); }
  }

  // ── Superweapon chips ─────────────────────────────────────────────────────
  function updateSupers(state, faction) {
    const items = [];
    const ps = state.player && state.player.super;
    if (ps) items.push({ side: 'player', faction, ...normSuper(ps) });
    const es = state.enemy && state.enemy.super;
    if (es) items.push({ side: 'enemy', faction: state.enemy.faction, ...normSuper(es) });
    const sig = items.map(s => `${s.side}:${s.key}:${Math.ceil(s.left)}:${s.ready}`).join('|');
    if (sig === cache.supersSig) return;
    cache.supersSig = sig;
    R.supers.innerHTML = '';
    for (const s of items) {
      const col = facColor(s.faction);
      const chip = el('div', 'ic-super-chip ic-side-' + s.side + (s.ready ? ' ic-ready' : ''));
      chip.style.setProperty('--sw', col);
      const sname = s.key ? structName({ factionData: null }, s.key) : 'Superweapon';
      chip.innerHTML = `
        <div class="ic-super-icon">${entityIcon(s.key || 'orbitalLance', { faction: s.faction })}</div>
        <div class="ic-super-meta">
          <div class="ic-super-name">${s.side === 'enemy' ? 'ENEMY ' : ''}${sname}</div>
          <div class="ic-super-time">${s.ready ? 'READY' : fmtCount(s.left)}</div>
        </div>`;
      if (s.side === 'player' && s.ready) {
        chip.classList.add('ic-fireable');
        chip.addEventListener('click', () => onFireSuper());
        chip.title = 'Fire (F)';
      }
      R.supers.appendChild(chip);
    }
  }
  function normSuper(s) {
    const total = s.total || 0, charge = s.charge || 0;
    const ready = !!s.ready || (total > 0 && charge >= total);
    const left = Math.max(0, total - charge);
    return { key: s.key || s.id || null, total, charge, ready, left };
  }

  // ════════════════════════════════════════════════════════════════════════
  // MINIMAP
  // ════════════════════════════════════════════════════════════════════════
  const MM = 240;            // canvas px
  const WORLD = MAP.size;    // [-WORLD/2, WORLD/2]
  const WHALF = WORLD / 2;
  function w2m(x) { return ((x + WHALF) / WORLD) * MM; }
  let pingList = [];         // {x,z,kind,t0}
  function drawMinimap(state, ctx) {
    const g = mmCtx;
    g.clearRect(0, 0, MM, MM);
    // base terrain (or dark grid fallback)
    const base = ctx.minimapBase;
    if (base && base.width) {
      try { g.drawImage(base, 0, 0, MM, MM); } catch (_) { gridFallback(g); }
    } else gridFallback(g);

    // fog dimming
    const fog = ctx.fog;
    if (fog && fog.grid && fog.w && fog.h) {
      const cw = MM / fog.w, ch = MM / fog.h;
      for (let y = 0; y < fog.h; y++) {
        for (let x = 0; x < fog.w; x++) {
          const v = fog.grid[y * fog.w + x];
          if (v === 2) continue;            // clear
          g.fillStyle = v === 1 ? 'rgba(4,6,8,0.5)' : 'rgba(2,3,4,0.92)';
          g.fillRect(x * cw, y * ch, cw + 0.6, ch + 0.6);
        }
      }
    }

    // entity dots
    const ents = state.entities || [];
    for (const e of ents) {
      if (!e) continue;
      const isStruct = e.kind === 'structure';
      let col;
      if (e.side === 'player') col = '#2e7bff';
      else if (e.side === 'enemy') { if (e.visible === false) continue; col = '#e03c2e'; }
      else { col = '#e8c33a'; if (e.visible === false && e.kind !== 'structure') continue; }
      const mx = w2m(e.x), my = w2m(e.z);
      g.fillStyle = col;
      if (isStruct) { const s = 4; g.fillRect(mx - s / 2, my - s / 2, s, s); }
      else { g.beginPath(); g.arc(mx, my, 1.6, 0, Math.PI * 2); g.fill(); }
    }

    // radar pings (expanding rings)
    const now = (state.time || 0);
    if (Array.isArray(state.radarPings)) {
      for (const rp of state.radarPings) if (rp) pingList.push({ x: rp.x, z: rp.z, kind: rp.kind, t0: now });
      state.radarPings = null;
    }
    pingList = pingList.filter(p => now - p.t0 < 1.5);
    for (const ping of pingList) {
      const age = (now - ping.t0) / 1.5;
      const r = 2 + age * 14;
      g.strokeStyle = ping.kind === 'attack' ? `rgba(224,60,46,${1 - age})` : `rgba(244,165,34,${1 - age})`;
      g.lineWidth = 1.5;
      g.beginPath(); g.arc(w2m(ping.x), w2m(ping.z), r, 0, Math.PI * 2); g.stroke();
    }

    // camera frustum quad
    const quad = ctx.cameraQuad;
    if (Array.isArray(quad) && quad.length >= 3) {
      g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 1.2;
      g.beginPath();
      quad.forEach((pt, i) => { const mx = w2m(pt.x), my = w2m(pt.z); i ? g.lineTo(mx, my) : g.moveTo(mx, my); });
      g.closePath(); g.stroke();
    }
  }
  function gridFallback(g) {
    g.fillStyle = '#0a0e12'; g.fillRect(0, 0, MM, MM);
    g.strokeStyle = 'rgba(56,68,79,0.35)'; g.lineWidth = 1;
    for (let i = 1; i < 8; i++) {
      const p = (i / 8) * MM;
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, MM); g.stroke();
      g.beginPath(); g.moveTo(0, p); g.lineTo(MM, p); g.stroke();
    }
  }
  function mmEvent(e, fn) {
    const rect = mmCanvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left) / rect.width;
    const cz = (e.clientY - rect.top) / rect.height;
    const wx = cx * WORLD - WHALF, wz = cz * WORLD - WHALF;
    fn(Math.max(-WHALF, Math.min(WHALF, wx)), Math.max(-WHALF, Math.min(WHALF, wz)));
  }
  let mmDragging = false;
  mmCanvas.addEventListener('mousedown', (e) => {
    if (e.button === 2) { e.preventDefault(); mmEvent(e, onMinimapTarget); return; }
    mmDragging = true; mmEvent(e, onMinimapNav);
  });
  mmCanvas.addEventListener('mousemove', (e) => { if (mmDragging) mmEvent(e, onMinimapNav); });
  window.addEventListener('mouseup', () => { mmDragging = false; });
  mmCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // ════════════════════════════════════════════════════════════════════════
  // COMMAND PANEL (contextual)
  // ════════════════════════════════════════════════════════════════════════
  function updateCommandPanel(state, ctx) {
    const sel = (ctx.selection || []).filter(Boolean);
    const faction = playerFaction(state);
    // Determine context category + a signature to know whether to rebuild.
    const cat = selCategory(sel);
    const sig = buildSelSig(sel, cat, state);
    if (sig !== cache.selSig) {
      cache.selSig = sig;
      renderCommandPanel(sel, cat, state, ctx, faction);
    } else {
      // light per-frame refresh (queues, cooldowns, affordability)
      refreshCommandPanel(sel, cat, state, ctx);
    }
  }
  function selCategory(sel) {
    if (!sel.length) return 'none';
    const first = sel[0];
    if (sel.length === 1) {
      const e = first;
      if (e.kind === 'structure') {
        if (Array.isArray(e.garrison) && e.garrison.length) return 'garrison';
        if (isBuilder(e)) return 'builder-struct';
        if (producesUnits(e)) return 'production';
        return 'structure';
      }
      if (isBuilderUnit(e)) return 'units';   // builder unit → treated like units (build via B); show build grid
      return 'units';
    }
    // multi: if all structures of same producing type → production-ish; else units
    if (sel.every(e => e.kind !== 'structure')) return 'units';
    return 'units';
  }
  function isBuilder(e) { return e && (e.key === 'dozer' || e.key === 'worker'); }
  function isBuilderUnit(e) { return e && e.kind !== 'structure' && (e.key === 'dozer' || e.key === 'worker'); }
  function producesUnits(e) {
    return e && PRODUCERS[e.key];
  }
  function buildSelSig(sel, cat, state) {
    if (cat === 'none') return 'none';
    if (cat === 'units') {
      return 'units:' + sel.map(e => e.key).sort().join(',') + ':' + sel.length;
    }
    const e = sel[0];
    return cat + ':' + e.id + ':' + e.key;
  }

  function renderCommandPanel(sel, cat, state, ctx, faction) {
    cmdInfo.innerHTML = '';
    cmdGrid.innerHTML = '';
    cmdGrid.className = 'ic-cmd-grid';

    if (cat === 'none') return renderIdlePanel(state, ctx, faction);
    if (cat === 'builder-struct') return renderBuilderStructInfo(sel[0], state, ctx);
    if (cat === 'production') return renderProduction(sel[0], state, ctx, faction);
    if (cat === 'structure') return renderStructure(sel[0], state, ctx);
    if (cat === 'garrison') return renderGarrison(sel[0], state, ctx);
    if (cat === 'units') return renderUnits(sel, state, ctx, faction);
  }

  // -- Idle: faction emblem watermark + tip ticker --
  function renderIdlePanel(state, ctx, faction) {
    cmdInfo.innerHTML = `<div class="ic-watermark" style="--accent:${facColor(faction)}">
      ${entityIcon('commandCenter', { faction, cls: 'ic-watermark-glyph' })}
      <div class="ic-watermark-text">No Selection</div>
    </div>`;
    cmdGrid.innerHTML = `<div class="ic-tip" data-tip>${TIPS[cache.tipIdx]}</div>`;
    cmdGrid.classList.add('ic-cmd-tipmode');
  }
  function refreshTipIfShown() {
    const t = cmdGrid.querySelector('[data-tip]');
    if (t) t.textContent = TIPS[cache.tipIdx];
  }

  // -- Builder unit selected, or Command Center (build menu) --
  function buildMenuKeys(faction) { return BUILD_MENUS[faction] || []; }
  function renderUnitsBuildMenu() {} // placeholder retained for clarity

  // -- Builder structure (Command Center idle) shows build grid too --
  function renderBuilderStructInfo(e, state, ctx) {
    portrait(cmdInfo, e, ctx);
    renderBuildGrid(state, ctx);
  }

  // Build grid (used by builder units): the faction's structure menu.
  function renderBuildGrid(state, ctx) {
    const faction = playerFaction(state);
    const keys = buildMenuKeys(faction);
    cmdGrid.classList.add('ic-cmd-cards');
    const built = builtStructKeys(state);
    const money = (state.player && state.player.money) || 0;
    keys.forEach((key) => {
      const cost = structCost(ctx, key);
      const reqKey = (defStruct(ctx, key) && defStruct(ctx, key).req) || (STRUCT_META[key] && STRUCT_META[key].req);
      const reqMet = prereqMet(reqKey, built);
      const afford = money >= cost;
      const locked = !reqMet;
      const card = makeCard({
        key, name: structName(ctx, key), cost, time: structTime(ctx, key),
        glyphKey: key, faction, locked, afford,
        hero: false, sup: !!(STRUCT_META[key] && STRUCT_META[key].super),
        lockText: locked ? `Requires ${prettyReq(reqKey)}` : (!afford ? 'Insufficient funds' : ''),
      });
      card.dataset.cost = cost; card.dataset.req = reqKey || '';
      if (!locked && afford) card.addEventListener('click', () => { onBuildSelect(key); blip(660, 0.05, 'square'); });
      cmdGrid.appendChild(card);
    });
  }

  // -- Production structure: unit cards + queue + rally + sell + upgrades --
  function renderProduction(e, state, ctx, faction) {
    portrait(cmdInfo, e, ctx);
    // unit cards
    cmdGrid.classList.add('ic-cmd-cards');
    const units = productionUnits(e, faction, ctx);
    const money = (state.player && state.player.money) || 0;
    const built = builtStructKeys(state);
    // No per-card hotkey labels: Q/W/E/etc. are global command keys (Generals scheme).
    const hotkeys = [];
    units.forEach((key, i) => {
      const cost = unitCost(ctx, key);
      const reqK = unitReq(ctx, key);
      const reqMet = prereqMet(reqK, built);
      const hero = unitIsHero(ctx, key);
      const heroAlive = hero && heroIsAlive(state, key);
      const afford = money >= cost;
      const locked = !reqMet || heroAlive;
      const card = makeCard({
        key, name: unitName(ctx, key), cost, time: unitTime(ctx, key),
        glyphKey: key, faction, locked, afford, hero,
        hotkey: hotkeys[i] || '',
        lockText: heroAlive ? 'Hero already deployed' : (!reqMet ? `Requires ${prettyReq(reqK)}` : (!afford ? 'Insufficient funds' : '')),
      });
      card.dataset.cost = cost; card.dataset.unitkey = key; card.dataset.req = reqK || ''; card.dataset.hero = hero ? '1' : '';
      if (!locked && afford) card.addEventListener('click', () => { onQueueUnit(e.id, key); blip(720, 0.05, 'square'); });
      cmdGrid.appendChild(card);
    });
    renderQueueAndControls(e, state, ctx);
  }
  function renderQueueAndControls(e, state, ctx) {
    const side = el('div', 'ic-cmd-side');
    // queue strip: fixed slot grid (Generals-style), filled by syncQueueSlots
    const qstrip = el('div', 'ic-queue', '<div class="ic-queue-label">Queue <span class="ic-queue-count"></span></div>');
    const qitems = el('div', 'ic-queue-items');
    for (let i = 0; i < QUEUE_SLOTS; i++) {
      const it = el('div', 'ic-queue-item');
      it.addEventListener('click', () => {
        if (!it.classList.contains('ic-filled')) return;
        onCancelQueue(e.id, i); blip(300, 0.05, 'sawtooth');
      });
      qitems.appendChild(it);
    }
    qstrip.appendChild(qitems);
    side.appendChild(qstrip);
    syncQueueSlots(qstrip, Array.isArray(e.queue) ? e.queue : [], e.faction, ctx);
    // control row: rally + sell + upgrades
    const ctrls = el('div', 'ic-ctrls');
    ctrls.appendChild(ctrlBtn('Rally', 'rally', () => { onSetRally(e.id); blip(520, 0.05); }));
    ctrls.appendChild(ctrlBtn('Sell', 'sell', () => { onSell(e.id); blip(220, 0.08, 'sawtooth'); }, 'danger'));
    side.appendChild(ctrls);
    // upgrades
    const ups = upgradesAt(e.key, ctx);
    if (ups.length) {
      const upRow = el('div', 'ic-upgrades');
      const money = (state.player && state.player.money) || 0;
      const owned = (state.player && state.player.upgrades) || {};
      const research = e.research || null; // {key, progress}
      ups.forEach((u) => {
        const has = !!owned[u.key];
        const researching = research && research.key === u.key;
        const afford = money >= u.c;
        const btn = el('div', 'ic-upgrade' + (has ? ' ic-owned' : '') + (researching ? ' ic-researching' : '') + (!has && !afford ? ' ic-unaffordable' : ''));
        btn.title = `${u.n} — $${u.c}`;
        btn.innerHTML = `<span class="ic-upgrade-name">${u.n}</span><span class="ic-upgrade-cost">${has ? 'DONE' : '$' + u.c}</span>`
          + (researching ? `<div class="ic-upgrade-prog" style="width:${Math.round((research.progress || 0) * 100)}%"></div>` : '');
        if (!has && !researching && afford) btn.addEventListener('click', () => { onUpgrade(e.id, u.key); blip(640, 0.06); });
        upRow.appendChild(btn);
      });
      side.appendChild(upRow);
    }
    cmdGrid.appendChild(side);
  }

  // Fill the fixed queue slot grid from the live queue (called on build + light refresh).
  function syncQueueSlots(qstrip, queue, faction, ctx) {
    const count = qstrip.querySelector('.ic-queue-count');
    if (count) count.textContent = queue.length ? `${queue.length}/${QUEUE_SLOTS}` : '';
    const slots = qstrip.querySelectorAll('.ic-queue-item');
    slots.forEach((it, i) => {
      const q = queue[i];
      if (!q) {
        if (it.dataset.key) { delete it.dataset.key; it.innerHTML = ''; it.title = ''; }
        it.classList.remove('ic-filled', 'ic-active');
        return;
      }
      if (it.dataset.key !== q.key) {
        it.dataset.key = q.key;
        it.innerHTML = `${entityIcon(q.key, { faction, cls: 'ic-queue-icon' })}<div class="ic-queue-sweep"></div>`;
        it.title = (unitName(ctx, q.key) || pretty(q.key)) + ' — click to cancel';
      }
      it.classList.add('ic-filled');
      it.classList.toggle('ic-active', i === 0);
      it.style.setProperty('--prog-deg', Math.round((i === 0 ? q.progress || 0 : 0) * 360) + 'deg');
    });
  }

  // -- Plain structure (defense/tech/etc.): sell + maybe upgrades --
  function renderStructure(e, state, ctx) {
    portrait(cmdInfo, e, ctx);
    cmdGrid.classList.add('ic-cmd-cards');
    const side = el('div', 'ic-cmd-side');
    const ctrls = el('div', 'ic-ctrls');
    ctrls.appendChild(ctrlBtn('Sell', 'sell', () => { onSell(e.id); blip(220, 0.08, 'sawtooth'); }, 'danger'));
    // superweapon fire button if this is a ready super
    side.appendChild(ctrls);
    const ups = upgradesAt(e.key, ctx);
    if (ups.length) {
      const upRow = el('div', 'ic-upgrades');
      const money = (state.player && state.player.money) || 0;
      const owned = (state.player && state.player.upgrades) || {};
      ups.forEach((u) => {
        const has = !!owned[u.key];
        const afford = money >= u.c;
        const btn = el('div', 'ic-upgrade' + (has ? ' ic-owned' : '') + (!has && !afford ? ' ic-unaffordable' : ''));
        btn.title = `${u.n} — $${u.c}`;
        btn.innerHTML = `<span class="ic-upgrade-name">${u.n}</span><span class="ic-upgrade-cost">${has ? 'DONE' : '$' + u.c}</span>`;
        if (!has && afford) btn.addEventListener('click', () => { onUpgrade(e.id, u.key); blip(640, 0.06); });
        upRow.appendChild(btn);
      });
      side.appendChild(upRow);
    }
    cmdGrid.appendChild(side);
  }

  // -- Garrisoned building: occupant list + evacuate --
  function renderGarrison(e, state, ctx) {
    portrait(cmdInfo, e, ctx);
    cmdGrid.classList.add('ic-cmd-cards');
    const list = el('div', 'ic-garrison');
    list.innerHTML = '<div class="ic-garrison-label">Occupants</div>';
    const occ = el('div', 'ic-garrison-occ');
    const ids = e.garrison || [];
    const byId = state._entById || indexEntities(state);
    ids.forEach((id) => {
      const u = byId[id];
      const key = (u && u.key) || 'trooper';
      const slot = el('div', 'ic-garrison-slot');
      slot.title = unitName(ctx, key);
      slot.innerHTML = entityIcon(key, { faction: u && u.faction, cls: 'ic-garrison-icon' });
      occ.appendChild(slot);
    });
    if (!ids.length) occ.innerHTML = '<div class="ic-queue-empty">Empty</div>';
    list.appendChild(occ);
    cmdGrid.appendChild(list);
    const ctrls = el('div', 'ic-ctrls');
    ctrls.appendChild(ctrlBtn('Evacuate', 'evac', () => { onEvacuate(e.id); blip(420, 0.07); }, 'warn'));
    cmdGrid.appendChild(ctrls);
  }

  // -- Units selected: group portraits w/ HP + abilities --
  function renderUnits(sel, state, ctx, faction) {
    // If a builder unit is among them, show build grid as the grid content.
    const hasBuilder = sel.some(isBuilderUnit);
    // info = group portraits
    cmdInfo.classList.add('ic-units-info');
    const wrap = el('div', 'ic-portraits');
    const show = sel.slice(0, 12);
    show.forEach((u) => {
      const frac = u.maxHp ? Math.max(0, Math.min(1, u.hp / u.maxHp)) : 1;
      const isHero = unitIsHero(ctx, u.key);
      const pc = el('div', 'ic-pp' + (isHero ? ' ic-pp-hero' : ''));
      pc.title = unitName(ctx, u.key) + (u.vet ? ` (vet ${u.vet})` : '');
      pc.innerHTML = `
        ${entityIcon(u.key, { faction: u.faction || faction, cls: 'ic-pp-icon' })}
        ${u.vet ? `<span class="ic-pp-vet">${'★'.repeat(Math.min(3, u.vet))}</span>` : ''}
        ${u.stealthed ? '<span class="ic-pp-stealth">◇</span>' : ''}
        <div class="ic-pp-hp"><div class="ic-pp-hp-fill" style="width:${Math.round(frac * 100)}%;background:${hpColor(frac)}"></div></div>`;
      wrap.appendChild(pc);
    });
    if (sel.length > 12) wrap.appendChild(el('div', 'ic-pp-more', `+${sel.length - 12}`));
    cmdInfo.appendChild(wrap);

    cmdGrid.classList.add('ic-cmd-cards');
    if (hasBuilder) {
      renderBuildGrid(state, ctx);
      return;
    }
    // ability buttons (union of abilities across selection)
    const abilitySet = [];
    const seen = new Set();
    sel.forEach((u) => {
      const abs = unitAbilities(u.key, ctx);
      abs.forEach((a) => { if (!seen.has(a)) { seen.add(a); abilitySet.push({ a, unit: u }); } });
    });
    if (abilitySet.length) {
      abilitySet.forEach(({ a, unit }) => {
        const m = abilityMeta(a);
        const cdMap = unit.abilityCd || {};
        const cdLeft = cdMap[a] || 0;
        const card = el('div', 'ic-ability' + (cdLeft > 0.05 ? ' ic-cooling' : ''));
        card.dataset.ability = a;
        card.title = m.n;
        card.innerHTML = `${emblemIcon(a, 'ic-ability-icon') || svg('0 0 40 40', abilityGlyph(a), 'ic-ability-icon')}<span class="ic-ability-name">${m.n}</span>
          <div class="ic-ability-cd" style="--cd-deg:${cdLeft > 0.05 ? Math.round(Math.min(1, cdLeft / (m.cd || 10)) * 360) : 0}deg"><span>${cdLeft > 0.05 ? Math.ceil(cdLeft) : ''}</span></div>`;
        if (cdLeft <= 0.05) card.addEventListener('click', () => { onAbility(unit.id, a); blip(800, 0.05); });
        cmdGrid.appendChild(card);
      });
    }
    // stop/guard hint icons
    const hints = el('div', 'ic-cmd-hints');
    hints.innerHTML = `
      <div class="ic-hint" title="Stop (S)"><span class="ic-hint-key">S</span> Stop</div>
      <div class="ic-hint" title="Guard (G)"><span class="ic-hint-key">G</span> Guard</div>
      <div class="ic-hint" title="Attack-move (A)"><span class="ic-hint-key">A</span> Atk-Move</div>`;
    cmdGrid.appendChild(hints);
  }

  // Light refresh (no DOM rebuild): queue progress, cooldowns, affordability.
  function refreshCommandPanel(sel, cat, state, ctx) {
    const money = (state.player && state.player.money) || 0;
    const built = builtStructKeys(state);
    // single-entity portrait HP/tags refresh
    if (cat === 'production' || cat === 'structure' || cat === 'builder-struct' || cat === 'garrison') {
      const cur = byEntId(state, sel[0].id) || sel[0];
      const fill = cmdInfo.querySelector('.ic-portrait-hp-fill');
      const htext = cmdInfo.querySelector('.ic-portrait-hp-text');
      if (fill && cur.maxHp) {
        const frac = Math.max(0, Math.min(1, cur.hp / cur.maxHp));
        fill.style.width = Math.round(frac * 100) + '%';
        fill.style.background = hpColor(frac);
        if (htext) htext.textContent = `${Math.max(0, Math.round(cur.hp || 0))}/${Math.round(cur.maxHp || 0)}`;
      }
    }
    // affordability/locks on build & unit cards
    cmdGrid.querySelectorAll('.ic-card').forEach((card) => {
      const cost = parseInt(card.dataset.cost || '0', 10);
      const reqK = card.dataset.req || '';
      const isUnit = !!card.dataset.unitkey;
      const reqMet = prereqMet(reqK, built);
      const heroAlive = card.dataset.hero === '1' && isUnit && heroIsAlive(state, card.dataset.unitkey);
      const locked = !reqMet || heroAlive;
      const afford = money >= cost;
      card.classList.toggle('ic-locked', locked);
      card.classList.toggle('ic-unaffordable', !locked && !afford);
    });
    // production queue + upgrades
    if (cat === 'production') {
      const e = sel[0];
      const cur = byEntId(state, e.id) || e;
      const qstrip = cmdGrid.querySelector('.ic-queue');
      if (qstrip) syncQueueSlots(qstrip, Array.isArray(cur.queue) ? cur.queue : [], cur.faction || e.faction, ctx);
      // research progress
      const research = cur.research;
      if (research) {
        const rp = cmdGrid.querySelector('.ic-upgrade.ic-researching .ic-upgrade-prog');
        if (rp) rp.style.width = Math.round((research.progress || 0) * 100) + '%';
      }
    }
    // unit ability cooldowns + HP bars
    if (cat === 'units') {
      // refresh HP bars
      const pps = cmdInfo.querySelectorAll('.ic-pp');
      sel.slice(0, 12).forEach((u, i) => {
        const pc = pps[i]; if (!pc) return;
        const fill = pc.querySelector('.ic-pp-hp-fill');
        if (fill) { const frac = u.maxHp ? Math.max(0, Math.min(1, u.hp / u.maxHp)) : 1; fill.style.width = Math.round(frac * 100) + '%'; fill.style.background = hpColor(frac); }
      });
      // refresh ability cooldown sweeps from current selection's cooldowns
      cmdGrid.querySelectorAll('.ic-ability').forEach((card) => {
        const a = card.dataset.ability;
        if (!a) return;
        let cdLeft = 0;
        for (const u of sel) { const m = (u.abilityCd || {}); if (m[a] != null) { cdLeft = Math.max(cdLeft, m[a]); } }
        const meta = abilityMeta(a);
        const sweep = card.querySelector('.ic-ability-cd');
        const txt = sweep && sweep.querySelector('span');
        const cooling = cdLeft > 0.05;
        card.classList.toggle('ic-cooling', cooling);
        if (cooling) {
          if (sweep) sweep.style.setProperty('--cd-deg', Math.round(Math.min(1, cdLeft / (meta.cd || 10)) * 360) + 'deg');
          if (txt) txt.textContent = Math.ceil(cdLeft);
        } else if (txt) txt.textContent = '';
      });
    }
  }

  // ── Command panel helpers ──
  function portrait(target, e, ctx) {
    const frac = e.maxHp ? Math.max(0, Math.min(1, e.hp / e.maxHp)) : 1;
    const name = e.kind === 'structure' ? structName(ctx, e.key) : unitName(ctx, e.key);
    const building = e.building != null && e.building < 1;
    const disabled = e.disabled > 0;
    const powered = e.powered;
    target.className = 'ic-cmd-info ic-single-info';
    target.innerHTML = `
      <div class="ic-portrait-big">${entityIcon(e.key, { faction: e.faction, cls: 'ic-portrait-glyph' })}</div>
      <div class="ic-portrait-meta">
        <div class="ic-portrait-name">${name}</div>
        <div class="ic-portrait-hp"><div class="ic-portrait-hp-fill" style="width:${Math.round(frac * 100)}%;background:${hpColor(frac)}"></div>
          <span class="ic-portrait-hp-text">${Math.max(0, Math.round(e.hp || 0))}/${Math.round(e.maxHp || 0)}</span></div>
        ${building ? `<div class="ic-portrait-tag ic-building">Building ${Math.round((e.building || 0) * 100)}%</div>` : ''}
        ${disabled ? `<div class="ic-portrait-tag ic-disabled">Disabled ${Math.ceil(e.disabled)}s</div>` : ''}
        ${powered === false ? `<div class="ic-portrait-tag ic-unpowered">Offline (Low Power)</div>` : ''}
      </div>`;
  }
  function makeCard(o) {
    const card = el('div', 'ic-card'
      + (o.hero ? ' ic-hero' : '')
      + (o.sup ? ' ic-super' : '')
      + (o.locked ? ' ic-locked' : '')
      + (!o.locked && !o.afford ? ' ic-unaffordable' : ''));
    card.dataset.key = o.key;
    card.title = o.lockText || `${o.name} — $${o.cost}${o.time ? ` · ${o.time}s` : ''}`;
    card.innerHTML = `
      ${o.hotkey ? `<span class="ic-card-hotkey">${o.hotkey}</span>` : ''}
      ${o.hero ? '<span class="ic-card-herolabel">HERO</span>' : ''}
      ${o.sup ? '<span class="ic-card-herolabel ic-suplabel">SUPER</span>' : ''}
      ${entityIcon(o.glyphKey, { faction: o.faction, cls: 'ic-card-icon' })}
      <span class="ic-card-name">${o.name}</span>
      <span class="ic-card-cost">$${o.cost}</span>
      ${(o.locked) ? `<div class="ic-card-lock">${svg('0 0 24 24', `<rect x="6" y="11" width="12" height="9" rx="1" fill="${C}"/><path d="M8 11 V8 a4 4 0 0 1 8 0 v3" stroke="${C}" stroke-width="2" fill="none"/>`, 'ic-lock-icon')}</div>` : ''}`;
    return card;
  }
  function ctrlBtn(label, key, fn, variant) {
    const b = el('div', 'ic-ctrl' + (variant ? ' ic-ctrl-' + variant : ''));
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  }
  function productionUnits(e, faction, ctx) {
    // Prefer factionData mapping if it lists per-structure produces.
    const d = defStruct(ctx, e.key);
    if (d && Array.isArray(d.produces)) return d.produces;
    const map = PRODUCERS[e.key];
    if (map && map[faction]) return map[faction];
    if (map) { for (const k in map) return map[k]; }
    return [];
  }
  function unitReq(ctx, key) {
    const d = defUnit(ctx, key);
    if (d && d.req) return d.req;
    // a few canonical reqs (heroes need their tech building)
    const HERO_REQ = { ghost: 'uplink', mantis: 'warCouncil', cobra: 'citadel', meteor: 'uplink', emperor: 'warCouncil', scud: 'citadel' };
    return HERO_REQ[key] || '';
  }
  function upgradesAt(structKey, ctx) {
    const d = defStruct(ctx, structKey);
    if (d && Array.isArray(d.upgrades)) {
      return d.upgrades.map(u => typeof u === 'string' ? { key: u, n: pretty(u), c: 0 } : { key: u.key, n: u.name || pretty(u.key), c: u.cost || 0 });
    }
    return UPGRADES_AT[structKey] || [];
  }
  function unitAbilities(key, ctx) {
    const d = defUnit(ctx, key);
    if (d && Array.isArray(d.abilities)) return d.abilities;
    return ABILITIES_OF[key] || [];
  }
  function prettyReq(k) { return k ? structName({ factionData: null }, k) : ''; }
  function prereqMet(reqKey, built) {
    if (!reqKey) return true;
    if (reqKey === 'reactor') return built.has('fusionReactor') || built.has('fissionReactor');
    return built.has(reqKey);
  }
  function builtStructKeys(state) {
    const set = new Set();
    for (const e of (state.entities || [])) {
      if (e && e.kind === 'structure' && e.side === 'player' && (e.building == null || e.building >= 1)) set.add(e.key);
    }
    return set;
  }
  function heroIsAlive(state, key) {
    for (const e of (state.entities || [])) {
      if (e && e.side === 'player' && e.key === key && e.kind !== 'structure') return true;
    }
    return false;
  }
  function indexEntities(state) {
    const idx = {};
    for (const e of (state.entities || [])) if (e) idx[e.id] = e;
    state._entById = idx;
    return idx;
  }
  function byEntId(state, id) {
    const idx = state._entById || indexEntities(state);
    return idx[id];
  }

  // ════════════════════════════════════════════════════════════════════════
  // GENERAL'S PANEL
  // ════════════════════════════════════════════════════════════════════════
  function updateGeneralPanel(state, ctx, faction) {
    const p = state.player || {};
    const rank = p.rank || 1;
    const points = p.points || 0;
    const xp = p.xp || 0, nextXp = p.nextXp || 0;
    const xpFrac = nextXp > 0 ? Math.max(0, Math.min(1, xp / nextXp)) : (rank >= 5 ? 1 : 0);

    if (rank !== cache.rank) {
      cache.rank = rank;
      starsEl.innerHTML = Array.from({ length: 5 }).map((_, i) =>
        `<span class="ic-star ${i < rank ? 'ic-on' : ''}">★</span>`).join('');
    }
    if (points !== cache.points) {
      cache.points = points;
      pointsEl.textContent = points;
      pointsEl.classList.toggle('ic-hidden', points <= 0);
    }
    if (Math.abs(xpFrac - cache.xpFrac) > 0.005) {
      cache.xpFrac = xpFrac;
      xpFill.style.width = Math.round(xpFrac * 100) + '%';
    }

    // powers grid
    const powerKeys = factionPowers(faction, ctx);
    const owned = p.powers || {};
    const cds = p.powerCd || {};
    const sig = powerKeys.map(k => `${k}:${owned[k] || 0}:${Math.ceil(cds[k] || 0)}:${points}:${rank}`).join('|');
    if (sig !== cache.powersSig) {
      cache.powersSig = sig;
      renderPowers(powerKeys, owned, cds, points, rank, ctx);
    } else {
      // light cd refresh
      powerKeys.forEach((k) => {
        const btn = powersEl.querySelector(`[data-power="${k}"]`);
        if (!btn) return;
        const cd = cds[k] || 0;
        const m = powerMetaFor(k, ctx);
        const ring = btn.querySelector('.ic-pwr-ring');
        const txt = btn.querySelector('.ic-pwr-cd');
        if (cd > 0.05 && owned[k]) {
          const deg = Math.round((1 - Math.min(1, cd / (m.cd || 60))) * 360);
          if (ring) ring.style.setProperty('--pw-deg', deg + 'deg');
          if (txt) txt.textContent = Math.ceil(cd);
        } else if (txt) txt.textContent = '';
      });
    }
  }
  function factionPowers(faction, ctx) {
    const f = fd(ctx);
    if (f && f.powers && typeof f.powers === 'object') return Object.keys(f.powers);
    return POWERS_OF[faction] || [];
  }
  function powerMetaFor(key, ctx) {
    const f = fd(ctx);
    if (f && f.powers && f.powers[key]) {
      const d = f.powers[key];
      return { n: d.name || powerMeta(key).n, cost: d.cost != null ? d.cost : powerMeta(key).cost, cd: d.cd != null ? d.cd : powerMeta(key).cd, rank: d.rank != null ? d.rank : powerMeta(key).rank, levels: d.levels, passive: d.passive };
    }
    return powerMeta(key);
  }
  function renderPowers(keys, owned, cds, points, rank, ctx) {
    powersEl.innerHTML = '';
    keys.forEach((key) => {
      const m = powerMetaFor(key, ctx);
      const lvl = owned[key] || 0;
      const isOwned = lvl > 0;
      const cd = cds[key] || 0;
      const rankGated = (m.rank || 1) > rank;
      const purchasable = !rankGated && points >= (m.cost || 1) && (!m.levels || lvl < m.levels);
      const maxed = m.levels && lvl >= m.levels;
      const btn = el('div', 'ic-pwr');
      btn.dataset.power = key;
      let stateCls = '';
      if (rankGated && !isOwned) stateCls = 'ic-pwr-locked';
      else if (!isOwned && purchasable) stateCls = 'ic-pwr-buy';
      else if (!isOwned) stateCls = 'ic-pwr-unavail';
      else if (cd > 0.05) stateCls = 'ic-pwr-cooling';
      else stateCls = 'ic-pwr-ready';
      btn.classList.add(stateCls);
      const deg = (isOwned && cd > 0.05) ? Math.round((1 - Math.min(1, cd / (m.cd || 60))) * 360) : 360;
      btn.innerHTML = `
        <div class="ic-pwr-ring" style="--pw-deg:${deg}deg"></div>
        ${emblemIcon(key, 'ic-pwr-icon') || svg('0 0 40 40', powerGlyph(key), 'ic-pwr-icon')}
        ${isOwned && m.levels ? `<span class="ic-pwr-lvl">${lvl}${m.levels ? '/' + m.levels : ''}</span>` : ''}
        ${(!isOwned && !rankGated) ? `<span class="ic-pwr-buy-badge">${m.cost || 1}pt</span>` : ''}
        ${rankGated && !isOwned ? `<span class="ic-pwr-rank">R${m.rank}</span>` : ''}
        <div class="ic-pwr-cd">${isOwned && cd > 0.05 ? Math.ceil(cd) : ''}</div>
        <div class="ic-pwr-name">${m.n}</div>`;
      btn.title = `${m.n}${rankGated && !isOwned ? ` — requires Rank ${m.rank}` : isOwned ? (m.passive ? ' (passive)' : (cd > 0.05 ? ` — ${Math.ceil(cd)}s` : ' — ready')) : ` — ${m.cost || 1} point${(m.cost || 1) > 1 ? 's' : ''}`}`;
      if (!isOwned && purchasable) {
        btn.addEventListener('click', () => { onChoosePower(key); blip(900, 0.07, 'triangle'); });
      } else if (isOwned && !m.passive && cd <= 0.05) {
        btn.addEventListener('click', () => { onUsePower(key); blip(880, 0.06, 'triangle'); });
      }
      powersEl.appendChild(btn);
    });
    // points → "choose power" picker pulse hint
    if (points > 0) {
      const hint = el('div', 'ic-pwr-pickhint', `${points} promotion point${points > 1 ? 's' : ''} — choose a power`);
      powersEl.appendChild(hint);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // EVA banner queue
  // ════════════════════════════════════════════════════════════════════════
  function eva(key, text) {
    const sev = EVA_SEV[key] || 'info';
    const msg = text || EVA_TEXT[key] || pretty(key);
    // superweapon launch → full-width red warning
    if (key === 'superLaunchDetected') {
      superWarn.textContent = '⚠  SUPERWEAPON LAUNCH DETECTED  ⚠';
      superWarn.classList.remove('ic-hidden');
      clearTimeout(superWarn._to);
      superWarn._to = setTimeout(() => superWarn.classList.add('ic-hidden'), 5000);
      blip(140, 0.5, 'sawtooth', 0.08);
    }
    const id = ++cache.evaIds;
    const banner = el('div', 'ic-eva ic-eva-' + sev);
    banner.dataset.id = id;
    banner.innerHTML = `<span class="ic-eva-dot"></span><span class="ic-eva-text">EVA: ${msg}</span>`;
    evaWrap.appendChild(banner);
    // audio cue by severity
    const freq = sev === 'good' ? 880 : sev === 'danger' || sev === 'critical' ? 200 : sev === 'warn' ? 330 : 520;
    blip(freq, 0.12, sev === 'good' ? 'triangle' : 'square');
    // limit queue length
    while (evaWrap.children.length > 4) evaWrap.removeChild(evaWrap.firstChild);
    requestAnimationFrame(() => banner.classList.add('ic-in'));
    setTimeout(() => {
      banner.classList.remove('ic-in'); banner.classList.add('ic-out');
      setTimeout(() => banner.remove(), 400);
    }, 4200);
  }

  // ════════════════════════════════════════════════════════════════════════
  // MODE (cursor hints)
  // ════════════════════════════════════════════════════════════════════════
  function setMode(mode) {
    if (mode === cache.mode) return;
    cache.mode = mode;
    root.classList.remove('ic-mode-placing', 'ic-mode-targeting');
    modeHint.classList.add('ic-hidden');
    if (mode === 'placing') {
      root.classList.add('ic-mode-placing');
      modeHint.textContent = 'RIGHT-CLICK TO CANCEL';
      modeHint.classList.remove('ic-hidden');
    } else if (mode === 'targeting') {
      root.classList.add('ic-mode-targeting');
      modeHint.textContent = 'SELECT TARGET · RIGHT-CLICK TO CANCEL';
      modeHint.classList.remove('ic-hidden');
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // GAME OVER
  // ════════════════════════════════════════════════════════════════════════
  function showGameOver(result, stats, handlers = {}) {
    const win = result === 'win' || result === 'player' || result === true ||
                (result && result.winner === 'player');
    const color = win ? 'var(--ic-gold)' : 'var(--ic-red)';
    const title = win ? 'VICTORY' : 'DEFEAT';
    const eyebrow = win ? 'Enemy command destroyed' : 'Your command has fallen';
    const st = stats || (result && result.stats) || {};
    const rows = [
      ['Units Built', st.unitsBuilt ?? st.built ?? 0],
      ['Units Lost', st.unitsLost ?? st.lost ?? 0],
      ['Kills', st.kills ?? 0],
      ['Money Earned', '$' + (st.moneyEarned ?? st.earned ?? 0)],
      ['Supers Fired', st.supersFired ?? st.supers ?? 0],
      ['Time', fmtClock(st.time ?? st.duration ?? 0)],
      ['Rank Reached', st.rank ?? st.rankReached ?? 1],
    ];
    const titleChars = title.split('').map((ch, i) =>
      `<span class="ic-rch" style="animation-delay:${(i * 0.04).toFixed(3)}s">${ch === ' ' ? '&nbsp;' : ch}</span>`).join('');
    gameOverEl.innerHTML = `
      <div class="ic-result-panel" style="--res-color:${color}">
        <div class="ic-result-eyebrow">${eyebrow}</div>
        <h1 class="ic-result-title">${titleChars}</h1>
        <div class="ic-stats-grid">
          ${rows.map(([l, v]) => `<div class="ic-stat"><div class="ic-stat-label">${l}</div><div class="ic-stat-val">${v}</div></div>`).join('')}
        </div>
        <div class="ic-result-buttons">
          <button class="ic-btn ic-btn-primary" data-rematch>Rematch</button>
          <button class="ic-btn ic-btn-ghost" data-menu>Main Menu</button>
        </div>
      </div>`;
    gameOverEl.classList.remove('ic-hidden');
    gameOverEl.querySelector('[data-rematch]').addEventListener('click', () => {
      gameOverEl.classList.add('ic-hidden'); (handlers.onRematch || noop)();
    });
    gameOverEl.querySelector('[data-menu]').addEventListener('click', () => {
      gameOverEl.classList.add('ic-hidden'); (handlers.onMenu || noop)();
    });
    blip(win ? 660 : 160, 0.4, win ? 'triangle' : 'sawtooth', 0.07);
  }

  // ════════════════════════════════════════════════════════════════════════
  // PAUSE
  // ════════════════════════════════════════════════════════════════════════
  function showPause(handlers = {}) {
    pauseEl.innerHTML = `
      <div class="ic-pause-panel">
        <h2 class="ic-pause-title">Paused</h2>
        <div class="ic-pause-body">
          <div class="ic-pause-buttons">
            <button class="ic-btn ic-btn-primary" data-resume>Resume</button>
            <button class="ic-btn" data-restart>Restart Current Game</button>
            <button class="ic-btn ic-btn-ghost" data-menu>Main Menu</button>
          </div>
          <div class="ic-keyref">
            <div class="ic-keyref-title">Command Reference</div>
            <div class="ic-keyref-table">
              ${KEYREF.map(([k, d]) => `<span class="ic-key">${k}</span><span class="ic-keyref-desc">${d}</span>`).join('')}
            </div>
          </div>
        </div>
      </div>`;
    pauseEl.classList.remove('ic-hidden');
    pauseEl.querySelector('[data-resume]').addEventListener('click', () => { hidePause(); (handlers.onResume || noop)(); });
    pauseEl.querySelector('[data-restart]').addEventListener('click', () => { hidePause(); (handlers.onRestart || noop)(); });
    pauseEl.querySelector('[data-menu]').addEventListener('click', () => { hidePause(); (handlers.onMenu || noop)(); });
  }
  function hidePause() { pauseEl.classList.add('ic-hidden'); }

  // ── Destroy ────────────────────────────────────────────────────────────
  function destroy() {
    clearTimeout(R._deltaTO);
    clearTimeout(superWarn._to);
    try { if (audioCtx) audioCtx.close(); } catch (_) {}
    root.remove();
  }

  return { update, showGameOver, showPause, hidePause, setMode, eva, destroy, el: root };
}

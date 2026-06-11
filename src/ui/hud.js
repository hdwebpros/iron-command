// ════════════════════════════════════════════════════════════════════════════
// IRON COMMAND — In-match HUD
// export function HUD(rootEl, { onDeployRequest, onPowerRequest, onPause, onCardCancel })
//   → { update(state, generals, playerGeneralKey),
//       showGameOver(result, stats, {onRematch, onMenu}),
//       showPause({onResume,onRestart,onMenu}), hidePause(),
//       setActiveCard(unitKey|null), destroy() }
// Plain DOM/CSS. Built once; update() mutates only changed values (cached).
// ════════════════════════════════════════════════════════════════════════════

const SVGNS = 'http://www.w3.org/2000/svg';
function svg(viewBox, inner, cls) {
  return `<svg viewBox="${viewBox}" class="${cls || ''}" xmlns="${SVGNS}" fill="none">${inner}</svg>`;
}

// ── Unit silhouettes (inline SVG, simple recognizable shapes) ────────────────
// Drawn with currentColor fill so card state can recolor them.
const C = 'currentColor';
const UNIT_SILHOUETTES = {
  // generic infantry squad
  infantry: `<g fill="${C}"><circle cx="16" cy="9" r="4"/><rect x="12" y="14" width="8" height="14" rx="2"/><rect x="8" y="16" width="3" height="10" rx="1.5"/><rect x="21" y="16" width="3" height="10" rx="1.5"/><circle cx="30" cy="11" r="3"/><rect x="27" y="15" width="6" height="11" rx="2"/></g>`,
  // rifle squad
  rifle_squad: `<g fill="${C}"><circle cx="14" cy="9" r="4"/><rect x="10" y="14" width="8" height="13" rx="2"/><rect x="18" y="16" width="14" height="2.4" rx="1"/><circle cx="28" cy="11" r="3.2"/><rect x="25" y="15" width="6" height="11" rx="2"/></g>`,
  recon_squad: `<g fill="${C}"><circle cx="14" cy="9" r="4"/><rect x="10" y="14" width="8" height="13" rx="2"/><path d="M18 12 l12 -4 v3 l-12 4z"/><circle cx="29" cy="12" r="3"/><rect x="26" y="15" width="6" height="11" rx="2"/></g>`,
  conscript_mob: `<g fill="${C}"><circle cx="10" cy="10" r="3.4"/><rect x="7" y="14" width="6" height="11" rx="2"/><circle cx="20" cy="8" r="3.4"/><rect x="17" y="12" width="6" height="13" rx="2"/><circle cx="30" cy="11" r="3.4"/><rect x="27" y="15" width="6" height="10" rx="2"/></g>`,
  // missile / rocket infantry
  missile_team: `<g fill="${C}"><circle cx="13" cy="10" r="4"/><rect x="9" y="15" width="8" height="12" rx="2"/><rect x="15" y="11" width="18" height="4" rx="2" transform="rotate(-18 15 11)"/><path d="M33 6 l4 1 -3 3z"/></g>`,
  stinger_squad: `<g fill="${C}"><circle cx="13" cy="10" r="4"/><rect x="9" y="15" width="8" height="12" rx="2"/><rect x="14" y="10" width="20" height="3.6" rx="1.8" transform="rotate(-26 14 10)"/></g>`,
  rpg_brigade: `<g fill="${C}"><circle cx="13" cy="11" r="4"/><rect x="9" y="16" width="8" height="11" rx="2"/><rect x="14" y="12" width="20" height="4" rx="2" transform="rotate(-15 14 12)"/><circle cx="33" cy="7" r="2.6"/></g>`,
  // flame trooper
  flame_trooper: `<g fill="${C}"><circle cx="13" cy="11" r="4"/><rect x="9" y="16" width="8" height="11" rx="2"/><rect x="15" y="14" width="13" height="3" rx="1.5"/><path d="M28 13 q6 2 9 -2 q-2 6 -9 5z"/></g>`,
  // tanks (turret + tread)
  scorpion_tank: `<g fill="${C}"><rect x="5" y="20" width="30" height="9" rx="3"/><rect x="10" y="14" width="18" height="7" rx="2"/><rect x="26" y="15" width="14" height="3.2" rx="1.6"/></g>`,
  phantom_tank: `<g fill="${C}" opacity="0.85"><rect x="5" y="20" width="30" height="9" rx="3"/><path d="M10 14 h18 l-3 7 h-12z"/><rect x="26" y="15" width="13" height="3" rx="1.5"/></g>`,
  goliath: `<g fill="${C}"><rect x="3" y="21" width="34" height="10" rx="3"/><rect x="8" y="12" width="22" height="9" rx="2"/><rect x="27" y="12" width="14" height="3.4" rx="1.7"/><rect x="27" y="17" width="14" height="3.4" rx="1.7"/><rect x="14" y="7" width="5" height="6" rx="1"/></g>`,
  // AA / gatling track
  gatling_track: `<g fill="${C}"><rect x="5" y="20" width="30" height="9" rx="3"/><rect x="12" y="14" width="12" height="7" rx="2"/><rect x="22" y="13" width="13" height="2" rx="1"/><rect x="22" y="16" width="13" height="2" rx="1"/><rect x="22" y="19" width="13" height="2" rx="1"/></g>`,
  // howitzer / siege (long barrel raised)
  siege_howitzer: `<g fill="${C}"><rect x="5" y="22" width="28" height="8" rx="3"/><circle cx="14" cy="24" r="3.4" fill="#000" opacity="0.25"/><rect x="12" y="16" width="10" height="7" rx="2"/><rect x="18" y="6" width="3.6" height="16" rx="1.5" transform="rotate(-32 18 6)"/></g>`,
  mortar_crew: `<g fill="${C}"><circle cx="12" cy="13" r="3.6"/><rect x="8" y="17" width="7" height="10" rx="2"/><rect x="22" y="8" width="3.4" height="18" rx="1.5" transform="rotate(28 22 8)"/><rect x="20" y="24" width="12" height="3" rx="1.5"/></g>`,
  // technical (light truck w/ gun)
  technical: `<g fill="${C}"><path d="M5 24 h22 l-3 -6 h-9 l-2 -4 h-5z"/><circle cx="11" cy="27" r="3"/><circle cx="24" cy="27" r="3"/><rect x="22" y="9" width="13" height="2.4" rx="1"/></g>`,
  // harvester (boxy industrial)
  harvester: `<g fill="${C}"><path d="M4 25 h26 v-6 l6 -3 v9 h2 v4 h-34z"/><circle cx="11" cy="29" r="3"/><circle cx="24" cy="29" r="3"/><rect x="6" y="13" width="14" height="6" rx="1"/></g>`,
  // drone / aircraft
  venom_drone: `<g fill="${C}"><ellipse cx="20" cy="18" rx="9" ry="4"/><rect x="4" y="17" width="14" height="2" rx="1"/><rect x="22" y="17" width="14" height="2" rx="1"/><circle cx="20" cy="18" r="2.4" fill="#000" opacity="0.3"/></g>`,
  razor_jet: `<g fill="${C}"><path d="M6 18 L30 15 L37 18 L30 21 Z"/><path d="M14 18 L20 8 L23 18z"/><path d="M14 18 L20 28 L23 18z"/></g>`,
  spectre: `<g fill="${C}"><path d="M4 17 h30 l3 2 -3 2 h-30 l-2 -2z"/><path d="M12 17 l5 -8 4 0 -2 8z"/><rect x="22" y="22" width="3" height="4" rx="1"/><rect x="28" y="22" width="3" height="4" rx="1"/></g>`,
  // mech (legged walker)
  warlord: `<g fill="${C}"><rect x="11" y="9" width="18" height="11" rx="3"/><rect x="6" y="12" width="6" height="3" rx="1.5"/><rect x="28" y="12" width="6" height="3" rx="1.5"/><path d="M14 20 l-4 9 h3 l3 -7z"/><path d="M26 20 l4 9 h-3 l-3 -7z"/><rect x="17" y="5" width="6" height="5" rx="1"/></g>`,
};
function unitSilhouette(key) {
  return UNIT_SILHOUETTES[key] || UNIT_SILHOUETTES.infantry;
}

// ── Misc icons ───────────────────────────────────────────────────────────────
const ICON_RADIATION = svg('0 0 24 24', `
  <circle cx="12" cy="12" r="2.4" fill="${C}"/>
  <path d="M12 12 L12 3 A9 9 0 0 1 19.8 7.5 Z" fill="${C}"/>
  <path d="M12 12 L19.8 16.5 A9 9 0 0 1 12 21 Z" fill="${C}"/>
  <path d="M12 12 L4.2 16.5 A9 9 0 0 1 4.2 7.5 Z" fill="${C}"/>
`, 'ic-nuke-icon');

const ICON_PAUSE = svg('0 0 24 24', `<rect x="6" y="5" width="4" height="14" rx="1" fill="${C}"/><rect x="14" y="5" width="4" height="14" rx="1" fill="${C}"/>`);

const ICON_POWER_DEFAULT = svg('0 0 24 24', `<path d="M13 2 L4 14 h6 l-2 8 9 -12 h-6z" fill="${C}"/>`, 'ic-power-icon');

// Hotkey reference for the pause overlay
const KEYREF = [
  ['1 – 7', 'Deploy unit'],
  ['Q',     'General power'],
  ['H',     'Select hero'],
  ['Space', 'Recenter camera'],
  ['W A S D', 'Pan camera'],
  ['Wheel', 'Zoom'],
  ['Esc / P', 'Pause'],
];

const HP_CHUNKS = 20;

function hpColor(frac) {
  if (frac > 0.5) return 'var(--ic-green)';
  if (frac > 0.25) return 'var(--ic-amber)';
  return 'var(--ic-red)';
}
function fmtClock(t) {
  const s = Math.max(0, Math.floor(t || 0));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss < 10 ? '0' : ''}${ss}`;
}

// Fallback unit metadata (name + cost) if def not provided through state/generals.
const UNIT_META = {
  rifle_squad:{n:'Rifle Squad',c:100}, missile_team:{n:'Missile Team',c:175},
  scorpion_tank:{n:'Scorpion',c:300}, gatling_track:{n:'Gatling Track',c:250},
  siege_howitzer:{n:'Siege Howitzer',c:450}, harvester:{n:'Harvester',c:200},
  goliath:{n:'Goliath',c:900},
  recon_squad:{n:'Recon Squad',c:90}, stinger_squad:{n:'Stinger Squad',c:175},
  venom_drone:{n:'Venom Drone',c:220}, razor_jet:{n:'Razor Jet',c:350},
  phantom_tank:{n:'Phantom Tank',c:380}, spectre:{n:'Spectre',c:950},
  conscript_mob:{n:'Conscript Mob',c:70}, rpg_brigade:{n:'RPG Brigade',c:160},
  flame_trooper:{n:'Flame Trooper',c:180}, technical:{n:'Technical',c:200},
  mortar_crew:{n:'Mortar Crew',c:320}, warlord:{n:'Warlord Mech',c:850},
};
const HERO_KEYS = new Set(['goliath','spectre','warlord']);

// ════════════════════════════════════════════════════════════════════════════
export function HUD(rootEl, opts = {}) {
  const onDeployRequest = opts.onDeployRequest || (() => {});
  const onPowerRequest  = opts.onPowerRequest  || (() => {});
  const onPause         = opts.onPause         || (() => {});
  const onCardCancel    = opts.onCardCancel    || (() => {});

  // ── Build static DOM once ──────────────────────────────────────────────
  const el = document.createElement('div');
  el.className = 'ic-hud';
  rootEl.appendChild(el);

  // Top bar
  const topbar = document.createElement('div');
  topbar.className = 'ic-topbar';
  topbar.innerHTML = `
    ${combatantPanel('player', 'YOUR FORCES')}
    <div class="ic-top-panel ic-center">
      <div class="ic-clock-label">Mission Time</div>
      <div class="ic-clock" data-clock>0:00</div>
      <div class="ic-pads">
        ${[0,1,2].map(i => `<div class="ic-pad-pip" data-pad="${i}"><div class="ic-pad-pip-prog"></div></div>`).join('')}
      </div>
    </div>
    ${combatantPanel('enemy', 'HOSTILE FORCES')}
    <div class="ic-resources">
      <div class="ic-top-panel ic-credits">
        <div class="ic-credits-label">Credits</div>
        <div class="ic-credits-val"><span class="ic-credits-amt" data-credits>0</span><span class="ic-credits-cr">CR</span></div>
        <div class="ic-credits-delta" data-credits-delta></div>
      </div>
      <div class="ic-top-panel ic-icon-btn" data-pause title="Pause (Esc)">${ICON_PAUSE}</div>
    </div>
  `;
  el.appendChild(topbar);

  function combatantPanel(side, label) {
    return `
      <div class="ic-top-panel ic-combatant ic-side-${side}" data-side="${side}">
        <div class="ic-combatant-head">
          <span class="ic-combatant-label" data-name>${label}</span>
          <span class="ic-combatant-sub">BASE INTEGRITY</span>
        </div>
        <div class="ic-hpbar" data-hpbar>
          ${Array.from({length:HP_CHUNKS}).map(() => '<div class="ic-hp-chunk"></div>').join('')}
          <span class="ic-hpbar-text" data-hptext>1000</span>
        </div>
        <div class="ic-nuke" data-nuke>
          ${ICON_RADIATION}
          <div class="ic-nuke-track"><div class="ic-nuke-fill" data-nukefill></div></div>
          <span class="ic-nuke-pct" data-nukepct>0%</span>
        </div>
      </div>`;
  }

  // Bottom dock (7 cards built on first update once we know the roster)
  const dock = document.createElement('div');
  dock.className = 'ic-dock';
  const cardsWrap = document.createElement('div');
  cardsWrap.className = 'ic-cards';
  dock.appendChild(cardsWrap);
  el.appendChild(dock);

  // Power button
  const powerWrap = document.createElement('div');
  powerWrap.className = 'ic-power';
  powerWrap.innerHTML = `
    <button class="ic-power-btn" data-power>
      <div class="ic-power-ring"></div>
      <span class="ic-power-badge">Q</span>
      ${ICON_POWER_DEFAULT}
      <div class="ic-power-cd-text" data-powcd></div>
      <div class="ic-power-name" data-powname>Power</div>
    </button>
  `;
  el.appendChild(powerWrap);

  // Overlays (built once, hidden)
  const gameOverEl = document.createElement('div');
  gameOverEl.className = 'ic-overlay ic-scanlines ic-hidden';
  el.appendChild(gameOverEl);

  const pauseEl = document.createElement('div');
  pauseEl.className = 'ic-overlay ic-scanlines ic-hidden';
  el.appendChild(pauseEl);

  // ── Cached refs ────────────────────────────────────────────────────────
  const refs = {
    clock: topbar.querySelector('[data-clock]'),
    credits: topbar.querySelector('[data-credits]'),
    creditsDelta: topbar.querySelector('[data-credits-delta]'),
    pads: [0,1,2].map(i => topbar.querySelector(`[data-pad="${i}"]`)),
    pause: topbar.querySelector('[data-pause]'),
    power: powerWrap.querySelector('[data-power]'),
    powerRing: powerWrap.querySelector('.ic-power-ring'),
    powerIcon: powerWrap.querySelector('.ic-power-icon'),
    powCd: powerWrap.querySelector('[data-powcd]'),
    powName: powerWrap.querySelector('[data-powname]'),
    sides: {},
  };
  for (const side of ['player','enemy']) {
    const p = topbar.querySelector(`.ic-combatant[data-side="${side}"]`);
    refs.sides[side] = {
      name: p.querySelector('[data-name]'),
      chunks: Array.from(p.querySelectorAll('.ic-hp-chunk')),
      hptext: p.querySelector('[data-hptext]'),
      nuke: p.querySelector('[data-nuke]'),
      nukefill: p.querySelector('[data-nukefill]'),
      nukepct: p.querySelector('[data-nukepct]'),
    };
  }

  // ── Cached last values ─────────────────────────────────────────────────
  const cache = {
    clock: '', credits: null, creditsDisplay: 0,
    hp: { player: -1, enemy: -1 },
    nuke: { player: -1, enemy: -1 },
    nukeWarn: { player: null, enemy: null },
    pads: [undefined, undefined, undefined],
    padProg: [-1,-1,-1],
    power: { deg: -1, ready: null, cd: '' },
    cards: {},          // unitKey -> {cd, deg, afford, hero, heroAlive, active}
    activeCard: null,
    rosterKeys: null,
  };

  // ── Card construction ──────────────────────────────────────────────────
  let cardEls = {};   // unitKey -> {el, cd, cdText, name, cost, icon}
  function buildCards(keys) {
    cardsWrap.innerHTML = '';
    cardEls = {};
    keys.forEach((key, i) => {
      // Hero = known hero key, or conventionally the 7th/last card slot.
      const hero = HERO_KEYS.has(key) || (keys.length === 7 && i === 6);
      const meta = UNIT_META[key] || { n: prettyName(key), c: 0 };
      const card = document.createElement('div');
      card.className = 'ic-card' + (hero ? ' ic-hero' : '');
      card.setAttribute('data-key', key);
      card.innerHTML = `
        <span class="ic-card-hotkey">${i + 1}</span>
        ${hero ? '<span class="ic-card-herolabel">HERO</span>' : ''}
        ${svg('0 0 40 36', unitSilhouette(key), 'ic-card-icon')}
        <span class="ic-card-name" data-cname>${meta.n}</span>
        <span class="ic-card-cost" data-ccost>${meta.c}</span>
        <div class="ic-card-cd"><div class="ic-card-cd-text" data-cdtext></div></div>
      `;
      cardsWrap.appendChild(card);
      cardEls[key] = {
        el: card,
        cd: card.querySelector('.ic-card-cd'),
        cdText: card.querySelector('[data-cdtext]'),
        cost: card.querySelector('[data-ccost]'),
        name: card.querySelector('[data-cname]'),
      };
      card.addEventListener('click', () => {
        if (card.classList.contains('ic-unaffordable')) return;
        if (card.classList.contains('ic-cooling')) return;
        if (card.classList.contains('ic-hero-active')) return;
        onDeployRequest(key);
      });
      card.addEventListener('contextmenu', (e) => { e.preventDefault(); onCardCancel(); });
    });
  }
  function prettyName(k) {
    return String(k).split('_').map(w => w[0]?.toUpperCase() + w.slice(1)).join(' ');
  }

  // ── update(): per-frame, allocation-light ──────────────────────────────
  function update(state, generals, playerGeneralKey) {
    if (!state) return;

    // Resolve roster keys (player general's units)
    let roster = null;
    if (generals && playerGeneralKey && generals[playerGeneralKey] && Array.isArray(generals[playerGeneralKey].units)) {
      roster = generals[playerGeneralKey].units;
    } else if (state.cooldowns && state.cooldowns.player) {
      roster = Object.keys(state.cooldowns.player);
    }
    if (roster && (!cache.rosterKeys || cache.rosterKeys.join() !== roster.join())) {
      cache.rosterKeys = roster.slice();
      buildCards(roster.slice(0, 7));
      // refresh card metadata from generals def if available
      const gen = generals && playerGeneralKey ? generals[playerGeneralKey] : null;
      applyCardDefs(roster, gen, state);
      // power name
      if (gen && gen.power) {
        if (refs.powName) refs.powName.textContent = gen.power.name || 'Power';
        const badge = powerWrap.querySelector('.ic-power-badge');
        if (badge) badge.textContent = (gen.power.key || 'Q').toUpperCase();
      }
    }

    // ── Clock
    const clk = fmtClock(state.time);
    if (clk !== cache.clock) { cache.clock = clk; refs.clock.textContent = clk; }

    // ── Credits w/ animated tick + flash
    const credits = Math.floor((state.credits && state.credits.player) || 0);
    if (cache.credits === null) { cache.credits = credits; cache.creditsDisplay = credits; refs.credits.textContent = credits; }
    if (credits !== cache.credits) {
      const diff = credits - cache.credits;
      // flash + delta tag
      refs.credits.classList.remove('ic-flash-up', 'ic-flash-down');
      void refs.credits.offsetWidth; // restart animation
      refs.credits.classList.add(diff > 0 ? 'ic-flash-up' : 'ic-flash-down');
      if (Math.abs(diff) >= 10) {
        refs.creditsDelta.textContent = (diff > 0 ? '+' : '') + diff;
        refs.creditsDelta.className = 'ic-credits-delta ic-show ' + (diff > 0 ? 'ic-up' : 'ic-down');
        clearTimeout(refs._deltaTO);
        refs._deltaTO = setTimeout(() => { refs.creditsDelta.classList.remove('ic-show'); }, 700);
      }
      cache.credits = credits;
    }
    // smooth tick-up of displayed number toward target
    if (cache.creditsDisplay !== credits) {
      const gap = credits - cache.creditsDisplay;
      const step = Math.max(1, Math.ceil(Math.abs(gap) * 0.25));
      if (Math.abs(gap) <= step) cache.creditsDisplay = credits;
      else cache.creditsDisplay += gap > 0 ? step : -step;
      refs.credits.textContent = cache.creditsDisplay;
    }

    // ── Base HP + nukes per side
    for (const side of ['player','enemy']) {
      const s = refs.sides[side];
      const hp = Math.max(0, Math.round((state.baseHp && state.baseHp[side]) ?? 1000));
      if (hp !== cache.hp[side]) {
        cache.hp[side] = hp;
        const frac = hp / 1000;
        const col = hpColor(frac);
        const on = Math.round(frac * HP_CHUNKS);
        for (let i = 0; i < HP_CHUNKS; i++) {
          const c = s.chunks[i];
          const lit = i < on;
          if (lit) { c.classList.add('ic-on'); c.style.setProperty('--hp-color', col); }
          else c.classList.remove('ic-on');
        }
        s.hptext.textContent = hp;
      }
      const nk = Math.max(0, Math.min(100, Math.round((state.nuke && state.nuke[side]) || 0)));
      if (nk !== cache.nuke[side]) {
        cache.nuke[side] = nk;
        s.nukefill.style.width = nk + '%';
        s.nukepct.textContent = nk + '%';
        s.nukefill.style.setProperty('--nuke-color', side === 'player' ? 'var(--ic-cyan)' : 'var(--ic-amber)');
      }
      const warn = nk >= 80;
      if (warn !== cache.nukeWarn[side]) {
        cache.nukeWarn[side] = warn;
        s.nuke.classList.toggle('ic-warn', warn);
      }
    }

    // ── Pads
    const pads = state.pads || [];
    for (let i = 0; i < 3; i++) {
      const pad = pads[i];
      const owner = pad ? (pad.owner || 'none') : 'none';
      if (owner !== cache.pads[i]) {
        cache.pads[i] = owner;
        refs.pads[i].setAttribute('data-owner', owner);
      }
      const prog = pad ? Math.max(0, Math.min(1, pad.progress || 0)) : 0;
      const progPct = Math.round(prog * 100);
      if (progPct !== cache.padProg[i]) {
        cache.padProg[i] = progPct;
        const bar = refs.pads[i].querySelector('.ic-pad-pip-prog');
        if (bar) bar.style.width = (owner === 'none' ? progPct : 0) + '%';
      }
    }

    // ── Hero alive? (player side)
    let heroAlive = false;
    if (Array.isArray(state.units)) {
      for (const u of state.units) {
        if (u && u.side === 'player' && (u.def?.hero || HERO_KEYS.has(u.key))) { heroAlive = true; break; }
      }
    }

    // ── Cards: cooldown radial + affordability + hero state
    const cds = (state.cooldowns && state.cooldowns.player) || {};
    for (const key in cardEls) {
      const ce = cardEls[key];
      const isHero = ce.el.classList.contains('ic-hero');
      const cost = readCost(key, generals, playerGeneralKey, ce);
      const cd = Math.max(0, cds[key] || 0);
      const buildCd = readBuildCd(key, generals, playerGeneralKey);
      let prev = cache.cards[key];
      if (!prev) prev = cache.cards[key] = {};

      // cooldown sweep
      if (cd > 0.05) {
        const deg = Math.round(Math.min(1, buildCd ? cd / buildCd : Math.min(cd / 10, 1)) * 360);
        if (!prev.cooling) { ce.el.classList.add('ic-cooling'); prev.cooling = true; }
        if (deg !== prev.deg) { ce.cd.style.setProperty('--cd-deg', deg + 'deg'); prev.deg = deg; }
        const t = Math.ceil(cd);
        if (t !== prev.cdText) { ce.cdText.textContent = t; prev.cdText = t; }
      } else if (prev.cooling) {
        ce.el.classList.remove('ic-cooling'); prev.cooling = false; prev.deg = -1; prev.cdText = '';
        ce.cdText.textContent = '';
      }

      // affordability
      const afford = credits >= cost;
      if (afford !== prev.afford) { ce.el.classList.toggle('ic-unaffordable', !afford); prev.afford = afford; }

      // hero disabled while alive
      if (isHero) {
        if (heroAlive !== prev.heroAlive) { ce.el.classList.toggle('ic-hero-active', heroAlive); prev.heroAlive = heroAlive; }
      }
    }

    // ── Power button: radial cooldown + ready pulse
    const powerCd = Math.max(0, (state.powerCd && state.powerCd.player) || 0);
    const powerMax = readPowerCd(generals, playerGeneralKey) || 90;
    const ready = powerCd <= 0.05;
    if (ready !== cache.power.ready) {
      cache.power.ready = ready;
      refs.power.classList.toggle('ic-ready', ready);
      refs.power.classList.toggle('ic-cooling', !ready);
    }
    const deg = ready ? 360 : Math.round((1 - powerCd / powerMax) * 360);
    if (deg !== cache.power.deg) { cache.power.deg = deg; refs.powerRing.style.setProperty('--pow-deg', deg + 'deg'); }
    const cdLabel = ready ? '' : String(Math.ceil(powerCd));
    if (cdLabel !== cache.power.cd) { cache.power.cd = cdLabel; refs.powCd.textContent = cdLabel; }
  }

  // ── Card def helpers (prefer generals/def, fall back to UNIT_META) ──────
  const costCache = {};
  function applyCardDefs(roster, gen, state) {
    roster.forEach((key) => {
      const ce = cardEls[key];
      if (!ce) return;
      const def = findDef(key, gen, state);
      if (def) {
        if (def.name) ce.name.textContent = def.name;
        if (typeof def.cost === 'number') ce.cost.textContent = def.cost;
      }
    });
  }
  function findDef(key, gen, state) {
    // 1) generals[].defs / units may carry per-unit defs in some sim builds
    if (gen) {
      if (gen.defs && gen.defs[key]) return gen.defs[key];
      if (gen.unitDefs && gen.unitDefs[key]) return gen.unitDefs[key];
    }
    // 2) any deployed unit of this key carries def
    if (state && Array.isArray(state.units)) {
      for (const u of state.units) if (u && u.key === key && u.def) return u.def;
    }
    return null;
  }
  function readCost(key, generals, pgk, ce) {
    if (costCache[key] != null) return costCache[key];
    const gen = generals && pgk ? generals[pgk] : null;
    const def = findDef(key, gen, null);
    let c = def && typeof def.cost === 'number' ? def.cost
          : (UNIT_META[key] ? UNIT_META[key].c : 0);
    // also try the rendered cost text
    if (!c && ce) { const t = parseInt(ce.cost.textContent, 10); if (!isNaN(t)) c = t; }
    costCache[key] = c;
    return c;
  }
  function readBuildCd(key, generals, pgk) {
    const gen = generals && pgk ? generals[pgk] : null;
    const def = findDef(key, gen, null);
    return def && typeof def.buildCooldown === 'number' ? def.buildCooldown : 0;
  }
  function readPowerCd(generals, pgk) {
    const gen = generals && pgk ? generals[pgk] : null;
    return gen && gen.power && typeof gen.power.cd === 'number' ? gen.power.cd : 0;
  }

  // ── setActiveCard ──────────────────────────────────────────────────────
  function setActiveCard(unitKey) {
    if (cache.activeCard === unitKey) return;
    // clear old
    if (cache.activeCard && cardEls[cache.activeCard]) {
      cardEls[cache.activeCard].el.classList.remove('ic-active');
    }
    cache.activeCard = unitKey;
    if (unitKey && cardEls[unitKey]) cardEls[unitKey].el.classList.add('ic-active');
    // power active state when 'Q'/power targeting
    refs.power.classList.toggle('ic-active', unitKey === '__power__');
  }

  // ── Game over overlay ──────────────────────────────────────────────────
  function showGameOver(result, stats, handlers = {}) {
    const win = result === 'win' || result === 'player' || result === true ||
                (result && result.winner === 'player');
    const color = win ? 'var(--ic-gold)' : 'var(--ic-red)';
    const title = win ? 'MISSION ACCOMPLISHED' : 'MISSION FAILED';
    const eyebrow = win ? 'VICTORY' : 'DEFEAT';
    const st = stats || {};
    const rows = [
      ['Units Built', st.unitsBuilt ?? st.built ?? 0],
      ['Units Lost', st.unitsLost ?? st.lost ?? 0],
      ['Damage Dealt', Math.round(st.damageDealt ?? st.damage ?? 0)],
      ['Time', fmtClock(st.time ?? st.duration ?? 0)],
    ];
    const titleChars = title.split('').map((ch, i) =>
      `<span class="ic-rch" style="animation-delay:${(i * 0.035).toFixed(3)}s">${ch === ' ' ? '&nbsp;' : ch}</span>`
    ).join('');

    gameOverEl.innerHTML = `
      <div class="ic-result-panel" style="--res-color:${color}">
        <div class="ic-result-eyebrow">${eyebrow}</div>
        <h1 class="ic-result-title">${titleChars}</h1>
        <div class="ic-stats-grid">
          ${rows.map(([l, v]) => `
            <div class="ic-stat">
              <div class="ic-stat-label">${l}</div>
              <div class="ic-stat-val">${v}</div>
            </div>`).join('')}
        </div>
        <div class="ic-result-buttons">
          <button class="ic-btn ic-btn-primary" data-rematch>Rematch</button>
          <button class="ic-btn ic-btn-ghost" data-menu>Main Menu</button>
        </div>
      </div>
    `;
    gameOverEl.classList.remove('ic-hidden');
    gameOverEl.querySelector('[data-rematch]').addEventListener('click', () => {
      gameOverEl.classList.add('ic-hidden');
      (handlers.onRematch || (() => {}))();
    });
    gameOverEl.querySelector('[data-menu]').addEventListener('click', () => {
      gameOverEl.classList.add('ic-hidden');
      (handlers.onMenu || (() => {}))();
    });
  }
  function hideGameOver() { gameOverEl.classList.add('ic-hidden'); }

  // ── Pause overlay ──────────────────────────────────────────────────────
  function showPause(handlers = {}) {
    pauseEl.innerHTML = `
      <div class="ic-pause-panel">
        <h2 class="ic-pause-title">Paused</h2>
        <div class="ic-pause-body">
          <div class="ic-pause-buttons">
            <button class="ic-btn ic-btn-primary" data-resume>Resume</button>
            <button class="ic-btn" data-restart>Restart</button>
            <button class="ic-btn ic-btn-ghost" data-menu>Main Menu</button>
          </div>
          <div class="ic-keyref">
            <div class="ic-keyref-title">Command Reference</div>
            <div class="ic-keyref-table">
              ${KEYREF.map(([k, d]) => `<span class="ic-key">${k}</span><span class="ic-keyref-desc">${d}</span>`).join('')}
            </div>
          </div>
        </div>
      </div>
    `;
    pauseEl.classList.remove('ic-hidden');
    pauseEl.querySelector('[data-resume]').addEventListener('click', () => {
      hidePause(); (handlers.onResume || (() => {}))();
    });
    pauseEl.querySelector('[data-restart]').addEventListener('click', () => {
      hidePause(); (handlers.onRestart || (() => {}))();
    });
    pauseEl.querySelector('[data-menu]').addEventListener('click', () => {
      hidePause(); (handlers.onMenu || (() => {}))();
    });
  }
  function hidePause() { pauseEl.classList.add('ic-hidden'); }

  // ── Wire static buttons ────────────────────────────────────────────────
  refs.pause.addEventListener('click', () => onPause());
  refs.power.addEventListener('click', () => {
    if (refs.power.classList.contains('ic-cooling')) return;
    onPowerRequest();
  });

  // ── Destroy ────────────────────────────────────────────────────────────
  function destroy() {
    clearTimeout(refs._deltaTO);
    el.remove();
  }

  return {
    update, showGameOver, hideGameOver, showPause, hidePause, setActiveCard, destroy, el,
  };
}

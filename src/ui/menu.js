// ════════════════════════════════════════════════════════════════════════════
// IRON COMMAND — Main menu
// export function Menu(rootEl, { onStart, generals })
//   → { show(), hide(), setGenerals(generalsObj), destroy() }
// Plain DOM/CSS. No framework, no imports. Renders into #ui-root.
// ════════════════════════════════════════════════════════════════════════════

// ── SVG helpers ─────────────────────────────────────────────────────────────
const SVGNS = 'http://www.w3.org/2000/svg';
function svg(viewBox, inner, cls) {
  return `<svg viewBox="${viewBox}" class="${cls || ''}" xmlns="${SVGNS}" fill="none">${inner}</svg>`;
}

// Distinct emblem per general key. accent uses currentColor via the card's --accent.
const EMBLEMS = {
  steel: svg('0 0 100 100', `
    <circle cx="50" cy="50" r="46" stroke="var(--accent)" stroke-width="2" opacity="0.7"/>
    <circle cx="50" cy="50" r="40" stroke="var(--accent)" stroke-width="1" opacity="0.35"/>
    <!-- armored chevrons -->
    <path d="M50 24 L74 50 L62 50 L50 38 L38 50 L26 50 Z" fill="var(--accent)"/>
    <path d="M50 44 L74 70 L62 70 L50 58 L38 70 L26 70 Z" fill="var(--accent)" opacity="0.55"/>
    <!-- tank tread silhouette -->
    <rect x="30" y="74" width="40" height="9" rx="3" fill="var(--accent)" opacity="0.8"/>
    <rect x="44" y="68" width="12" height="8" fill="var(--accent)"/>
  `, 'ic-gen-emblem'),

  phantom: svg('0 0 100 100', `
    <circle cx="50" cy="50" r="46" stroke="var(--accent)" stroke-width="2" opacity="0.7"/>
    <circle cx="50" cy="50" r="40" stroke="var(--accent)" stroke-width="1" opacity="0.35"/>
    <!-- winged delta / ghost wraith -->
    <path d="M50 22 L70 64 L50 54 L30 64 Z" fill="var(--accent)"/>
    <path d="M50 22 L16 56 L30 56 L50 40 Z" fill="var(--accent)" opacity="0.45"/>
    <path d="M50 22 L84 56 L70 56 L50 40 Z" fill="var(--accent)" opacity="0.45"/>
    <path d="M40 70 q10 12 20 0" stroke="var(--accent)" stroke-width="3" opacity="0.7"/>
  `, 'ic-gen-emblem'),

  hammer: svg('0 0 100 100', `
    <circle cx="50" cy="50" r="46" stroke="var(--accent)" stroke-width="2" opacity="0.7"/>
    <circle cx="50" cy="50" r="40" stroke="var(--accent)" stroke-width="1" opacity="0.35"/>
    <!-- star behind fist -->
    <path d="M50 18 L57 38 L78 38 L61 50 L67 70 L50 58 L33 70 L39 50 L22 38 L43 38 Z" fill="var(--accent)" opacity="0.4"/>
    <!-- raised fist -->
    <rect x="40" y="44" width="20" height="22" rx="4" fill="var(--accent)"/>
    <rect x="40" y="38" width="5" height="12" rx="2" fill="var(--accent)"/>
    <rect x="46" y="34" width="5" height="16" rx="2" fill="var(--accent)"/>
    <rect x="52" y="36" width="5" height="14" rx="2" fill="var(--accent)"/>
    <rect x="58" y="40" width="5" height="10" rx="2" fill="var(--accent)"/>
    <rect x="36" y="48" width="6" height="10" rx="3" fill="var(--accent)"/>
  `, 'ic-gen-emblem'),
};
function emblemFor(key) {
  return EMBLEMS[key] || svg('0 0 100 100',
    `<circle cx="50" cy="50" r="44" stroke="var(--accent)" stroke-width="2"/><path d="M50 28 L68 62 H32 Z" fill="var(--accent)"/>`,
    'ic-gen-emblem');
}

const DIFF_ICONS = {
  easy: svg('0 0 24 24', `<path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`, 'ic-diff-icon'),
  hard: svg('0 0 24 24', `<path d="M12 3l2.5 6.5L21 11l-5 4 1.5 6.5L12 18l-5.5 3.5L8 15 3 11l6.5-1.5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>`, 'ic-diff-icon'),
  brutal: svg('0 0 24 24', `<path d="M8 2h8l-1 5h2l-2 4h2l-3 11-2-6-2 6-3-11h2L7 7h2z" fill="currentColor"/>`, 'ic-diff-icon'),
};

const DIFFICULTIES = [
  { key: 'easy',   name: 'Easy',   flavor: 'Training exercise.',   heat: 'var(--ic-green)' },
  { key: 'hard',   name: 'Hard',   flavor: 'Fair fight.',          heat: 'var(--ic-amber)' },
  { key: 'brutal', name: 'Brutal', flavor: 'They know no mercy.',  heat: 'var(--ic-red)'   },
];

const VERSION = 'v0.1.0';

// Fallback generals data (used only if sim hasn't supplied GENERALS yet).
const FALLBACK_GENERALS = {
  steel: {
    name: 'Vance', title: 'Steel', color: '#cfa23c',
    desc: 'Armor Division. Heavy vehicles, overwhelming firepower, rolling steel.',
    power: { key: 'q', name: 'Artillery Barrage', desc: '8 shells over 2s in a 3-tile circle.' },
    units: ['rifle_squad','missile_team','scorpion_tank','gatling_track','siege_howitzer','harvester','goliath'],
  },
  phantom: {
    name: 'Kira', title: 'Phantom', color: '#28d3e8',
    desc: 'Stealth & Air. Fast strikes, cloaked armor, total air superiority.',
    power: { key: 'q', name: 'EMP Strike', desc: 'Stun enemy vehicles & air in a 4-tile radius for 6s.' },
    units: ['recon_squad','stinger_squad','venom_drone','razor_jet','phantom_tank','harvester','spectre'],
  },
  hammer: {
    name: 'Marcus', title: 'Hammer', color: '#e0552e',
    desc: 'Infantry Horde. Endless boots on the ground, cheap and relentless.',
    power: { key: 'q', name: 'Napalm Run', desc: 'Plane strafes a 6×2 line, 150 flame + lingering burn.' },
    units: ['conscript_mob','rpg_brigade','flame_trooper','technical','mortar_crew','harvester','warlord'],
  },
};

// Readable unit names for the roster summary (fallback if def name not supplied).
const UNIT_NAMES = {
  rifle_squad:'Rifle Squad', missile_team:'Missile Team', scorpion_tank:'Scorpion Tank',
  gatling_track:'Gatling Track', siege_howitzer:'Siege Howitzer', harvester:'Harvester',
  goliath:'Goliath Supertank',
  recon_squad:'Recon Squad', stinger_squad:'Stinger Squad', venom_drone:'Venom Drone',
  razor_jet:'Razor Jet', phantom_tank:'Phantom Tank', spectre:'Spectre Gunship',
  conscript_mob:'Conscript Mob', rpg_brigade:'RPG Brigade', flame_trooper:'Flame Trooper',
  technical:'Technical', mortar_crew:'Mortar Crew', warlord:'Warlord Mech',
};
function prettyKey(k) {
  return UNIT_NAMES[k] || String(k).split('_').map(w => w[0]?.toUpperCase() + w.slice(1)).join(' ');
}

// ════════════════════════════════════════════════════════════════════════════
export function Menu(rootEl, opts = {}) {
  const onStart = opts.onStart || (() => {});
  let generals = opts.generals || FALLBACK_GENERALS;

  // ── Root scaffold ──────────────────────────────────────────────────────
  const el = document.createElement('div');
  el.className = 'ic-menu ic-scanlines ic-noise';
  el.innerHTML = `
    <canvas class="ic-menu-bg"></canvas>
    <div class="ic-menu-vignette"></div>
    <div class="ic-menu-inner"></div>
    <div class="ic-version">${VERSION}</div>
    <div class="ic-credit-line">IRON COMMAND // TACTICAL WARFARE SYSTEM</div>
  `;
  rootEl.appendChild(el);

  const inner = el.querySelector('.ic-menu-inner');
  const bgCanvas = el.querySelector('.ic-menu-bg');

  // selection state across steps
  let chosenGeneralKey = null;

  // ── Animated backdrop ──────────────────────────────────────────────────
  const ctx = bgCanvas.getContext('2d');
  let embers = [];
  let raf = 0;
  let running = false;
  let radarAngle = 0;
  let lastT = 0;

  function resizeBg() {
    const w = el.clientWidth || window.innerWidth;
    const h = el.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    bgCanvas.width = w * dpr;
    bgCanvas.height = h * dpr;
    bgCanvas.style.width = w + 'px';
    bgCanvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function seedEmbers() {
    const w = el.clientWidth || window.innerWidth;
    const h = el.clientHeight || window.innerHeight;
    embers = [];
    const n = 70;
    for (let i = 0; i < n; i++) {
      embers.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.5 + Math.random() * 1.8,
        vy: -(6 + Math.random() * 18),
        vx: (Math.random() - 0.5) * 8,
        a: 0.1 + Math.random() * 0.5,
        tw: Math.random() * Math.PI * 2,
      });
    }
  }

  function drawBg(t) {
    if (!running) return;
    const dt = lastT ? Math.min((t - lastT) / 1000, 0.05) : 0.016;
    lastT = t;
    const w = el.clientWidth || window.innerWidth;
    const h = el.clientHeight || window.innerHeight;

    ctx.clearRect(0, 0, w, h);

    // base atmospheric gradient
    const g = ctx.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.42, Math.max(w, h) * 0.7);
    g.addColorStop(0, 'rgba(28,34,40,0.55)');
    g.addColorStop(0.5, 'rgba(12,16,20,0.35)');
    g.addColorStop(1, 'rgba(3,5,7,0.7)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // sweeping radar arc (lower portion)
    const cx = w * 0.5, cy = h * 1.18, R = h * 0.95;
    radarAngle += dt * 0.35;
    ctx.save();
    ctx.translate(cx, cy);
    // faint range rings
    ctx.strokeStyle = 'rgba(40,211,232,0.05)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, R * (i / 4), Math.PI, Math.PI * 2);
      ctx.stroke();
    }
    // sweep beam
    const beam = ctx.createConicGradient
      ? ctx.createConicGradient(-Math.PI / 2 + radarAngle, 0, 0)
      : null;
    const baseAng = -Math.PI / 2 + Math.sin(radarAngle) * 0.9; // sweep back & forth
    ctx.rotate(baseAng);
    const grad = ctx.createLinearGradient(0, 0, 0, -R);
    grad.addColorStop(0, 'rgba(40,211,232,0.22)');
    grad.addColorStop(1, 'rgba(40,211,232,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, R, -Math.PI / 2 - 0.18, -Math.PI / 2 + 0.02);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // drifting embers / dust
    for (const p of embers) {
      p.y += p.vy * dt;
      p.x += p.vx * dt;
      p.tw += dt * 3;
      if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
      if (p.x < -10) p.x = w + 10;
      if (p.x > w + 10) p.x = -10;
      const flick = 0.6 + 0.4 * Math.sin(p.tw);
      ctx.beginPath();
      ctx.fillStyle = `rgba(244,165,34,${(p.a * flick).toFixed(3)})`;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }

    raf = requestAnimationFrame(drawBg);
  }

  function startBg() {
    if (running) return;
    running = true;
    lastT = 0;
    resizeBg();
    seedEmbers();
    raf = requestAnimationFrame(drawBg);
  }
  function stopBg() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  const onResize = () => { if (running) { resizeBg(); seedEmbers(); } };
  window.addEventListener('resize', onResize);

  // ── Step rendering ─────────────────────────────────────────────────────
  function clearInner() { inner.innerHTML = ''; }

  function renderStart() {
    chosenGeneralKey = null;
    clearInner();
    const step = document.createElement('div');
    step.className = 'ic-step';
    step.innerHTML = `
      <div class="ic-title-wrap">
        <h1 class="ic-title"><span class="ic-title-iron">IRON</span> <span class="ic-title-command">COMMAND</span></h1>
        <div class="ic-subtitle">Tactical Warfare</div>
        <div class="ic-title-rule"></div>
      </div>
      <div class="ic-menu-buttons">
        <button class="ic-btn ic-btn-primary" data-act="new">New Game</button>
      </div>
    `;
    inner.appendChild(step);
    step.querySelector('[data-act="new"]').addEventListener('click', renderGeneralSelect);
  }

  function renderGeneralSelect() {
    clearInner();
    const step = document.createElement('div');
    step.className = 'ic-step';

    const keys = Object.keys(generals);
    const cards = keys.map((key) => {
      const g = generals[key] || {};
      const accent = g.color || 'var(--ic-amber)';
      const name = (g.name || key).toUpperCase();
      const callsign = (g.title || '').toUpperCase();
      const doctrine = g.desc || '';
      const power = g.power || {};
      const units = Array.isArray(g.units) ? g.units : [];
      // hero is conventionally the last unit key
      const heroKey = units[units.length - 1];
      const roster = units.map((uk, i) => {
        const isHero = i === units.length - 1;
        return `<li class="${isHero ? 'ic-roster-hero' : ''}">${prettyKey(uk)}</li>`;
      }).join('');
      return `
        <div class="ic-gen-card" data-key="${key}" style="--accent:${accent}">
          ${emblemFor(key)}
          <h3 class="ic-gen-name">${name}</h3>
          <div class="ic-gen-callsign">"${callsign}"</div>
          <p class="ic-gen-doctrine">${doctrine}</p>
          <div class="ic-gen-sep"></div>
          <div class="ic-gen-power">
            <span class="ic-gen-power-badge">${(power.key || 'Q').toUpperCase()}</span>
            <div class="ic-gen-power-text">
              <div class="ic-gen-power-name">${power.name || 'Special Power'}</div>
              <div class="ic-gen-power-desc">${power.desc || ''}</div>
            </div>
          </div>
          <div class="ic-gen-roster-label">Field Roster</div>
          <ul class="ic-gen-roster">${roster}</ul>
        </div>`;
    }).join('');

    step.innerHTML = `
      <div class="ic-step-head">
        <div class="ic-step-eyebrow">Select Commander</div>
        <h2 class="ic-step-title">Choose Your General</h2>
      </div>
      <div class="ic-gen-grid">${cards}</div>
      <div class="ic-menu-nav">
        <button class="ic-btn ic-btn-ghost" data-act="back">‹ Back</button>
      </div>
    `;
    inner.appendChild(step);

    step.querySelectorAll('.ic-gen-card').forEach((c) => {
      c.addEventListener('click', () => {
        chosenGeneralKey = c.getAttribute('data-key');
        renderDifficulty();
      });
    });
    step.querySelector('[data-act="back"]').addEventListener('click', renderStart);
  }

  function renderDifficulty() {
    clearInner();
    const step = document.createElement('div');
    step.className = 'ic-step';

    const g = generals[chosenGeneralKey] || {};
    const accent = g.color || 'var(--ic-amber)';
    const genLabel = `${(g.name || chosenGeneralKey || '').toUpperCase()} "${(g.title || '').toUpperCase()}"`;

    const cards = DIFFICULTIES.map((d) => `
      <div class="ic-diff-card" data-diff="${d.key}" style="--heat:${d.heat}">
        ${DIFF_ICONS[d.key] || ''}
        <h3 class="ic-diff-name">${d.name}</h3>
        <p class="ic-diff-flavor">${d.flavor}</p>
      </div>`).join('');

    step.innerHTML = `
      <div class="ic-step-head">
        <div class="ic-step-eyebrow" style="color:${accent}">Commander · ${genLabel}</div>
        <h2 class="ic-step-title">Select Difficulty</h2>
      </div>
      <div class="ic-diff-grid">${cards}</div>
      <div class="ic-menu-nav">
        <button class="ic-btn ic-btn-ghost" data-act="back">‹ Back</button>
      </div>
    `;
    inner.appendChild(step);

    step.querySelectorAll('.ic-diff-card').forEach((c) => {
      c.addEventListener('click', () => {
        const difficulty = c.getAttribute('data-diff');
        onStart({ general: chosenGeneralKey, difficulty });
      });
    });
    step.querySelector('[data-act="back"]').addEventListener('click', renderGeneralSelect);
  }

  // ── Public API ─────────────────────────────────────────────────────────
  function show() {
    el.classList.remove('ic-hidden');
    startBg();
    renderStart();
  }
  function hide() {
    el.classList.add('ic-hidden');
    stopBg();
  }
  function setGenerals(g) {
    if (g && typeof g === 'object') generals = g;
  }
  function destroy() {
    stopBg();
    window.removeEventListener('resize', onResize);
    el.remove();
  }

  // start visible
  show();

  return { show, hide, setGenerals, destroy, el };
}

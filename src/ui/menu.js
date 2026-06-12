// ════════════════════════════════════════════════════════════════════════════
// FREEDOM FIGHT — Main menu
// export function Menu(rootEl, { onStart(factionKey, difficulty), factions })
//   → { show(), hide(), destroy(), el }
// Plain DOM/CSS. No framework, no imports, no external assets (inline SVG only).
// Keyboard navigable (arrows + enter) and mouse.
// ════════════════════════════════════════════════════════════════════════════

const SVGNS = 'http://www.w3.org/2000/svg';
function svg(viewBox, inner, cls) {
  return `<svg viewBox="${viewBox}" class="${cls || ''}" xmlns="${SVGNS}" fill="none">${inner}</svg>`;
}

// ── Faction emblems (stylized, faction-distinct) ─────────────────────────────
// accent supplied via the card's --accent custom property.
const EMBLEMS = {
  // Coalition: winged chevron (USA-like air power)
  coalition: svg('0 0 100 100', `
    <circle cx="50" cy="50" r="46" stroke="var(--accent)" stroke-width="2" opacity="0.7"/>
    <circle cx="50" cy="50" r="40" stroke="var(--accent)" stroke-width="1" opacity="0.3"/>
    <path d="M50 22 L70 60 L50 50 L30 60 Z" fill="var(--accent)"/>
    <path d="M50 26 L16 54 L31 54 L50 40 Z" fill="var(--accent)" opacity="0.5"/>
    <path d="M50 26 L84 54 L69 54 L50 40 Z" fill="var(--accent)" opacity="0.5"/>
    <path d="M38 66 L50 78 L62 66" stroke="var(--accent)" stroke-width="3" stroke-linecap="round"/>
  `, 'ic-fac-emblem'),

  // Dominion: star-gear (China-like horde/industry)
  dominion: svg('0 0 100 100', `
    <circle cx="50" cy="50" r="46" stroke="var(--accent)" stroke-width="2" opacity="0.7"/>
    <g stroke="var(--accent)" stroke-width="2" opacity="0.55">
      ${Array.from({length:12}).map((_,i)=>{const a=i*Math.PI/6;const x1=50+34*Math.cos(a),y1=50+34*Math.sin(a),x2=50+42*Math.cos(a),y2=50+42*Math.sin(a);return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;}).join('')}
    </g>
    <circle cx="50" cy="50" r="32" stroke="var(--accent)" stroke-width="2" opacity="0.4"/>
    <path d="M50 26 L57 44 L76 44 L61 55 L67 73 L50 62 L33 73 L39 55 L24 44 L43 44 Z" fill="var(--accent)"/>
  `, 'ic-fac-emblem'),

  // Syndicate: serpent / scrap (GLA-like guerrilla)
  syndicate: svg('0 0 100 100', `
    <circle cx="50" cy="50" r="46" stroke="var(--accent)" stroke-width="2" opacity="0.7" stroke-dasharray="6 4"/>
    <path d="M28 70 q-2 -22 18 -24 q18 -2 18 -16 q0 -10 -10 -12" stroke="var(--accent)" stroke-width="5" stroke-linecap="round" fill="none"/>
    <path d="M30 70 l-6 4 l8 2 z" fill="var(--accent)"/>
    <circle cx="60" cy="20" r="4" fill="var(--accent)"/>
    <path d="M40 40 l6 6 m-6 0 l6 -6" stroke="var(--accent)" stroke-width="3" stroke-linecap="round"/>
    <path d="M66 58 l5 5 m-5 0 l5 -5" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" opacity="0.7"/>
  `, 'ic-fac-emblem'),
};
function emblemFor(key) {
  return EMBLEMS[key] || svg('0 0 100 100',
    `<circle cx="50" cy="50" r="44" stroke="var(--accent)" stroke-width="2"/><path d="M50 28 L68 62 H32 Z" fill="var(--accent)"/>`,
    'ic-fac-emblem');
}

const DIFF_ICONS = {
  easy:   svg('0 0 24 24', `<path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`, 'ic-diff-icon'),
  hard:   svg('0 0 24 24', `<path d="M12 3l2.5 6.5L21 11l-5 4 1.5 6.5L12 18l-5.5 3.5L8 15 3 11l6.5-1.5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>`, 'ic-diff-icon'),
  brutal: svg('0 0 24 24', `<path d="M8 2h8l-1 5h2l-2 4h2l-3 11-2-6-2 6-3-11h2L7 7h2z" fill="currentColor"/>`, 'ic-diff-icon'),
};

const DIFFICULTIES = [
  { key: 'easy',   name: 'Easy',   flavor: 'Training exercise. The enemy holds back.',   heat: 'var(--ic-green)' },
  { key: 'hard',   name: 'Hard',   flavor: 'A fair fight. Combined-arms, hero, counters.', heat: 'var(--ic-amber)' },
  { key: 'brutal', name: 'Brutal', flavor: 'No mercy. Relentless multi-prong assault, maphack.',  heat: 'var(--ic-red)'   },
];

const VERSION = 'v0.2.0';

// ── Built-in faction fallback data (per DESIGN §1 / §13.5). Used if sim
//    hasn't supplied FACTIONS, or to fill in missing fields. ─────────────────
const FALLBACK_FACTIONS = {
  coalition: {
    name: 'Coalition', general: 'Kira "Phantom" Voss', color: '#2e7bff',
    blurb: 'Expensive high-tech doctrine. Air superiority, laser defenses, and stealth aircraft strike from beyond the horizon.',
    highlights: [
      { key: 'falcon',  name: 'Falcon Strike Fighter' },
      { key: 'paladin', name: 'Paladin MBT' },
      { key: 'ghost',   name: 'Ghost', hero: true },
    ],
    superweapon: 'Orbital Lance',
  },
  dominion: {
    name: 'Dominion', general: 'Vance "Steel" Karov', color: '#e03c2e',
    blurb: 'Tank and infantry hordes. Cheap masses gain firepower in numbers; napalm and nuclear fire level the field.',
    highlights: [
      { key: 'emperor',   name: 'Emperor Overlord' },
      { key: 'conscript', name: 'Conscript Horde' },
      { key: 'mantis',    name: 'Mantis', hero: true },
    ],
    superweapon: 'Nuclear Missile',
  },
  syndicate: {
    name: 'Syndicate', general: 'Ali "Viper" Abazz', color: '#3da64b',
    blurb: 'Cheap swarms, stealth, and salvage. No power grid to defend — scavenge scrap and bury the enemy in numbers.',
    highlights: [
      { key: 'scorpion', name: 'Scorpion Tank' },
      { key: 'fanatic',  name: 'Fanatic (suicide)' },
      { key: 'cobra',    name: 'Cobra', hero: true },
    ],
    superweapon: 'Viper Storm',
  },
};

const FACTION_ORDER = ['coalition', 'dominion', 'syndicate'];

// Pretty-print a raw key as a fallback label.
function prettyKey(k) {
  return String(k).split(/[_\s]/).map(w => (w[0] ? w[0].toUpperCase() + w.slice(1) : '')).join(' ');
}

// Derive 3 signature highlights from a faction def's units map if highlights absent.
function deriveHighlights(def) {
  if (Array.isArray(def.highlights) && def.highlights.length) return def.highlights;
  const units = def.units && typeof def.units === 'object' ? def.units : null;
  if (!units) return [];
  const keys = Object.keys(units);
  // hero = unit flagged hero, else most expensive
  let heroKey = keys.find(k => units[k] && units[k].hero);
  const sorted = keys.slice().sort((a, b) => (units[b]?.cost || 0) - (units[a]?.cost || 0));
  if (!heroKey) heroKey = sorted[0];
  const others = sorted.filter(k => k !== heroKey).slice(0, 2);
  const pick = [...others, heroKey].filter(Boolean);
  return pick.map(k => ({
    key: k,
    name: (units[k] && units[k].name) || prettyKey(k),
    hero: k === heroKey,
  }));
}

// ════════════════════════════════════════════════════════════════════════════
export function Menu(rootEl, opts = {}) {
  const onStart = opts.onStart || (() => {});
  // Merge supplied factions over fallback (so missing fields fill in).
  const supplied = opts.factions && typeof opts.factions === 'object' ? opts.factions : {};
  const factions = {};
  for (const key of FACTION_ORDER) {
    const fb = FALLBACK_FACTIONS[key] || {};
    const sp = supplied[key] || {};
    factions[key] = {
      name: sp.name || fb.name || prettyKey(key),
      general: sp.general || fb.general || '',
      color: sp.color || fb.color || 'var(--ic-amber)',
      blurb: sp.blurb || sp.desc || fb.blurb || '',
      superweapon: sp.superweapon || fb.superweapon || '',
      highlights: (sp.highlights && sp.highlights.length) ? sp.highlights
                : deriveHighlights(sp).length ? deriveHighlights(sp)
                : fb.highlights || [],
    };
  }
  // Include any extra factions the sim supplied beyond the canonical 3.
  for (const key of Object.keys(supplied)) {
    if (!factions[key]) {
      const sp = supplied[key];
      factions[key] = {
        name: sp.name || prettyKey(key),
        general: sp.general || '',
        color: sp.color || 'var(--ic-amber)',
        blurb: sp.blurb || sp.desc || '',
        superweapon: sp.superweapon || '',
        highlights: deriveHighlights(sp),
      };
    }
  }
  const factionKeys = Object.keys(factions);

  // ── Root scaffold ──────────────────────────────────────────────────────
  const el = document.createElement('div');
  el.className = 'ic-menu ic-scanlines ic-noise';
  el.innerHTML = `
    <canvas class="ic-menu-bg"></canvas>
    <div class="ic-menu-vignette"></div>
    <div class="ic-menu-inner"></div>
    <div class="ic-version">${VERSION}</div>
    <div class="ic-credit-line">FREEDOM FIGHT // TACTICAL WARFARE SYSTEM</div>
  `;
  rootEl.appendChild(el);

  const inner = el.querySelector('.ic-menu-inner');
  const bgCanvas = el.querySelector('.ic-menu-bg');

  // Selection state across steps
  let chosenFactionKey = null;
  let focusIndex = 0;        // keyboard focus within current step's selectable set
  let step = 'start';        // 'start' | 'faction' | 'difficulty'

  // ── Animated backdrop (radar sweep + drifting embers) ──────────────────
  const ctx = bgCanvas.getContext('2d');
  let embers = [];
  let raf = 0, running = false, radarAngle = 0, lastT = 0;

  function resizeBg() {
    const w = el.clientWidth || window.innerWidth;
    const h = el.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    bgCanvas.width = w * dpr; bgCanvas.height = h * dpr;
    bgCanvas.style.width = w + 'px'; bgCanvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function seedEmbers() {
    const w = el.clientWidth || window.innerWidth;
    const h = el.clientHeight || window.innerHeight;
    embers = [];
    for (let i = 0; i < 70; i++) {
      embers.push({
        x: Math.random() * w, y: Math.random() * h,
        r: 0.5 + Math.random() * 1.8, vy: -(6 + Math.random() * 18),
        vx: (Math.random() - 0.5) * 8, a: 0.1 + Math.random() * 0.5,
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
    const g = ctx.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.42, Math.max(w, h) * 0.7);
    g.addColorStop(0, 'rgba(28,34,40,0.55)');
    g.addColorStop(0.5, 'rgba(12,16,20,0.35)');
    g.addColorStop(1, 'rgba(3,5,7,0.7)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

    const cx = w * 0.5, cy = h * 1.18, R = h * 0.95;
    radarAngle += dt * 0.35;
    ctx.save(); ctx.translate(cx, cy);
    ctx.strokeStyle = 'rgba(244,165,34,0.05)'; ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) { ctx.beginPath(); ctx.arc(0, 0, R * (i / 4), Math.PI, Math.PI * 2); ctx.stroke(); }
    const baseAng = -Math.PI / 2 + Math.sin(radarAngle) * 0.9;
    ctx.rotate(baseAng);
    const grad = ctx.createLinearGradient(0, 0, 0, -R);
    grad.addColorStop(0, 'rgba(244,165,34,0.16)');
    grad.addColorStop(1, 'rgba(244,165,34,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.arc(0, 0, R, -Math.PI / 2 - 0.18, -Math.PI / 2 + 0.02);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    for (const p of embers) {
      p.y += p.vy * dt; p.x += p.vx * dt; p.tw += dt * 3;
      if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
      if (p.x < -10) p.x = w + 10; if (p.x > w + 10) p.x = -10;
      const flick = 0.6 + 0.4 * Math.sin(p.tw);
      ctx.beginPath();
      ctx.fillStyle = `rgba(244,165,34,${(p.a * flick).toFixed(3)})`;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    raf = requestAnimationFrame(drawBg);
  }
  function startBg() { if (running) return; running = true; lastT = 0; resizeBg(); seedEmbers(); raf = requestAnimationFrame(drawBg); }
  function stopBg() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
  const onResize = () => { if (running) { resizeBg(); seedEmbers(); } };
  window.addEventListener('resize', onResize);

  // ── Step rendering ─────────────────────────────────────────────────────
  function clearInner() { inner.innerHTML = ''; }
  function selectables() { return Array.from(inner.querySelectorAll('[data-focusable]')); }
  function applyFocus() {
    const items = selectables();
    items.forEach((it, i) => it.classList.toggle('ic-focused', i === focusIndex));
    const cur = items[focusIndex];
    if (cur && typeof cur.scrollIntoView === 'function') cur.scrollIntoView({ block: 'nearest' });
  }

  function renderStart() {
    step = 'start'; chosenFactionKey = null; focusIndex = 0;
    clearInner();
    const s = document.createElement('div');
    s.className = 'ic-step';
    s.innerHTML = `
      <div class="ic-title-wrap">
        <h1 class="ic-title"><span class="ic-title-iron">FREEDOM</span> <span class="ic-title-command">FIGHT</span></h1>
        <div class="ic-subtitle">Zero Hour</div>
        <div class="ic-title-rule"></div>
      </div>
      <div class="ic-menu-buttons">
        <button class="ic-btn ic-btn-primary" data-focusable data-act="new">New Game</button>
      </div>
    `;
    inner.appendChild(s);
    s.querySelector('[data-act="new"]').addEventListener('click', renderFactionSelect);
    applyFocus();
  }

  function renderFactionSelect() {
    step = 'faction'; focusIndex = 0;
    clearInner();
    const s = document.createElement('div');
    s.className = 'ic-step';
    const cards = factionKeys.map((key) => {
      const f = factions[key];
      const accent = f.color || 'var(--ic-amber)';
      const general = f.general || '';
      // split general into name + callsign if "Name "Call" Surname" form
      const callMatch = general.match(/"([^"]+)"/);
      const callsign = callMatch ? callMatch[1] : '';
      const generalName = general.replace(/"[^"]*"/, '').replace(/\s+/g, ' ').trim();
      const hl = (f.highlights || []).slice(0, 3);
      const roster = hl.map((h) => {
        const isHero = !!h.hero;
        const nm = h.name || prettyKey(h.key || '');
        return `<li class="${isHero ? 'ic-roster-hero' : ''}">${nm}</li>`;
      }).join('');
      return `
        <div class="ic-fac-card" data-focusable data-key="${key}" style="--accent:${accent}">
          <div class="ic-fac-name">${(f.name || key).toUpperCase()}</div>
          ${emblemFor(key)}
          <div class="ic-fac-general">${generalName || ''}${callsign ? `<span class="ic-fac-callsign">"${callsign}"</span>` : ''}</div>
          <p class="ic-fac-blurb">${f.blurb || ''}</p>
          <div class="ic-fac-sep"></div>
          <div class="ic-fac-roster-label">Signature Forces</div>
          <ul class="ic-fac-roster">${roster}</ul>
          ${f.superweapon ? `<div class="ic-fac-super"><span class="ic-fac-super-label">Superweapon</span><span class="ic-fac-super-name">${f.superweapon}</span></div>` : ''}
        </div>`;
    }).join('');

    s.innerHTML = `
      <div class="ic-step-head">
        <div class="ic-step-eyebrow">Select Faction</div>
        <h2 class="ic-step-title">Choose Your Army</h2>
      </div>
      <div class="ic-fac-grid">${cards}</div>
      <div class="ic-menu-nav">
        <button class="ic-btn ic-btn-ghost" data-act="back">‹ Back</button>
      </div>
    `;
    inner.appendChild(s);
    s.querySelectorAll('.ic-fac-card').forEach((c) => {
      c.addEventListener('click', () => { chosenFactionKey = c.getAttribute('data-key'); renderDifficulty(); });
      c.addEventListener('mouseenter', () => { focusIndex = selectables().indexOf(c); applyFocus(); });
    });
    s.querySelector('[data-act="back"]').addEventListener('click', renderStart);
    applyFocus();
  }

  function renderDifficulty() {
    step = 'difficulty'; focusIndex = 1; // default to HARD
    clearInner();
    const s = document.createElement('div');
    s.className = 'ic-step';
    const f = factions[chosenFactionKey] || {};
    const accent = f.color || 'var(--ic-amber)';
    const label = (f.name || chosenFactionKey || '').toUpperCase();
    const cards = DIFFICULTIES.map((d) => `
      <div class="ic-diff-card" data-focusable data-diff="${d.key}" style="--heat:${d.heat}">
        ${DIFF_ICONS[d.key] || ''}
        <h3 class="ic-diff-name">${d.name}</h3>
        <p class="ic-diff-flavor">${d.flavor}</p>
      </div>`).join('');
    s.innerHTML = `
      <div class="ic-step-head">
        <div class="ic-step-eyebrow" style="color:${accent}">Faction · ${label}</div>
        <h2 class="ic-step-title">Select Difficulty</h2>
      </div>
      <div class="ic-diff-grid">${cards}</div>
      <div class="ic-menu-nav">
        <button class="ic-btn ic-btn-ghost" data-act="back">‹ Back</button>
      </div>
    `;
    inner.appendChild(s);
    s.querySelectorAll('.ic-diff-card').forEach((c) => {
      c.addEventListener('click', () => onStart(chosenFactionKey, c.getAttribute('data-diff')));
      c.addEventListener('mouseenter', () => { focusIndex = selectables().indexOf(c); applyFocus(); });
    });
    s.querySelector('[data-act="back"]').addEventListener('click', renderFactionSelect);
    applyFocus();
  }

  // ── Keyboard navigation ────────────────────────────────────────────────
  function onKey(e) {
    if (el.classList.contains('ic-hidden')) return;
    const items = selectables();
    if (!items.length) return;
    const k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowDown') {
      e.preventDefault(); focusIndex = (focusIndex + 1) % items.length; applyFocus();
    } else if (k === 'ArrowLeft' || k === 'ArrowUp') {
      e.preventDefault(); focusIndex = (focusIndex - 1 + items.length) % items.length; applyFocus();
    } else if (k === 'Enter' || k === ' ') {
      e.preventDefault(); const cur = items[focusIndex]; if (cur) cur.click();
    } else if (k === 'Escape' || k === 'Backspace') {
      if (step === 'faction') { e.preventDefault(); renderStart(); }
      else if (step === 'difficulty') { e.preventDefault(); renderFactionSelect(); }
    }
  }
  window.addEventListener('keydown', onKey);

  // ── Public API ─────────────────────────────────────────────────────────
  function show() { el.classList.remove('ic-hidden'); startBg(); renderStart(); }
  function hide() { el.classList.add('ic-hidden'); stopBg(); }
  function destroy() {
    stopBg();
    window.removeEventListener('resize', onResize);
    window.removeEventListener('keydown', onKey);
    el.remove();
  }

  show();
  return { show, hide, destroy, el };
}

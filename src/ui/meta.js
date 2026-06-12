// ════════════════════════════════════════════════════════════════════════════
// IRON COMMAND — UI fallback metadata + inline SVG icon glyphs.
// Keyed by the canonical entity keys (DESIGN §13.5). Used when ctx.factionData
// does not carry a name/cost/buildTime/etc. for a given key, so the HUD always
// renders sensibly. Icons are simple readable silhouettes (currentColor fill).
// ════════════════════════════════════════════════════════════════════════════

const C = 'currentColor';
export const SVGNS = 'http://www.w3.org/2000/svg';
export function svg(viewBox, inner, cls) {
  return `<svg viewBox="${viewBox}" class="${cls || ''}" xmlns="${SVGNS}" fill="none">${inner}</svg>`;
}

// ── Fallback unit/structure metadata (name, cost, buildTime in s) ────────────
// Mirrors DESIGN §5 / §6 tables. Heroes flagged. power for structures.
export const UNIT_META = {
  // coalition units
  trooper:  { n: 'Trooper',          c: 225,  t: 5,  pop: 1 },
  javelin:  { n: 'Javelin Team',     c: 300,  t: 5,  pop: 1 },
  marksman: { n: 'Marksman',         c: 600,  t: 10, pop: 1 },
  ghost:    { n: 'Ghost',            c: 1500, t: 20, pop: 3, hero: true },
  dozer:    { n: 'Dozer',            c: 1000, t: 8,  pop: 1 },
  pelican:  { n: 'Pelican',          c: 1200, t: 10, pop: 1 },
  outrider: { n: 'Outrider',         c: 700,  t: 8,  pop: 2 },
  paladin:  { n: 'Paladin MBT',      c: 900,  t: 10, pop: 3 },
  tempest:  { n: 'Tempest Launcher', c: 1200, t: 14, pop: 3 },
  specter:  { n: 'Specter Gunship',  c: 1500, t: 18, pop: 3 },
  falcon:   { n: 'Falcon',           c: 1400, t: 18, pop: 3 },
  meteor:   { n: 'Meteor Bomber',    c: 2500, t: 25, pop: 4 },
  // dominion units
  conscript:  { n: 'Conscript',      c: 300,  t: 8,  pop: 1 },
  hunter:     { n: 'Hunter Team',    c: 300,  t: 5,  pop: 1 },
  hacker:     { n: 'Hacker',         c: 625,  t: 12, pop: 1 },
  mantis:     { n: 'Mantis',         c: 1500, t: 20, pop: 3, hero: true },
  supplyTruck:{ n: 'Supply Truck',   c: 600,  t: 8,  pop: 1 },
  warmaster:  { n: 'Warmaster',      c: 800,  t: 10, pop: 3 },
  shredder:   { n: 'Shredder AA',    c: 800,  t: 10, pop: 2 },
  dragon:     { n: 'Dragon Tank',    c: 800,  t: 10, pop: 3 },
  hellstorm:  { n: 'Hellstorm Cannon', c: 900, t: 14, pop: 3 },
  emperor:    { n: 'Emperor',        c: 2000, t: 20, pop: 6 },
  vulture:    { n: 'Vulture',        c: 1200, t: 12, pop: 3 },
  // syndicate units
  worker:     { n: 'Worker',         c: 200,  t: 5,  pop: 1 },
  militant:   { n: 'Militant',       c: 150,  t: 4,  pop: 1 },
  stinger:    { n: 'Stinger Trooper',c: 300,  t: 5,  pop: 1 },
  fanatic:    { n: 'Fanatic',        c: 200,  t: 4,  pop: 1 },
  cobra:      { n: 'Cobra',          c: 1500, t: 20, pop: 3, hero: true },
  technical:  { n: 'Technical',      c: 500,  t: 6,  pop: 2 },
  scorpion:   { n: 'Scorpion',       c: 600,  t: 7,  pop: 3 },
  quad:       { n: 'Quad Cannon',    c: 700,  t: 8,  pop: 2 },
  toxinTractor:{ n: 'Toxin Tractor', c: 600,  t: 8,  pop: 2 },
  buggy:      { n: 'Rocket Buggy',   c: 900,  t: 10, pop: 2 },
  scud:       { n: 'Scud Launcher',  c: 1200, t: 16, pop: 4 },
};

export const STRUCT_META = {
  commandCenter:  { n: 'Command Center', c: 2000, t: 30, power: 0 },
  fusionReactor:  { n: 'Fusion Reactor', c: 800,  t: 10, power: 5 },
  fissionReactor: { n: 'Fission Reactor',c: 1000, t: 10, power: 10 },
  barracks:       { n: 'Barracks',       c: 600,  t: 10, power: 0 },
  supplyCenter:   { n: 'Supply Center',  c: 2000, t: 15, power: -1 },
  supplyStash:    { n: 'Supply Stash',   c: 1500, t: 15, power: 0 },
  warFactory:     { n: 'War Factory',    c: 2000, t: 20, power: -1, req: 'supplyCenter' },
  armsBazaar:     { n: 'Arms Bazaar',    c: 2500, t: 20, power: 0,  req: 'supplyStash' },
  airfield:       { n: 'Airfield',       c: 1000, t: 15, power: -1, req: 'supplyCenter' },
  aegis:          { n: 'Aegis Battery',  c: 1000, t: 12, power: -3, req: 'reactor' },
  gatling:        { n: 'Gatling Cannon', c: 1200, t: 12, power: -3, req: 'reactor' },
  stingerNest:    { n: 'Stinger Nest',   c: 900,  t: 10, power: 0,  req: 'barracks' },
  bunker:         { n: 'Bunker',         c: 500,  t: 8,  power: 0,  req: 'barracks' },
  tunnel:         { n: 'Tunnel Network', c: 800,  t: 10, power: 0,  req: 'barracks' },
  demoTrap:       { n: 'Demo Trap',      c: 400,  t: 4,  power: 0 },
  uplink:         { n: 'Command Uplink', c: 2500, t: 20, power: -2, req: 'warFactory' },
  warCouncil:     { n: 'War Council',    c: 2000, t: 20, power: -2, req: 'warFactory' },
  citadel:        { n: 'Citadel',        c: 2500, t: 20, power: 0,  req: 'armsBazaar' },
  dropZone:       { n: 'Drop Zone',      c: 2500, t: 15, power: -4, req: 'uplink' },
  blackMarket:    { n: 'Black Market',   c: 2500, t: 15, power: 0,  req: 'citadel' },
  orbitalLance:   { n: 'Orbital Lance',  c: 5000, t: 45, power: -10, req: 'uplink', super: true },
  nuclearMissile: { n: 'Nuclear Missile',c: 5000, t: 45, power: -10, req: 'warCouncil', super: true },
  viperStorm:     { n: 'Viper Storm',    c: 5000, t: 45, power: 0,   req: 'citadel', super: true },
  // neutral / world
  civBuilding:    { n: 'Civilian Building', c: 0, t: 0 },
  oilDerrick:     { n: 'Oil Derrick',    c: 0, t: 0 },
  supplyDock:     { n: 'Supply Dock',    c: 0, t: 0 },
  supplyPile:     { n: 'Supply Pile',    c: 0, t: 0 },
};

export function unitMeta(key) { return UNIT_META[key] || { n: pretty(key), c: 0, t: 0, pop: 1 }; }
export function structMeta(key) { return STRUCT_META[key] || { n: pretty(key), c: 0, t: 0, power: 0 }; }
export function pretty(k) {
  return String(k || '').replace(/([A-Z])/g, ' $1').replace(/[_]/g, ' ')
    .split(/\s+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

// ── Power (general's) metadata fallback (DESIGN §8) ─────────────────────────
export const POWER_META = {
  spyDrone:   { n: 'Spy Drone',     cost: 1, cd: 90,  rank: 1 },
  paradrop:   { n: 'Paradrop',      cost: 1, cd: 240, rank: 1, levels: 3 },
  strikeWing: { n: 'Strike Wing',   cost: 1, cd: 240, rank: 1, levels: 3 },
  fuelAir:    { n: 'Fuel-Air Bomb', cost: 3, cd: 360, rank: 5 },
  artillery:  { n: 'Artillery Barrage', cost: 1, cd: 300, rank: 1, levels: 3 },
  cashHackP:  { n: 'Cash Hack',     cost: 1, cd: 240, rank: 1, levels: 3 },
  clusterMines:{ n: 'Cluster Mines',cost: 1, cd: 240, rank: 1 },
  empBomb:    { n: 'EMP Bomb',      cost: 3, cd: 360, rank: 5 },
  ambush:     { n: 'Ambush',        cost: 1, cd: 300, rank: 1, levels: 3 },
  cashBounty: { n: 'Cash Bounty',   cost: 1, cd: 0,   rank: 1, levels: 3, passive: true },
  sneakAttack:{ n: 'Sneak Attack',  cost: 1, cd: 300, rank: 1 },
  anthrax:    { n: 'Anthrax Bomb',  cost: 3, cd: 360, rank: 5 },
};
export function powerMeta(key) { return POWER_META[key] || { n: pretty(key), cost: 1, cd: 60, rank: 1 }; }

// ── Ability metadata (unit abilities; DESIGN §6 / commands §13.1) ────────────
export const ABILITY_META = {
  flashbang: { n: 'Flashbang', cd: 15 },
  c4:        { n: 'Plant C4',  cd: 20 },
  deploy:    { n: 'Deploy',    cd: 3 },
  disable:   { n: 'Disable',   cd: 20 },
  cashHack:  { n: 'Cash Hack', cd: 45 },
  crewSnipe: { n: 'Crew Snipe',cd: 20 },
};
export function abilityMeta(key) { return ABILITY_META[key] || { n: pretty(key), cd: 10 }; }

// ════════════════════════════════════════════════════════════════════════════
// ICON GLYPHS — inline SVG, simple readable silhouettes (currentColor).
// Returned as inner-SVG strings (no <svg> wrapper) so callers size them.
// ════════════════════════════════════════════════════════════════════════════
const G = {
  // ── infantry-ish ──
  trooper:  `<g fill="${C}"><circle cx="20" cy="9" r="4.2"/><rect x="16" y="14" width="8" height="15" rx="2"/><rect x="24" y="15" width="13" height="2.4" rx="1"/></g>`,
  javelin:  `<g fill="${C}"><circle cx="14" cy="10" r="4"/><rect x="10" y="15" width="8" height="13" rx="2"/><rect x="15" y="9" width="20" height="4" rx="2" transform="rotate(-22 15 9)"/><path d="M33 4 l5 1 -3 4z"/></g>`,
  marksman: `<g fill="${C}"><circle cx="13" cy="11" r="4"/><rect x="9" y="16" width="7" height="12" rx="2"/><rect x="15" y="16" width="22" height="2" rx="1"/><circle cx="34" cy="17" r="2.2"/></g>`,
  ghost:    `<g fill="${C}" opacity="0.92"><circle cx="20" cy="8" r="4"/><path d="M14 13 h12 l2 16 h-16z"/><rect x="24" y="14" width="13" height="2" rx="1"/><path d="M16 29 q4 4 8 0" opacity="0.6"/></g>`,
  conscript:`<g fill="${C}"><circle cx="11" cy="10" r="3.6"/><rect x="8" y="14" width="6" height="13" rx="2"/><circle cx="24" cy="10" r="3.6"/><rect x="21" y="14" width="6" height="13" rx="2"/><rect x="14" y="15" width="11" height="2" rx="1"/></g>`,
  hunter:   `<g fill="${C}"><circle cx="14" cy="10" r="4"/><rect x="10" y="15" width="8" height="13" rx="2"/><rect x="14" y="9" width="22" height="3.6" rx="1.8" transform="rotate(-26 14 9)"/></g>`,
  hacker:   `<g fill="${C}"><circle cx="14" cy="10" r="4"/><rect x="10" y="15" width="8" height="13" rx="2"/><rect x="22" y="18" width="14" height="10" rx="1.5"/><rect x="24" y="20" width="10" height="6" rx="1" fill="#000" opacity="0.3"/></g>`,
  mantis:   `<g fill="${C}" opacity="0.92"><circle cx="20" cy="8" r="4"/><path d="M14 13 h12 l2 16 h-16z"/><circle cx="20" cy="20" r="3" fill="#000" opacity="0.35"/></g>`,
  worker:   `<g fill="${C}"><circle cx="20" cy="9" r="4"/><rect x="16" y="14" width="8" height="15" rx="2"/><rect x="9" y="22" width="22" height="3" rx="1.5" transform="rotate(-18 9 22)"/></g>`,
  militant: `<g fill="${C}"><circle cx="18" cy="10" r="4"/><rect x="14" y="15" width="8" height="14" rx="2"/><rect x="21" y="16" width="14" height="2.4" rx="1"/></g>`,
  stinger:  `<g fill="${C}"><circle cx="14" cy="10" r="4"/><rect x="10" y="15" width="8" height="13" rx="2"/><rect x="14" y="9" width="22" height="3.6" rx="1.8" transform="rotate(-26 14 9)"/></g>`,
  fanatic:  `<g fill="${C}"><circle cx="20" cy="9" r="4"/><rect x="16" y="14" width="8" height="14" rx="2"/><circle cx="20" cy="20" r="5" fill="none" stroke="${C}" stroke-width="2" opacity="0.6"/><path d="M20 16 v8 M16 20 h8" stroke="${C}" stroke-width="1.5"/></g>`,
  cobra:    `<g fill="${C}" opacity="0.92"><circle cx="13" cy="11" r="4"/><rect x="9" y="16" width="7" height="12" rx="2"/><rect x="15" y="16" width="23" height="2" rx="1"/><circle cx="35" cy="17" r="2.2"/></g>`,
  // ── vehicles ──
  dozer:    `<g fill="${C}"><rect x="9" y="16" width="22" height="9" rx="2"/><rect x="4" y="13" width="5" height="14" rx="1.5"/><rect x="14" y="11" width="12" height="6" rx="1.5"/><circle cx="14" cy="27" r="2.6"/><circle cx="26" cy="27" r="2.6"/></g>`,
  supplyTruck:`<g fill="${C}"><path d="M6 25 h20 v-9 h6 l4 5 v4 h2 v3 h-32z"/><circle cx="12" cy="28" r="2.8"/><circle cx="28" cy="28" r="2.8"/></g>`,
  pelican:  `<g fill="${C}"><ellipse cx="20" cy="18" rx="11" ry="5"/><rect x="2" y="6" width="36" height="2" rx="1"/><rect x="19" y="8" width="2" height="6"/><path d="M31 18 l8 -2 v3z"/></g>`,
  outrider: `<g fill="${C}"><path d="M5 24 h26 l-3 -7 h-12 l-2 -3 h-9z"/><circle cx="12" cy="27" r="2.8"/><circle cx="26" cy="27" r="2.8"/><rect x="20" y="9" width="14" height="2.4" rx="1"/></g>`,
  paladin:  `<g fill="${C}"><rect x="5" y="20" width="30" height="9" rx="3"/><rect x="11" y="14" width="17" height="7" rx="2"/><rect x="26" y="15" width="14" height="3.2" rx="1.6"/></g>`,
  tempest:  `<g fill="${C}"><rect x="5" y="22" width="28" height="8" rx="3"/><rect x="11" y="15" width="12" height="8" rx="2"/><rect x="17" y="5" width="3.6" height="16" rx="1.5" transform="rotate(-30 17 5)"/><rect x="20" y="6" width="3.6" height="15" rx="1.5" transform="rotate(-24 20 6)"/></g>`,
  specter:  `<g fill="${C}" opacity="0.9"><path d="M4 17 h30 l3 2 -3 2 h-30 l-2 -2z"/><path d="M12 17 l5 -8 4 0 -2 8z"/><rect x="22" y="22" width="3" height="4" rx="1"/><rect x="28" y="22" width="3" height="4" rx="1"/></g>`,
  falcon:   `<g fill="${C}"><path d="M5 18 L30 15 L38 18 L30 21 Z"/><path d="M13 18 L21 7 L24 18z"/><path d="M13 18 L21 29 L24 18z"/></g>`,
  meteor:   `<g fill="${C}"><path d="M4 18 L28 15 L39 18 L28 21 Z"/><path d="M10 18 L18 5 L22 18z"/><path d="M10 18 L18 31 L22 18z"/><circle cx="30" cy="24" r="2.4"/></g>`,
  warmaster:`<g fill="${C}"><rect x="5" y="21" width="30" height="8" rx="3"/><path d="M11 14 h17 l-3 7 h-11z"/><rect x="25" y="15" width="14" height="3" rx="1.5"/></g>`,
  shredder: `<g fill="${C}"><rect x="5" y="20" width="30" height="9" rx="3"/><rect x="12" y="14" width="12" height="7" rx="2"/><rect x="22" y="13" width="13" height="2" rx="1"/><rect x="22" y="16" width="13" height="2" rx="1"/><rect x="22" y="19" width="13" height="2" rx="1"/></g>`,
  dragon:   `<g fill="${C}"><rect x="5" y="20" width="28" height="9" rx="3"/><rect x="11" y="14" width="16" height="7" rx="2"/><path d="M26 16 q9 1 13 -3 q-2 7 -13 6z"/></g>`,
  hellstorm:`<g fill="${C}"><rect x="5" y="22" width="28" height="8" rx="3"/><rect x="11" y="15" width="11" height="8" rx="2"/><rect x="18" y="5" width="4" height="17" rx="2" transform="rotate(-30 18 5)"/></g>`,
  emperor:  `<g fill="${C}"><rect x="3" y="21" width="34" height="10" rx="3"/><rect x="8" y="12" width="22" height="9" rx="2"/><rect x="27" y="12" width="14" height="3.4" rx="1.7"/><rect x="27" y="17" width="14" height="3.4" rx="1.7"/><rect x="14" y="6" width="6" height="7" rx="1"/></g>`,
  vulture:  `<g fill="${C}"><path d="M5 18 L30 15 L38 18 L30 21 Z"/><path d="M14 18 L21 8 L24 18z"/><path d="M14 18 L21 28 L24 18z"/><circle cx="9" cy="18" r="1.6"/></g>`,
  technical:`<g fill="${C}"><path d="M5 24 h22 l-3 -6 h-9 l-2 -4 h-5z"/><circle cx="11" cy="27" r="3"/><circle cx="24" cy="27" r="3"/><rect x="22" y="9" width="13" height="2.4" rx="1"/></g>`,
  scorpion: `<g fill="${C}"><rect x="5" y="20" width="30" height="9" rx="3"/><path d="M11 14 h16 l-2 7 h-12z"/><rect x="25" y="15" width="14" height="3" rx="1.5"/></g>`,
  quad:     `<g fill="${C}"><rect x="6" y="21" width="26" height="8" rx="2"/><circle cx="12" cy="29" r="2.4"/><circle cx="26" cy="29" r="2.4"/><rect x="22" y="12" width="14" height="1.8" rx="0.9"/><rect x="22" y="15" width="14" height="1.8" rx="0.9"/><rect x="22" y="18" width="14" height="1.8" rx="0.9"/></g>`,
  toxinTractor:`<g fill="${C}"><path d="M6 25 h20 v-8 h6 v8 h2 v3 h-30z"/><circle cx="12" cy="28" r="2.8"/><circle cx="26" cy="28" r="2.8"/><path d="M26 14 q8 1 12 -2 q-2 6 -12 5z" opacity="0.8"/></g>`,
  buggy:    `<g fill="${C}"><path d="M6 24 h22 l-3 -6 h-11z"/><circle cx="12" cy="27" r="3"/><circle cx="25" cy="27" r="3"/><rect x="14" y="10" width="3" height="9" rx="1.5" transform="rotate(-20 14 10)"/><rect x="18" y="10" width="3" height="9" rx="1.5" transform="rotate(-20 18 10)"/></g>`,
  scud:     `<g fill="${C}"><path d="M6 25 h22 v-8 h6 v8 h2 v3 h-32z"/><circle cx="12" cy="28" r="2.8"/><circle cx="26" cy="28" r="2.8"/><rect x="14" y="4" width="4" height="16" rx="2" transform="rotate(-34 14 4)"/></g>`,

  // ── structures ──
  commandCenter: `<g fill="${C}"><rect x="7" y="16" width="26" height="14" rx="1"/><rect x="13" y="9" width="14" height="8"/><rect x="18" y="3" width="4" height="7"/><circle cx="20" cy="3" r="2.4"/></g>`,
  fusionReactor: `<g fill="${C}"><rect x="8" y="14" width="24" height="16" rx="2"/><circle cx="20" cy="22" r="6" fill="none" stroke="${C}" stroke-width="2"/><circle cx="20" cy="22" r="2"/><path d="M20 16 v3 M20 25 v3 M14 22 h3 M23 22 h3"/></g>`,
  fissionReactor:`<g fill="${C}"><rect x="8" y="16" width="24" height="14" rx="1"/><path d="M12 16 q3 -8 8 -8 q5 0 8 8" fill="none" stroke="${C}" stroke-width="2.4"/><rect x="22" y="6" width="5" height="11" rx="2"/></g>`,
  barracks:      `<g fill="${C}"><rect x="6" y="15" width="28" height="15" rx="1"/><path d="M6 15 l14 -7 14 7z"/><rect x="17" y="21" width="6" height="9"/></g>`,
  supplyCenter:  `<g fill="${C}"><rect x="6" y="14" width="28" height="16" rx="1"/><path d="M6 14 h28 l-4 -6 h-20z"/><circle cx="20" cy="22" r="3"/><path d="M20 22 l0 -3 2 1z" fill="#000" opacity="0.3"/></g>`,
  supplyStash:   `<g fill="${C}"><path d="M7 30 l4 -16 h18 l4 16z"/><rect x="14" y="9" width="12" height="6" rx="1"/><path d="M11 22 h18" stroke="#000" stroke-width="1.5" opacity="0.3"/></g>`,
  warFactory:    `<g fill="${C}"><rect x="5" y="16" width="30" height="14" rx="1"/><path d="M5 16 q5 -6 10 0 q5 -6 10 0 q5 -6 10 0" fill="none" stroke="${C}" stroke-width="2"/><rect x="15" y="22" width="10" height="8"/></g>`,
  armsBazaar:    `<g fill="${C}"><rect x="6" y="17" width="28" height="13" rx="1"/><path d="M5 17 q15 -10 30 0" fill="none" stroke="${C}" stroke-width="2.5"/><rect x="13" y="22" width="6" height="8"/><rect x="22" y="22" width="6" height="8"/></g>`,
  airfield:      `<g fill="${C}"><rect x="5" y="13" width="30" height="17" rx="2"/><rect x="9" y="17" width="22" height="3" rx="1" fill="#000" opacity="0.3"/><path d="M14 26 l6 -3 6 3" stroke="${C}" stroke-width="2" fill="none"/></g>`,
  aegis:         `<g fill="${C}"><rect x="12" y="20" width="16" height="10" rx="1"/><rect x="17" y="8" width="6" height="13" rx="1"/><path d="M20 8 l-4 -4 m4 4 l4 -4 m-4 4 v-5"/></g>`,
  gatling:       `<g fill="${C}"><rect x="11" y="21" width="18" height="9" rx="1"/><rect x="15" y="14" width="10" height="8" rx="1"/><rect x="24" y="13" width="13" height="1.8" rx="0.9"/><rect x="24" y="16" width="13" height="1.8" rx="0.9"/><rect x="24" y="19" width="13" height="1.8" rx="0.9"/></g>`,
  stingerNest:   `<g fill="${C}"><path d="M8 30 l4 -12 h16 l4 12z"/><rect x="15" y="10" width="3" height="9" rx="1.5" transform="rotate(-20 15 10)"/><rect x="19" y="10" width="3" height="9" rx="1.5"/><rect x="23" y="10" width="3" height="9" rx="1.5" transform="rotate(20 23 10)"/></g>`,
  bunker:        `<g fill="${C}"><path d="M7 30 v-8 q13 -8 26 0 v8z"/><rect x="14" y="22" width="12" height="3" rx="1" fill="#000" opacity="0.35"/></g>`,
  tunnel:        `<g fill="${C}"><path d="M6 30 v-6 a14 14 0 0 1 28 0 v6z"/><path d="M14 30 v-4 a6 6 0 0 1 12 0 v4z" fill="#000" opacity="0.35"/></g>`,
  demoTrap:      `<g fill="${C}"><circle cx="20" cy="22" r="8" fill="none" stroke="${C}" stroke-width="2"/><circle cx="20" cy="22" r="3"/><path d="M20 10 v4 M20 30 v4 M8 22 h4 M28 22 h4"/></g>`,
  uplink:        `<g fill="${C}"><rect x="8" y="18" width="24" height="12" rx="1"/><circle cx="20" cy="13" r="7" fill="none" stroke="${C}" stroke-width="2"/><path d="M20 13 l5 -5" stroke="${C}" stroke-width="2"/></g>`,
  warCouncil:    `<g fill="${C}"><rect x="7" y="16" width="26" height="14" rx="1"/><path d="M20 5 l2.5 5 5.5 0 -4.5 3.5 1.5 5.5 -4.5 -3 -4.5 3 1.5 -5.5 -4.5 -3.5 5.5 0z"/></g>`,
  citadel:       `<g fill="${C}"><path d="M6 30 v-14 h6 v-4 h4 v4 h4 v-4 h4 v4 h6 v14z"/><rect x="16" y="22" width="8" height="8"/></g>`,
  dropZone:      `<g fill="${C}"><rect x="7" y="20" width="26" height="10" rx="1"/><path d="M20 6 q-8 0 -8 8 h16 q0 -8 -8 -8z" fill="none" stroke="${C}" stroke-width="2"/><path d="M20 14 v6"/></g>`,
  blackMarket:   `<g fill="${C}"><rect x="7" y="17" width="26" height="13" rx="1"/><path d="M6 17 q14 -9 28 0" fill="none" stroke="${C}" stroke-width="2"/><path d="M11 17 v13 M20 17 v13 M29 17 v13" opacity="0.3"/></g>`,
  orbitalLance:  `<g fill="${C}"><rect x="11" y="20" width="18" height="10" rx="1"/><path d="M20 20 v-14" stroke="${C}" stroke-width="3"/><circle cx="20" cy="5" r="3.5"/><path d="M16 9 l8 0" opacity="0.5"/></g>`,
  nuclearMissile:`<g fill="${C}"><rect x="11" y="22" width="18" height="8" rx="1"/><path d="M20 22 l-5 -10 q5 -6 10 0z"/><circle cx="20" cy="9" r="2" fill="#000" opacity="0.3"/></g>`,
  viperStorm:    `<g fill="${C}"><rect x="10" y="22" width="20" height="8" rx="1"/><rect x="13" y="9" width="3" height="13" rx="1.5"/><rect x="18.5" y="6" width="3" height="16" rx="1.5"/><rect x="24" y="9" width="3" height="13" rx="1.5"/></g>`,
  // ── world ──
  civBuilding:   `<g fill="${C}"><rect x="9" y="11" width="22" height="19"/><rect x="13" y="15" width="4" height="4" fill="#000" opacity="0.35"/><rect x="23" y="15" width="4" height="4" fill="#000" opacity="0.35"/><rect x="17" y="23" width="6" height="7" fill="#000" opacity="0.35"/></g>`,
  oilDerrick:    `<g fill="${C}"><path d="M14 30 L20 6 L26 30" fill="none" stroke="${C}" stroke-width="2.4"/><path d="M16 22 h8 M15 26 h10 M17 18 h6"/><circle cx="20" cy="6" r="2"/></g>`,
  supplyDock:    `<g fill="${C}"><path d="M8 30 l3 -12 h18 l3 12z"/><circle cx="20" cy="14" r="4" fill="none" stroke="${C}" stroke-width="2"/></g>`,
  supplyPile:    `<g fill="${C}"><path d="M10 30 l4 -9 h12 l4 9z"/><path d="M14 21 l2 -5 h8 l2 5z"/></g>`,
  crate:         `<g fill="${C}"><rect x="11" y="14" width="18" height="16" rx="1"/><path d="M11 14 l18 16 M29 14 l-18 16" stroke="#000" stroke-width="1.2" opacity="0.3"/></g>`,
};

// Generic fallbacks by category.
const GENERIC_UNIT = `<g fill="${C}"><circle cx="20" cy="9" r="4.2"/><rect x="16" y="14" width="8" height="15" rx="2"/></g>`;
const GENERIC_STRUCT = `<g fill="${C}"><rect x="8" y="14" width="24" height="16" rx="1"/><rect x="16" y="20" width="8" height="10"/></g>`;

export function glyph(key) {
  return G[key] || (STRUCT_META[key] ? GENERIC_STRUCT : GENERIC_UNIT);
}

// ── Power icons ──────────────────────────────────────────────────────────────
const PW = {
  spyDrone:   `<g fill="${C}"><ellipse cx="20" cy="20" rx="6" ry="3"/><rect x="6" y="19" width="10" height="2"/><rect x="24" y="19" width="10" height="2"/><circle cx="20" cy="20" r="1.6" fill="#000" opacity="0.4"/></g>`,
  paradrop:   `<g fill="${C}"><path d="M20 8 q-9 0 -9 8 h18 q0 -8 -9 -8z" fill="none" stroke="${C}" stroke-width="2"/><path d="M13 16 l7 8 7 -8"/><circle cx="20" cy="28" r="2.5"/></g>`,
  strikeWing: `<g fill="${C}"><path d="M6 22 L26 18 L34 22 L26 26 Z"/><path d="M14 22 L20 12 L23 22z"/></g>`,
  fuelAir:    `<g fill="${C}"><path d="M20 6 q6 8 6 14 a6 6 0 0 1 -12 0 q0 -6 6 -14z"/><path d="M14 30 q6 -4 12 0"/></g>`,
  artillery:  `<g fill="${C}"><rect x="8" y="22" width="16" height="6" rx="2"/><rect x="14" y="8" width="4" height="16" rx="2" transform="rotate(-30 14 8)"/><circle cx="30" cy="12" r="2.2"/><circle cx="34" cy="18" r="1.6"/></g>`,
  cashHackP:  `<g fill="${C}"><circle cx="20" cy="20" r="11" fill="none" stroke="${C}" stroke-width="2"/><path d="M20 13 v14 M16 16 q4 -3 8 0 M16 24 q4 3 8 0"/></g>`,
  clusterMines:`<g fill="${C}"><circle cx="13" cy="24" r="3"/><circle cx="27" cy="24" r="3"/><circle cx="20" cy="14" r="3"/><path d="M13 24 v-3 M27 24 v-3 M20 14 v-3"/></g>`,
  empBomb:    `<g fill="${C}"><path d="M22 6 L12 22 h7 l-3 12 12 -16 h-7z"/></g>`,
  ambush:     `<g fill="${C}"><circle cx="12" cy="14" r="3"/><rect x="9" y="18" width="6" height="9" rx="2"/><circle cx="28" cy="14" r="3"/><rect x="25" y="18" width="6" height="9" rx="2"/><circle cx="20" cy="11" r="3"/><rect x="17" y="15" width="6" height="9" rx="2"/></g>`,
  cashBounty: `<g fill="${C}"><circle cx="20" cy="20" r="11" fill="none" stroke="${C}" stroke-width="2"/><path d="M20 13 v14 M16 16 q4 -3 8 0 M16 24 q4 3 8 0"/><path d="M30 9 l2 2 m-2 0 l2 -2" stroke="${C}" stroke-width="1.5"/></g>`,
  sneakAttack:`<g fill="${C}"><path d="M6 30 v-6 a14 14 0 0 1 28 0 v6z"/><path d="M14 30 v-4 a6 6 0 0 1 12 0 v4z" fill="#000" opacity="0.4"/></g>`,
  anthrax:    `<g fill="${C}"><circle cx="20" cy="20" r="3"/><path d="M20 20 L20 8 A12 12 0 0 1 30 14 Z"/><path d="M20 20 L30 26 A12 12 0 0 1 20 32 Z"/><path d="M20 20 L10 26 A12 12 0 0 1 10 14 Z"/></g>`,
};
export function powerGlyph(key) {
  return PW[key] || `<path d="M22 4 L8 22 h8 l-2 14 14 -18 h-8z" fill="${C}"/>`;
}

// ── Ability icons ────────────────────────────────────────────────────────────
const AB = {
  flashbang: `<g fill="${C}"><circle cx="20" cy="20" r="6"/><path d="M20 6 v6 M20 28 v6 M6 20 h6 M28 20 h6 M10 10 l4 4 M30 10 l-4 4 M10 30 l4 -4 M30 30 l-4 -4" stroke="${C}" stroke-width="2"/></g>`,
  c4:        `<g fill="${C}"><rect x="10" y="14" width="20" height="12" rx="1"/><rect x="13" y="17" width="14" height="3" fill="#000" opacity="0.4"/><path d="M30 14 v-5 h4" stroke="${C}" stroke-width="2" fill="none"/></g>`,
  deploy:    `<g fill="${C}"><path d="M20 8 v18 M12 18 l8 8 8 -8" stroke="${C}" stroke-width="3" fill="none"/><rect x="10" y="28" width="20" height="4" rx="1"/></g>`,
  disable:   `<g fill="${C}"><circle cx="20" cy="20" r="11" fill="none" stroke="${C}" stroke-width="2.5"/><path d="M12 12 l16 16" stroke="${C}" stroke-width="2.5"/></g>`,
  cashHack:  `<g fill="${C}"><circle cx="20" cy="20" r="11" fill="none" stroke="${C}" stroke-width="2"/><path d="M20 13 v14 M16 16 q4 -3 8 0 M16 24 q4 3 8 0"/></g>`,
  crewSnipe: `<g fill="${C}"><circle cx="20" cy="20" r="10" fill="none" stroke="${C}" stroke-width="2"/><circle cx="20" cy="20" r="2"/><path d="M20 6 v6 M20 28 v6 M6 20 h6 M28 20 h6"/></g>`,
};
export function abilityGlyph(key) {
  return AB[key] || `<circle cx="20" cy="20" r="9" fill="none" stroke="${C}" stroke-width="2"/>`;
}

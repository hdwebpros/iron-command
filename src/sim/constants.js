// FREEDOM FIGHT — sim constants, RNG, damage table, geometry helpers.
// Pure: zero imports from three/DOM. Runs under plain node.

export const TICK = 1 / 30;
export const POP_CAP = 80;

export const PLAYER = 'player';
export const ENEMY = 'enemy';
export const NEUTRAL = 'neutral';

// ─── Deterministic RNG (mulberry32) ─────────────────────────────────────────
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Damage type × armor class multiplier (% damage received) ───────────────
export const DMG_TABLE = {
  smallArms: { infantry: 100, lightVehicle: 50, tank: 25, aircraft: 60, structure: 25, baseDefense: 25 },
  gatling:   { infantry: 125, lightVehicle: 60, tank: 20, aircraft: 125, structure: 20, baseDefense: 25 },
  cannon:    { infantry: 50, lightVehicle: 100, tank: 100, aircraft: 0, structure: 90, baseDefense: 90 },
  missile:   { infantry: 30, lightVehicle: 100, tank: 110, aircraft: 120, structure: 70, baseDefense: 70 },
  flame:     { infantry: 150, lightVehicle: 90, tank: 50, aircraft: 0, structure: 80, baseDefense: 60 },
  toxin:     { infantry: 175, lightVehicle: 50, tank: 25, aircraft: 0, structure: 25, baseDefense: 25 },
  sniper:    { infantry: 250, lightVehicle: 10, tank: 0, aircraft: 0, structure: 5, baseDefense: 10 },
  explosion: { infantry: 100, lightVehicle: 110, tank: 100, aircraft: 60, structure: 110, baseDefense: 100 },
  bomb:      { infantry: 120, lightVehicle: 120, tank: 120, aircraft: 0, structure: 250, baseDefense: 200 },
  beam:      { infantry: 150, lightVehicle: 120, tank: 110, aircraft: 0, structure: 220, baseDefense: 220 },
};

export function dmgMultiplier(dmgType, armorClass) {
  const row = DMG_TABLE[dmgType];
  if (!row) return 1;
  const v = row[armorClass];
  return (v == null ? 100 : v) / 100;
}

// Instant-hit weapons vs travel-time projectiles.
export const INSTANT_WEAPONS = new Set(['smallArms', 'gatling', 'sniper', 'flame', 'toxin']);
export const PROJECTILE_WEAPONS = new Set(['cannon', 'missile', 'explosion', 'bomb']);

// Projectile speeds (units/sec) for flight-time calc.
export const PROJ_SPEED = { cannon: 40, missile: 30, explosion: 22, bomb: 28 };

// Splash radii by weapon (units). Artillery weapons override per-unit.
export const SPLASH_RADIUS = { cannon: 1.5, explosion: 4, bomb: 4 };

// ─── Geometry helpers ───────────────────────────────────────────────────────
export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }
export function dist(ax, az, bx, bz) { return Math.sqrt(dist2(ax, az, bx, bz)); }
export function lerp(a, b, t) { return a + (b - a) * t; }

// EVA throttle for underAttack family (sec).
export const UNDER_ATTACK_THROTTLE = 15;

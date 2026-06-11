// ─── IRON COMMAND — Simulation Constants ────────────────────────────────────
// Pure data. No imports. No side-effects.

// Board
export const BOARD_WIDTH   = 14;   // x: -7 .. 7
export const BOARD_LENGTH  = 22;   // z: -11 .. 11
export const BOARD_HALF_X  = 7;
export const BOARD_HALF_Z  = 11;

// Sides
export const PLAYER = 'player';
export const ENEMY  = 'enemy';

// Deploy zones: |z| between 5 and 9, clamped to side
// player: z in [5, 9], enemy: z in [-9, -5]
export const DEPLOY_Z_MIN = 5;
export const DEPLOY_Z_MAX = 9;

// Bases
export const BASE_HP           = 1000;
export const BASE_TURRET_RANGE = 4;
export const BASE_TURRET_DPS   = 30;

// Player base is at z=+10, enemy at z=-10
export const BASE_Z = { player: 10, enemy: -10 };

// Tiberium fields
export const TIBERIUM_FIELDS = [
  { x:  5, z:  5 },  // player half
  { x: -5, z: -5 },  // enemy half
];
export const TIBERIUM_HARVEST_RADIUS  = 1.5;
export const TIBERIUM_HARVEST_INCOME  = 14;   // per-sec while parked

// Economy
export const STARTING_CREDITS    = 300;
export const PASSIVE_INCOME_RATE = 12;   // per-sec

// Missile pads
export const PAD_POSITIONS = [
  { x: -4.5, z: 0 },
  { x:  0,   z: 0 },
  { x:  4.5, z: 0 },
];
export const PAD_CAPTURE_RADIUS   = 1.5;  // tiles, ground units only
export const PAD_CAPTURE_TIME     = 3;    // seconds continuous occupancy
export const NUKE_CHARGE_2_PADS   = 2.5;   // %/sec holding ≥2 pads
export const NUKE_CHARGE_3_PADS   = 4.5;  // %/sec holding 3 pads
export const NUKE_DAMAGE          = 300;
export const NUKE_FLIGHT_TIME     = 3.0; // seconds in air before impact

// Combat
export const SIGHT_RANGE        = 6;
export const SEPARATION_RADIUS  = 0.45;
export const STEALTH_DETECT_RADIUS = 2; // tiles; stealth broken while attacking too
export const HOLD_CHASE_LIMIT   = 3;    // tiles beyond move-order position

// Projectile speeds (tiles/sec)
export const PROJ_SPEED = {
  bullet:  0,    // instant
  cannon:  12,
  missile: 9,
  flame:   7,
};
export const PROJ_SPLASH_RADIUS = 0.6; // for dead-target redirect

// Damage multiplier table: [attackerDmgType][targetArmorClass]
export const DMG_TABLE = {
  bullet:  { infantry: 1.50, vehicle: 0.50, air: 0.75, building: 0.50 },
  cannon:  { infantry: 0.50, vehicle: 1.50, air: 0.00, building: 1.25 },
  missile: { infantry: 0.75, vehicle: 1.25, air: 1.50, building: 1.00 },
  flame:   { infantry: 1.75, vehicle: 0.75, air: 0.00, building: 1.50 },
};

// Attack cadence: damage dealt per shot / dps = cadence (s)
// We target ~1 shot every 0.5–1 s. Use cadence = clamp(dps/dps, 0.5, 1.0).
// Actual cadence = 0.75s baseline but clamped per unit.
export const SHOT_CADENCE_MIN = 0.5;
export const SHOT_CADENCE_MAX = 1.0;
export const SHOT_CADENCE_BASE = 0.75;

// AI
export const AI_THINK_INTERVAL = { easy: 4, hard: 2, brutal: 1 };
export const AI_INCOME_MULT    = { easy: 0.75, hard: 1.0, brutal: 1.25 };

// Power cooldowns (sec) — stored in GENERALS but also re-exported for convenience
export const POWER_CD = { steel: 90, phantom: 75, hammer: 80 };

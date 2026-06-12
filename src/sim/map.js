// Scorched Basin — the skirmish map. FROZEN DATA, authored by the design contract.
// This file is the ONE sanctioned cross-import between sim and gfx: it exports plain
// data only and must never import anything. Sim may append pure helper functions
// below the MAP export; the MAP object itself must not be mutated or reshaped.

const PI = Math.PI;

export const MAP = {
  size: 128,            // x,z ∈ [-64, 64]
  cell: 2,              // fog/path grid cell size → 64×64 grid
  border: 4,            // outer ring impassable: playable area |x|,|z| <= 60

  spawns: {
    player: { x: -42, z: -42, angle: PI / 4 },
    enemy:  { x: 42,  z: 42,  angle: PI / 4 + PI },
  },

  // Finite supply: docks are the big 400-box stacks, piles are small scatter
  supplyDocks: [
    { x: -30, z: -48, amount: 30000 },  // player base dock
    { x: 30,  z: 48,  amount: 30000 },  // enemy base dock
    { x: -8,  z: 14,  amount: 30000 },  // contested center west
    { x: 8,   z: -14, amount: 30000 },  // contested center east
  ],
  supplyPiles: [
    { x: -52, z: 8,  amount: 6000 },
    { x: 52,  z: -8, amount: 6000 },
  ],

  oilDerricks: [
    { x: -2, z: -34 },
    { x: 2,  z: 34 },
  ],

  // Garrisonable neutral buildings: 5 infantry slots, 400 HP
  civBuildings: [
    { x: -14, z: 0 }, { x: 14, z: 0 },
    { x: 0, z: -6 },  { x: 0, z: 6 },
    { x: -30, z: 24 }, { x: 30, z: -24 },
  ],

  // Impassable rock outcrops (ground units): 180°-symmetric, lanes >= 8 wide
  blockers: [
    { x: -20, z: -8,  r: 5 }, { x: 20,  z: 8,   r: 5 },
    { x: -34, z: 18,  r: 4 }, { x: 34,  z: -18, r: 4 },
    { x: -6,  z: -26, r: 4 }, { x: 6,   z: 26,  r: 4 },
    { x: -46, z: 24,  r: 5 }, { x: 46,  z: -24, r: 5 },
    { x: -24, z: 38,  r: 6 }, { x: 24,  z: -38, r: 6 },
    { x: -40, z: -12, r: 3 }, { x: 40,  z: 12,  r: 3 },
  ],
};

// ─── Pure helpers (appended; do not mutate MAP) ─────────────────────────────
// Grid: 64×64 cells of size MAP.cell=2 over x,z ∈ [-64,64].

export const GRID_W = MAP.size / MAP.cell; // 64
export const GRID_H = MAP.size / MAP.cell; // 64
const HALF = MAP.size / 2;                 // 64

// World coord → grid index (clamped).
export function worldToCell(x, z) {
  let cx = Math.floor((x + HALF) / MAP.cell);
  let cz = Math.floor((z + HALF) / MAP.cell);
  if (cx < 0) cx = 0; else if (cx >= GRID_W) cx = GRID_W - 1;
  if (cz < 0) cz = 0; else if (cz >= GRID_H) cz = GRID_H - 1;
  return { cx, cz };
}

// Grid cell center → world coord.
export function cellToWorld(cx, cz) {
  return { x: cx * MAP.cell - HALF + MAP.cell / 2, z: cz * MAP.cell - HALF + MAP.cell / 2 };
}

// Build a Uint8Array passability grid for GROUND units.
// 0 = passable, 1 = blocked (rock blocker or border ring). Aircraft ignore this.
export function buildPassGrid() {
  const grid = new Uint8Array(GRID_W * GRID_H);
  const playable = HALF - MAP.border; // 60
  for (let cz = 0; cz < GRID_H; cz++) {
    for (let cx = 0; cx < GRID_W; cx++) {
      const { x, z } = cellToWorld(cx, cz);
      let blocked = false;
      // Border ring
      if (Math.abs(x) > playable || Math.abs(z) > playable) blocked = true;
      // Rock blockers
      if (!blocked) {
        for (const b of MAP.blockers) {
          const dx = x - b.x, dz = z - b.z;
          if (dx * dx + dz * dz <= (b.r + 0.5) * (b.r + 0.5)) { blocked = true; break; }
        }
      }
      grid[cz * GRID_W + cx] = blocked ? 1 : 0;
    }
  }
  return grid;
}

export function cellBlocked(grid, cx, cz) {
  if (cx < 0 || cz < 0 || cx >= GRID_W || cz >= GRID_H) return true;
  return grid[cz * GRID_W + cx] === 1;
}

// Is a world point passable for ground? (border + blockers)
export function pointPassable(grid, x, z) {
  const { cx, cz } = worldToCell(x, z);
  return !cellBlocked(grid, cx, cz);
}

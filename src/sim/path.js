// FREEDOM FIGHT — spatial hash, binary heap, A* pathfinding. Pure, no imports
// except map helpers (which themselves import nothing).
import { GRID_W, GRID_H, cellBlocked, worldToCell, cellToWorld } from './map.js';

// ─── Spatial hash for proximity queries ─────────────────────────────────────
export class SpatialHash {
  constructor(cellSize = 6) {
    this.cell = cellSize;
    this.map = new Map(); // key "cx,cz" → array of entities
  }
  _key(x, z) { return ((x / this.cell) | 0) + ',' + ((z / this.cell) | 0); }
  clear() { this.map.clear(); }
  insert(ent) {
    const k = this._key(ent.x, ent.z);
    let arr = this.map.get(k);
    if (!arr) { arr = []; this.map.set(k, arr); }
    arr.push(ent);
  }
  // Query all entities within `radius` of (x,z). Returns array (may include some
  // outside radius; caller should re-check distance).
  query(x, z, radius) {
    const out = [];
    const mincx = ((x - radius) / this.cell) | 0;
    const maxcx = ((x + radius) / this.cell) | 0;
    const mincz = ((z - radius) / this.cell) | 0;
    const maxcz = ((z + radius) / this.cell) | 0;
    for (let cz = mincz; cz <= maxcz; cz++) {
      for (let cx = mincx; cx <= maxcx; cx++) {
        const arr = this.map.get(cx + ',' + cz);
        if (arr) for (const e of arr) out.push(e);
      }
    }
    return out;
  }
}

// ─── Binary min-heap (for A*) ───────────────────────────────────────────────
class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(node, priority) {
    const it = this.items;
    it.push({ node, priority });
    let i = it.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (it[p].priority <= it[i].priority) break;
      [it[p], it[i]] = [it[i], it[p]];
      i = p;
    }
  }
  pop() {
    const it = this.items;
    const top = it[0];
    const last = it.pop();
    if (it.length > 0) {
      it[0] = last;
      let i = 0;
      const n = it.length;
      for (;;) {
        let l = 2 * i + 1, r = 2 * i + 2, s = i;
        if (l < n && it[l].priority < it[s].priority) s = l;
        if (r < n && it[r].priority < it[s].priority) s = r;
        if (s === i) break;
        [it[s], it[i]] = [it[i], it[s]];
        i = s;
      }
    }
    return top.node;
  }
}

// ─── A* on the GRID_W×GRID_H grid ───────────────────────────────────────────────────
// Returns array of world-space waypoints {x,z} from start to goal, or null.
const NEI = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142],
];

export function findPath(grid, sx, sz, gx, gz) {
  const s = worldToCell(sx, sz);
  let g = worldToCell(gx, gz);
  // If goal blocked, find nearest open cell (small spiral).
  if (cellBlocked(grid, g.cx, g.cz)) {
    const open = nearestOpen(grid, g.cx, g.cz);
    if (!open) return null;
    g = open;
  }
  if (s.cx === g.cx && s.cz === g.cz) return [{ x: gx, z: gz }];

  const idx = (cx, cz) => cz * GRID_W + cx;
  const startI = idx(s.cx, s.cz), goalI = idx(g.cx, g.cz);
  const came = new Map();
  const gScore = new Map();
  gScore.set(startI, 0);
  const heap = new MinHeap();
  const h = (cx, cz) => Math.abs(cx - g.cx) + Math.abs(cz - g.cz);
  heap.push(startI, h(s.cx, s.cz));
  const closed = new Set();
  let iterations = 0;
  const MAX_ITER = GRID_W * GRID_H;

  while (heap.size > 0 && iterations++ < MAX_ITER) {
    const cur = heap.pop();
    if (cur === goalI) return reconstruct(came, cur, s, gx, gz);
    if (closed.has(cur)) continue;
    closed.add(cur);
    const ccx = cur % GRID_W, ccz = (cur / GRID_W) | 0;
    const cg = gScore.get(cur);
    for (const [dx, dz, cost] of NEI) {
      const nx = ccx + dx, nz = ccz + dz;
      if (cellBlocked(grid, nx, nz)) continue;
      // Prevent diagonal corner-cutting through blocked orthogonals.
      if (dx !== 0 && dz !== 0) {
        if (cellBlocked(grid, ccx + dx, ccz) || cellBlocked(grid, ccx, ccz + dz)) continue;
      }
      const ni = idx(nx, nz);
      if (closed.has(ni)) continue;
      const tentative = cg + cost;
      if (tentative < (gScore.get(ni) ?? Infinity)) {
        came.set(ni, cur);
        gScore.set(ni, tentative);
        heap.push(ni, tentative + h(nx, nz));
      }
    }
  }
  return null;
}

function reconstruct(came, cur, start, gx, gz) {
  const cells = [cur];
  while (came.has(cur)) { cur = came.get(cur); cells.push(cur); }
  cells.reverse();
  const path = [];
  // Skip the very first cell (start cell) — we are already there.
  for (let i = 1; i < cells.length; i++) {
    const cx = cells[i] % GRID_W, cz = (cells[i] / GRID_W) | 0;
    path.push(cellToWorld(cx, cz));
  }
  // Replace final waypoint with exact goal for precision.
  if (path.length) path[path.length - 1] = { x: gx, z: gz };
  else path.push({ x: gx, z: gz });
  return path;
}

function nearestOpen(grid, cx, cz) {
  for (let r = 1; r <= 6; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
        const nx = cx + dx, nz = cz + dz;
        if (!cellBlocked(grid, nx, nz)) return { cx: nx, cz: nz };
      }
    }
  }
  return null;
}

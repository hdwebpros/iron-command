// ─── IRON COMMAND — Scorched Basin terrain ──────────────────────────────────
// 128×128 golden-hour desert built straight from the frozen MAP data:
// procedural 2048px diffuse (fbm sand, tire tracks, scorch), impassable
// mountain ring on the 4-unit border, rock outcrops at every blocker,
// debris props outside the play lanes, drifting dust.
import * as THREE from 'three';
import { MAP } from '../sim/map.js';

const SIZE = MAP.size;          // 128
const HALF = SIZE / 2;          // 64
const PLAY = HALF - MAP.border; // 60 — playable extent
const TEX = 2048;

/* ── deterministic value noise ──────────────────────────────────────────── */
function hash2(ix, iz) {
  let n = (ix * 374761393 + iz * 668265263) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}
function fbm(x, z) {
  return vnoise(x, z) * 0.58 + vnoise(x * 2.3 + 7.1, z * 2.3 + 3.7) * 0.3 + vnoise(x * 5.1 + 13.7, z * 5.1 + 5.3) * 0.12;
}
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
// seeded RNG for prop placement (keeps minimap/visuals stable across loads)
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ground relief: dead flat inside the playfield, rises into the border rim. */
export function terrainHeight(x, z) {
  const edge = Math.max(Math.abs(x), Math.abs(z));
  const t = smoothstep(PLAY - 1.5, HALF + 2, edge);
  if (t <= 0) return 0;
  return t * t * (2.2 + fbm(x * 0.12 + 5, z * 0.12 + 9) * 2.4);
}

/* ── 2048px painted diffuse ─────────────────────────────────────────────── */
const W2C = (x, z, S = TEX) => [(x / SIZE + 0.5) * S, (z / SIZE + 0.5) * S];

function paintGround() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = TEX;
  const c = cv.getContext('2d');
  const px = TEX / SIZE; // pixels per world unit (16)

  // base sand mottle — broad dune patches over packed earth, painted low-res
  {
    const MS = 512;
    const mc = document.createElement('canvas');
    mc.width = mc.height = MS;
    const mx = mc.getContext('2d');
    const img = mx.createImageData(MS, MS);
    const d = img.data;
    for (let yy = 0; yy < MS; yy++) {
      const wz = (yy / MS - 0.5) * SIZE;
      for (let xx = 0; xx < MS; xx++) {
        const wx = (xx / MS - 0.5) * SIZE;
        const mt = fbm(wx * 0.05 + 3.1, wz * 0.05 + 9.7);
        const dn = vnoise((wx + wz * 0.4) * 0.1 + 40.2, (wz - wx * 0.3) * 0.03 + 7.7);
        const t = Math.max(0, Math.min(1, mt * 0.72 + dn * 0.42 - 0.07));
        let r = 144 + t * 78, g = 115 + t * 62, b = 79 + t * 42;
        const v = (fbm(wx * 0.3 + 17.3, wz * 0.3 + 4.4) - 0.5) * 26;
        r += v; g += v * 0.85; b += v * 0.65;
        // rocky darkening toward the border rim
        const edge = smoothstep(PLAY - 2, HALF, Math.max(Math.abs(wx), Math.abs(wz)));
        r -= edge * 38; g -= edge * 34; b -= edge * 24;
        const i4 = (yy * MS + xx) * 4;
        d[i4] = r; d[i4 + 1] = g; d[i4 + 2] = b; d[i4 + 3] = 255;
      }
    }
    mx.putImageData(img, 0, 0);
    c.imageSmoothingEnabled = true;
    c.drawImage(mc, 0, 0, TEX, TEX);
  }

  // fine grit speckle
  const rnd = mulberry32(1337);
  for (let i = 0; i < 30000; i++) {
    const v = rnd();
    c.fillStyle = v > 0.5 ? `rgba(236,212,166,${0.03 + rnd() * 0.06})` : `rgba(56,42,28,${0.03 + rnd() * 0.06})`;
    c.fillRect(rnd() * TEX, rnd() * TEX, 1 + rnd() * 2, 1 + rnd() * 2);
  }

  // cracked-earth polylines
  c.strokeStyle = 'rgba(62,46,32,0.2)';
  for (let i = 0; i < 160; i++) {
    c.lineWidth = 0.7 + rnd() * 1.5;
    let x = rnd() * TEX, y = rnd() * TEX;
    c.beginPath(); c.moveTo(x, y);
    let a = rnd() * Math.PI * 2;
    const segs = 4 + (rnd() * 6) | 0;
    for (let s = 0; s < segs; s++) {
      a += (rnd() - 0.5) * 1.6;
      const len = 12 + rnd() * 38;
      x += Math.cos(a) * len; y += Math.sin(a) * len;
      c.lineTo(x, y);
    }
    c.stroke();
  }

  // dry scrub tufts
  for (let i = 0; i < 1300; i++) {
    const x = rnd() * TEX, y = rnd() * TEX;
    const tone = rnd();
    c.fillStyle = tone > 0.5 ? `rgba(96,94,56,${0.2 + rnd() * 0.28})` : `rgba(74,70,44,${0.2 + rnd() * 0.28})`;
    const n = 2 + (rnd() * 4) | 0;
    for (let j = 0; j < n; j++) {
      c.beginPath();
      c.ellipse(x + (rnd() - 0.5) * 9, y + (rnd() - 0.5) * 9, 1 + rnd() * 2.4, 1 + rnd() * 2.4, 0, 0, Math.PI * 2);
      c.fill();
    }
  }

  // worn tire-track roads: spawn↔center docks↔spawn + cross routes
  const roads = [
    [MAP.spawns.player, MAP.supplyDocks[2], MAP.spawns.enemy],
    [MAP.spawns.player, MAP.supplyDocks[3], MAP.spawns.enemy],
    [MAP.spawns.player, MAP.supplyDocks[0]],
    [MAP.spawns.enemy, MAP.supplyDocks[1]],
    [MAP.oilDerricks[0], { x: 0, z: 0 }, MAP.oilDerricks[1]],
  ];
  for (const pts of roads) {
    for (let s = 0; s < pts.length - 1; s++) {
      const [x0, y0] = W2C(pts[s].x, pts[s].z);
      const [x1, y1] = W2C(pts[s + 1].x, pts[s + 1].z);
      const dx = x1 - x0, dy = y1 - y0;
      const L = Math.hypot(dx, dy);
      const nx = -dy / L, ny = dx / L;
      // packed lighter lane
      c.strokeStyle = 'rgba(176,148,104,0.34)';
      c.lineWidth = 2.0 * px;
      c.lineCap = 'round';
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
      // paired wheel ruts with wobble
      for (const off of [-0.5, -0.25, 0.25, 0.5]) {
        c.strokeStyle = `rgba(74,57,38,${0.2 + rnd() * 0.1})`;
        c.lineWidth = 0.13 * px;
        const wob = rnd() * 9;
        c.beginPath();
        const steps = Math.max(2, (L / 26) | 0);
        for (let k = 0; k <= steps; k++) {
          const t = k / steps;
          const wx = x0 + dx * t + nx * (off * px + Math.sin(t * 17 + wob) * 5);
          const wy = y0 + dy * t + ny * (off * px + Math.sin(t * 17 + wob) * 5);
          k ? c.lineTo(wx, wy) : c.moveTo(wx, wy);
        }
        c.stroke();
      }
    }
  }

  // scorch variation — old battle stains: small irregular blob clusters
  for (let i = 0; i < 20; i++) {
    const x = (rnd() - 0.5) * (SIZE - 24), z = (rnd() - 0.5) * (SIZE - 24);
    const [cx, cy] = W2C(x, z);
    const blobs = 2 + (rnd() * 3) | 0;
    for (let b = 0; b < blobs; b++) {
      const bx = cx + (rnd() - 0.5) * 2.2 * px, by = cy + (rnd() - 0.5) * 2.2 * px;
      const r = (0.4 + rnd() * 1.0) * px;
      const gr = c.createRadialGradient(bx, by, 0, bx, by, r);
      gr.addColorStop(0, `rgba(30,25,20,${0.10 + rnd() * 0.14})`);
      gr.addColorStop(1, 'rgba(30,25,20,0)');
      c.fillStyle = gr;
      c.beginPath(); c.arc(bx, by, r, 0, Math.PI * 2); c.fill();
    }
  }

  // concrete aprons under supply docks + derricks + civ buildings
  const aprons = [
    ...MAP.supplyDocks.map((p) => ({ ...p, r: 3.2 })),
    ...MAP.oilDerricks.map((p) => ({ ...p, r: 2.4 })),
    ...MAP.civBuildings.map((p) => ({ ...p, r: 2.6 })),
  ];
  for (const a of aprons) {
    const [cx, cy] = W2C(a.x, a.z);
    c.fillStyle = 'rgba(133,128,118,0.55)';
    c.beginPath(); c.arc(cx, cy, a.r * px, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(50,46,40,0.4)';
    c.lineWidth = 3;
    c.beginPath(); c.arc(cx, cy, a.r * px - 3, 0, Math.PI * 2); c.stroke();
  }

  // darker rocky stain under blockers
  for (const b of MAP.blockers) {
    const [cx, cy] = W2C(b.x, b.z);
    const r = (b.r + 1.2) * px;
    const gr = c.createRadialGradient(cx, cy, r * 0.3, cx, cy, r);
    gr.addColorStop(0, 'rgba(84,70,54,0.55)');
    gr.addColorStop(1, 'rgba(84,70,54,0)');
    c.fillStyle = gr;
    c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
  }

  // base aprons at spawns
  for (const s of [MAP.spawns.player, MAP.spawns.enemy]) {
    const [cx, cy] = W2C(s.x, s.z);
    c.fillStyle = 'rgba(139,130,118,0.5)';
    c.fillRect(cx - 7 * px, cy - 7 * px, 14 * px, 14 * px);
    c.strokeStyle = 'rgba(45,42,38,0.45)';
    c.lineWidth = 3;
    c.strokeRect(cx - 7 * px, cy - 7 * px, 14 * px, 14 * px);
  }
  return cv;
}

function paintBump() {
  const S = 1024;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d');
  const MS = 512;
  const mc = document.createElement('canvas');
  mc.width = mc.height = MS;
  const mx = mc.getContext('2d');
  const img = mx.createImageData(MS, MS);
  const d = img.data;
  for (let yy = 0; yy < MS; yy++) {
    const wz = (yy / MS - 0.5) * SIZE;
    for (let xx = 0; xx < MS; xx++) {
      const wx = (xx / MS - 0.5) * SIZE;
      let g = 128;
      g += (fbm(wx * 0.5 + 5.2, wz * 0.5 + 2.8) - 0.5) * 56;
      g += (vnoise((wx + wz * 0.4) * 0.8 + 11.1, (wz - wx * 0.3) * 0.22 + 3.3) - 0.5) * 34;
      g += (vnoise(wx * 2.8 + 23.7, wz * 2.8 + 8.9) - 0.5) * 30;
      const i4 = (yy * MS + xx) * 4;
      d[i4] = d[i4 + 1] = d[i4 + 2] = g; d[i4 + 3] = 255;
    }
  }
  mx.putImageData(img, 0, 0);
  c.imageSmoothingEnabled = true;
  c.drawImage(mc, 0, 0, S, S);
  const rnd = mulberry32(99);
  for (let i = 0; i < 8000; i++) {
    const v = rnd();
    c.fillStyle = v > 0.5 ? 'rgba(190,190,190,0.5)' : 'rgba(70,70,70,0.5)';
    c.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  return cv;
}

/* ── shared rock geometry/materials ─────────────────────────────────────── */
function makeRockGeo(seed) {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
    const n = vnoise(vx * 2.7 + seed * 13.1, vy * 2.7 + vz * 3.3 + seed * 7.7);
    const m = 0.72 + n * 0.62;
    pos.setXYZ(i, vx * m, vy * m * 0.82, vz * m);
  }
  geo.computeVertexNormals();
  return geo;
}
const ROCK_GEOS = [makeRockGeo(1), makeRockGeo(2), makeRockGeo(3), makeRockGeo(4)];
const ROCK_MATS = [0x8a7a64, 0x95826a, 0x7c6e5d, 0x6e6052].map(
  (col) => new THREE.MeshStandardMaterial({ color: col, roughness: 0.95, metalness: 0.02, flatShading: true }),
);
const MOUNTAIN_MATS = [0x77685a, 0x6a5c4e, 0x82715f].map(
  (col) => new THREE.MeshStandardMaterial({ color: col, roughness: 0.98, metalness: 0.0, flatShading: true }),
);

/* ── builders ───────────────────────────────────────────────────────────── */
function buildGround() {
  const geo = new THREE.PlaneGeometry(SIZE + 10, SIZE + 10, 100, 100);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setZ(i, terrainHeight(pos.getX(i), -pos.getY(i)));
  }
  geo.computeVertexNormals();
  geo.rotateX(-Math.PI / 2);

  const diff = new THREE.CanvasTexture(paintGround());
  diff.colorSpace = THREE.SRGBColorSpace;
  diff.anisotropy = 8;
  diff.wrapS = diff.wrapT = THREE.ClampToEdgeWrapping;
  // plane is 138 wide but the texture maps the 128 map: scale UVs
  const k = (SIZE + 10) / SIZE;
  diff.repeat.set(k, k);
  diff.offset.set(-(k - 1) / 2, -(k - 1) / 2);
  const bump = new THREE.CanvasTexture(paintBump());
  bump.wrapS = bump.wrapT = THREE.ClampToEdgeWrapping;
  bump.repeat.copy(diff.repeat); bump.offset.copy(diff.offset);
  const mat = new THREE.MeshStandardMaterial({
    map: diff, roughness: 0.96, metalness: 0.0, bumpMap: bump, bumpScale: 0.5,
  });
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  m.userData.isGround = true;
  return m;
}

// endless desert apron under/around the map so the horizon never shows void
function buildApron() {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 900),
    new THREE.MeshStandardMaterial({ color: 0x9c7e55, roughness: 1, metalness: 0 }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = -0.4;
  return m;
}

function buildMountainRing(group, rnd) {
  // low rocky ridge marching around the 4-unit border
  const step = 5;
  const ring = [];
  for (let x = -HALF; x <= HALF; x += step) { ring.push([x, -HALF + 1]); ring.push([x, HALF - 1]); }
  for (let z = -HALF + step; z <= HALF - step; z += step) { ring.push([-HALF + 1, z]); ring.push([HALF - 1, z]); }
  for (const [bx, bz] of ring) {
    const n = 2 + (rnd() * 2) | 0;
    for (let i = 0; i < n; i++) {
      const x = bx + (rnd() - 0.5) * 4.5;
      const z = bz + (rnd() - 0.5) * 4.5;
      const rk = new THREE.Mesh(ROCK_GEOS[(rnd() * 4) | 0], MOUNTAIN_MATS[(rnd() * 3) | 0]);
      const s = 2.4 + rnd() * 3.4;
      rk.scale.set(s * (0.8 + rnd() * 0.6), s * (0.8 + rnd() * 0.9), s * (0.8 + rnd() * 0.6));
      rk.position.set(x, terrainHeight(x, z) + s * 0.12, z);
      rk.rotation.set((rnd() - 0.5) * 0.4, rnd() * Math.PI, (rnd() - 0.5) * 0.4);
      rk.castShadow = rk.receiveShadow = true;
      group.add(rk);
    }
    // foothill scatter just inside
    if (rnd() < 0.6) {
      const dirx = Math.abs(bx) > Math.abs(bz) ? -Math.sign(bx) : 0;
      const dirz = dirx === 0 ? -Math.sign(bz) : 0;
      const x = bx + dirx * (2.5 + rnd() * 2), z = bz + dirz * (2.5 + rnd() * 2);
      const rk = new THREE.Mesh(ROCK_GEOS[(rnd() * 4) | 0], ROCK_MATS[(rnd() * 4) | 0]);
      const s = 0.5 + rnd() * 1.1;
      rk.scale.set(s, s * 0.7, s);
      rk.position.set(x, terrainHeight(x, z) + s * 0.15, z);
      rk.rotation.y = rnd() * Math.PI;
      rk.castShadow = true;
      group.add(rk);
    }
  }
}

function buildBlockers(group, rnd) {
  for (const b of MAP.blockers) {
    const n = 3 + (rnd() * 3) | 0;
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = Math.pow(rnd(), 0.7) * b.r * 0.55;
      const x = b.x + Math.cos(a) * rr, z = b.z + Math.sin(a) * rr;
      const rk = new THREE.Mesh(ROCK_GEOS[(rnd() * 4) | 0], ROCK_MATS[(rnd() * 4) | 0]);
      const s = b.r * (0.34 + rnd() * 0.4);
      rk.scale.set(s * (0.8 + rnd() * 0.5), s * (0.6 + rnd() * 0.6), s * (0.8 + rnd() * 0.5));
      rk.position.set(x, s * 0.1, z);
      rk.rotation.set((rnd() - 0.5) * 0.4, rnd() * Math.PI, (rnd() - 0.5) * 0.4);
      rk.castShadow = rk.receiveShadow = true;
      group.add(rk);
    }
    // pebbles around the foot
    for (let i = 0; i < 3; i++) {
      const a = rnd() * Math.PI * 2;
      const x = b.x + Math.cos(a) * (b.r * 0.9), z = b.z + Math.sin(a) * (b.r * 0.9);
      const rk = new THREE.Mesh(ROCK_GEOS[(rnd() * 4) | 0], ROCK_MATS[(rnd() * 4) | 0]);
      const s = 0.2 + rnd() * 0.4;
      rk.scale.set(s, s * 0.7, s);
      rk.position.set(x, s * 0.15, z);
      rk.castShadow = true;
      group.add(rk);
    }
  }
}

// decorative debris — only in the dead margin near the rim, never in lanes
function buildDebris(group, rnd) {
  const charMat = new THREE.MeshStandardMaterial({ color: 0x26221e, roughness: 0.95, metalness: 0.12 });
  const rustMat = new THREE.MeshStandardMaterial({ color: 0x5a3c28, roughness: 0.9, metalness: 0.25 });
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x6b6a45, roughness: 0.85, metalness: 0.05 });
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const barrelGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.5, 9);
  let placed = 0, tries = 0;
  while (placed < 16 && tries++ < 300) {
    const a = rnd() * Math.PI * 2;
    // ring band between playfield edge and mountains
    const rr = PLAY - 4.5 + rnd() * 4;
    const x = Math.cos(a) * rr * (0.8 + rnd() * 0.25);
    const z = Math.sin(a) * rr * (0.8 + rnd() * 0.25);
    if (Math.max(Math.abs(x), Math.abs(z)) < PLAY - 6) continue;
    // keep clear of spawn corners
    if (Math.hypot(x - MAP.spawns.player.x, z - MAP.spawns.player.z) < 16) continue;
    if (Math.hypot(x - MAP.spawns.enemy.x, z - MAP.spawns.enemy.z) < 16) continue;
    const g = new THREE.Group();
    g.position.set(x, terrainHeight(x, z), z);
    g.rotation.y = rnd() * Math.PI * 2;
    const kind = rnd();
    if (kind < 0.4) { // burned-out husk
      const hull = new THREE.Mesh(boxGeo, charMat);
      hull.scale.set(1.6, 0.5, 1.0); hull.position.y = 0.3;
      const tu = new THREE.Mesh(boxGeo, rustMat);
      tu.scale.set(0.8, 0.34, 0.66); tu.position.set(0.12, 0.62, 0.06); tu.rotation.y = 0.7;
      const brl = new THREE.Mesh(barrelGeo, charMat);
      brl.scale.set(0.3, 2.0, 0.3); brl.rotation.z = 1.2; brl.position.set(0.7, 0.8, 0.3);
      g.add(hull, tu, brl);
    } else if (kind < 0.75) { // crate cluster
      for (let i = 0; i < 3; i++) {
        const cm = new THREE.Mesh(boxGeo, i % 2 ? crateMat : rustMat);
        const s = 0.4 + rnd() * 0.3;
        cm.scale.setScalar(s);
        cm.position.set((rnd() - 0.5) * 1.2, s / 2, (rnd() - 0.5) * 1.2);
        cm.rotation.y = rnd();
        g.add(cm);
      }
    } else { // barrels
      for (let i = 0; i < 3; i++) {
        const bm = new THREE.Mesh(barrelGeo, rustMat);
        bm.position.set((rnd() - 0.5) * 0.9, i === 2 ? 0.25 : 0.25, (rnd() - 0.5) * 0.9);
        if (i === 2) { bm.rotation.z = Math.PI / 2; bm.position.y = 0.18; }
        g.add(bm);
      }
    }
    g.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
    group.add(g);
    placed++;
  }
}

function buildDust() {
  const N = 260;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 120;
    pos[i * 3 + 1] = 0.3 + Math.random() * 7;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 120;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const cv = document.createElement('canvas');
  cv.width = cv.height = 32;
  const c = cv.getContext('2d');
  const gr = c.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,240,210,0.8)');
  gr.addColorStop(1, 'rgba(255,240,210,0)');
  c.fillStyle = gr;
  c.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.PointsMaterial({
    map: tex, size: 0.6, transparent: true, opacity: 0.12,
    depthWrite: false, color: 0xe8d2a8, sizeAttenuation: true,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

/* ── public ─────────────────────────────────────────────────────────────── */
export function createTerrain(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const rnd = mulberry32(20260611);

  const apron = buildApron();
  group.add(apron);
  const ground = buildGround();
  group.add(ground);
  buildMountainRing(group, rnd);
  buildBlockers(group, rnd);
  buildDebris(group, rnd);
  const dust = buildDust();
  group.add(dust);

  return {
    group,
    ground,
    update(dt, time) {
      const p = dust.geometry.attributes.position;
      const arr = p.array;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i] += dt * 1.1;
        arr[i + 1] += Math.sin(time * 0.4 + i) * dt * 0.06;
        if (arr[i] > 62) arr[i] = -62;
      }
      p.needsUpdate = true;
    },
    dispose() {
      scene.remove(group);
    },
  };
}

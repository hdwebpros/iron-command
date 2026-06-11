// ─── IRON COMMAND — battlefield terrain ─────────────────────────────────────
// 14×22 board + apron, canvas-procedural desert textures, silo, capture pads,
// tiberium fields, bases with auto-turrets, rocks, drifting dust.
import * as THREE from 'three';
import { TEAM_COLORS } from './meshes.js';

const GW = 72;   // ground width (x)
const GL = 96;   // ground length (z)
const TEX = 2048;

const PAD_XS = [-4.5, 0, 4.5];
const TIB_FIELDS = [{ x: 5, z: 5 }, { x: -5, z: -5 }];
const BASE_Z = { player: 10, enemy: -10 };

/* ── tiny value noise ───────────────────────────────────────────────────── */
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

/**
 * Terrain displacement. Dead flat across the whole playfield plus a ~2 tile
 * margin (|x|<9, |z|<13); low dunes ramp in smoothly on the outer apron only.
 * Shared by the ground mesh and apron prop/rock placement so things sit on
 * the surface.
 */
function terrainHeight(x, z) {
  const edge = Math.max(Math.abs(x) / 9.0, Math.abs(z) / 13.0);
  const t = smoothstep(1.0, 1.55, edge);
  if (t <= 0) return 0;
  let h = t * (fbm(x * 0.18, z * 0.18) - 0.42) * 1.25;
  h += t * (fbm(x * 0.5 + 31, z * 0.5 + 17) - 0.45) * 0.4;
  return h;
}

/* ── canvas textures ────────────────────────────────────────────────────── */
const W2C = (x, z, S = TEX) => [(x / GW + 0.5) * S, (z / GL + 0.5) * S];

function paintGround() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = TEX;
  const c = cv.getContext('2d');
  const pxPerX = TEX / GW;

  // ── large-scale sand mottle: lighter wind-blown dunes over darker packed
  //    earth, painted per-pixel at low res then upscaled smooth ──
  {
    const MS = 512;
    const mc = document.createElement('canvas');
    mc.width = mc.height = MS;
    const mx = mc.getContext('2d');
    const img = mx.createImageData(MS, MS);
    const d = img.data;
    for (let yy = 0; yy < MS; yy++) {
      const wz = (yy / MS - 0.5) * GL;
      for (let xx = 0; xx < MS; xx++) {
        const wx = (xx / MS - 0.5) * GW;
        const m = fbm(wx * 0.075 + 3.1, wz * 0.075 + 9.7);                                  // broad patches
        const dn = vnoise((wx + wz * 0.4) * 0.14 + 40.2, (wz - wx * 0.3) * 0.04 + 7.7);     // streaky dunes
        const t = Math.max(0, Math.min(1, m * 0.72 + dn * 0.42 - 0.07));
        let r = 142 + t * 80, g = 114 + t * 64, b = 78 + t * 44;
        const v = (fbm(wx * 0.4 + 17.3, wz * 0.4 + 4.4) - 0.5) * 24;                        // mid detail
        r += v; g += v * 0.85; b += v * 0.65;
        const i4 = (yy * MS + xx) * 4;
        d[i4] = r; d[i4 + 1] = g; d[i4 + 2] = b; d[i4 + 3] = 255;
      }
    }
    mx.putImageData(img, 0, 0);
    c.imageSmoothingEnabled = true;
    c.drawImage(mc, 0, 0, TEX, TEX);
  }

  // fine speckle (gravel/grit)
  for (let i = 0; i < 26000; i++) {
    const v = Math.random();
    c.fillStyle = v > 0.5 ? `rgba(236,212,166,${0.03 + Math.random() * 0.07})` : `rgba(56,42,28,${0.03 + Math.random() * 0.07})`;
    c.fillRect(Math.random() * TEX, Math.random() * TEX, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }

  // cracked-earth polylines
  c.strokeStyle = 'rgba(62,46,32,0.22)';
  for (let i = 0; i < 130; i++) {
    c.lineWidth = 0.7 + Math.random() * 1.5;
    let x = Math.random() * TEX, y = Math.random() * TEX;
    c.beginPath();
    c.moveTo(x, y);
    const segs = 4 + (Math.random() * 6) | 0;
    let a = Math.random() * Math.PI * 2;
    for (let s = 0; s < segs; s++) {
      a += (Math.random() - 0.5) * 1.6;
      const len = 10 + Math.random() * 34;
      x += Math.cos(a) * len; y += Math.sin(a) * len;
      c.lineTo(x, y);
    }
    c.stroke();
  }

  // dry scrub tufts — apron only, breaks up the monochrome sand
  {
    const [sx0, sz0] = W2C(-7.6, -11.6);
    const [sx1, sz1] = W2C(7.6, 11.6);
    for (let i = 0; i < 850; i++) {
      const x = Math.random() * TEX, y = Math.random() * TEX;
      if (x > sx0 && x < sx1 && y > sz0 && y < sz1) continue;
      const tone = Math.random();
      c.fillStyle = tone > 0.5
        ? `rgba(96,94,56,${0.25 + Math.random() * 0.3})`
        : `rgba(74,70,44,${0.25 + Math.random() * 0.3})`;
      const n = 2 + (Math.random() * 4) | 0;
      for (let j = 0; j < n; j++) {
        c.beginPath();
        c.ellipse(x + (Math.random() - 0.5) * 9, y + (Math.random() - 0.5) * 9,
          1 + Math.random() * 2.4, 1 + Math.random() * 2.4, 0, 0, Math.PI * 2);
        c.fill();
      }
    }
  }

  // ── slightly darker apron outside the board so the play area pops ──
  {
    const [bx0, bz0] = W2C(-7.4, -11.4);
    const [bx1, bz1] = W2C(7.4, 11.4);
    c.save();
    c.filter = 'blur(14px)';
    c.beginPath();
    c.rect(-40, -40, TEX + 80, TEX + 80);
    c.rect(bx0, bz0, bx1 - bx0, bz1 - bz0);
    c.fillStyle = 'rgba(52,38,26,0.26)';
    c.fill('evenodd');
    c.restore();
    // faint warm lift inside the board + worn boundary line
    c.fillStyle = 'rgba(255,228,178,0.05)';
    c.fillRect(bx0, bz0, bx1 - bx0, bz1 - bz0);
    c.strokeStyle = 'rgba(66,50,34,0.32)';
    c.lineWidth = 3;
    c.strokeRect(bx0, bz0, bx1 - bx0, bz1 - bz0);
  }

  // ── two worn vehicle-track lanes running base-to-base ──
  for (const rx of [-2.6, 2.6]) {
    const [cx] = W2C(rx, 0);
    const [, zTop] = W2C(0, -10.4);
    const [, zBot] = W2C(0, 10.4);
    // packed lighter lane
    const w = 1.35 * pxPerX;
    const gr = c.createLinearGradient(cx - w, 0, cx + w, 0);
    gr.addColorStop(0, 'rgba(172,144,102,0)');
    gr.addColorStop(0.5, 'rgba(176,148,104,0.5)');
    gr.addColorStop(1, 'rgba(172,144,102,0)');
    c.fillStyle = gr;
    c.fillRect(cx - w, zTop, w * 2, zBot - zTop);
    // wheel ruts: paired darker wobbly lines
    for (const off of [-0.58, -0.32, 0.32, 0.58]) {
      const lx = cx + off * pxPerX;
      c.strokeStyle = `rgba(74,57,38,${0.26 + Math.random() * 0.08})`;
      c.lineWidth = 0.14 * pxPerX;
      const wob = Math.random() * 9;
      c.beginPath();
      c.moveTo(lx + Math.sin(zTop * 0.012 + wob) * 4, zTop);
      for (let y = zTop + 14; y <= zBot; y += 14) {
        c.lineTo(lx + Math.sin(y * 0.012 + wob) * 4, y);
      }
      c.stroke();
    }
    // sparse tread dashes across the ruts
    c.fillStyle = 'rgba(70,54,36,0.16)';
    for (let y = zTop; y < zBot; y += 9 + Math.random() * 22) {
      c.fillRect(cx - 0.7 * pxPerX, y, 1.4 * pxPerX, 2.5);
    }
  }

  // ── faint grid-fade marks in the deploy rows (|z| 5..9, x −7..7) ──
  for (const sign of [1, -1]) {
    for (let gx = -7; gx <= 7; gx++) {
      const [lx, ly0] = W2C(gx, sign * 5);
      const [, ly1] = W2C(gx, sign * 9);
      c.strokeStyle = `rgba(238,218,172,${0.045 + Math.random() * 0.04})`;
      c.lineWidth = 1.6;
      c.beginPath();
      c.moveTo(lx, Math.min(ly0, ly1));
      c.lineTo(lx, Math.max(ly0, ly1));
      c.stroke();
    }
    for (let gz = 5; gz <= 9; gz++) {
      const [lx0, ly] = W2C(-7, sign * gz);
      const [lx1] = W2C(7, sign * gz);
      c.strokeStyle = `rgba(238,218,172,${0.045 + Math.random() * 0.04})`;
      c.lineWidth = 1.6;
      c.beginPath();
      c.moveTo(lx0, ly);
      c.lineTo(lx1, ly);
      c.stroke();
    }
  }

  // concrete circle under the silo complex
  {
    const [cx, cy] = W2C(0, 0);
    const r = 3.1 * pxPerX;
    c.fillStyle = '#86837c';
    c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(40,40,40,0.5)';
    c.lineWidth = 3;
    c.beginPath(); c.arc(cx, cy, r - 4, 0, Math.PI * 2); c.stroke();
    // grime
    for (let i = 0; i < 200; i++) {
      const a = Math.random() * Math.PI * 2, rr = Math.random() * r;
      c.fillStyle = `rgba(50,48,44,${0.05 + Math.random() * 0.12})`;
      c.fillRect(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 2 + Math.random() * 4, 2 + Math.random() * 4);
    }
  }

  // scorched ring around the silo
  {
    const [cx, cy] = W2C(0, 0);
    const r = 5.6 * pxPerX;
    const gr = c.createRadialGradient(cx, cy, 2.6 * pxPerX, cx, cy, r);
    gr.addColorStop(0, 'rgba(28,24,20,0.75)');
    gr.addColorStop(0.55, 'rgba(35,28,22,0.35)');
    gr.addColorStop(1, 'rgba(40,32,24,0)');
    c.fillStyle = gr;
    c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
  }

  // pad concrete circles
  for (const px of PAD_XS) {
    const [cx, cy] = W2C(px, 0);
    const r = 1.7 * (TEX / GW);
    c.fillStyle = '#7d7a74';
    c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
  }

  // greenish stain at tiberium fields
  for (const f of TIB_FIELDS) {
    const [cx, cy] = W2C(f.x, f.z);
    const r = 2.2 * pxPerX;
    const gr = c.createRadialGradient(cx, cy, 0, cx, cy, r);
    gr.addColorStop(0, 'rgba(60,120,70,0.4)');
    gr.addColorStop(1, 'rgba(60,120,70,0)');
    c.fillStyle = gr;
    c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
  }

  // base aprons
  for (const bz of [10, -10]) {
    const [cx, cy] = W2C(0, bz);
    c.fillStyle = '#8b8276';
    c.fillRect(cx - 2.6 * pxPerX, cy - 1.8 * pxPerX, 5.2 * pxPerX, 3.6 * pxPerX);
    c.strokeStyle = 'rgba(45,42,38,0.6)';
    c.lineWidth = 2;
    c.strokeRect(cx - 2.6 * pxPerX, cy - 1.8 * pxPerX, 5.2 * pxPerX, 3.6 * pxPerX);
  }
  return cv;
}

function paintRoughness() {
  const S = 1024;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d');
  // base: broad roughness variation following the dune mottle
  {
    const MS = 256;
    const mc = document.createElement('canvas');
    mc.width = mc.height = MS;
    const mx = mc.getContext('2d');
    const img = mx.createImageData(MS, MS);
    const d = img.data;
    for (let yy = 0; yy < MS; yy++) {
      const wz = (yy / MS - 0.5) * GL;
      for (let xx = 0; xx < MS; xx++) {
        const wx = (xx / MS - 0.5) * GW;
        const g = 212 + (fbm(wx * 0.3 + 3.1, wz * 0.3 + 9.7) - 0.5) * 50;
        const i4 = (yy * MS + xx) * 4;
        d[i4] = d[i4 + 1] = d[i4 + 2] = g; d[i4 + 3] = 255;
      }
    }
    mx.putImageData(img, 0, 0);
    c.imageSmoothingEnabled = true;
    c.drawImage(mc, 0, 0, S, S);
  }
  for (let i = 0; i < 9000; i++) {
    const v = (Math.random() * 70) | 0;
    c.fillStyle = `rgba(${150 + v},${150 + v},${150 + v},0.25)`;
    c.fillRect(Math.random() * S, Math.random() * S, 2, 2);
  }
  const [cx, cy] = W2C(0, 0, S);
  // smoother concrete + ashy scorch
  c.fillStyle = '#9a9a9a';
  c.beginPath(); c.arc(cx, cy, 3.1 * (S / GW), 0, Math.PI * 2); c.fill();
  const gr = c.createRadialGradient(cx, cy, 2.6 * (S / GW), cx, cy, 5.6 * (S / GW));
  gr.addColorStop(0, 'rgba(140,140,140,0.6)');
  gr.addColorStop(1, 'rgba(140,140,140,0)');
  c.fillStyle = gr;
  c.beginPath(); c.arc(cx, cy, 5.6 * (S / GW), 0, Math.PI * 2); c.fill();
  // packed track lanes slightly smoother
  for (const rx of [-2.6, 2.6]) {
    const [rcx] = W2C(rx, 0, S);
    const [, rz0] = W2C(0, -10.4, S);
    const [, rz1] = W2C(0, 10.4, S);
    c.fillStyle = 'rgba(170,170,170,0.4)';
    c.fillRect(rcx - 1.35 * (S / GW), rz0, 2.7 * (S / GW), rz1 - rz0);
  }
  // pad concrete
  for (const px of PAD_XS) {
    const [pcx, pcy] = W2C(px, 0, S);
    c.fillStyle = 'rgba(160,160,160,0.7)';
    c.beginPath(); c.arc(pcx, pcy, 1.7 * (S / GW), 0, Math.PI * 2); c.fill();
  }
  return cv;
}

function paintBump() {
  const S = 1024;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d');
  // micro-relief: dune ripples + grit, matching the diffuse mottle
  {
    const MS = 512;
    const mc = document.createElement('canvas');
    mc.width = mc.height = MS;
    const mx = mc.getContext('2d');
    const img = mx.createImageData(MS, MS);
    const d = img.data;
    for (let yy = 0; yy < MS; yy++) {
      const wz = (yy / MS - 0.5) * GL;
      for (let xx = 0; xx < MS; xx++) {
        const wx = (xx / MS - 0.5) * GW;
        let g = 128;
        g += (fbm(wx * 0.6 + 5.2, wz * 0.6 + 2.8) - 0.5) * 58;                                 // soft undulation
        g += (vnoise((wx + wz * 0.4) * 0.9 + 11.1, (wz - wx * 0.3) * 0.25 + 3.3) - 0.5) * 34;  // wind ripples
        g += (vnoise(wx * 3.4 + 23.7, wz * 3.4 + 8.9) - 0.5) * 30;                             // grit
        const i4 = (yy * MS + xx) * 4;
        d[i4] = d[i4 + 1] = d[i4 + 2] = g; d[i4 + 3] = 255;
      }
    }
    mx.putImageData(img, 0, 0);
    c.imageSmoothingEnabled = true;
    c.drawImage(mc, 0, 0, S, S);
  }
  // pebble pips
  for (let i = 0; i < 7000; i++) {
    const v = Math.random();
    c.fillStyle = v > 0.5 ? 'rgba(190,190,190,0.5)' : 'rgba(70,70,70,0.5)';
    c.fillRect(Math.random() * S, Math.random() * S, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  // concrete + pads read flat
  const [cx, cy] = W2C(0, 0, S);
  c.fillStyle = '#808080';
  c.beginPath(); c.arc(cx, cy, 3.1 * (S / GW), 0, Math.PI * 2); c.fill();
  for (const px of PAD_XS) {
    const [pcx, pcy] = W2C(px, 0, S);
    c.beginPath(); c.arc(pcx, pcy, 1.7 * (S / GW), 0, Math.PI * 2); c.fill();
  }
  // pressed-in wheel ruts on the lanes
  for (const rx of [-2.6, 2.6]) {
    const [rcx] = W2C(rx, 0, S);
    const [, rz0] = W2C(0, -10.4, S);
    const [, rz1] = W2C(0, 10.4, S);
    for (const off of [-0.45, 0.45]) {
      c.fillStyle = 'rgba(80,80,80,0.45)';
      c.fillRect(rcx + (off - 0.1) * (S / GW), rz0, 0.2 * (S / GW), rz1 - rz0);
    }
  }
  return cv;
}

/* ── shared static materials/geos ───────────────────────────────────────── */
const concreteMat = new THREE.MeshStandardMaterial({ color: 0x8d8a82, roughness: 0.85, metalness: 0.08 });
const concreteDark = new THREE.MeshStandardMaterial({ color: 0x6b6963, roughness: 0.9, metalness: 0.05 });
const padMetal = new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.45, metalness: 0.7 });
const padDeck = new THREE.MeshStandardMaterial({ color: 0x33373c, roughness: 0.6, metalness: 0.55 });
const rockMat = new THREE.MeshStandardMaterial({ color: 0x86796a, roughness: 0.95, metalness: 0.02 });
const tibMat = new THREE.MeshStandardMaterial({ color: 0x0c2415, emissive: 0x35ff7a, emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.1 });
const doorMat = new THREE.MeshStandardMaterial({ color: 0x5d6066, roughness: 0.5, metalness: 0.6 });
const warnMat = new THREE.MeshStandardMaterial({ color: 0x220a08, emissive: 0xff3422, emissiveIntensity: 1.5 });
// angular apron boulders: icosahedra with deterministic per-vertex jitter
// (jitter keyed off vertex position so duplicated verts stay welded)
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
const ROCK_MATS = [0x8a7a64, 0x95826a, 0x7c6e5d, 0x8e7a6e].map(
  (col) => new THREE.MeshStandardMaterial({ color: col, roughness: 0.95, metalness: 0.02, flatShading: true }),
);
// apron props
const crateMat = new THREE.MeshStandardMaterial({ color: 0x6b6a45, roughness: 0.85, metalness: 0.05 });
const crateDarkMat = new THREE.MeshStandardMaterial({ color: 0x4d4c33, roughness: 0.85, metalness: 0.05 });
const charMat = new THREE.MeshStandardMaterial({ color: 0x26221e, roughness: 0.95, metalness: 0.12 });
const rustMat = new THREE.MeshStandardMaterial({ color: 0x5a3c28, roughness: 0.9, metalness: 0.25 });
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const barrelGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.42, 10);
const crystalGeos = [
  new THREE.ConeGeometry(0.13, 0.55, 5),
  new THREE.ConeGeometry(0.2, 0.9, 5),
  new THREE.ConeGeometry(0.09, 0.35, 5),
];

function teamGlowMat(side) {
  return new THREE.MeshStandardMaterial({
    color: 0x0a0a0a, emissive: TEAM_COLORS[side] ?? 0x888888, emissiveIntensity: 2.0,
  });
}

/* ── builders ───────────────────────────────────────────────────────────── */
function buildGround() {
  const geo = new THREE.PlaneGeometry(GW, GL, 110, 144);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const wz = -pos.getY(i);
    pos.setZ(i, terrainHeight(x, wz));
  }
  geo.computeVertexNormals();
  geo.rotateX(-Math.PI / 2);

  const diff = new THREE.CanvasTexture(paintGround());
  diff.colorSpace = THREE.SRGBColorSpace;
  diff.anisotropy = 8;
  const rough = new THREE.CanvasTexture(paintRoughness());
  const bump = new THREE.CanvasTexture(paintBump());
  const mat = new THREE.MeshStandardMaterial({
    map: diff,
    roughnessMap: rough,
    roughness: 1.0,
    metalness: 0.0,
    bumpMap: bump,
    bumpScale: 0.45,
  });
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  m.userData.isGround = true;
  return m;
}

function buildPad(x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.5, 0.14, 24), padMetal);
  base.position.y = 0.07;
  base.receiveShadow = true;
  g.add(base);
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.06, 24), padDeck);
  deck.position.y = 0.16;
  deck.receiveShadow = true;
  g.add(deck);
  // owner ring (emissive torus)
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x101113, emissive: 0x9aa0a6, emissiveIntensity: 0.35, roughness: 0.4, metalness: 0.5 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.05, 8, 36), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.18;
  g.add(ring);
  // capture-progress arc segments
  const segMat = new THREE.MeshBasicMaterial({ color: 0xffc24d });
  const segGeo = new THREE.BoxGeometry(0.07, 0.04, 0.2);
  const segs = [];
  const N = 22;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const s = new THREE.Mesh(segGeo, segMat);
    s.position.set(Math.sin(a) * 0.88, 0.21, Math.cos(a) * 0.88);
    s.rotation.y = a;
    s.visible = false;
    g.add(s);
    segs.push(s);
  }
  // small corner posts
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.08), padMetal);
    p.position.set(Math.sin(a) * 1.32, 0.15, Math.cos(a) * 1.32);
    p.castShadow = true;
    g.add(p);
  }
  return { group: g, ringMat, segMat, segs };
}

function buildSilo() {
  const g = new THREE.Group();
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.5, 0.5, 8), concreteMat);
  pad.position.y = 0.25;
  pad.castShadow = pad.receiveShadow = true;
  g.add(pad);
  const lip = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.55, 0.1, 18), concreteDark);
  lip.position.y = 0.53;
  g.add(lip);
  // blast doors (two sliding halves)
  const doorGeo = new THREE.BoxGeometry(1.18, 0.1, 2.36);
  const dL = new THREE.Mesh(doorGeo, doorMat);
  const dR = new THREE.Mesh(doorGeo, doorMat);
  dL.position.set(-0.6, 0.56, 0);
  dR.position.set(0.6, 0.56, 0);
  dL.castShadow = dR.castShadow = true;
  g.add(dL, dR);
  // hazard chevrons
  const hzMat = new THREE.MeshStandardMaterial({ color: 0xb98a23, roughness: 0.7 });
  for (const sx of [-1, 1]) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.105, 2.3), hzMat);
    stripe.position.set(sx * 1.12, 0.565, 0);
    g.add(stripe);
  }
  // warning beacons
  const warnLights = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.5, 6), padMetal);
    post.position.set(Math.sin(a) * 2.05, 0.7, Math.cos(a) * 2.05);
    post.castShadow = true;
    g.add(post);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), warnMat.clone());
    lamp.position.set(Math.sin(a) * 2.05, 0.98, Math.cos(a) * 2.05);
    g.add(lamp);
    warnLights.push(lamp.material);
  }
  // vents / pipes
  for (const [vx, vz] of [[-1.7, 1.0], [1.7, -1.0], [1.4, 1.5]]) {
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.4), concreteDark);
    v.position.set(vx, 0.65, vz);
    v.castShadow = true;
    g.add(v);
  }
  return { group: g, doors: [dL, dR], warnLights };
}

function buildBase(side) {
  const g = new THREE.Group();
  g.position.set(0, 0, BASE_Z[side]);
  // build facing +z; player base (at z=+10) faces -z toward center
  const rotY = side === 'player' ? Math.PI : 0;
  g.rotation.y = rotY;
  const glow = teamGlowMat(side);
  const trim = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.5, metalness: 0.5, emissive: TEAM_COLORS[side], emissiveIntensity: 1.0 });

  const slab = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.16, 3.0), concreteMat);
  slab.position.y = 0.08;
  slab.receiveShadow = true;
  g.add(slab);

  const bunker = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.95, 1.7), concreteDark);
  bunker.position.set(0.5, 0.62, -0.3);
  bunker.castShadow = bunker.receiveShadow = true;
  g.add(bunker);
  // sloped sides
  for (const sx of [-1, 1]) {
    const sl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 1.7), concreteMat);
    sl.position.set(0.5 + sx * 1.5, 0.45, -0.3);
    sl.rotation.z = -sx * 0.45;
    sl.castShadow = true;
    g.add(sl);
  }
  // door + window band in team color
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.04), glow);
  door.position.set(0.5, 0.42, 0.56);
  g.add(door);
  const band = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.1, 0.03), trim);
  band.position.set(0.5, 0.95, 0.56);
  g.add(band);

  // command tower
  const tower = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.9, 1.1), concreteMat);
  tower.position.set(-1.35, 1.05, -0.5);
  tower.castShadow = tower.receiveShadow = true;
  g.add(tower);
  for (let i = 0; i < 3; i++) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.1, 0.03), glow);
    win.position.set(-1.35, 0.85 + i * 0.42, 0.07);
    g.add(win);
  }
  // antenna + beacon
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.035, 1.7, 6), padMetal);
  mast.position.set(-1.35, 2.85, -0.5);
  mast.castShadow = true;
  g.add(mast);
  const beaconMat = teamGlowMat(side);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), beaconMat);
  beacon.position.set(-1.35, 3.72, -0.5);
  g.add(beacon);
  // radar dish (spins)
  const radar = new THREE.Group();
  radar.position.set(1.3, 1.2, -0.6);
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 14), padMetal);
  dish.rotation.x = 1.1;
  dish.position.y = 0.18;
  dish.castShadow = true;
  radar.add(dish);
  const rpost = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.35, 8), padDeck);
  radar.add(rpost);
  g.add(radar);

  // auto-defense turret on a forward mount
  const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.55, 10), concreteDark);
  mount.position.set(0.2, 0.35, 1.05);
  mount.castShadow = true;
  g.add(mount);
  const turret = new THREE.Group();
  turret.position.set(0.2, 0.72, 1.05);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.24, 0.5), padMetal);
  head.castShadow = true;
  turret.add(head);
  for (const bx of [-0.08, 0.08]) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.6, 6), padDeck);
    b.rotation.x = Math.PI / 2;
    b.position.set(bx, 0.02, 0.5);
    turret.add(b);
  }
  const tglow = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.04), trim);
  tglow.position.set(0, 0.13, 0.2);
  turret.add(tglow);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, 0.82);
  turret.add(muzzle);
  g.add(turret);

  // sandbag arc out front
  for (let i = 0; i < 5; i++) {
    const a = (i - 2) * 0.4;
    const sb = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.3, 3, 6), rockMat);
    sb.rotation.z = Math.PI / 2;
    sb.rotation.y = a;
    sb.position.set(Math.sin(a) * 2.2 + 0.2, 0.12, Math.cos(a) * 1.0 + 1.6);
    sb.castShadow = true;
    g.add(sb);
  }
  return { group: g, turret, muzzle, rotY, beaconMat, radar };
}

function buildTiberium(x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  for (let i = 0; i < 13; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.pow(Math.random(), 0.6) * 1.5;
    const cr = new THREE.Mesh(crystalGeos[(Math.random() * crystalGeos.length) | 0], tibMat);
    const s = 0.6 + Math.random() * 1.1;
    cr.scale.set(s, s, s);
    cr.position.set(Math.cos(a) * r, 0.1 * s, Math.sin(a) * r);
    cr.rotation.set((Math.random() - 0.5) * 0.7, Math.random() * Math.PI, (Math.random() - 0.5) * 0.7);
    cr.castShadow = true;
    g.add(cr);
  }
  const light = new THREE.PointLight(0x46ff7d, 1.4, 6, 2);
  light.position.set(0, 0.9, 0);
  g.add(light);
  return g;
}

function buildRocks(group) {
  // sparse angular boulders on the apron only — never on the board (+margin)
  let placed = 0, tries = 0;
  while (placed < 24 && tries++ < 400) {
    const x = (Math.random() - 0.5) * (GW - 6);
    const z = (Math.random() - 0.5) * (GL - 6);
    if (Math.abs(x) < 10 && Math.abs(z) < 14) continue;
    const rk = new THREE.Mesh(
      ROCK_GEOS[(Math.random() * ROCK_GEOS.length) | 0],
      ROCK_MATS[(Math.random() * ROCK_MATS.length) | 0],
    );
    const s = 0.35 + Math.pow(Math.random(), 1.6) * 1.7;
    rk.scale.set(s * (0.75 + Math.random() * 0.5), s * (0.55 + Math.random() * 0.45), s * (0.75 + Math.random() * 0.5));
    rk.position.set(x, terrainHeight(x, z) + s * 0.18, z);
    rk.rotation.set((Math.random() - 0.5) * 0.5, Math.random() * Math.PI, (Math.random() - 0.5) * 0.5);
    rk.castShadow = rk.receiveShadow = true;
    group.add(rk);
    placed++;
    // occasional smaller companion stones
    if (Math.random() < 0.4) {
      const n = 1 + (Math.random() * 2) | 0;
      for (let j = 0; j < n; j++) {
        const cx = x + (Math.random() - 0.5) * 3.2;
        const cz = z + (Math.random() - 0.5) * 3.2;
        if (Math.abs(cx) < 10 && Math.abs(cz) < 14) continue;
        const sm = new THREE.Mesh(
          ROCK_GEOS[(Math.random() * ROCK_GEOS.length) | 0],
          ROCK_MATS[(Math.random() * ROCK_MATS.length) | 0],
        );
        const ss = 0.15 + Math.random() * 0.35;
        sm.scale.set(ss, ss * 0.7, ss);
        sm.position.set(cx, terrainHeight(cx, cz) + ss * 0.2, cz);
        sm.rotation.y = Math.random() * Math.PI;
        sm.castShadow = true;
        group.add(sm);
      }
    }
  }
}

/* ── apron props: burned-out husks + supply crates ──────────────────────── */
function buildHusk(x, z, rot) {
  const g = new THREE.Group();
  g.position.set(x, terrainHeight(x, z), z);
  g.rotation.y = rot;
  g.rotation.z = 0.07;
  const hull = new THREE.Mesh(boxGeo, charMat);
  hull.scale.set(1.5, 0.46, 0.92);
  hull.position.y = 0.28;
  const turret = new THREE.Mesh(boxGeo, rustMat);
  turret.scale.set(0.72, 0.3, 0.6);
  turret.position.set(0.12, 0.58, 0.08);
  turret.rotation.y = 0.7;
  turret.rotation.x = -0.08;
  const barrel = new THREE.Mesh(barrelGeo, charMat);
  barrel.scale.set(0.32, 2.4, 0.32);
  barrel.rotation.z = 1.18; // snapped, pointing up-and-out
  barrel.rotation.y = 0.7;
  barrel.position.set(0.62, 0.74, 0.32);
  const trackL = new THREE.Mesh(boxGeo, charMat);
  trackL.scale.set(1.6, 0.22, 0.26);
  trackL.position.set(0, 0.11, 0.52);
  const trackR = trackL.clone();
  trackR.position.z = -0.52;
  trackR.rotation.y = 0.06; // blown half off
  for (const m of [hull, turret, barrel, trackL, trackR]) {
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

function buildCrates(x, z) {
  const g = new THREE.Group();
  g.position.set(x, terrainHeight(x, z), z);
  g.rotation.y = Math.random() * Math.PI;
  const sizes = [[0.5, 0, 0, 0], [0.4, 0.62, 0.1, 0.4], [0.34, -0.18, 0.55, -0.3], [0.36, 0.18, 0.5, 0.9]];
  sizes.forEach(([s, ox, oz, ry], i) => {
    const m = new THREE.Mesh(boxGeo, i % 2 ? crateDarkMat : crateMat);
    m.scale.setScalar(s);
    m.position.set(ox, s / 2, oz);
    m.rotation.y = ry;
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  });
  // one crate stacked on the big one
  const top = new THREE.Mesh(boxGeo, crateDarkMat);
  top.scale.setScalar(0.34);
  top.position.set(0.02, 0.5 + 0.17, -0.03);
  top.rotation.y = 0.35;
  top.castShadow = true;
  g.add(top);
  const barrel = new THREE.Mesh(barrelGeo, rustMat);
  barrel.position.set(-0.55, 0.21, 0.45);
  barrel.castShadow = true;
  g.add(barrel);
  return g;
}

function buildProps(group) {
  group.add(buildHusk(10.8, 3.4, 2.3));
  group.add(buildHusk(-10.5, -6.2, -0.8));
  group.add(buildCrates(3.6, 12.6));   // behind player base
  group.add(buildCrates(-3.4, -12.6)); // behind enemy base
}

function buildDust() {
  const N = 220;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 44;
    pos[i * 3 + 1] = 0.2 + Math.random() * 5;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 50;
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
    map: tex, size: 0.35, transparent: true, opacity: 0.13,
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

  const ground = buildGround();
  group.add(ground);

  const pads = PAD_XS.map((x) => buildPad(x, 0));
  pads.forEach((p) => group.add(p.group));

  const silo = buildSilo();
  group.add(silo.group);

  const bases = { player: buildBase('player'), enemy: buildBase('enemy') };
  group.add(bases.player.group, bases.enemy.group);

  const tibs = TIB_FIELDS.map((f) => buildTiberium(f.x, f.z));
  tibs.forEach((t) => group.add(t));

  buildRocks(group);
  buildProps(group);

  const dust = buildDust();
  group.add(dust);

  let siloTimer = 0; // >0 while door cycle in progress

  const api = {
    group,
    ground,
    bases,
    siloPos: { x: 0, z: 0 },

    /** Trigger blast-door open/close cycle (≈8 s). */
    openSilo() { siloTimer = 8; },

    /** Sync pad ring colors + capture progress arcs from state.pads. */
    updatePads(padsState) {
      if (!Array.isArray(padsState)) return;
      for (let i = 0; i < padsState.length; i++) {
        const ps = padsState[i];
        if (!ps) continue;
        // match by x position when available, else by index
        let pad = pads[i];
        if (Number.isFinite(ps.x)) {
          let bd = Infinity;
          for (let j = 0; j < pads.length; j++) {
            const d = Math.abs(pads[j].group.position.x - ps.x);
            if (d < bd) { bd = d; pad = pads[j]; }
          }
        }
        if (!pad) continue;
        const owner = ps.owner === 'player' || ps.owner === 'enemy' ? ps.owner : null;
        const col = owner ? TEAM_COLORS[owner] : 0x9aa0a6;
        pad.ringMat.emissive.setHex(col);
        pad.ringMat.emissiveIntensity = owner ? 1.9 : 0.35;
        let prog = Number(ps.progress) || 0;
        if (prog > 1.01) prog /= 3; // tolerate 0..3s convention
        prog = Math.min(1, Math.max(0, prog));
        const n = Math.round(prog * pad.segs.length);
        for (let s = 0; s < pad.segs.length; s++) pad.segs[s].visible = s < n && prog < 0.999;
      }
    },

    update(dt, time, state) {
      // dust drift
      const p = dust.geometry.attributes.position;
      const arr = p.array;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i] += dt * 0.55;
        arr[i + 1] += Math.sin(time * 0.4 + i) * dt * 0.05;
        if (arr[i] > 23) arr[i] = -23;
      }
      p.needsUpdate = true;

      // tiberium pulse
      tibMat.emissiveIntensity = 1.45 + Math.sin(time * 2.1) * 0.45;

      // base beacons + radar
      for (const s of ['player', 'enemy']) {
        const b = bases[s];
        b.beaconMat.emissiveIntensity = 1.6 + Math.sin(time * 3 + (s === 'enemy' ? 2 : 0)) * 1.4;
        b.radar.rotation.y += dt * 0.8;
      }

      // silo warning lights pulse with nuke charge
      const charge = Math.max(state?.nuke?.player || 0, state?.nuke?.enemy || 0) / 100;
      const pulse = charge > 0.01 ? (0.4 + charge * 2.2) * (0.6 + 0.4 * Math.sin(time * (2 + charge * 8))) : 0.25;
      for (const m of silo.warnLights) m.emissiveIntensity = pulse;

      // blast doors
      if (siloTimer > 0) {
        siloTimer -= dt;
        const t = 8 - siloTimer;
        let open;
        if (t < 1.2) open = t / 1.2;
        else if (siloTimer < 1.5) open = Math.max(0, siloTimer / 1.5);
        else open = 1;
        const off = 0.6 + open * 1.05;
        silo.doors[0].position.x = -off;
        silo.doors[1].position.x = off;
      }
    },

    dispose() {
      scene.remove(group);
    },
  };
  return api;
}

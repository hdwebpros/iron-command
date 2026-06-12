// ─── FREEDOM FIGHT — entity mesh factory ─────────────────────────────────────
// Primitive-composed meshes for EVERY canonical (faction, key) in DESIGN §13.5.
// All geometries & most materials are cached at module scope — never rebuilt
// per spawn. Per-instance clones only where state needs it (power glow, flags).
// Keys listed in models.js MODEL_DEFS use loaded CC0 models instead; the
// procedural builder remains the fallback while those load (and for husks
// spawned before the swap).
import * as THREE from 'three';
import { createModelMesh } from './models.js';

export const FACTION_COLORS = { coalition: 0x2e7bff, dominion: 0xe03c2e, syndicate: 0x3da64b, neutral: 0xd8b04a };
export const SIDE_COLORS = { player: 0x3da0ff, enemy: 0xff5238, neutral: 0xffd84d };

/* ── caches ─────────────────────────────────────────────────────────────── */
const GEOS = new Map();
const MATS = new Map();
function G(key, make) { let g = GEOS.get(key); if (!g) { g = make(); GEOS.set(key, g); } return g; }
function M(key, props) { let m = MATS.get(key); if (!m) { m = new THREE.MeshStandardMaterial(props); MATS.set(key, m); } return m; }

const box  = (w, h, d)           => G(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
const cyl  = (rt, rb, h, s = 10) => G(`c${rt}|${rb}|${h}|${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s));
const sph  = (r, s = 10)         => G(`s${r}|${s}`, () => new THREE.SphereGeometry(r, s, Math.max(5, s - 3)));
const cone = (r, h, s = 8)       => G(`k${r}|${h}|${s}`, () => new THREE.ConeGeometry(r, h, s));
const capg = (r, l, s = 8)       => G(`p${r}|${l}|${s}`, () => new THREE.CapsuleGeometry(r, l, 3, s));
const tor  = (r, t, s = 24)      => G(`t${r}|${t}|${s}`, () => new THREE.TorusGeometry(r, t, 8, s));
const hingeBox = (w, h, d) => G(`hb${w}|${h}|${d}`, () => { const g = new THREE.BoxGeometry(w, h, d); g.translate(0, -h / 2, 0); return g; });
// jittered rock (icosahedron) — deterministic per seed
function rockGeo(seed) {
  return G(`rock${seed}`, () => {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
      let n = Math.sin(vx * 5.1 + seed * 13.7) * 0.5 + Math.sin(vy * 3.7 + vz * 4.3 + seed * 7.1) * 0.5;
      const m = 0.78 + (n * 0.5 + 0.5) * 0.5;
      p.setXYZ(i, vx * m, vy * m * 0.8, vz * m);
    }
    g.computeVertexNormals();
    return g;
  });
}

/* ── faction palettes ───────────────────────────────────────────────────── */
function pal(f) {
  switch (f) {
    case 'coalition': return {
      hull:  M('co_hull',  { color: 0xb8c2c9, roughness: 0.55, metalness: 0.35 }),
      panel: M('co_panel', { color: 0xe3e8eb, roughness: 0.45, metalness: 0.2 }),
      dark:  M('co_dark',  { color: 0x3e474f, roughness: 0.6, metalness: 0.45 }),
      metal: M('co_metal', { color: 0x8a949c, roughness: 0.35, metalness: 0.7 }),
      track: M('co_track', { color: 0x23262a, roughness: 0.95, metalness: 0.1 }),
      glass: M('co_glass', { color: 0x0c1c2a, roughness: 0.1, metalness: 0.6, emissive: 0x4fc3ff, emissiveIntensity: 0.85 }),
      glow:  M('co_glow',  { color: 0x06121f, emissive: 0x4fa8ff, emissiveIntensity: 2.2 }),
      barrel:M('co_barrel',{ color: 0x2e353b, roughness: 0.35, metalness: 0.75 }),
      cloth: M('co_cloth', { color: 0x77806f, roughness: 0.95, metalness: 0 }),
      skin:  M('skin',     { color: 0xc59a76, roughness: 0.9, metalness: 0 }),
    };
    case 'dominion': return {
      hull:  M('do_hull',  { color: 0x97342a, roughness: 0.6, metalness: 0.3 }),
      panel: M('do_panel', { color: 0x6c241c, roughness: 0.65, metalness: 0.25 }),
      dark:  M('do_dark',  { color: 0x2c2f34, roughness: 0.55, metalness: 0.5 }),
      metal: M('do_metal', { color: 0x595f66, roughness: 0.4, metalness: 0.7 }),
      track: M('do_track', { color: 0x1e2023, roughness: 0.95, metalness: 0.1 }),
      glass: M('do_glass', { color: 0x241007, roughness: 0.15, metalness: 0.5, emissive: 0xffb14d, emissiveIntensity: 0.7 }),
      glow:  M('do_glow',  { color: 0x1c0703, emissive: 0xff5238, emissiveIntensity: 2.2 }),
      star:  M('do_star',  { color: 0x6b4a12, roughness: 0.35, metalness: 0.75, emissive: 0xffc23d, emissiveIntensity: 0.55 }),
      barrel:M('do_barrel',{ color: 0x26292d, roughness: 0.4, metalness: 0.75 }),
      cloth: M('do_cloth', { color: 0x6f5640, roughness: 0.95, metalness: 0 }),
      skin:  M('skin',     { color: 0xc59a76, roughness: 0.9, metalness: 0 }),
    };
    case 'syndicate': return {
      hull:  M('sy_hull',  { color: 0xb29a64, roughness: 0.8, metalness: 0.2 }),
      panel: M('sy_panel', { color: 0x8c7549, roughness: 0.85, metalness: 0.15 }),
      dark:  M('sy_dark',  { color: 0x483f33, roughness: 0.8, metalness: 0.25 }),
      metal: M('sy_metal', { color: 0x7b725d, roughness: 0.6, metalness: 0.5 }),
      track: M('sy_track', { color: 0x2a261f, roughness: 0.95, metalness: 0.1 }),
      glass: M('sy_glass', { color: 0x131a0c, roughness: 0.25, metalness: 0.4, emissive: 0x9add66, emissiveIntensity: 0.5 }),
      glow:  M('sy_glow',  { color: 0x06140a, emissive: 0x55d96e, emissiveIntensity: 2.0 }),
      tarp:  M('sy_tarp',  { color: 0x6e7042, roughness: 0.95, metalness: 0 }),
      rust:  M('sy_rust',  { color: 0x6e4626, roughness: 0.85, metalness: 0.3 }),
      barrel:M('sy_barrel',{ color: 0x3a352b, roughness: 0.55, metalness: 0.6 }),
      cloth: M('sy_cloth', { color: 0x96825a, roughness: 0.95, metalness: 0 }),
      skin:  M('skin2',    { color: 0xb08458, roughness: 0.9, metalness: 0 }),
    };
    default: return { // neutral / world
      hull:  M('nu_conc',  { color: 0x9a948a, roughness: 0.85, metalness: 0.05 }),
      panel: M('nu_conc2', { color: 0x7e786e, roughness: 0.9, metalness: 0.05 }),
      dark:  M('nu_dark',  { color: 0x4e4a44, roughness: 0.85, metalness: 0.15 }),
      metal: M('nu_metal', { color: 0x6f6a60, roughness: 0.5, metalness: 0.6 }),
      track: M('nu_dark',  { color: 0x4e4a44, roughness: 0.85, metalness: 0.15 }),
      glass: M('nu_glass', { color: 0x14110c, roughness: 0.4, metalness: 0.2 }),
      glow:  M('nu_glow',  { color: 0x231b04, emissive: 0xffd84d, emissiveIntensity: 1.6 }),
      gold:  M('nu_gold',  { color: 0xc8a23e, roughness: 0.45, metalness: 0.55, emissive: 0x553f08, emissiveIntensity: 0.4 }),
      wood:  M('nu_wood',  { color: 0x7c5c38, roughness: 0.95, metalness: 0 }),
      rust:  M('nu_rust',  { color: 0x6e4626, roughness: 0.85, metalness: 0.3 }),
      cloth: M('nu_cloth', { color: 0x8a8270, roughness: 0.95, metalness: 0 }),
      skin:  M('skin',     { color: 0xc59a76, roughness: 0.9, metalness: 0 }),
    };
  }
}
const charMat  = () => M('char',  { color: 0x231f1b, roughness: 0.95, metalness: 0.2 });
const charMat2 = () => M('char2', { color: 0x3a3028, roughness: 0.9, metalness: 0.25 });
const sandbag  = () => M('sbag',  { color: 0x8d7e62, roughness: 0.95, metalness: 0 });
const tireMat  = () => M('tire',  { color: 0x17191b, roughness: 0.95, metalness: 0.05 });
const concPad  = () => M('cpad',  { color: 0x8d8a82, roughness: 0.85, metalness: 0.08 });
const hazMat   = () => M('haz',   { color: 0xb9871f, roughness: 0.7, metalness: 0.2 });
const sideMat  = (side) => M('side_' + side, { color: 0x0a0a0a, emissive: SIDE_COLORS[side] ?? 0xffd84d, emissiveIntensity: 2.0 });
const flagBase = (side) => M('flagb_' + side, { color: 0x222222, emissive: SIDE_COLORS[side] ?? 0xffd84d, emissiveIntensity: 0.9, side: THREE.DoubleSide });

/* ── tiny builder helpers ───────────────────────────────────────────────── */
function mk(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, noShadow = false) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (rx || ry || rz) m.rotation.set(rx, ry, rz);
  if (noShadow) m.userData.noShadow = true;
  parent.add(m);
  return m;
}
// glow mesh that participates in the power-state dimming (per-instance clone later)
function pw(mesh) { mesh.userData.pw = true; return mesh; }

function treads(g, m, halfW, h, len) {
  mk(g, box(0.26, h, len), m.track, -halfW, h / 2, 0);
  mk(g, box(0.26, h, len), m.track, halfW, h / 2, 0);
}
function wheels4(g, m, hw, r, zs) {
  const list = [];
  const wg = cyl(r, r, 0.14, 10);
  for (const zz of zs) for (const xx of [-hw, hw]) list.push(mk(g, wg, tireMat(), xx, r, zz, 0, 0, Math.PI / 2));
  return list;
}
function sideLamp(g, side, x, y, z, s = 0.1) {
  return mk(g, box(s, s * 0.4, s), sideMat(side), x, y, z, 0, 0, 0, true);
}
function dish(g, m, x, y, z, r, tilt = 1.0) {
  const grp = new THREE.Group();
  grp.position.set(x, y, z);
  mk(grp, cyl(0.05, 0.07, 0.3, 8), m.metal, 0, 0.0, 0);
  const d = mk(grp, cyl(r, r * 0.55, r * 0.28, 14), m.panel, 0, 0.26, 0);
  d.rotation.x = tilt;
  mk(grp, cyl(0.02, 0.02, r * 0.9, 6), m.metal, 0, 0.26 + Math.sin(tilt) * r * 0.3, Math.cos(tilt) * r * 0.3, tilt);
  g.add(grp);
  return grp;
}
function smokestack(g, m, x, z, h, r = 0.16) {
  mk(g, cyl(r * 0.82, r, h, 10), m.dark, x, h / 2, z);
  mk(g, cyl(r * 0.9, r * 0.86, 0.08, 10), m.metal, x, h - 0.04, z);
  return { x, y: h + 0.05, z };
}
function flagpole(g, side, x, z, h = 1.6) {
  mk(g, cyl(0.025, 0.035, h, 6), M('pole', { color: 0x666b70, roughness: 0.4, metalness: 0.7 }), x, h / 2, z);
  const fm = flagBase(side).clone();
  const flagG = G('flag', () => { const ge = new THREE.PlaneGeometry(0.55, 0.32, 4, 1); ge.translate(0.275, 0, 0); return ge; });
  const flag = new THREE.Mesh(flagG, fm);
  flag.position.set(x, h - 0.22, z);
  flag.userData.noShadow = true;
  g.add(flag);
  return { o: flag, mat: fm };
}
function scaffoldPoles(g, m, w, d, h) {
  const pg = cyl(0.04, 0.04, h, 6);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
    mk(g, pg, m.metal, sx * w / 2, h / 2, sz * d / 2);
}
function junkPile(g, m, x, z, s = 1) {
  const r = mk(g, rockGeo(7), m.rust || m.dark, x, 0.18 * s, z);
  r.scale.set(0.5 * s, 0.3 * s, 0.5 * s);
  mk(g, box(0.3 * s, 0.08 * s, 0.4 * s), m.dark, x + 0.2 * s, 0.32 * s, z - 0.1 * s, 0.3, 0.7, 0.2);
  mk(g, cyl(0.09 * s, 0.09 * s, 0.3 * s, 8), m.rust || m.metal, x - 0.25 * s, 0.12 * s, z + 0.2 * s, 1.4, 0, 0.3);
}
function spikes(g, m, cx, cz, r, n = 5) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.4;
    mk(g, cone(0.05, 0.5, 5), m.dark, cx + Math.cos(a) * r, 0.25, cz + Math.sin(a) * r, (Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5);
  }
}
function star(g, m, x, y, z, s = 0.3, rx = 0) {
  // 5-point star built from 2 cones — reads as a star emblem at RTS distance
  const grp = new THREE.Group();
  grp.position.set(x, y, z); grp.rotation.x = rx;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const c = mk(grp, cone(s * 0.22, s, 4), m.star || m.glow, Math.sin(a) * s * 0.32, Math.cos(a) * s * 0.32, 0);
    c.rotation.z = -a + Math.PI;
    c.userData.noShadow = true;
  }
  g.add(grp);
  return grp;
}

/* ════════════════════════ INFANTRY ══════════════════════════════════════ */
// single articulated figure ~0.78 tall, faces +z
function soldier(m, side, opts = {}) {
  const g = new THREE.Group();
  const fat = opts.dark ? M('inf_dark', { color: 0x32363c, roughness: 0.85, metalness: 0.1 })
    : opts.fatigues || m.cloth;
  const fat2 = opts.dark ? M('inf_dark2', { color: 0x24272c, roughness: 0.85, metalness: 0.1 }) : m.dark;
  const legs = [];
  const lg = hingeBox(0.07, 0.24, 0.07);
  legs.push({ o: mk(g, lg, fat2, -0.065, 0.24, 0), ph: 0, amp: 0.6, hz: 8 });
  legs.push({ o: mk(g, lg, fat2, 0.065, 0.24, 0), ph: Math.PI, amp: 0.6, hz: 8 });
  mk(g, capg(0.105, 0.18), fat, 0, 0.42, 0);                         // torso
  mk(g, box(0.24, 0.06, 0.14), fat2, 0, 0.32, 0);                    // belt
  mk(g, box(0.18, 0.14, 0.08), fat2, 0, 0.47, -0.1);                 // pack
  mk(g, sph(0.075, 8), opts.dark ? fat : m.skin, 0, 0.62, 0);        // head
  if (opts.wrap) mk(g, cyl(0.082, 0.082, 0.07, 8), m.cloth, 0, 0.64, 0);
  else mk(g, cyl(0.085, 0.1, 0.07, 8), opts.dark ? fat2 : M('helm_' + (opts.helm || 'a'), { color: opts.helmCol ?? 0x4d513e, roughness: 0.8, metalness: 0.15 }), 0, 0.665, 0);
  if (opts.visor) pw(mk(g, box(0.1, 0.03, 0.02), m.glow, 0, 0.63, 0.07, 0, 0, 0, true));
  sideLamp(g, side, -0.12, 0.52, 0, 0.06);                           // shoulder pip
  switch (opts.role) {
    case 'launcher':
      mk(g, cyl(0.045, 0.045, 0.5, 8), m.barrel, 0.12, 0.58, -0.03, Math.PI / 2);
      mk(g, cyl(0.06, 0.06, 0.1, 8), m.metal, 0.12, 0.58, 0.2, Math.PI / 2);
      break;
    case 'sniper':
      mk(g, box(0.03, 0.05, 0.52), m.barrel, 0.09, 0.42, 0.12);
      mk(g, cyl(0.025, 0.025, 0.1, 6), m.dark, 0.09, 0.47, 0.1, Math.PI / 2);
      if (opts.cape) mk(g, box(0.26, 0.34, 0.04), m.cloth, 0, 0.42, -0.16, 0.12);
      break;
    case 'tool':
      mk(g, box(0.035, 0.4, 0.035), m.wood || m.dark, 0.13, 0.4, 0.05, 0, 0, 0.2);
      mk(g, box(0.1, 0.08, 0.02), m.metal, 0.165, 0.6, 0.05);
      break;
    case 'laptop': {
      const lap = mk(g, box(0.18, 0.025, 0.13), m.dark, 0, 0.4, 0.16);
      pw(mk(g, box(0.16, 0.1, 0.015), m.glow, 0, 0.46, 0.22, -0.4, 0, 0, true));
      lap.castShadow = false;
      mk(g, cyl(0.012, 0.04, 0.3, 6), m.metal, -0.14, 0.5, -0.1);
      break;
    }
    case 'bomb':
      mk(g, box(0.2, 0.18, 0.09), m.rust || m.dark, 0, 0.45, 0.1);
      pw(mk(g, sph(0.03, 6), M('fz', { color: 0x200404, emissive: 0xff2211, emissiveIntensity: 3 }), 0, 0.55, 0.14, 0, 0, 0, true));
      break;
    case 'none': break;
    default: // rifle
      mk(g, box(0.035, 0.055, 0.34), m.barrel, 0.09, 0.43, 0.12);
  }
  g.userData = { legs, radius: 0.4, aimY: 0.45, height: 0.8, infantry: true };
  const muz = new THREE.Object3D(); muz.position.set(0.09, 0.45, 0.32); g.add(muz);
  g.userData.muzzle = muz;
  return g;
}

/* ════════════════════════ VEHICLE CHASSIS HELPERS ═══════════════════════ */
function tankChassis(m, side, L = 2.0, W = 1.0, glacis = true) {
  const g = new THREE.Group();
  treads(g, m, W / 2, 0.34, L);
  mk(g, box(W - 0.18, 0.3, L * 0.92), m.hull, 0, 0.47, 0);
  if (glacis) mk(g, box(W - 0.22, 0.2, 0.5), m.panel, 0, 0.5, L * 0.38, -0.45);
  sideLamp(g, side, 0, 0.55, -L * 0.44, 0.12);
  return g;
}
function turretAssembly(g, m, { x = 0, y = 0.66, z = -0.1, r = 0.34, barrelLen = 1.0, twin = false, muzzY = 0.12 }) {
  const tu = new THREE.Group();
  tu.position.set(x, y, z);
  mk(tu, cyl(r * 0.82, r, 0.24, 12), m.panel, 0, 0.1, 0);
  mk(tu, box(r * 0.8, 0.16, r * 1.1), m.hull, 0, 0.22, 0.05);
  const xs = twin ? [-0.12, 0.12] : [0];
  for (const bx of xs) {
    mk(tu, cyl(0.05, 0.065, barrelLen, 8), m.barrel, bx, muzzY, r + barrelLen / 2, Math.PI / 2);
    mk(tu, box(0.1, 0.1, 0.14), m.barrel, bx, muzzY, r + barrelLen);
  }
  const muz = new THREE.Object3D(); muz.position.set(0, muzzY, r + barrelLen + 0.1); tu.add(muz);
  g.add(tu);
  return { tu, muz };
}

/* ════════════════════════ UNITS — COALITION ═════════════════════════════ */
const U_CO = {
  trooper: (m, side) => soldier(m, side, { role: 'rifle', fatigues: M('co_fat', { color: 0x8e9aa0, roughness: 0.9 }), helmCol: 0x9aa6ae, visor: true }),
  javelin: (m, side) => soldier(m, side, { role: 'launcher', fatigues: M('co_fat', { color: 0x8e9aa0, roughness: 0.9 }), helmCol: 0x9aa6ae }),
  marksman: (m, side) => soldier(m, side, { role: 'sniper', cape: true, fatigues: M('co_fat2', { color: 0x6f7a72, roughness: 0.95 }), helmCol: 0x5f6a62 }),
  ghost: (m, side) => {
    const g = soldier(m, side, { role: 'sniper', dark: true, visor: true });
    mk(g, box(0.06, 0.06, 0.06), m.glow, 0, 0.5, -0.16, 0, 0, 0, true); // back beacon
    g.userData.hero = true;
    return g;
  },
  dozer: (m, side) => dozerMesh(m, side),
  pelican: (m, side) => {
    const g = new THREE.Group();
    mk(g, capg(0.34, 1.0, 10), m.panel, 0, 0, 0, 0, 0, Math.PI / 2).rotation.set(Math.PI / 2, 0, 0);
    mk(g, sph(0.26, 10), m.glass, 0, 0.02, 0.62, 0, 0, 0, true);
    mk(g, box(0.5, 0.4, 0.7), m.hull, 0, -0.32, -0.05);                // cargo belly
    mk(g, cyl(0.07, 0.1, 0.9, 8), m.hull, 0, 0.16, -0.95, Math.PI / 2);
    mk(g, box(0.04, 0.4, 0.3), m.panel, 0, 0.36, -1.3);
    const rots = [];
    for (const sx of [-0.62, 0.62]) {
      mk(g, box(0.5, 0.07, 0.2), m.hull, sx * 0.6, 0.3, 0.05);
      mk(g, cyl(0.1, 0.13, 0.24, 8), m.dark, sx, 0.34, 0.05);
      const rot = new THREE.Group(); rot.position.set(sx, 0.48, 0.05);
      for (let i = 0; i < 3; i++) mk(rot, box(0.08, 0.015, 1.1), m.dark, 0, 0, 0, 0, (i / 3) * Math.PI * 2, 0);
      g.add(rot); rots.push({ o: rot, ax: 'y', sp: 26, idle: true });
    }
    const cargo = mk(g, box(0.42, 0.3, 0.5), pal('neutral').gold, 0, -0.62, -0.05);
    cargo.visible = false;
    sideLamp(g, side, 0, 0.1, -1.42, 0.1);
    g.userData = { spinners: rots, radius: 0.8, aimY: 0, height: 0.9, air: true, hoverY: 4.6, cargoMesh: cargo };
    return g;
  },
  outrider: (m, side) => {
    const g = new THREE.Group();
    const wheels = wheels4(g, m, 0.46, 0.2, [0.5, -0.5]);
    mk(g, box(0.78, 0.3, 1.5), m.hull, 0, 0.42, 0);
    mk(g, box(0.7, 0.22, 0.5), m.panel, 0, 0.6, 0.3);
    mk(g, box(0.58, 0.1, 0.03), m.glass, 0, 0.64, 0.56, -0.25, 0, 0, true);
    sideLamp(g, side, 0, 0.52, -0.72);
    const tu = new THREE.Group(); tu.position.set(0, 0.74, -0.3);
    mk(tu, box(0.34, 0.14, 0.34), m.dark, 0, 0.05, 0);
    mk(tu, box(0.3, 0.18, 0.42), m.metal, 0, 0.2, 0, -0.15);
    for (let i = 0; i < 4; i++) mk(tu, cone(0.035, 0.1, 6), m.panel, -0.09 + (i % 2) * 0.18, 0.2, 0.22 + Math.floor(i / 2) * 0.0, Math.PI / 2);
    const muz = new THREE.Object3D(); muz.position.set(0, 0.2, 0.3); tu.add(muz);
    g.add(tu);
    g.userData = { turret: tu, muzzle: muz, wheels, radius: 0.7, aimY: 0.6, height: 0.95 };
    return g;
  },
  paladin: (m, side) => {
    const g = tankChassis(m, side, 2.1, 1.1);
    const { tu, muz } = turretAssembly(g, m, { r: 0.36, barrelLen: 1.15 });
    pw(mk(tu, box(0.12, 0.05, 0.12), m.glow, 0, 0.32, -0.12, 0, 0, 0, true)); // sensor
    mk(tu, box(0.3, 0.08, 0.18), m.panel, 0.22, 0.3, -0.1);
    g.userData = { ...g.userData, turret: tu, muzzle: muz, radius: 0.85, aimY: 0.7, height: 1.0 };
    return g;
  },
  tempest: (m, side) => {
    const g = new THREE.Group();
    treads(g, m, 0.5, 0.3, 1.8);
    mk(g, box(0.84, 0.26, 1.7), m.hull, 0, 0.42, 0);
    mk(g, box(0.7, 0.24, 0.5), m.panel, 0, 0.62, 0.55);
    mk(g, box(0.56, 0.1, 0.03), m.glass, 0, 0.66, 0.81, -0.3, 0, 0, true);
    sideLamp(g, side, 0, 0.5, -0.82);
    const tu = new THREE.Group(); tu.position.set(0, 0.58, -0.35);
    const rack = new THREE.Group(); rack.position.y = 0.16; rack.rotation.x = -0.7;
    mk(rack, box(0.66, 0.3, 0.9), m.panel, 0, 0, 0);
    for (let i = 0; i < 6; i++) mk(rack, cyl(0.07, 0.07, 0.92, 8), m.dark, -0.2 + (i % 3) * 0.2, 0.0, 0, Math.PI / 2).rotation.set(Math.PI / 2, 0, 0);
    for (let i = 0; i < 6; i++) mk(rack, sph(0.05, 6), m.glow, -0.2 + (i % 3) * 0.2, (i < 3 ? 0.08 : -0.08), 0.46, 0, 0, 0, true);
    mk(tu, box(0.5, 0.16, 0.5), m.hull, 0, 0.02, 0);
    tu.add(rack);
    const muz = new THREE.Object3D(); muz.position.set(0, 0.6, 0.3); tu.add(muz);
    g.add(tu);
    g.userData = { turret: tu, muzzle: muz, radius: 0.9, aimY: 0.7, height: 1.2 };
    return g;
  },
  specter: (m, side) => {
    const g = new THREE.Group();
    mk(g, box(0.5, 0.34, 1.7), m.dark, 0, 0, 0);                       // angular stealth fuselage
    mk(g, box(0.42, 0.26, 0.5), m.glass, 0, 0.1, 0.78, -0.3, 0, 0, true);
    mk(g, box(0.34, 0.2, 0.6), m.hull, 0, -0.06, -1.05, 0.12);
    mk(g, box(0.03, 0.4, 0.32), m.hull, 0, 0.3, -1.3, 0, 0, 0.35);
    mk(g, box(1.5, 0.05, 0.4), m.hull, 0, 0.12, -0.1);                 // stub wings
    for (const sx of [-0.72, 0.72]) mk(g, box(0.18, 0.12, 0.5), m.metal, sx, 0.04, 0);
    const rot = new THREE.Group(); rot.position.set(0, 0.3, 0);
    for (let i = 0; i < 4; i++) mk(rot, box(0.09, 0.016, 1.5), m.dark, 0, 0, 0, 0, (i / 4) * Math.PI * 2, 0);
    g.add(rot);
    const tu = new THREE.Group(); tu.position.set(0, -0.2, 0.55);
    mk(tu, box(0.16, 0.14, 0.2), m.dark);
    mk(tu, cyl(0.03, 0.03, 0.4, 6), m.barrel, 0, -0.02, 0.25, Math.PI / 2);
    const muz = new THREE.Object3D(); muz.position.set(0, -0.02, 0.48); tu.add(muz);
    g.add(tu);
    sideLamp(g, side, 0, 0.2, -1.45, 0.08);
    g.userData = { spinners: [{ o: rot, ax: 'y', sp: 24, idle: true }], turret: tu, muzzle: muz, radius: 0.85, aimY: 0, height: 0.8, air: true, hoverY: 4.9 };
    return g;
  },
  falcon: (m, side) => jetMesh(m, side, { sweep: 0.55, len: 1.7, col: null }),
  meteor: (m, side) => {
    const g = new THREE.Group();
    mk(g, cyl(0.16, 0.22, 1.9, 10), m.panel, 0, 0, -0.1, Math.PI / 2);
    mk(g, cone(0.16, 0.5, 10), m.hull, 0, 0, 1.05, Math.PI / 2);
    mk(g, capg(0.09, 0.2, 8), m.glass, 0, 0.14, 0.5, Math.PI / 2, 0, 0, true);
    for (const sx of [-1, 1]) {
      mk(g, box(1.7, 0.05, 0.65), m.hull, sx * 0.95, 0, -0.25, 0, sx * 0.35, 0);
      mk(g, cyl(0.09, 0.11, 0.5, 8), m.dark, sx * 0.75, -0.1, -0.1, Math.PI / 2);
      mk(g, cyl(0.06, 0.07, 0.08, 8), M('eng', { color: 0x1d1106, emissive: 0xff9a3d, emissiveIntensity: 2.4 }), sx * 0.75, -0.1, -0.38, Math.PI / 2, 0, 0, true);
    }
    mk(g, box(0.55, 0.05, 0.4), m.hull, 0, 0.18, -1.0);
    mk(g, box(0.04, 0.34, 0.3), m.panel, 0, 0.3, -1.0);
    mk(g, box(0.3, 0.18, 0.7), m.dark, 0, -0.2, 0.1);                  // bomb bay
    sideLamp(g, side, 0, 0.08, -1.15, 0.1);
    g.userData = { radius: 1.1, aimY: 0, height: 0.7, air: true, hoverY: 6.4 };
    return g;
  },
};
function dozerMesh(m, side) {
  const g = new THREE.Group();
  treads(g, m, 0.46, 0.34, 1.3);
  mk(g, box(0.7, 0.34, 1.15), m.hull, 0, 0.5, -0.05);
  mk(g, box(0.55, 0.42, 0.5), m.panel, 0, 0.85, -0.25);
  mk(g, box(0.45, 0.16, 0.03), m.glass, 0, 0.92, 0.0, 0, 0, 0, true);
  mk(g, box(1.1, 0.42, 0.1), m.metal, 0, 0.4, 0.78, -0.18);            // blade
  mk(g, box(0.08, 0.08, 0.5), m.dark, -0.3, 0.45, 0.5, 0.3);
  mk(g, box(0.08, 0.08, 0.5), m.dark, 0.3, 0.45, 0.5, 0.3);
  pw(mk(g, sph(0.05, 6), pal('neutral').glow, 0, 1.16, -0.25, 0, 0, 0, true)); // work beacon
  sideLamp(g, side, 0, 0.6, -0.62);
  g.userData = { radius: 0.75, aimY: 0.6, height: 1.15 };
  return g;
}
function jetMesh(m, side, { sweep = 0.5, len = 1.6 } = {}) {
  const g = new THREE.Group();
  mk(g, cyl(0.11, 0.15, len * 0.65, 8), m.hull, 0, 0, -0.05, Math.PI / 2);
  mk(g, cone(0.11, 0.4, 8), m.panel, 0, 0, len * 0.33 + 0.18, Math.PI / 2);
  mk(g, capg(0.07, 0.16, 8), m.glass, 0, 0.12, 0.25, Math.PI / 2, 0, 0, true);
  for (const sx of [-1, 1]) {
    mk(g, box(0.85, 0.03, 0.4), m.hull, sx * 0.46, 0, -0.18, 0, sx * sweep, 0);
    mk(g, cyl(0.03, 0.03, 0.34, 6), m.metal, sx * 0.4, -0.07, 0, Math.PI / 2); // pylon missiles
  }
  mk(g, box(0.26, 0.03, 0.22), m.hull, -0.13, 0.16, -0.62, 0, 0, 0.7);
  mk(g, box(0.26, 0.03, 0.22), m.hull, 0.13, 0.16, -0.62, 0, 0, -0.7);
  mk(g, cyl(0.06, 0.075, 0.12, 8), M('eng', { color: 0x1d1106, emissive: 0xff9a3d, emissiveIntensity: 2.4 }), 0, 0, -len * 0.42, Math.PI / 2, 0, 0, true);
  sideLamp(g, side, 0, 0.1, -0.55, 0.08);
  g.userData = { radius: 0.8, aimY: 0, height: 0.5, air: true, hoverY: 6.0 };
  return g;
}

/* ════════════════════════ UNITS — DOMINION ══════════════════════════════ */
const U_DO = {
  conscript: (m, side) => soldier(m, side, { role: 'rifle', fatigues: M('do_fat', { color: 0x7a4438, roughness: 0.9 }), helmCol: 0x5e3028 }),
  hunter: (m, side) => soldier(m, side, { role: 'launcher', fatigues: M('do_fat', { color: 0x7a4438, roughness: 0.9 }), helmCol: 0x5e3028 }),
  hacker: (m, side) => soldier(m, side, { role: 'laptop', fatigues: M('do_fat2', { color: 0x4f5358, roughness: 0.9 }), helmCol: 0x3c4044 }),
  mantis: (m, side) => {
    const g = soldier(m, side, { role: 'none', dark: true, visor: true });
    mk(g, box(0.2, 0.2, 0.06), m.dark, 0, 0.46, -0.13);
    pw(mk(g, sph(0.035, 6), m.glow, 0.1, 0.5, -0.14, 0, 0, 0, true));
    g.userData.hero = true;
    return g;
  },
  dozer: (m, side) => dozerMesh(m, side),
  supplyTruck: (m, side) => {
    const g = new THREE.Group();
    const wheels = wheels4(g, m, 0.42, 0.18, [0.6, 0, -0.6]);
    mk(g, box(0.72, 0.22, 1.7), m.hull, 0, 0.36, 0);
    mk(g, box(0.66, 0.4, 0.5), m.panel, 0, 0.62, 0.58);
    mk(g, box(0.54, 0.14, 0.03), m.glass, 0, 0.7, 0.84, 0, 0, 0, true);
    const cargo = mk(g, box(0.66, 0.44, 0.95), pal('neutral').gold, 0, 0.66, -0.32);
    mk(g, box(0.7, 0.06, 1.0), m.dark, 0, 0.46, -0.32);
    sideLamp(g, side, 0, 0.5, -0.84);
    g.userData = { wheels, radius: 0.75, aimY: 0.5, height: 0.95, cargoMesh: cargo };
    cargo.visible = false;
    return g;
  },
  warmaster: (m, side) => {
    const g = tankChassis(m, side, 2.0, 1.15);
    mk(g, box(0.5, 0.1, 0.4), m.panel, 0, 0.66, -0.6, 0.5);            // rear slope
    const { tu, muz } = turretAssembly(g, m, { r: 0.38, barrelLen: 1.05 });
    star(tu, m, 0, 0.24, 0.42, 0.16, Math.PI / 2);
    g.userData = { ...g.userData, turret: tu, muzzle: muz, radius: 0.85, aimY: 0.7, height: 1.0 };
    return g;
  },
  shredder: (m, side) => {
    const g = new THREE.Group();
    treads(g, m, 0.46, 0.3, 1.4);
    mk(g, box(0.74, 0.26, 1.3), m.hull, 0, 0.42, 0);
    sideLamp(g, side, 0, 0.5, -0.64);
    const tu = new THREE.Group(); tu.position.set(0, 0.62, -0.05);
    mk(tu, cyl(0.26, 0.3, 0.18, 10), m.panel, 0, 0.04, 0);
    mk(tu, box(0.3, 0.24, 0.4), m.dark, 0, 0.22, 0);
    const spin = new THREE.Group(); spin.position.set(0, 0.22, 0.32);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; mk(spin, cyl(0.022, 0.022, 0.6, 6), m.barrel, Math.cos(a) * 0.06, Math.sin(a) * 0.06, 0.26, Math.PI / 2); }
    mk(spin, cyl(0.09, 0.09, 0.1, 10), m.metal, 0, 0, 0.05, Math.PI / 2);
    tu.add(spin);
    mk(tu, box(0.16, 0.1, 0.14), m.glass, 0, 0.36, 0.1, -0.3, 0, 0, true);
    const muz = new THREE.Object3D(); muz.position.set(0, 0.22, 0.6); tu.add(muz);
    g.add(tu);
    g.userData = { turret: tu, muzzle: muz, spinners: [{ o: spin, ax: 'z', sp: 18, idle: false }], radius: 0.8, aimY: 0.75, height: 1.05 };
    return g;
  },
  dragon: (m, side) => {
    const g = tankChassis(m, side, 1.9, 1.05);
    for (const sx of [-0.26, 0.26]) mk(g, cyl(0.14, 0.14, 0.6, 8), m.rust || m.metal, sx, 0.7, -0.55, Math.PI / 2); // fuel drums
    const tu = new THREE.Group(); tu.position.set(0, 0.66, 0);
    mk(tu, cyl(0.28, 0.32, 0.2, 10), m.panel, 0, 0.08, 0);
    mk(tu, cyl(0.07, 0.09, 0.7, 8), m.dark, 0, 0.16, 0.5, Math.PI / 2);
    mk(tu, cyl(0.12, 0.07, 0.16, 8), m.barrel, 0, 0.16, 0.86, Math.PI / 2);
    pw(mk(tu, sph(0.045, 6), M('pilot', { color: 0x200a02, emissive: 0xff7a1f, emissiveIntensity: 2.6 }), 0, 0.16, 0.95, 0, 0, 0, true));
    const muz = new THREE.Object3D(); muz.position.set(0, 0.16, 0.95); tu.add(muz);
    g.add(tu);
    g.userData = { ...g.userData, turret: tu, muzzle: muz, radius: 0.8, aimY: 0.66, height: 1.0 };
    return g;
  },
  hellstorm: (m, side) => {
    const g = new THREE.Group();
    treads(g, m, 0.48, 0.28, 1.7);
    mk(g, box(0.8, 0.24, 1.6), m.hull, 0, 0.4, 0);
    mk(g, box(0.6, 0.26, 0.44), m.panel, 0, 0.6, 0.6);
    mk(g, box(0.5, 0.1, 0.03), m.glass, 0, 0.66, 0.83, -0.3, 0, 0, true);
    sideLamp(g, side, 0, 0.48, -0.8);
    const tu = new THREE.Group(); tu.position.set(0, 0.56, -0.3);
    mk(tu, box(0.56, 0.18, 0.56), m.hull, 0, 0.04, 0);
    const rack = new THREE.Group(); rack.position.y = 0.2; rack.rotation.x = -0.6;
    for (let i = 0; i < 4; i++) {
      const t = mk(rack, cyl(0.1, 0.12, 1.0, 8), m.dark, -0.24 + (i % 2) * 0.48, 0, (i < 2 ? 0.1 : -0.14));
      t.rotation.x = Math.PI / 2;
      pw(mk(rack, cyl(0.08, 0.08, 0.04, 8), M('pilot', { color: 0x200a02, emissive: 0xff7a1f, emissiveIntensity: 2.6 }), -0.24 + (i % 2) * 0.48, 0, (i < 2 ? 0.62 : 0.38), Math.PI / 2, 0, 0, true));
    }
    tu.add(rack);
    const muz = new THREE.Object3D(); muz.position.set(0, 0.7, 0.4); tu.add(muz);
    g.add(tu);
    g.userData = { turret: tu, muzzle: muz, radius: 0.9, aimY: 0.7, height: 1.2 };
    return g;
  },
  emperor: (m, side) => {
    const g = new THREE.Group();
    treads(g, m, 0.68, 0.42, 2.5);
    mk(g, box(1.14, 0.4, 2.3), m.hull, 0, 0.62, 0);
    mk(g, box(1.0, 0.26, 0.6), m.panel, 0, 0.68, 1.0, -0.4);
    for (let i = 0; i < 3; i++) mk(g, box(0.16, 0.1, 0.3), m.dark, -0.34 + i * 0.34, 0.86, 0.8);
    smokestack(g, m, -0.42, -0.9, 1.3, 0.1); smokestack(g, m, 0.42, -0.9, 1.3, 0.1);
    sideLamp(g, side, 0, 0.8, -1.18, 0.14);
    const { tu, muz } = turretAssembly(g, m, { y: 0.94, z: -0.2, r: 0.5, barrelLen: 1.5, twin: true, muzzY: 0.16 });
    star(tu, m, 0, 0.34, 0.56, 0.2, Math.PI / 2);
    mk(tu, box(0.3, 0.14, 0.4), m.dark, -0.34, 0.32, -0.2);
    g.userData = { turret: tu, muzzle: muz, radius: 1.25, aimY: 1.0, height: 1.5, vents: [{ x: -0.42, y: 1.36, z: -0.9 }, { x: 0.42, y: 1.36, z: -0.9 }] };
    return g;
  },
  vulture: (m, side) => jetMesh(m, side, { sweep: -0.4, len: 1.6 }),
};

/* ════════════════════════ UNITS — SYNDICATE ═════════════════════════════ */
const U_SY = {
  worker: (m, side) => soldier(m, side, { role: 'tool', wrap: true, fatigues: M('sy_fat', { color: 0x9a7e50, roughness: 0.95 }) }),
  militant: (m, side) => soldier(m, side, { role: 'rifle', wrap: true, fatigues: M('sy_fat', { color: 0x9a7e50, roughness: 0.95 }) }),
  stinger: (m, side) => soldier(m, side, { role: 'launcher', wrap: true, fatigues: M('sy_fat2', { color: 0x7c6844, roughness: 0.95 }) }),
  fanatic: (m, side) => soldier(m, side, { role: 'bomb', wrap: true, fatigues: M('sy_fat2', { color: 0x7c6844, roughness: 0.95 }) }),
  cobra: (m, side) => {
    const g = soldier(m, side, { role: 'sniper', cape: true, wrap: true, fatigues: M('inf_dark', { color: 0x32363c, roughness: 0.85, metalness: 0.1 }) });
    g.userData.hero = true;
    return g;
  },
  technical: (m, side) => {
    const g = new THREE.Group();
    const wheels = wheels4(g, m, 0.4, 0.17, [0.52, -0.45]);
    mk(g, box(0.66, 0.18, 1.5), m.hull, 0, 0.34, 0);
    mk(g, box(0.6, 0.3, 0.5), m.panel, 0, 0.56, 0.34);
    mk(g, box(0.5, 0.12, 0.03), m.glass, 0, 0.62, 0.6, 0, 0, 0, true);
    mk(g, box(0.06, 0.18, 0.6), m.rust, -0.3, 0.5, -0.38);
    mk(g, box(0.06, 0.18, 0.6), m.rust, 0.3, 0.5, -0.38);
    sideLamp(g, side, 0, 0.46, -0.72);
    const tu = new THREE.Group(); tu.position.set(0, 0.62, -0.35);
    mk(tu, cyl(0.04, 0.05, 0.2, 8), m.dark, 0, -0.04, 0);
    mk(tu, box(0.08, 0.1, 0.5), m.dark, 0, 0.08, 0.12);
    const muz = new THREE.Object3D(); muz.position.set(0, 0.08, 0.42); tu.add(muz);
    g.add(tu);
    g.userData = { turret: tu, muzzle: muz, wheels, radius: 0.7, aimY: 0.55, height: 0.85 };
    return g;
  },
  scorpion: (m, side) => {
    const g = tankChassis(m, side, 1.8, 1.0);
    mk(g, cone(0.07, 0.34, 5), m.dark, -0.42, 0.6, 0.7, 0.4, 0, 0.5);  // prow spikes
    mk(g, cone(0.07, 0.34, 5), m.dark, 0.42, 0.6, 0.7, 0.4, 0, -0.5);
    mk(g, box(0.5, 0.06, 0.5), m.rust, 0.1, 0.66, -0.4, 0, 0.4, 0);    // scrap plate
    const { tu, muz } = turretAssembly(g, m, { r: 0.3, barrelLen: 0.85 });
    mk(tu, cone(0.05, 0.26, 5), m.dark, 0, 0.3, -0.22, -0.5);          // tail spike
    g.userData = { ...g.userData, turret: tu, muzzle: muz, radius: 0.8, aimY: 0.62, height: 0.95 };
    return g;
  },
  quad: (m, side) => {
    const g = new THREE.Group();
    const wheels = wheels4(g, m, 0.42, 0.18, [0.5, -0.5]);
    mk(g, box(0.7, 0.22, 1.4), m.hull, 0, 0.36, 0);
    mk(g, box(0.62, 0.26, 0.4), m.panel, 0, 0.56, 0.42);
    mk(g, box(0.5, 0.1, 0.03), m.glass, 0, 0.62, 0.63, 0, 0, 0, true);
    sideLamp(g, side, 0, 0.46, -0.68);
    const tu = new THREE.Group(); tu.position.set(0, 0.66, -0.25);
    mk(tu, box(0.4, 0.16, 0.3), m.metal, 0, 0.02, 0);
    const spin = new THREE.Group(); spin.position.set(0, 0.1, 0.2);
    for (const [bx, by] of [[-0.09, 0.05], [0.09, 0.05], [-0.09, -0.05], [0.09, -0.05]])
      mk(spin, cyl(0.025, 0.025, 0.55, 6), m.barrel, bx, by, 0.24, Math.PI / 2);
    tu.add(spin);
    const muz = new THREE.Object3D(); muz.position.set(0, 0.1, 0.5); tu.add(muz);
    g.add(tu);
    g.userData = { turret: tu, muzzle: muz, wheels, spinners: [{ o: spin, ax: 'z', sp: 14, idle: false }], radius: 0.72, aimY: 0.6, height: 0.95 };
    return g;
  },
  toxinTractor: (m, side) => {
    const g = new THREE.Group();
    const wheels = wheels4(g, m, 0.4, 0.22, [0.42, -0.42]);
    mk(g, box(0.7, 0.3, 1.2), m.hull, 0, 0.44, 0.05);
    mk(g, box(0.6, 0.3, 0.4), m.panel, 0, 0.7, 0.35);
    mk(g, box(0.48, 0.12, 0.03), m.glass, 0, 0.76, 0.56, 0, 0, 0, true);
    const tank = pw(mk(g, capg(0.26, 0.4, 10), M('tox', { color: 0x10260f, roughness: 0.3, metalness: 0.2, emissive: 0x49d44f, emissiveIntensity: 1.1 }), 0, 0.72, -0.38));
    tank.rotation.x = Math.PI / 2;
    mk(g, cyl(0.03, 0.03, 0.7, 6), m.metal, 0, 0.5, 0.62, 0.9);        // spray boom
    const muz = new THREE.Object3D(); muz.position.set(0, 0.42, 0.92); g.add(muz);
    sideLamp(g, side, 0, 0.55, -0.7);
    g.userData = { muzzle: muz, wheels, radius: 0.75, aimY: 0.6, height: 1.05 };
    return g;
  },
  buggy: (m, side) => {
    const g = new THREE.Group();
    const wheels = wheels4(g, m, 0.36, 0.18, [0.42, -0.4]);
    mk(g, box(0.56, 0.16, 1.2), m.hull, 0, 0.3, 0);
    mk(g, box(0.46, 0.2, 0.4), m.panel, 0, 0.46, 0.26);
    mk(g, cyl(0.015, 0.015, 0.5, 6), m.metal, 0, 0.56, 0.05, 0, 0, Math.PI / 2); // roll bar
    sideLamp(g, side, 0, 0.4, -0.58);
    const tu = new THREE.Group(); tu.position.set(0, 0.52, -0.3);
    const rack = mk(tu, box(0.5, 0.3, 0.45), m.dark, 0, 0.12, 0, -0.5);
    for (let i = 0; i < 6; i++) pw(mk(rack, cyl(0.05, 0.05, 0.04, 6), M('rkt', { color: 0x1c0a04, emissive: 0xffb14d, emissiveIntensity: 1.4 }), -0.16 + (i % 3) * 0.16, (i < 3 ? 0.08 : -0.08), 0.24, Math.PI / 2, 0, 0, true));
    const muz = new THREE.Object3D(); muz.position.set(0, 0.3, 0.3); tu.add(muz);
    g.add(tu);
    g.userData = { turret: tu, muzzle: muz, wheels, radius: 0.65, aimY: 0.5, height: 0.8 };
    return g;
  },
  scud: (m, side) => {
    const g = new THREE.Group();
    const wheels = wheels4(g, m, 0.46, 0.2, [0.75, 0, -0.75]);
    mk(g, box(0.8, 0.24, 2.1), m.hull, 0, 0.4, 0);
    mk(g, box(0.7, 0.34, 0.5), m.panel, 0, 0.66, 0.78);
    mk(g, box(0.56, 0.12, 0.03), m.glass, 0, 0.74, 1.04, 0, 0, 0, true);
    const erect = new THREE.Group(); erect.position.set(0, 0.56, -0.5); erect.rotation.x = -0.5;
    mk(erect, box(0.2, 0.12, 1.5), m.metal, 0, -0.02, 0.3);
    mk(erect, cyl(0.16, 0.18, 1.5, 10), m.cloth, 0, 0.14, 0.3).rotation.x = Math.PI / 2;
    const tip = pw(mk(erect, cone(0.16, 0.4, 10), M('tox', { color: 0x10260f, roughness: 0.3, metalness: 0.2, emissive: 0x49d44f, emissiveIntensity: 1.1 }), 0, 0.14, 1.25));
    tip.rotation.x = Math.PI / 2;
    g.add(erect);
    const muz = new THREE.Object3D(); muz.position.set(0, 1.3, -0.5); g.add(muz);
    sideLamp(g, side, 0, 0.5, -1.08);
    g.userData = { muzzle: muz, wheels, radius: 1.0, aimY: 0.8, height: 1.6 };
    return g;
  },
};

/* ════════════════════════ STRUCTURES — shared bits ══════════════════════ */
function slab(g, w, d, h = 0.18) {
  const s = mk(g, box(w, h, d), concPad(), 0, h / 2, 0);
  s.receiveShadow = true;
  return s;
}
function windowBand(g, m, w, y, z, n = 4, dy = 0.14) {
  for (let i = 0; i < n; i++)
    pw(mk(g, box(w / n * 0.55, dy, 0.04), m.glass, -w / 2 + (i + 0.5) * (w / n), y, z, 0, 0, 0, true));
}
function bayDoor(g, m, w, h, x, y, z) {
  const d = mk(g, box(w, h, 0.08), m.dark, x, y, z);
  for (let i = 1; i < 4; i++) mk(g, box(w, 0.02, 0.1), m.metal, x, y - h / 2 + (h / 4) * i, z);
  return d;
}
function craneArm(g, m, x, z, h, reach) {
  mk(g, box(0.14, h, 0.14), m.metal, x, h / 2, z);
  mk(g, box(0.1, 0.1, reach), m.metal, x, h, z + reach / 2 - 0.1);
  mk(g, cyl(0.015, 0.015, 0.5, 4), m.dark, x, h - 0.27, z + reach - 0.2);
  mk(g, box(0.12, 0.1, 0.12), m.dark, x, h - 0.55, z + reach - 0.2);
}

/* ════════════════════════ STRUCTURES — COALITION ════════════════════════ */
const S_CO = {
  commandCenter: (m, side) => {
    const g = new THREE.Group();
    slab(g, 5.6, 5.6);
    mk(g, box(3.6, 1.3, 3.0), m.panel, 0, 0.82, 0.2);                  // main hub
    mk(g, box(3.8, 0.18, 3.2), m.hull, 0, 1.52, 0.2);                  // roof lip
    for (const sx of [-1, 1]) mk(g, box(0.6, 1.0, 2.2), m.hull, sx * 2.0, 0.68, 0.2, 0, 0, sx * -0.12);
    windowBand(g, m, 3.0, 1.05, 1.74, 5);
    pw(mk(g, box(0.7, 0.6, 0.06), m.glow, 0, 0.55, 1.72, 0, 0, 0, true)); // entry
    mk(g, cyl(0.7, 0.8, 2.6, 10), m.panel, -1.5, 1.4, -1.5);           // control tower
    pw(mk(g, cyl(0.72, 0.72, 0.25, 10), m.glass, -1.5, 2.35, -1.5, 0, 0, 0, true));
    mk(g, cyl(0.8, 0.85, 0.14, 10), m.hull, -1.5, 2.78, -1.5);
    const radar = dish(g, m, 1.5, 1.62, -1.2, 0.85, 1.05);
    mk(g, cyl(0.02, 0.03, 1.6, 6), m.metal, -1.5, 3.6, -1.5);
    pw(mk(g, sph(0.07, 8), m.glow, -1.5, 4.42, -1.5, 0, 0, 0, true));
    mk(g, cyl(1.0, 1.0, 0.06, 18), m.hull, 1.6, 1.64, 1.2);            // roof helipad
    pw(mk(g, tor(0.7, 0.035, 20), m.glow, 1.6, 1.68, 1.2, Math.PI / 2, 0, 0, true));
    sideLamp(g, side, 0, 1.66, 0.2, 0.2);
    const fl = flagpole(g, side, 2.5, 2.5, 2.0);
    return Object.assign(g, { userData: { radius: 3.0, height: 3.2, aimY: 1.2, spinners: [{ o: radar, ax: 'y', sp: 0.9, idle: true }], flags: [fl] } });
  },
  fusionReactor: (m, side) => {
    const g = new THREE.Group();
    slab(g, 3.6, 3.6);
    mk(g, cyl(1.2, 1.35, 1.5, 14), m.panel, 0, 0.92, 0);
    mk(g, sph(0.95, 14), m.hull, 0, 1.7, 0);
    pw(mk(g, tor(1.26, 0.09, 28), m.glow, 0, 1.45, 0, Math.PI / 2, 0, 0, true));
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.4; mk(g, box(0.2, 1.2, 0.5), m.hull, Math.cos(a) * 1.45, 0.7, Math.sin(a) * 1.45, 0, -a, 0); }
    pw(mk(g, cyl(0.3, 0.3, 0.1, 10), m.glass, 0, 2.6, 0, 0, 0, 0, true));
    sideLamp(g, side, 0, 0.4, 1.74, 0.16);
    return Object.assign(g, { userData: { radius: 2.0, height: 2.7, aimY: 1.2 } });
  },
  barracks: (m, side) => {
    const g = new THREE.Group();
    slab(g, 4.4, 3.4);
    mk(g, box(3.4, 1.1, 2.2), m.panel, 0, 0.72, -0.2);
    mk(g, box(3.6, 0.3, 2.4), m.hull, 0, 1.34, -0.2, 0, 0, 0);         // flat roof
    mk(g, box(1.2, 0.8, 0.6), m.hull, -1.0, 0.55, 1.0);                // entry block
    pw(mk(g, box(0.6, 0.55, 0.06), m.glow, -1.0, 0.45, 1.32, 0, 0, 0, true));
    windowBand(g, m, 3.0, 0.9, 0.92, 5);
    mk(g, box(0.5, 0.4, 0.5), m.metal, 1.3, 1.7, -0.5);                // AC unit
    const fl = flagpole(g, side, 1.7, 1.2, 1.9);
    sideLamp(g, side, 0, 1.5, -0.2, 0.18);
    return Object.assign(g, { userData: { radius: 2.3, height: 1.6, aimY: 0.8, flags: [fl] } });
  },
  supplyCenter: (m, side) => {
    const g = new THREE.Group();
    slab(g, 5.2, 4.2);
    mk(g, box(3.2, 1.5, 2.6), m.panel, -0.7, 0.93, -0.5);
    mk(g, box(3.4, 0.2, 2.8), m.hull, -0.7, 1.76, -0.5);
    bayDoor(g, m, 1.6, 1.1, -0.7, 0.73, 0.84);
    windowBand(g, m, 2.6, 1.4, 0.84, 4, 0.12);
    pw(mk(g, cyl(0.85, 0.85, 0.05, 16), m.glass, 1.55, 0.21, 0.9, 0, 0, 0, true)); // landing ring
    craneArm(g, m, 1.9, -1.4, 2.2, 1.8);
    const gold = pal('neutral').gold;
    for (let i = 0; i < 3; i++) mk(g, box(0.5, 0.4 + (i % 2) * 0.2, 0.5), gold, 1.3 + (i % 2) * 0.6, 0.4, -1.2 + i * 0.5, 0, i * 0.4, 0);
    sideLamp(g, side, 0, 1.86, -0.5, 0.18);
    return Object.assign(g, { userData: { radius: 2.6, height: 2.3, aimY: 1.0 } });
  },
  warFactory: (m, side) => {
    const g = new THREE.Group();
    slab(g, 5.8, 5.0);
    mk(g, box(4.4, 1.9, 3.6), m.panel, 0, 1.13, -0.4);
    mk(g, box(4.6, 0.22, 3.8), m.hull, 0, 2.18, -0.4);
    for (let i = 0; i < 3; i++) mk(g, box(0.5, 0.3, 0.9), m.metal, -1.4 + i * 1.4, 2.4, -0.6);
    bayDoor(g, m, 2.2, 1.5, 0, 0.93, 1.42);
    pw(mk(g, box(2.3, 0.12, 0.06), m.glow, 0, 1.8, 1.44, 0, 0, 0, true));
    windowBand(g, m, 3.6, 1.7, 1.42, 5, 0.14);
    mk(g, box(0.9, 0.7, 2.4), m.hull, 2.2, 0.5, -0.4);                 // side annex
    craneArm(g, m, -2.4, -1.8, 2.6, 2.6);
    sideLamp(g, side, 0, 2.3, -0.4, 0.2);
    return Object.assign(g, { userData: { radius: 2.9, height: 2.6, aimY: 1.2 } });
  },
  airfield: (m, side) => airfieldMesh(m, side),
  aegis: (m, side) => {
    const g = new THREE.Group();
    slab(g, 2.4, 2.4);
    mk(g, cyl(0.6, 0.75, 0.9, 8), m.panel, 0, 0.62, 0);
    const tu = new THREE.Group(); tu.position.set(0, 1.12, 0);
    const rack = mk(tu, box(0.8, 0.5, 0.7), m.hull, 0, 0.22, 0, -0.5);
    for (let i = 0; i < 4; i++) pw(mk(rack, cyl(0.1, 0.1, 0.06, 8), m.glow, -0.2 + (i % 2) * 0.4, (i < 2 ? 0.13 : -0.13), 0.36, Math.PI / 2, 0, 0, true));
    dish(tu, m, 0, 0.1, -0.5, 0.3, 0.9);
    const muz = new THREE.Object3D(); muz.position.set(0, 0.5, 0.4); tu.add(muz);
    g.add(tu);
    sideLamp(g, side, 0, 0.3, 1.1, 0.14);
    return Object.assign(g, { userData: { radius: 1.4, height: 1.9, aimY: 1.2, turret: tu, muzzle: muz } });
  },
  uplink: (m, side) => {
    const g = new THREE.Group();
    slab(g, 4.2, 4.2);
    mk(g, box(2.6, 1.5, 2.6), m.panel, -0.4, 0.93, 0.3);
    mk(g, box(2.8, 0.2, 2.8), m.hull, -0.4, 1.76, 0.3);
    windowBand(g, m, 2.2, 1.2, 1.64, 4);
    const d1 = dish(g, m, -1.0, 1.86, -0.2, 0.62, 0.8);
    const d2 = dish(g, m, 0.4, 1.86, 0.9, 0.5, 0.95);
    const d3 = dish(g, m, 1.4, 0.2, -1.2, 0.78, 0.7);
    pw(mk(g, cyl(0.05, 0.05, 2.0, 6), m.glow, 1.5, 1.2, 1.3, 0, 0, 0, true));
    sideLamp(g, side, -0.4, 1.86, 0.3, 0.18);
    return Object.assign(g, { userData: { radius: 2.2, height: 2.4, aimY: 1.0, spinners: [{ o: d1, ax: 'y', sp: 0.5, idle: true }, { o: d2, ax: 'y', sp: -0.7, idle: true }, { o: d3, ax: 'y', sp: 0.4, idle: true }] } });
  },
  dropZone: (m, side) => {
    const g = new THREE.Group();
    slab(g, 4.0, 4.0, 0.14);
    pw(mk(g, tor(1.5, 0.05, 24), m.glow, 0, 0.18, 0, Math.PI / 2, 0, 0, true));
    mk(g, box(1.4, 0.16, 0.4), m.panel, 0, 0.18, 0);
    mk(g, box(0.4, 0.16, 1.4), m.panel, 0, 0.18, 0);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      mk(g, cyl(0.05, 0.06, 1.0, 6), m.metal, sx * 1.7, 0.5, sz * 1.7);
      pw(mk(g, sph(0.06, 6), m.glow, sx * 1.7, 1.05, sz * 1.7, 0, 0, 0, true));
    }
    const gold = pal('neutral').gold;
    mk(g, box(0.55, 0.45, 0.55), gold, -1.3, 0.42, 0.9, 0, 0.4, 0);
    mk(g, box(0.4, 0.3, 0.4), gold, -0.85, 0.34, 1.25, 0, 0.9, 0);
    sideLamp(g, side, 1.5, 0.3, -1.3, 0.14);
    return Object.assign(g, { userData: { radius: 2.1, height: 1.1, aimY: 0.4 } });
  },
  orbitalLance: (m, side) => {
    const g = new THREE.Group();
    slab(g, 5.4, 5.4);
    mk(g, cyl(1.5, 1.8, 0.8, 8), m.hull, 0, 0.58, 0);
    mk(g, cyl(0.9, 1.2, 1.6, 8), m.panel, 0, 1.7, 0);
    mk(g, cyl(0.55, 0.75, 1.4, 8), m.panel, 0, 3.1, 0);
    windowBand(g, m, 1.6, 1.9, 1.06, 3, 0.12);
    for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; mk(g, box(0.18, 2.6, 0.4), m.hull, Math.cos(a) * 1.7, 1.4, Math.sin(a) * 1.7, 0, -a, 0.22); }
    const ring = new THREE.Group(); ring.position.y = 4.0;
    const sg = pw(mk(ring, tor(0.7, 0.1, 24), m.glow, 0, 0, 0, Math.PI / 2));
    sg.userData.noShadow = true;
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; mk(ring, cone(0.09, 0.5, 6), m.metal, Math.cos(a) * 0.7, 0.2, Math.sin(a) * 0.7); }
    g.add(ring);
    pw(mk(g, cyl(0.16, 0.3, 0.5, 10), m.glow, 0, 4.05, 0, 0, 0, 0, true));
    dish(g, m, 1.9, 0.2, 1.6, 0.6, 0.8);
    sideLamp(g, side, 0, 0.99, 1.85, 0.18);
    return Object.assign(g, { userData: { radius: 2.8, height: 4.4, aimY: 2.0, superGlow: sg, spinners: [{ o: ring, ax: 'y', sp: 0.6, idle: true }] } });
  },
};
function airfieldMesh(m, side) {
  const g = new THREE.Group();
  slab(g, 7.0, 5.0, 0.14);
  // 4 pads
  for (let i = 0; i < 4; i++) {
    const px = -2.4 + (i % 2) * 2.4, pz = -1.2 + Math.floor(i / 2) * 2.6;
    mk(g, cyl(0.95, 0.95, 0.06, 14), m.dark, px, 0.17, pz);
    pw(mk(g, tor(0.7, 0.03, 18), m.glow, px, 0.21, pz, Math.PI / 2, 0, 0, true));
  }
  mk(g, box(1.2, 1.6, 1.2), m.panel, 2.7, 1.0, -1.4);                  // tower
  pw(mk(g, box(1.26, 0.34, 1.26), m.glass, 2.7, 1.65, -1.4, 0, 0, 0, true));
  mk(g, box(1.4, 0.12, 1.4), m.hull, 2.7, 1.92, -1.4);
  mk(g, cyl(0.02, 0.02, 1.0, 4), m.metal, 2.7, 2.4, -1.4);
  pw(mk(g, sph(0.05, 6), m.glow, 2.7, 2.92, -1.4, 0, 0, 0, true));
  mk(g, cone(0.16, 0.5, 6), M('sock', { color: 0xd97a2a, roughness: 0.9 }), 2.7, 1.1, 1.8, 0, 0, Math.PI / 2); // windsock
  mk(g, cyl(0.02, 0.02, 1.0, 4), m.metal, 2.7, 0.6, 1.8);
  mk(g, box(1.6, 0.6, 0.8), m.hull, -2.6, 0.45, 2.0);                  // fuel depot
  mk(g, cyl(0.3, 0.3, 0.7, 10), m.metal, -1.6, 0.5, 2.0, 0, 0, Math.PI / 2);
  sideLamp(g, side, 3.2, 0.3, 0.4, 0.16);
  g.userData = { radius: 3.4, height: 2.0, aimY: 0.8 };
  return g;
}

/* ════════════════════════ STRUCTURES — DOMINION ═════════════════════════ */
const S_DO = {
  commandCenter: (m, side) => {
    const g = new THREE.Group();
    slab(g, 5.6, 5.6);
    mk(g, box(3.8, 1.6, 3.2), m.hull, 0, 0.98, 0);                     // main block
    for (const sx of [-1, 1]) mk(g, box(0.8, 1.5, 3.0), m.panel, sx * 2.1, 0.85, 0, 0, 0, sx * -0.3); // sloped armor
    mk(g, box(4.4, 0.25, 3.8), m.dark, 0, 1.9, 0);                     // pagoda lip 1
    mk(g, box(2.6, 1.0, 2.2), m.hull, 0, 2.5, 0);
    mk(g, box(3.2, 0.22, 2.8), m.dark, 0, 3.1, 0);                     // pagoda lip 2
    star(g, m, 0, 1.35, 1.66, 0.42);
    windowBand(g, m, 2.2, 2.5, 1.14, 4, 0.16);
    pw(mk(g, box(0.9, 0.7, 0.06), m.glow, 0, 0.55, 1.64, 0, 0, 0, true));
    const v1 = smokestack(g, m, -1.6, -1.9, 3.4, 0.22);
    const v2 = smokestack(g, m, -0.9, -1.9, 2.9, 0.18);
    const radar = dish(g, m, 1.7, 3.2, -0.6, 0.6, 1.0);
    const fl = flagpole(g, side, 2.5, 2.4, 2.2);
    sideLamp(g, side, 0, 3.25, 0, 0.2);
    return Object.assign(g, { userData: { radius: 3.0, height: 3.6, aimY: 1.4, vents: [v1, v2], spinners: [{ o: radar, ax: 'y', sp: 0.8, idle: true }], flags: [fl] } });
  },
  fissionReactor: (m, side) => {
    const g = new THREE.Group();
    slab(g, 4.0, 4.0);
    mk(g, sph(1.25, 14), m.hull, 0, 1.0, -0.4);                        // containment dome
    mk(g, cyl(1.3, 1.4, 0.7, 14), m.panel, 0, 0.5, -0.4);
    pw(mk(g, box(1.6, 0.16, 0.06), m.glow, 0, 0.85, 0.94, 0, 0, 0, true)); // core slit
    mk(g, cyl(0.55, 0.8, 1.7, 12), m.panel, 1.45, 1.0, 1.1);           // cooling tower
    mk(g, cyl(0.62, 0.5, 0.4, 12), m.panel, 1.45, 2.0, 1.1);
    const v1 = { x: 1.45, y: 2.25, z: 1.1 };
    star(g, m, 0, 1.7, 0.74, 0.3);
    smokestack(g, m, -1.5, 1.2, 2.2, 0.16);
    sideLamp(g, side, -1.5, 0.4, 1.6, 0.16);
    return Object.assign(g, { userData: { radius: 2.2, height: 2.4, aimY: 1.0, vents: [v1, { x: -1.5, y: 2.3, z: 1.2 }] } });
  },
  barracks: (m, side) => {
    const g = new THREE.Group();
    slab(g, 4.4, 3.4);
    mk(g, box(3.4, 1.1, 2.2), m.hull, 0, 0.72, -0.2);
    mk(g, box(3.7, 0.24, 2.5), m.dark, 0, 1.36, -0.2);
    mk(g, box(1.1, 1.4, 0.3), m.panel, 0, 0.85, 1.1);                  // gate arch
    star(g, m, 0, 1.36, 1.28, 0.26);
    pw(mk(g, box(0.7, 0.8, 0.06), m.glow, 0, 0.5, 1.27, 0, 0, 0, true));
    windowBand(g, m, 3.0, 0.95, 0.92, 4, 0.14);
    const f1 = flagpole(g, side, -1.5, 1.3, 1.8), f2 = flagpole(g, side, 1.5, 1.3, 1.8);
    sideLamp(g, side, 0, 1.52, -0.2, 0.18);
    return Object.assign(g, { userData: { radius: 2.3, height: 1.7, aimY: 0.8, flags: [f1, f2] } });
  },
  supplyCenter: (m, side) => {
    const g = new THREE.Group();
    slab(g, 5.2, 4.2);
    mk(g, box(3.2, 1.4, 2.6), m.hull, -0.7, 0.88, -0.4);
    mk(g, box(3.5, 0.24, 2.9), m.dark, -0.7, 1.7, -0.4);
    bayDoor(g, m, 1.7, 1.05, -0.7, 0.7, 0.92);
    star(g, m, -0.7, 1.45, 0.94, 0.22);
    craneArm(g, m, 1.7, -1.5, 2.4, 2.4);
    const gold = pal('neutral').gold;
    for (let i = 0; i < 4; i++) mk(g, box(0.5, 0.36 + (i % 2) * 0.22, 0.5), gold, 1.2 + (i % 2) * 0.6, 0.36, -0.9 + i * 0.55, 0, i * 0.5, 0);
    sideLamp(g, side, -0.7, 1.8, -0.4, 0.18);
    return Object.assign(g, { userData: { radius: 2.6, height: 2.0, aimY: 0.9 } });
  },
  warFactory: (m, side) => {
    const g = new THREE.Group();
    slab(g, 5.8, 5.0);
    mk(g, box(4.4, 1.8, 3.6), m.hull, 0, 1.08, -0.4);
    mk(g, box(4.7, 0.26, 3.9), m.dark, 0, 2.1, -0.4);
    for (const sx of [-1, 1]) mk(g, box(0.7, 1.7, 3.4), m.panel, sx * 2.35, 0.95, -0.4, 0, 0, sx * -0.28);
    bayDoor(g, m, 2.2, 1.4, 0, 0.88, 1.42);
    star(g, m, 0, 1.85, 1.45, 0.34);
    const v1 = smokestack(g, m, -1.7, -1.9, 2.9, 0.2);
    const v2 = smokestack(g, m, 1.7, -1.9, 2.9, 0.2);
    sideLamp(g, side, 0, 2.24, -0.4, 0.2);
    return Object.assign(g, { userData: { radius: 2.9, height: 3.0, aimY: 1.2, vents: [v1, v2] } });
  },
  airfield: (m, side) => airfieldMesh(m, side),
  gatling: (m, side) => {
    const g = new THREE.Group();
    slab(g, 2.4, 2.4);
    mk(g, cyl(0.7, 0.9, 1.6, 8), m.hull, 0, 0.98, 0);
    mk(g, cyl(0.78, 0.72, 0.2, 8), m.dark, 0, 1.85, 0);
    const tu = new THREE.Group(); tu.position.set(0, 2.0, 0);
    mk(tu, box(0.5, 0.34, 0.5), m.panel, 0, 0.1, 0);
    const spin = new THREE.Group(); spin.position.set(0, 0.1, 0.3);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; mk(spin, cyl(0.025, 0.025, 0.7, 6), m.barrel, Math.cos(a) * 0.07, Math.sin(a) * 0.07, 0.3, Math.PI / 2); }
    mk(spin, cyl(0.1, 0.1, 0.12, 10), m.metal, 0, 0, 0.05, Math.PI / 2);
    tu.add(spin);
    star(tu, m, 0, 0.34, 0, 0.18);
    const muz = new THREE.Object3D(); muz.position.set(0, 0.1, 0.7); tu.add(muz);
    g.add(tu);
    sideLamp(g, side, 0, 0.4, 1.1, 0.14);
    return Object.assign(g, { userData: { radius: 1.4, height: 2.4, aimY: 1.8, turret: tu, muzzle: muz, spinners: [{ o: spin, ax: 'z', sp: 16, idle: false }] } });
  },
  bunker: (m, side) => {
    const g = new THREE.Group();
    slab(g, 3.2, 3.2);
    mk(g, box(2.4, 0.9, 2.4), m.panel, 0, 0.62, 0);
    for (const sx of [-1, 1]) mk(g, box(0.5, 0.85, 2.4), concPad(), sx * 1.4, 0.55, 0, 0, 0, sx * -0.5);
    mk(g, box(0.5, 0.85, 2.4), concPad(), 0, 0.55, -1.4, 0.5);
    mk(g, box(2.0, 0.16, 0.06), m.dark, 0, 0.85, 1.22);                // firing slit
    mk(g, box(2.5, 0.2, 2.5), m.dark, 0, 1.16, 0);
    for (let i = 0; i < 5; i++) mk(g, capg(0.11, 0.3, 6), sandbag(), -1.0 + i * 0.5, 0.14, 1.5, 0, 0, Math.PI / 2);
    const fl = flagpole(g, side, 1.2, -1.2, 1.5);
    fl.o.visible = false; // shown when garrisoned
    sideLamp(g, side, 0, 1.3, 0, 0.16);
    return Object.assign(g, { userData: { radius: 1.8, height: 1.3, aimY: 0.8, garrisonFlag: fl } });
  },
  warCouncil: (m, side) => {
    const g = new THREE.Group();
    slab(g, 4.6, 4.6);
    mk(g, box(3.2, 1.6, 2.6), m.hull, 0, 1.0, -0.3);
    mk(g, box(3.6, 0.26, 3.0), m.dark, 0, 1.95, -0.3);
    for (let i = 0; i < 4; i++) mk(g, cyl(0.14, 0.14, 1.5, 8), m.panel, -1.2 + i * 0.8, 0.95, 1.15);
    mk(g, box(3.6, 0.3, 0.9), m.dark, 0, 1.85, 1.0);
    star(g, m, 0, 2.4, -0.3, 0.5);
    windowBand(g, m, 2.6, 1.1, 1.02, 4, 0.18);
    const f1 = flagpole(g, side, -2.0, 1.9, 2.0), f2 = flagpole(g, side, 2.0, 1.9, 2.0);
    sideLamp(g, side, 0, 2.1, -0.3, 0.18);
    return Object.assign(g, { userData: { radius: 2.4, height: 2.8, aimY: 1.2, flags: [f1, f2] } });
  },
  nuclearMissile: (m, side) => {
    const g = new THREE.Group();
    slab(g, 5.6, 5.6, 0.3);
    mk(g, cyl(1.7, 1.85, 0.5, 12), concPad(), 0, 0.55, 0);
    mk(g, cyl(1.35, 1.4, 0.12, 16), m.dark, 0, 0.86, 0);
    // clamshell doors hinged at the silo rim — swing outward when opening
    const doorGeo = G('silodoor', () => { const ge = new THREE.BoxGeometry(1.1, 0.12, 2.2); ge.translate(-0.55, 0, 0); return ge; });
    const dL = new THREE.Mesh(doorGeo, m.metal); dL.position.set(-1.15, 0.95, 0); dL.rotation.y = Math.PI;
    const dR = new THREE.Mesh(doorGeo, m.metal); dR.position.set(1.15, 0.95, 0);
    g.add(dL, dR);
    for (const sx of [-1, 1]) mk(g, box(0.14, 0.13, 2.3), hazMat(), sx * 1.28, 0.93, 0);
    mk(g, box(1.5, 1.1, 1.2), m.hull, -1.9, 0.85, -1.7);               // control blockhouse
    pw(mk(g, box(0.9, 0.3, 0.05), m.glass, -1.9, 1.0, -1.08, 0, 0, 0, true));
    star(g, m, -1.9, 1.55, -1.7, 0.26);
    const warn = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      mk(g, cyl(0.05, 0.06, 0.8, 6), m.metal, Math.cos(a) * 2.2, 0.7, Math.sin(a) * 2.2);
      const lamp = pw(mk(g, sph(0.08, 8), m.glow, Math.cos(a) * 2.2, 1.15, Math.sin(a) * 2.2, 0, 0, 0, true));
      warn.push(lamp);
    }
    craneArm(g, m, 2.2, 1.8, 2.6, 1.6);
    const missile = new THREE.Group(); missile.position.set(0, 0.2, 0); missile.visible = false;
    mk(missile, cyl(0.3, 0.34, 2.2, 12), M('nuke_body', { color: 0xb9bec4, roughness: 0.35, metalness: 0.7 }), 0, 1.1, 0);
    mk(missile, cone(0.3, 0.7, 12), M('nuke_body', { color: 0xb9bec4, roughness: 0.35, metalness: 0.7 }), 0, 2.55, 0);
    g.add(missile);
    sideLamp(g, side, 2.2, 0.8, -2.2, 0.18);
    const sg = warn[0].material; // pw pass will clone; renderer drives via superGlow fallback
    return Object.assign(g, { userData: { radius: 2.8, height: 2.2, aimY: 1.0, silo: { left: dL, right: dR, open: 0 }, missile, superGlowMeshes: warn } });
  },
};

/* ════════════════════════ STRUCTURES — SYNDICATE ════════════════════════ */
function scrapWall(g, m, x, z, len, ry) {
  const w = new THREE.Group(); w.position.set(x, 0, z); w.rotation.y = ry;
  mk(w, box(len, 0.7, 0.14), m.panel, 0, 0.38, 0);
  for (let i = 0; i < Math.floor(len / 0.8); i++)
    mk(w, box(0.5, 0.4, 0.05), i % 2 ? m.rust : m.dark, -len / 2 + 0.5 + i * 0.8, 0.6 + (i % 3) * 0.1, 0.06, 0, 0, (i % 2 ? 0.12 : -0.1));
  g.add(w);
}
const S_SY = {
  commandCenter: (m, side) => {
    const g = new THREE.Group();
    slab(g, 5.8, 5.8, 0.12);
    scrapWall(g, m, 0, 2.7, 5.2, 0); scrapWall(g, m, 0, -2.7, 5.2, 0);
    scrapWall(g, m, 2.7, 0, 5.2, Math.PI / 2); scrapWall(g, m, -2.7, 0, 5.2, Math.PI / 2);
    mk(g, box(2.6, 1.2, 2.2), m.hull, -0.3, 0.72, -0.3);               // main block
    mk(g, box(1.8, 1.0, 1.6), m.panel, -0.3, 1.7, -0.3);               // 2nd storey
    mk(g, box(2.2, 0.14, 2.0), m.dark, -0.3, 2.27, -0.3);
    windowBand(g, m, 1.6, 1.7, 0.54, 3, 0.16);
    pw(mk(g, box(0.7, 0.6, 0.06), m.glow, -0.3, 0.45, 0.84, 0, 0, 0, true));
    // tarp lean-to + junk
    mk(g, box(1.8, 0.06, 1.6), m.tarp, 1.7, 1.1, 1.4, 0, 0, 0.18);
    for (const [px, pz] of [[1.0, 0.8], [2.4, 0.8], [1.0, 2.0], [2.4, 2.0]]) mk(g, cyl(0.04, 0.04, 1.1, 5), m.metal, px, 0.55, pz);
    junkPile(g, m, 1.8, -1.7, 1.4);
    spikes(g, m, -2.7, 2.7, 0.3, 3);
    spikes(g, m, 2.7, -2.7, 0.3, 3);
    mk(g, cyl(0.03, 0.05, 3.2, 6), m.metal, -1.9, 1.6, 1.7);           // antenna mast
    mk(g, box(0.3, 0.2, 0.05), m.dark, -1.9, 2.9, 1.7);
    pw(mk(g, sph(0.06, 6), m.glow, -1.9, 3.25, 1.7, 0, 0, 0, true));
    const fl = flagpole(g, side, 2.4, 2.4, 2.0);
    sideLamp(g, side, -0.3, 2.36, -0.3, 0.18);
    return Object.assign(g, { userData: { radius: 3.0, height: 2.6, aimY: 1.0, flags: [fl] } });
  },
  supplyStash: (m, side) => {
    const g = new THREE.Group();
    slab(g, 4.6, 4.0, 0.12);
    mk(g, box(2.6, 0.06, 2.2), m.tarp, -0.5, 1.5, -0.4, 0.06, 0, 0.1);
    for (const [px, pz] of [[-1.6, -1.3], [0.6, -1.3], [-1.6, 0.6], [0.6, 0.6]]) mk(g, cyl(0.05, 0.05, 1.5, 5), m.metal, px, 0.75, pz);
    const gold = pal('neutral').gold;
    for (let i = 0; i < 5; i++) mk(g, box(0.5, 0.4 + (i % 3) * 0.16, 0.5), i % 2 ? gold : m.dark, -1.3 + (i % 3) * 0.8, 0.36, -0.9 + Math.floor(i / 3) * 0.8, 0, i * 0.4, 0);
    mk(g, box(0.9, 0.5, 0.6), m.rust, 1.6, 0.4, 1.2, 0, 0.5, 0);       // weigh shack
    junkPile(g, m, 1.6, -1.2, 1.0);
    sideLamp(g, side, 1.6, 0.78, 1.2, 0.14);
    return Object.assign(g, { userData: { radius: 2.3, height: 1.7, aimY: 0.7 } });
  },
  barracks: (m, side) => {
    const g = new THREE.Group();
    slab(g, 4.4, 3.4, 0.12);
    // big ridge tent
    mk(g, box(2.8, 0.06, 2.2), m.tarp, -0.4, 1.25, 0, 0, 0, 0.5);
    mk(g, box(2.8, 0.06, 2.2), m.tarp, 0.6, 1.25, 0, 0, 0, -0.5);
    mk(g, box(2.9, 0.9, 2.0), m.cloth, 0.1, 0.45, 0);
    pw(mk(g, box(0.6, 0.6, 0.06), m.glow, 0.1, 0.4, 1.02, 0, 0, 0, true));
    scrapWall(g, m, 0, -1.5, 4.0, 0);
    for (let i = 0; i < 4; i++) mk(g, capg(0.1, 0.28, 6), sandbag(), -1.4 + i * 0.5, 0.12, 1.4, 0, 0, Math.PI / 2);
    junkPile(g, m, 1.8, 0.9, 0.8);
    const fl = flagpole(g, side, -1.8, 1.2, 1.7);
    sideLamp(g, side, 0.1, 1.0, -0.9, 0.14);
    return Object.assign(g, { userData: { radius: 2.3, height: 1.8, aimY: 0.7, flags: [fl] } });
  },
  armsBazaar: (m, side) => {
    const g = new THREE.Group();
    slab(g, 5.6, 4.8, 0.12);
    mk(g, box(3.6, 1.4, 2.4), m.hull, -0.5, 0.84, -0.6);
    mk(g, box(3.9, 0.12, 2.7), m.rust, -0.5, 1.6, -0.6);
    bayDoor(g, m, 1.6, 1.0, -0.5, 0.66, 0.62);
    mk(g, box(2.0, 0.06, 1.6), m.tarp, 1.8, 1.3, 1.0, 0, 0, 0.14);     // market awning
    for (const [px, pz] of [[1.0, 0.4], [2.6, 0.4], [1.0, 1.7], [2.6, 1.7]]) mk(g, cyl(0.04, 0.04, 1.3, 5), m.metal, px, 0.65, pz);
    for (let i = 0; i < 3; i++) mk(g, box(0.16, 0.5, 0.06), m.dark, 1.3 + i * 0.45, 0.6, 1.1, 0, 0, 0.2 - i * 0.2); // gun racks
    for (const sx of [-1, 1]) mk(g, cyl(0.34, 0.34, 0.2, 10), tireMat(), -2.2, 0.12 + (sx > 0 ? 0.22 : 0), 1.5, Math.PI / 2);
    craneArm(g, m, -2.4, -1.8, 2.2, 2.0);
    spikes(g, m, 2.5, -2.0, 0.3, 4);
    sideLamp(g, side, -0.5, 1.7, -0.6, 0.18);
    return Object.assign(g, { userData: { radius: 2.8, height: 2.0, aimY: 0.9 } });
  },
  stingerNest: (m, side) => {
    const g = new THREE.Group();
    slab(g, 2.8, 2.8, 0.1);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      mk(g, capg(0.13, 0.36, 6), sandbag(), Math.cos(a) * 1.15, 0.16, Math.sin(a) * 1.15, 0, -a, Math.PI / 2);
      if (i % 2) mk(g, capg(0.11, 0.3, 6), sandbag(), Math.cos(a + 0.2) * 1.1, 0.4, Math.sin(a + 0.2) * 1.1, 0, -a, Math.PI / 2);
    }
    mk(g, box(0.9, 0.4, 0.9), m.panel, 0, 0.3, 0);
    const tu = new THREE.Group(); tu.position.set(0, 0.62, 0);
    for (let i = 0; i < 3; i++) {
      const t = mk(tu, cyl(0.07, 0.08, 0.7, 7), m.dark, -0.2 + i * 0.2, 0.1, 0);
      t.rotation.x = Math.PI / 2 - 0.5;
      pw(mk(tu, cyl(0.055, 0.055, 0.04, 7), M('rkt', { color: 0x1c0a04, emissive: 0xffb14d, emissiveIntensity: 1.4 }), -0.2 + i * 0.2, 0.27 + 0.0, 0.31, Math.PI / 2 - 0.5, 0, 0, true));
    }
    const muz = new THREE.Object3D(); muz.position.set(0, 0.4, 0.4); tu.add(muz);
    g.add(tu);
    spikes(g, m, 0, 0, 1.5, 7);
    sideLamp(g, side, 0, 0.56, 0, 0.13);
    return Object.assign(g, { userData: { radius: 1.6, height: 1.2, aimY: 0.7, turret: tu, muzzle: muz } });
  },
  tunnel: (m, side) => {
    const g = new THREE.Group();
    const mound = mk(g, rockGeo(5), M('dirt', { color: 0x8a7350, roughness: 0.95 }), 0, 0.25, -0.3);
    mound.scale.set(1.9, 0.95, 1.7);
    mk(g, box(1.1, 0.9, 0.2), m.panel, 0, 0.45, 0.95);                 // entrance frame
    mk(g, box(0.8, 0.7, 0.1), M('hole', { color: 0x060504, roughness: 1 }), 0, 0.38, 1.02);
    const fan = new THREE.Group(); fan.position.set(0.9, 1.0, -0.5);
    mk(fan, cyl(0.3, 0.3, 0.14, 10), m.metal, 0, 0, 0, Math.PI / 2);
    for (let i = 0; i < 3; i++) mk(fan, box(0.08, 0.4, 0.02), m.dark, 0, 0, 0.09, 0, 0, (i / 3) * Math.PI * 2);
    g.add(fan);
    for (let i = 0; i < 4; i++) mk(g, capg(0.1, 0.3, 6), sandbag(), -1.1 + i * 0.45, 0.12, 1.25, 0, 0, Math.PI / 2);
    const tu = new THREE.Group(); tu.position.set(-0.9, 1.0, -0.4);    // little gun
    mk(tu, box(0.2, 0.14, 0.2), m.dark);
    mk(tu, box(0.05, 0.06, 0.4), m.barrel, 0, 0.03, 0.2);
    const muz = new THREE.Object3D(); muz.position.set(0, 0.03, 0.42); tu.add(muz);
    g.add(tu);
    const fl = flagpole(g, side, 1.2, 0.8, 1.5);
    fl.o.visible = false;
    sideLamp(g, side, 0, 0.95, 0.9, 0.13);
    return Object.assign(g, { userData: { radius: 1.8, height: 1.4, aimY: 0.7, turret: tu, muzzle: muz, spinners: [{ o: fan, ax: 'z', sp: 5, idle: true }], garrisonFlag: fl } });
  },
  demoTrap: (m, side) => {
    const g = new THREE.Group();
    mk(g, cyl(0.22, 0.26, 0.34, 9), m.rust, 0, 0.17, 0);
    mk(g, cyl(0.2, 0.2, 0.06, 9), m.dark, 0, 0.38, 0);
    mk(g, box(0.5, 0.04, 0.5), m.cloth, 0, 0.42, 0, 0.06, 0.5, 0);     // camo rag
    pw(mk(g, sph(0.035, 6), M('fz', { color: 0x200404, emissive: 0xff2211, emissiveIntensity: 3 }), 0.12, 0.44, 0.1, 0, 0, 0, true));
    sideLamp(g, side, -0.14, 0.42, -0.1, 0.07);
    return Object.assign(g, { userData: { radius: 0.5, height: 0.5, aimY: 0.3 } });
  },
  citadel: (m, side) => {
    const g = new THREE.Group();
    slab(g, 4.6, 4.6, 0.12);
    mk(g, box(3.0, 1.2, 3.0), m.hull, 0, 0.72, 0);                     // tiered fortress
    mk(g, box(2.2, 1.1, 2.2), m.panel, 0, 1.85, 0);
    mk(g, box(1.4, 1.0, 1.4), m.hull, 0, 2.9, 0);
    mk(g, box(1.7, 0.14, 1.7), m.dark, 0, 3.45, 0);
    windowBand(g, m, 1.8, 2.0, 1.14, 3, 0.16);
    pw(mk(g, box(0.6, 0.7, 0.06), m.glow, 0, 0.5, 1.52, 0, 0, 0, true));
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      mk(g, cyl(0.22, 0.28, 1.6, 7), m.panel, sx * 1.75, 0.85, sz * 1.75);
      mk(g, cone(0.26, 0.4, 7), m.rust, sx * 1.75, 1.85, sz * 1.75);
    }
    spikes(g, m, 0, 0, 2.45, 9);
    mk(g, cyl(0.03, 0.04, 2.4, 5), m.metal, 0.6, 4.4, 0.6);
    const fl = flagpole(g, side, -0.6, -0.6, 4.6);
    sideLamp(g, side, 0, 3.55, 0, 0.18);
    return Object.assign(g, { userData: { radius: 2.4, height: 3.6, aimY: 1.6, flags: [fl] } });
  },
  blackMarket: (m, side) => {
    const g = new THREE.Group();
    slab(g, 4.6, 3.8, 0.12);
    mk(g, box(2.4, 1.1, 1.8), m.hull, -0.7, 0.67, -0.5);
    mk(g, box(3.2, 0.07, 2.6), m.tarp, -0.4, 1.5, 0.1, 0.08, 0, 0.1);  // big tarp roof
    for (const [px, pz] of [[-1.9, -0.9], [1.0, -0.9], [-1.9, 1.1], [1.0, 1.1]]) mk(g, cyl(0.05, 0.05, 1.5, 5), m.metal, px, 0.75, pz);
    const gold = pal('neutral').gold;
    for (let i = 0; i < 3; i++) mk(g, box(0.42, 0.36, 0.42), gold, 0.6 + (i % 2) * 0.5, 0.3, -0.3 + i * 0.45, 0, i, 0);
    for (let i = 0; i < 3; i++) mk(g, box(0.2, 0.26, 0.08), m.dark, -0.3 + i * 0.4, 1.15, 0.9, 0, 0, 0.1); // hanging goods
    dish(g, m, 1.6, 0.15, -1.2, 0.5, 0.9);                             // "borrowed" satellite dish
    pw(mk(g, box(0.5, 0.3, 0.05), m.glow, -0.7, 0.8, 0.42, 0, 0, 0, true)); // neon sign
    junkPile(g, m, -1.8, 1.4, 0.9);
    sideLamp(g, side, -0.7, 1.3, -0.5, 0.14);
    return Object.assign(g, { userData: { radius: 2.3, height: 1.7, aimY: 0.8 } });
  },
  viperStorm: (m, side) => {
    const g = new THREE.Group();
    slab(g, 5.4, 5.4, 0.14);
    mk(g, box(3.0, 0.5, 3.0), m.hull, 0, 0.42, 0);
    const tu = new THREE.Group(); tu.position.set(0, 0.75, 0);
    mk(tu, cyl(1.2, 1.4, 0.24, 10), m.metal, 0, 0, 0);
    const rack = new THREE.Group(); rack.position.y = 0.3; rack.rotation.x = -0.5;
    const glows = [];
    for (let i = 0; i < 9; i++) {
      const cx = -0.44 + (i % 3) * 0.44, cyy = -0.44 + Math.floor(i / 3) * 0.44;
      const t = mk(rack, cyl(0.14, 0.16, 1.6, 8), m.dark, cx, cyy, 0.2);
      t.rotation.x = Math.PI / 2;
      glows.push(pw(mk(rack, cyl(0.11, 0.11, 0.05, 8), M('toxglow', { color: 0x06140a, emissive: 0x55d96e, emissiveIntensity: 1.6 }), cx, cyy, 1.02, Math.PI / 2, 0, 0, true)));
    }
    mk(rack, box(1.5, 1.5, 0.2), m.panel, 0, 0, -0.6);
    tu.add(rack);
    g.add(tu);
    for (const sx of [-1, 1]) {
      const drum = pw(mk(g, cyl(0.3, 0.3, 0.8, 10), M('tox', { color: 0x10260f, roughness: 0.3, metalness: 0.2, emissive: 0x49d44f, emissiveIntensity: 1.1 }), sx * 2.0, 0.5, 1.6, 0, 0, Math.PI / 2));
    }
    scaffoldPoles(g, m, 4.6, 4.6, 1.4);
    spikes(g, m, 0, 0, 2.5, 8);
    sideLamp(g, side, 0, 0.75, 2.4, 0.18);
    return Object.assign(g, { userData: { radius: 2.7, height: 2.4, aimY: 1.0, superGlowMeshes: glows, superRack: rack } });
  },
};

/* ════════════════════════ NEUTRAL / WORLD ═══════════════════════════════ */
const N_WORLD = {
  supplyDock: (m) => {
    const g = new THREE.Group();
    slab(g, 4.6, 4.6, 0.1);
    const gold = pal('neutral').gold;
    let i = 0;
    for (const [px, pz] of [[-1.4, -1.4], [0, -1.4], [1.4, -1.4], [-1.4, 0], [1.4, 0], [-1.4, 1.4], [0, 1.4], [1.4, 1.4]]) {
      const h = 0.5 + ((i * 37) % 3) * 0.28;
      mk(g, box(1.0, 0.12, 1.0), m.wood, px, 0.16, pz);                // pallet
      mk(g, box(0.85, h, 0.85), gold, px, 0.22 + h / 2, pz, 0, (i % 3) * 0.3, 0);
      if (i % 3 === 0) mk(g, box(0.5, 0.34, 0.5), gold, px + 0.1, 0.32 + h, pz - 0.06, 0, 0.6, 0);
      if (i % 4 === 1) mk(g, box(0.95, 0.1, 0.95), m.cloth, px, 0.3 + h, pz, 0.05, 0.2, 0);
      i++;
    }
    mk(g, box(0.9, 0.5, 0.5), m.metal, 0, 0.3, 0);                     // dock office box
    return Object.assign(g, { userData: { radius: 2.4, height: 1.4, aimY: 0.5 } });
  },
  supplyPile: (m) => {
    const g = new THREE.Group();
    const gold = pal('neutral').gold;
    mk(g, box(0.9, 0.12, 0.9), m.wood, 0, 0.1, 0);
    mk(g, box(0.8, 0.6, 0.8), gold, 0, 0.46, 0, 0, 0.2, 0);
    mk(g, box(0.55, 0.4, 0.55), gold, 0.7, 0.26, 0.4, 0, 0.7, 0);
    mk(g, box(0.5, 0.34, 0.5), gold, -0.55, 0.23, -0.5, 0, 1.1, 0);
    mk(g, box(0.45, 0.3, 0.45), gold, 0.12, 0.95, -0.05, 0, 0.5, 0);
    return Object.assign(g, { userData: { radius: 1.2, height: 1.2, aimY: 0.4 } });
  },
  oilDerrick: (m) => {
    const g = new THREE.Group();
    slab(g, 3.0, 3.0, 0.12);
    // pumpjack: A-frame + walking beam + horsehead
    for (const sx of [-0.3, 0.3]) {
      mk(g, box(0.1, 1.5, 0.1), m.metal, sx, 0.85, 0, 0, 0, sx * 0.25);
      mk(g, box(0.1, 1.5, 0.1), m.metal, sx, 0.85, -0.55, 0.35, 0, sx * 0.25);
    }
    const beam = new THREE.Group(); beam.position.set(0, 1.6, -0.1);
    mk(beam, box(0.16, 0.14, 2.0), m.rust, 0, 0, 0.1);
    mk(beam, box(0.3, 0.5, 0.24), m.metal, 0, -0.1, 1.05);             // horsehead
    mk(beam, box(0.4, 0.4, 0.3), m.dark, 0, 0, -0.85);                 // counterweight
    g.add(beam);
    mk(g, cyl(0.12, 0.14, 0.7, 8), m.dark, 0, 0.4, 1.1);               // wellhead
    mk(g, cyl(0.5, 0.5, 0.9, 12), m.rust, -1.0, 0.55, -0.9);           // storage tank
    mk(g, cyl(0.45, 0.45, 0.08, 12), m.metal, -1.0, 1.03, -0.9);
    mk(g, box(0.7, 0.5, 0.5), m.wood, 1.1, 0.35, -0.9);                // shack
    pw(mk(g, sph(0.05, 6), pal('neutral').glow, 1.1, 0.7, -0.9, 0, 0, 0, true));
    return Object.assign(g, { userData: { radius: 1.7, height: 2.0, aimY: 0.9, pump: { o: beam, amp: 0.22, hz: 1.6 } } });
  },
  civBuilding: (m) => {
    const g = new THREE.Group();
    slab(g, 3.4, 3.0, 0.1);
    mk(g, box(2.8, 2.0, 2.4), m.hull, 0, 1.1, 0);                      // 2-storey shell
    mk(g, box(3.0, 0.16, 2.6), m.panel, 0, 2.18, 0);                   // roof slab + parapet
    for (const [w, d, px, pz] of [[3.0, 0.1, 0, 1.32], [3.0, 0.1, 0, -1.32], [0.1, 2.6, 1.52, 0], [0.1, 2.6, -1.52, 0]])
      mk(g, box(w, 0.24, d), m.panel, px, 2.36, pz);
    const win = M('civwin', { color: 0x0d0b09, roughness: 0.9 });
    for (const zz of [1.22, -1.22]) for (let f = 0; f < 2; f++) for (let i = 0; i < 3; i++)
      mk(g, box(0.5, 0.5, 0.06), win, -0.9 + i * 0.9, 0.7 + f * 0.95, zz, 0, 0, 0, true);
    for (const xx of [1.42, -1.42]) for (let f = 0; f < 2; f++)
      mk(g, box(0.06, 0.5, 0.5), win, xx, 0.7 + f * 0.95, 0.4, 0, 0, 0, true);
    mk(g, box(0.6, 0.85, 0.08), win, 0.0, 0.55, 1.23);                 // door
    mk(g, box(0.4, 0.3, 0.4), m.metal, 0.8, 2.4, -0.6);                // roof AC
    const fl = flagpole(g, 'neutral', -1.1, -1.0, 3.1);
    fl.o.visible = false;
    junkPile(g, m, 1.5, 1.3, 0.7);
    return Object.assign(g, { userData: { radius: 2.0, height: 2.6, aimY: 1.1, garrisonFlag: fl } });
  },
  crate: (m) => {
    const g = new THREE.Group();
    const gold = pal('neutral').gold;
    mk(g, box(0.45, 0.36, 0.45), gold, 0, 0.2, 0, 0, 0.4, 0);
    mk(g, box(0.3, 0.24, 0.3), m.dark, 0.3, 0.13, -0.2, 0, 0.9, 0);
    mk(g, cyl(0.1, 0.1, 0.26, 8), m.rust, -0.28, 0.13, 0.22, 0, 0, 0.3);
    pw(mk(g, sph(0.05, 6), pal('neutral').glow, 0, 0.46, 0, 0, 0, 0, true)); // glint
    return Object.assign(g, { userData: { radius: 0.6, height: 0.6, aimY: 0.3 } });
  },
};

/* ════════════════════════ registry + public API ═════════════════════════ */
const REG = {
  coalition: { ...U_CO, ...S_CO },
  dominion: { ...U_DO, ...S_DO },
  syndicate: { ...U_SY, ...S_SY },
  neutral: N_WORLD,
};
export const STRUCTURE_KEYS = new Set([
  ...Object.keys(S_CO), ...Object.keys(S_DO), ...Object.keys(S_SY),
  'civBuilding', 'oilDerrick', 'supplyDock', 'supplyPile',
]);
export const INFANTRY_KEYS = new Set([
  'trooper', 'javelin', 'marksman', 'ghost', 'conscript', 'hunter', 'hacker', 'mantis',
  'worker', 'militant', 'stinger', 'fanatic', 'cobra',
]);
const STEALTH_KEYS = new Set(['marksman', 'ghost', 'mantis', 'cobra', 'specter', 'demoTrap']);

function findFaction(key) {
  for (const f of ['coalition', 'dominion', 'syndicate', 'neutral']) if (REG[f][key]) return f;
  return 'neutral';
}

/**
 * Build a mesh group for a sim entity {kind, key, faction?, side?}.
 * userData: {radius, height, aimY, muzzle?, turret?, air?, hoverY?, spinners?,
 *            wheels?, legs?, pump?, flags?, garrisonFlag?, vents?, silo?,
 *            missile?, superGlowMeshes?, powerMats?, cargoMesh?, infantry?, hero?}
 */
export function createEntityMesh(ent) {
  const key = String(ent?.key || 'crate');
  const side = ent?.side === 'enemy' ? 'enemy' : ent?.side === 'player' ? 'player' : 'neutral';
  let faction = ent?.faction && REG[ent.faction] ? ent.faction : null;
  if (!faction || !REG[faction][key]) faction = findFaction(key);
  const m = pal(faction);
  const builder = REG[faction][key] || N_WORLD.crate;
  const g = createModelMesh(faction, key) || builder(m, side);
  g.userData.key = key;
  g.userData.faction = faction;
  g.userData.side = side;
  g.userData.radius ??= 0.6;
  g.userData.height ??= 0.8;
  g.userData.aimY ??= 0.4;
  g.traverse((o) => { if (o.isMesh && !o.userData.noShadow) o.castShadow = true; });

  if (ent?.kind === 'husk') {
    // charred, claimed-by-nobody wreck
    let i = 0;
    g.traverse((o) => { if (o.isMesh) { o.material = (i++ % 3) ? charMat() : charMat2(); } });
    g.rotation.z = 0.06; g.rotation.x = -0.03;
    const u = g.userData;
    u.spinners = null; u.legs = null; u.wheels = null; u.flags = null; u.anim = null; u.husk = true;
    return g;
  }

  // per-instance clones of power-sensitive glow materials (structures & a few units)
  const pms = [];
  g.traverse((o) => {
    if (o.isMesh && o.userData.pw) {
      o.material = o.material.clone();
      pms.push({ mat: o.material, base: o.material.emissiveIntensity });
    }
  });
  if (pms.length) g.userData.powerMats = pms;
  if (STEALTH_KEYS.has(key)) makeFadable(g);
  return g;
}

/** Clone all materials so whole-mesh opacity works (stealth ghosting). */
export function makeFadable(g) {
  if (g.userData.fadeMats) return;
  const mats = [];
  g.traverse((o) => {
    if (o.isMesh && o.material) {
      o.material = o.material.clone();
      o.material.transparent = true;
      o.material.userData.baseOp = o.material.opacity ?? 1;
      mats.push(o.material);
    }
  });
  g.userData.fadeMats = mats;
  // re-link powerMats to the new clones
  if (g.userData.powerMats) {
    const pms = [];
    g.traverse((o) => { if (o.isMesh && o.userData.pw) pms.push({ mat: o.material, base: o.material.emissiveIntensity }); });
    g.userData.powerMats = pms;
  }
}

export function setMeshOpacity(g, op) {
  if (!g.userData.fadeMats) makeFadable(g);
  for (const m of g.userData.fadeMats) m.opacity = op * (m.userData.baseOp ?? 1);
}

/** Replace every material (ghost placement preview). */
export function overrideMaterials(g, mat) {
  g.traverse((o) => { if (o.isMesh) { o.material = mat; o.castShadow = false; o.receiveShadow = false; } });
}

/** Per-frame sub-part animation. */
export function animateEntityMesh(g, dt, time, moving, groundSpeed = 0) {
  const u = g?.userData;
  if (!u) return;
  if (u.anim) {
    // clip-driven model: move ↔ shoot ↔ idle (tanks only have `move`)
    const a = u.anim;
    let want = null;
    if (moving && a.actions.move) want = a.actions.move;
    else if (a.actions.shoot && time - a.lastAttackT < 1.1) want = a.actions.shoot;
    else want = a.actions.idle || null;
    if (want !== a.cur) {
      if (a.cur) a.cur.fadeOut(0.18);
      if (want) want.reset().fadeIn(0.18).play();
      a.cur = want;
    }
    // pace the run cycle to actual ground speed (clip authored ≈ infantry
    // full speed) so feet don't slide or blur
    if (a.cur && a.cur === a.actions.move) {
      a.cur.timeScale = Math.max(0.5, Math.min(1.5, groundSpeed / 2.2));
    }
    a.mixer.update(dt);
  }
  if (u.spinners) for (let i = 0; i < u.spinners.length; i++) {
    const s = u.spinners[i];
    s.o.rotation[s.ax] += s.sp * dt * (s.idle || moving ? 1 : 0.15);
  }
  if (u.wheels && moving) for (let i = 0; i < u.wheels.length; i++) u.wheels[i].rotation.x += dt * 6;
  if (u.legs) {
    const k = Math.min(1, dt * 9);
    for (let i = 0; i < u.legs.length; i++) {
      const L = u.legs[i];
      const target = moving ? Math.sin(time * L.hz + L.ph) * L.amp : 0;
      L.o.rotation.x += (target - L.o.rotation.x) * k;
    }
  }
  if (u.pump) u.pump.o.rotation.x = Math.sin(time * u.pump.hz) * u.pump.amp;
  if (u.flags) for (let i = 0; i < u.flags.length; i++) {
    const f = u.flags[i];
    f.o.rotation.y = Math.sin(time * 2.4 + i * 1.7) * 0.3;
    f.o.rotation.z = Math.sin(time * 3.1 + i) * 0.07;
  }
}

/* ── veterancy / salvage rank sprites ───────────────────────────────────── */
const RANK_TEX = {};
export function rankTexture(level, salvage = false) {
  const k = (salvage ? 's' : 'v') + level;
  if (RANK_TEX[k]) return RANK_TEX[k];
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 64;
  const c = cv.getContext('2d');
  c.strokeStyle = salvage ? '#7ce0ff' : '#ffd84d';
  c.lineWidth = 7;
  c.lineCap = 'round';
  const n = Math.min(3, Math.max(1, level));
  for (let i = 0; i < n; i++) {
    const y = 48 - i * 15;
    c.beginPath();
    c.moveTo(14, y); c.lineTo(32, y - 11); c.lineTo(50, y);
    c.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  RANK_TEX[k] = t;
  return t;
}

// ─── IRON COMMAND — unit mesh factories ─────────────────────────────────────
// Composed-primitive, low-poly-but-sharp military meshes.
// All geometries & materials are cached at module scope — never rebuilt per spawn.
import * as THREE from 'three';

export const TEAM_COLORS = { player: 0x2e7bff, enemy: 0xe03c2e };

/* ── caches ─────────────────────────────────────────────────────────────── */
const GEOS = new Map();
const MATS = new Map();

function G(key, make) {
  let g = GEOS.get(key);
  if (!g) { g = make(); GEOS.set(key, g); }
  return g;
}
function M(key, props) {
  let m = MATS.get(key);
  if (!m) { m = new THREE.MeshStandardMaterial(props); MATS.set(key, m); }
  return m;
}

const box  = (w, h, d)          => G(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
const cyl  = (rt, rb, h, s = 10) => G(`c${rt}|${rb}|${h}|${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s));
const sph  = (r, s = 10)         => G(`s${r}|${s}`, () => new THREE.SphereGeometry(r, s, Math.max(5, s - 3)));
const cone = (r, h, s = 8)       => G(`k${r}|${h}|${s}`, () => new THREE.ConeGeometry(r, h, s));
const capg = (r, l, s = 8)       => G(`p${r}|${l}|${s}`, () => new THREE.CapsuleGeometry(r, l, 3, s));
// box with origin at its top face (hinge pivot for legs)
const hingeBox = (w, h, d) => G(`hb${w}|${h}|${d}`, () => {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, -h / 2, 0);
  return g;
});

/* ── palette ────────────────────────────────────────────────────────────── */
const P = {
  body:    () => M('body',    { color: 0x77705a, roughness: 0.72, metalness: 0.25 }),
  body2:   () => M('body2',   { color: 0x5d6157, roughness: 0.68, metalness: 0.28 }),
  dark:    () => M('dark',    { color: 0x2c2f32, roughness: 0.8,  metalness: 0.35 }),
  tread:   () => M('tread',   { color: 0x1e2022, roughness: 0.95, metalness: 0.1 }),
  steel:   () => M('steel',   { color: 0x596066, roughness: 0.45, metalness: 0.65 }),
  barrel:  () => M('barrel',  { color: 0x33373b, roughness: 0.4,  metalness: 0.7 }),
  tire:    () => M('tire',    { color: 0x17191b, roughness: 0.95, metalness: 0.05 }),
  fatigue: () => M('fatigue', { color: 0x6a6a50, roughness: 0.9,  metalness: 0.05 }),
  fatigue2:() => M('fatigue2',{ color: 0x53544a, roughness: 0.9,  metalness: 0.05 }),
  skin:    () => M('skin',    { color: 0xc59a76, roughness: 0.85, metalness: 0 }),
  helmet:  () => M('helmet',  { color: 0x4d513e, roughness: 0.85, metalness: 0.1 }),
  glass:   () => M('glass',   { color: 0x14202a, roughness: 0.12, metalness: 0.85, emissive: 0x6fb9d8, emissiveIntensity: 0.45 }),
  engine:  () => M('engine',  { color: 0x1d1106, emissive: 0xff9a3d, emissiveIntensity: 2.6 }),
  flame:   () => M('flame',   { color: 0x1d1106, emissive: 0xff7a1f, emissiveIntensity: 2.2 }),
  tib:     () => M('tib',     { color: 0x0c2415, emissive: 0x35ff7a, emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.1 }),
  rotor:   () => M('rotor',   { color: 0x222426, roughness: 0.6, metalness: 0.4 }),
  trim:  (s) => M('trim_' + s, { color: 0x23262b, roughness: 0.5, metalness: 0.5, emissive: TEAM_COLORS[s] ?? 0x888888, emissiveIntensity: 1.0 }),
  glow:  (s) => M('glow_' + s, { color: 0x0a0a0a, emissive: TEAM_COLORS[s] ?? 0x888888, emissiveIntensity: 2.4 }),
};

// non-standard (basic/transparent) shared mats
let _blurMat = null;
function blurMat() {
  if (!_blurMat) _blurMat = new THREE.MeshBasicMaterial({ color: 0x1c1e20, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
  return _blurMat;
}
let _beamMat = null;
function beamMat() {
  if (!_beamMat) _beamMat = new THREE.MeshBasicMaterial({ color: 0xfff0c2, transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  return _beamMat;
}

/* ── helpers ────────────────────────────────────────────────────────────── */
function mk(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, noShadow = false) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (rx || ry || rz) m.rotation.set(rx, ry, rz);
  if (noShadow) m.userData.noShadow = true;
  parent.add(m);
  return m;
}

function treads(g, halfW, h, len) {
  mk(g, box(0.2, h, len), P.tread(), -halfW, h / 2, 0);
  mk(g, box(0.2, h, len), P.tread(), halfW, h / 2, 0);
}

/* ── infantry ───────────────────────────────────────────────────────────── */
const FORM = {
  1: [[0, 0]],
  2: [[-0.14, 0], [0.14, 0.06]],
  3: [[0, -0.14], [-0.17, 0.11], [0.17, 0.11]],
  4: [[-0.15, -0.15], [0.15, -0.13], [-0.16, 0.15], [0.16, 0.16]],
  5: [[0, -0.19], [-0.18, -0.02], [0.18, -0.02], [-0.12, 0.18], [0.12, 0.18]],
  6: [[-0.14, -0.19], [0.14, -0.19], [-0.19, 0], [0.19, 0], [-0.12, 0.19], [0.12, 0.19]],
};

// a single soldier figure, ~0.5 tall, faces +z
function soldier(side, kind) {
  const s = new THREE.Group();
  const legs = [];
  const lg = hingeBox(0.05, 0.17, 0.05);
  const l1 = mk(s, lg, P.fatigue2(), -0.045, 0.17, 0);
  const l2 = mk(s, lg, P.fatigue2(), 0.045, 0.17, 0);
  legs.push({ o: l1, ph: 0, amp: 0.55, hz: 7 }, { o: l2, ph: Math.PI, amp: 0.55, hz: 7 });
  mk(s, capg(0.075, 0.13), P.fatigue(), 0, 0.295, 0);                 // torso
  mk(s, box(0.17, 0.05, 0.1), P.fatigue2(), 0, 0.225, 0);             // belt
  mk(s, box(0.13, 0.1, 0.06), P.fatigue2(), 0, 0.33, -0.07);          // pack
  mk(s, sph(0.055, 8), P.skin(), 0, 0.43, 0);                         // head
  mk(s, cyl(0.062, 0.075, 0.05, 8), P.helmet(), 0, 0.465, 0);         // helmet
  mk(s, box(0.05, 0.028, 0.06), P.trim(side), -0.09, 0.375, 0);       // shoulder trim
  if (kind === 'launcher') {
    mk(s, cyl(0.035, 0.035, 0.36, 8), P.dark(), 0.085, 0.41, -0.02, Math.PI / 2);
    mk(s, cyl(0.045, 0.045, 0.07, 8), P.steel(), 0.085, 0.41, 0.15, Math.PI / 2);
  } else if (kind === 'flamer') {
    mk(s, box(0.028, 0.05, 0.22), P.dark(), 0.06, 0.3, 0.1);
    mk(s, cone(0.025, 0.05, 6), P.flame(), 0.06, 0.3, 0.23, Math.PI / 2, 0, 0, true);
    mk(s, cyl(0.04, 0.04, 0.17, 8), M('fueltank', { color: 0x8a3b22, roughness: 0.5, metalness: 0.5 }), 0, 0.32, -0.11);
  } else { // rifle
    mk(s, box(0.025, 0.04, 0.26), P.dark(), 0.06, 0.3, 0.1);
  }
  s.userData = { legs };
  return s;
}

function squadFactory(kind, defaultN) {
  return (side, def) => {
    const g = new THREE.Group();
    let n = Math.round(def?.squadSize || defaultN) || defaultN;
    n = Math.max(1, Math.min(6, n));
    const legs = [];
    FORM[n].forEach(([ox, oz], i) => {
      const s = soldier(side, kind);
      s.position.set(ox * 1.8, 0, oz * 1.8);
      s.rotation.y = (i % 2 ? -1 : 1) * 0.12 * i;
      legs.push(...s.userData.legs.map((L) => ({ ...L, ph: L.ph + i * 1.3 })));
      g.add(s);
    });
    const muz = new THREE.Object3D();
    muz.position.set(0, 0.32, 0.3);
    g.add(muz);
    g.userData = { legs, muzzle: muz, radius: 0.42, aimY: 0.3, height: 0.55, kind: 'infantry' };
    return g;
  };
}

/* ── vehicles ───────────────────────────────────────────────────────────── */

function scorpionTank(side) {
  const g = new THREE.Group();
  treads(g, 0.34, 0.24, 1.0);
  mk(g, box(0.52, 0.18, 0.94), P.body(), 0, 0.32, 0);
  mk(g, box(0.5, 0.12, 0.3), P.body2(), 0, 0.33, 0.5, -0.45);             // glacis
  mk(g, box(0.02, 0.045, 0.55), P.trim(side), -0.27, 0.38, 0);
  mk(g, box(0.02, 0.045, 0.55), P.trim(side), 0.27, 0.38, 0);
  const tu = new THREE.Group();
  tu.position.set(0, 0.44, -0.06);
  mk(tu, cyl(0.2, 0.26, 0.17, 10), P.body2(), 0, 0.07, 0);
  mk(tu, box(0.14, 0.1, 0.18), P.dark(), 0, 0.08, 0.22);                  // mantlet
  mk(tu, cyl(0.04, 0.05, 0.7, 8), P.barrel(), 0, 0.07, 0.5, Math.PI / 2);
  mk(tu, box(0.07, 0.07, 0.1), P.barrel(), 0, 0.07, 0.82);                // muzzle brake
  mk(tu, box(0.06, 0.04, 0.06), P.glow(side), 0, 0.17, -0.1, 0, 0, 0, true); // hatch lamp
  mk(tu, cyl(0.006, 0.006, 0.45, 4), P.steel(), -0.15, 0.3, -0.15);       // antenna
  const muz = new THREE.Object3D(); muz.position.set(0, 0.07, 0.88); tu.add(muz);
  g.add(tu);
  g.userData = { turret: tu, muzzle: muz, radius: 0.55, aimY: 0.45, height: 0.68, kind: 'vehicle' };
  return g;
}

function gatlingTrack(side) {
  const g = new THREE.Group();
  treads(g, 0.34, 0.22, 0.86);
  mk(g, box(0.52, 0.18, 0.84), P.body(), 0, 0.3, 0);
  mk(g, box(0.42, 0.18, 0.32), P.body2(), 0, 0.46, 0.2);
  mk(g, box(0.36, 0.06, 0.02), P.glass(), 0, 0.5, 0.37, 0, 0, 0, true);   // visor
  mk(g, box(0.02, 0.04, 0.5), P.trim(side), -0.27, 0.36, 0);
  mk(g, box(0.02, 0.04, 0.5), P.trim(side), 0.27, 0.36, 0);
  const tu = new THREE.Group();
  tu.position.set(0, 0.52, -0.14);
  mk(tu, cyl(0.16, 0.19, 0.12, 10), P.dark(), 0, 0.04, 0);
  mk(tu, box(0.18, 0.16, 0.3), P.steel(), 0, 0.15, 0.06);
  const spin = new THREE.Group();
  spin.position.set(0, 0.15, 0.24);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    mk(spin, cyl(0.018, 0.018, 0.46, 6), P.barrel(), Math.cos(a) * 0.045, Math.sin(a) * 0.045, 0.2, Math.PI / 2);
  }
  mk(spin, cyl(0.07, 0.07, 0.06, 8), P.barrel(), 0, 0, 0.04, Math.PI / 2);
  tu.add(spin);
  const muz = new THREE.Object3D(); muz.position.set(0, 0.15, 0.7); tu.add(muz);
  g.add(tu);
  g.userData = {
    turret: tu, muzzle: muz, radius: 0.55, aimY: 0.45, height: 0.72, kind: 'vehicle',
    spinners: [{ o: spin, ax: 'z', sp: 16, idle: false }],
  };
  return g;
}

function siegeHowitzer(side) {
  const g = new THREE.Group();
  treads(g, 0.36, 0.22, 1.0);
  mk(g, box(0.56, 0.16, 0.98), P.body(), 0, 0.29, 0);
  mk(g, box(0.44, 0.22, 0.36), P.body2(), 0, 0.46, -0.28);                // crew cabin
  mk(g, box(0.38, 0.07, 0.02), P.glass(), 0, 0.5, -0.09, 0, 0, 0, true);
  mk(g, box(0.1, 0.06, 0.3), P.dark(), -0.36, 0.18, -0.5, 0, 0.5, 0);     // spades
  mk(g, box(0.1, 0.06, 0.3), P.dark(), 0.36, 0.18, -0.5, 0, -0.5, 0);
  mk(g, box(0.02, 0.045, 0.6), P.trim(side), -0.29, 0.35, 0);
  mk(g, box(0.02, 0.045, 0.6), P.trim(side), 0.29, 0.35, 0);
  const tu = new THREE.Group();
  tu.position.set(0, 0.42, 0.05);
  mk(tu, box(0.3, 0.18, 0.34), P.steel(), 0, 0.08, 0);
  const bg = new THREE.Group();                                            // elevated barrel
  bg.position.set(0, 0.16, 0.05);
  bg.rotation.x = -0.38;
  mk(bg, cyl(0.038, 0.055, 1.2, 8), P.barrel(), 0, 0, 0.55, Math.PI / 2);
  mk(bg, box(0.09, 0.09, 0.14), P.barrel(), 0, 0, 1.15);
  mk(bg, cyl(0.07, 0.07, 0.3, 8), P.dark(), 0, 0, 0.12, Math.PI / 2);     // recoil sleeve
  const muz = new THREE.Object3D(); muz.position.set(0, 0, 1.22); bg.add(muz);
  tu.add(bg);
  g.add(tu);
  g.userData = { turret: tu, muzzle: muz, radius: 0.6, aimY: 0.5, height: 0.95, kind: 'vehicle' };
  return g;
}

function harvester(side) {
  const g = new THREE.Group();
  const wheels = [];
  const wg = cyl(0.15, 0.15, 0.12, 10);
  for (const zz of [-0.34, 0, 0.34]) {
    for (const xx of [-0.33, 0.33]) {
      const w = mk(g, wg, P.tire(), xx, 0.15, zz, 0, 0, Math.PI / 2);
      wheels.push(w);
    }
  }
  mk(g, box(0.56, 0.32, 1.0), P.body(), 0, 0.45, 0);
  mk(g, box(0.5, 0.26, 0.3), P.body2(), 0, 0.66, 0.34);
  mk(g, box(0.42, 0.1, 0.02), P.glass(), 0, 0.7, 0.5, 0, 0, 0, true);
  mk(g, box(0.62, 0.2, 0.26), P.steel(), 0, 0.24, 0.6, 0.5);              // scoop
  mk(g, box(0.5, 0.3, 0.38), P.body2(), 0, 0.72, -0.28);                  // hopper
  mk(g, cyl(0.06, 0.06, 0.2, 8), P.tib(), -0.13, 0.92, -0.28, 0, 0, 0, true);
  mk(g, cyl(0.06, 0.06, 0.2, 8), P.tib(), 0.13, 0.92, -0.28, 0, 0, 0, true);
  mk(g, box(0.02, 0.05, 0.7), P.trim(side), -0.29, 0.56, 0);
  mk(g, box(0.02, 0.05, 0.7), P.trim(side), 0.29, 0.56, 0);
  g.userData = { wheels, radius: 0.62, aimY: 0.55, height: 1.0, kind: 'vehicle' };
  return g;
}

function goliath(side) {
  const g = new THREE.Group();
  mk(g, box(0.26, 0.32, 1.52), P.tread(), -0.52, 0.16, 0);
  mk(g, box(0.26, 0.32, 1.52), P.tread(), 0.52, 0.16, 0);
  mk(g, box(0.82, 0.26, 1.44), P.body(), 0, 0.45, 0);
  mk(g, box(0.78, 0.12, 0.4), P.body2(), 0, 0.48, 0.62, -0.4);            // glacis
  for (let i = 0; i < 4; i++) mk(g, box(0.1, 0.06, 0.18), P.dark(), -0.3 + i * 0.2, 0.6, 0.55); // armor blocks
  mk(g, box(0.03, 0.07, 1.0), P.trim(side), -0.42, 0.56, 0);
  mk(g, box(0.03, 0.07, 1.0), P.trim(side), 0.42, 0.56, 0);
  mk(g, box(0.3, 0.05, 0.05), P.glow(side), 0, 0.59, -0.69, 0, 0, 0, true); // rear glow
  const tu = new THREE.Group();
  tu.position.set(0, 0.66, -0.1);
  mk(tu, box(0.58, 0.24, 0.66), P.body2(), 0, 0.1, 0);
  mk(tu, box(0.2, 0.12, 0.2), P.dark(), 0, 0.28, -0.1);                   // commander hatch
  mk(tu, cyl(0.05, 0.06, 1.06, 8), P.barrel(), -0.13, 0.08, 0.7, Math.PI / 2);
  mk(tu, cyl(0.05, 0.06, 1.06, 8), P.barrel(), 0.13, 0.08, 0.7, Math.PI / 2);
  mk(tu, box(0.09, 0.09, 0.12), P.barrel(), -0.13, 0.08, 1.18);
  mk(tu, box(0.09, 0.09, 0.12), P.barrel(), 0.13, 0.08, 1.18);
  // AA pod
  const pod = mk(tu, box(0.26, 0.13, 0.32), P.steel(), 0.22, 0.3, -0.22, -0.25);
  for (let i = 0; i < 4; i++) mk(pod, cone(0.025, 0.09, 6), M('mtip', { color: 0xcfd2d6, roughness: 0.4, metalness: 0.6 }), -0.08 + (i % 2) * 0.16, 0.02, -0.08 + Math.floor(i / 2) * 0.16, Math.PI / 2);
  mk(tu, cyl(0.007, 0.007, 0.6, 4), P.steel(), -0.24, 0.5, -0.25);
  mk(tu, cyl(0.007, 0.007, 0.5, 4), P.steel(), 0.24, 0.45, -0.25);
  mk(tu, box(0.08, 0.05, 0.08), P.glow(side), 0, 0.25, 0.25, 0, 0, 0, true);
  const muz = new THREE.Object3D(); muz.position.set(-0.13, 0.08, 1.25); tu.add(muz);
  const muz2 = new THREE.Object3D(); muz2.position.set(0.13, 0.08, 1.25); tu.add(muz2);
  g.add(tu);
  g.userData = { turret: tu, muzzle: muz, muzzle2: muz2, radius: 0.88, aimY: 0.65, height: 1.15, kind: 'vehicle', hero: true };
  return g;
}

function venomDrone(side) {
  const g = new THREE.Group();
  const pod = mk(g, capg(0.15, 0.2), P.body2(), 0, 0, 0, Math.PI / 2);
  pod.rotation.x = Math.PI / 2;
  mk(g, sph(0.06, 8), P.glow(side), 0, 0, 0.24, 0, 0, 0, true);           // sensor eye
  mk(g, box(0.06, 0.04, 0.3), P.dark(), 0, -0.12, 0.05);                  // gun
  const spinners = [];
  for (const [sx, sz] of [[-0.3, -0.22], [0.3, -0.22], [-0.3, 0.22], [0.3, 0.22]]) {
    mk(g, box(0.3, 0.03, 0.05), P.steel(), sx * 0.55, 0.02, sz, 0, Math.atan2(sz, sx), 0);
    const rot = new THREE.Group();
    rot.position.set(sx, 0.07, sz);
    mk(rot, box(0.4, 0.012, 0.03), P.rotor());
    mk(rot, box(0.03, 0.012, 0.4), P.rotor());
    mk(rot, cyl(0.2, 0.2, 0.008, 14), blurMat(), 0, 0, 0, 0, 0, 0, true);
    g.add(rot);
    spinners.push({ o: rot, ax: 'y', sp: 30 + Math.random() * 6, idle: true });
  }
  g.userData = { spinners, muzzleStatic: true, radius: 0.5, aimY: 0.05, height: 0.35, air: true, hoverY: 2.0, kind: 'air' };
  const muz = new THREE.Object3D(); muz.position.set(0, -0.12, 0.25); g.add(muz);
  g.userData.muzzle = muz;
  return g;
}

function razorJet(side) {
  const g = new THREE.Group();
  mk(g, cyl(0.09, 0.13, 0.95, 8), P.body2(), 0, 0, -0.05, Math.PI / 2);
  mk(g, cone(0.09, 0.34, 8), P.body(), 0, 0, 0.6, Math.PI / 2);
  mk(g, capg(0.06, 0.14, 8), P.glass(), 0, 0.1, 0.22, Math.PI / 2, 0, 0, true);
  mk(g, box(0.62, 0.025, 0.3), P.body(), -0.36, 0, -0.12, 0, 0.5, 0);     // swept wings
  mk(g, box(0.62, 0.025, 0.3), P.body(), 0.36, 0, -0.12, 0, -0.5, 0);
  mk(g, box(0.02, 0.05, 0.4), P.trim(side), -0.5, 0.01, -0.3, 0, 0.5, 0);
  mk(g, box(0.02, 0.05, 0.4), P.trim(side), 0.5, 0.01, -0.3, 0, -0.5, 0);
  mk(g, box(0.2, 0.025, 0.18), P.body2(), -0.12, 0.14, -0.5, 0, 0, 0.6);  // V tails
  mk(g, box(0.2, 0.025, 0.18), P.body2(), 0.12, 0.14, -0.5, 0, 0, -0.6);
  mk(g, cyl(0.05, 0.06, 0.12, 8), P.engine(), -0.07, 0, -0.56, Math.PI / 2, 0, 0, true);
  mk(g, cyl(0.05, 0.06, 0.12, 8), P.engine(), 0.07, 0, -0.56, Math.PI / 2, 0, 0, true);
  mk(g, cyl(0.025, 0.025, 0.3, 6), M('mtip2', { color: 0xb8bcc0, roughness: 0.4, metalness: 0.6 }), -0.3, -0.05, 0, Math.PI / 2); // pylon missiles
  mk(g, cyl(0.025, 0.025, 0.3, 6), M('mtip2', { color: 0xb8bcc0, roughness: 0.4, metalness: 0.6 }), 0.3, -0.05, 0, Math.PI / 2);
  const muz = new THREE.Object3D(); muz.position.set(0, -0.05, 0.5); g.add(muz);
  g.userData = { muzzle: muz, radius: 0.6, aimY: 0.05, height: 0.4, air: true, hoverY: 2.45, kind: 'air' };
  return g;
}

function phantomTank(side) {
  const g = new THREE.Group();
  treads(g, 0.3, 0.18, 0.96);
  mk(g, box(0.5, 0.13, 0.96), P.body2(), 0, 0.24, 0);
  mk(g, box(0.44, 0.09, 0.66), P.dark(), 0, 0.34, 0.04);
  mk(g, box(0.48, 0.1, 0.26), P.body2(), 0, 0.26, 0.5, -0.5);             // sharp glacis
  mk(g, box(0.015, 0.03, 0.6), P.trim(side), -0.255, 0.3, 0);
  mk(g, box(0.015, 0.03, 0.6), P.trim(side), 0.255, 0.3, 0);
  const tu = new THREE.Group();
  tu.position.set(0, 0.4, -0.08);
  mk(tu, cyl(0.17, 0.22, 0.1, 8), P.dark(), 0, 0.03, 0);
  mk(tu, cyl(0.032, 0.042, 0.62, 8), P.barrel(), 0, 0.04, 0.42, Math.PI / 2);
  mk(tu, box(0.05, 0.03, 0.05), P.glow(side), 0, 0.1, -0.08, 0, 0, 0, true);
  const muz = new THREE.Object3D(); muz.position.set(0, 0.04, 0.76); tu.add(muz);
  g.add(tu);
  g.userData = { turret: tu, muzzle: muz, radius: 0.55, aimY: 0.38, height: 0.55, kind: 'vehicle' };
  return g;
}

function spectre(side) {
  const g = new THREE.Group();
  const body = mk(g, capg(0.27, 0.95, 10), P.body2(), 0, 0, 0);
  body.rotation.x = Math.PI / 2;
  mk(g, sph(0.2, 10), P.glass(), 0, -0.02, 0.62, 0, 0, 0, true);          // nose canopy
  mk(g, box(0.9, 0.05, 0.34), P.body(), 0, 0.12, 0.05);                   // stub wing
  mk(g, box(0.04, 0.06, 0.6), P.trim(side), -0.46, 0.14, 0.05);
  mk(g, box(0.04, 0.06, 0.6), P.trim(side), 0.46, 0.14, 0.05);
  mk(g, cyl(0.07, 0.09, 0.7, 8), P.body2(), 0, 0.1, -0.95, Math.PI / 2);  // tail boom
  mk(g, box(0.025, 0.3, 0.22), P.body(), 0, 0.3, -1.25);                  // tail fin
  const tailRot = new THREE.Group();
  tailRot.position.set(0.05, 0.32, -1.27);
  mk(tailRot, box(0.012, 0.4, 0.04), P.rotor());
  mk(tailRot, box(0.012, 0.04, 0.4), P.rotor());
  g.add(tailRot);
  const spinners = [{ o: tailRot, ax: 'x', sp: 40, idle: true }];
  for (const sx of [-0.58, 0.58]) {
    mk(g, cyl(0.1, 0.13, 0.28, 8), P.dark(), sx, 0.2, 0.05);              // nacelle
    const rot = new THREE.Group();
    rot.position.set(sx, 0.38, 0.05);
    for (let i = 0; i < 3; i++) mk(rot, box(0.07, 0.014, 0.95), P.rotor(), 0, 0, 0, 0, (i / 3) * Math.PI * 2, 0);
    mk(rot, cyl(0.52, 0.52, 0.01, 18), blurMat(), 0, -0.01, 0, 0, 0, 0, true);
    mk(rot, sph(0.05, 8), P.steel());
    g.add(rot);
    spinners.push({ o: rot, ax: 'y', sp: 26, idle: true });
  }
  // chin turret
  const tu = new THREE.Group();
  tu.position.set(0, -0.24, 0.35);
  mk(tu, box(0.16, 0.12, 0.16), P.dark());
  mk(tu, cyl(0.025, 0.025, 0.4, 6), P.barrel(), -0.04, -0.02, 0.22, Math.PI / 2);
  mk(tu, cyl(0.025, 0.025, 0.4, 6), P.barrel(), 0.04, -0.02, 0.22, Math.PI / 2);
  const muz = new THREE.Object3D(); muz.position.set(0, -0.02, 0.44); tu.add(muz);
  g.add(tu);
  // spotlight
  mk(g, sph(0.05, 8), M('lamp', { color: 0x222222, emissive: 0xffe9b0, emissiveIntensity: 3.0 }), 0, -0.26, 0.1, 0, 0, 0, true);
  const beam = mk(g, cone(0.5, 2.2, 12, true), beamMat(), 0, -1.32, 0.25, 0, 0, 0, true);
  beam.rotation.x = 0.12;
  // rocket pods
  mk(g, box(0.14, 0.12, 0.3), P.steel(), -0.42, 0.0, 0.2);
  mk(g, box(0.14, 0.12, 0.3), P.steel(), 0.42, 0.0, 0.2);
  g.userData = { turret: tu, muzzle: muz, spinners, radius: 0.95, aimY: 0.0, height: 0.7, air: true, hoverY: 2.7, kind: 'air', hero: true };
  return g;
}

function technical(side) {
  const g = new THREE.Group();
  const wheels = [];
  const wg = cyl(0.13, 0.13, 0.1, 10);
  for (const zz of [0.32, -0.32]) {
    for (const xx of [-0.26, 0.26]) wheels.push(mk(g, wg, P.tire(), xx, 0.13, zz, 0, 0, Math.PI / 2));
  }
  mk(g, box(0.48, 0.13, 0.95), P.body(), 0, 0.26, 0);
  mk(g, box(0.44, 0.22, 0.34), P.body2(), 0, 0.43, 0.22);                 // cab
  mk(g, box(0.38, 0.1, 0.02), P.glass(), 0, 0.47, 0.4, 0, 0, 0, true);
  mk(g, box(0.04, 0.13, 0.4), P.body(), -0.22, 0.39, -0.25);              // bed walls
  mk(g, box(0.04, 0.13, 0.4), P.body(), 0.22, 0.39, -0.25);
  mk(g, box(0.44, 0.13, 0.04), P.body(), 0, 0.39, -0.45);
  mk(g, cyl(0.015, 0.015, 0.4, 6), P.steel(), 0, 0.55, 0.04, 0, 0, 1.57); // roll bar
  mk(g, box(0.03, 0.04, 0.3), P.trim(side), -0.25, 0.5, 0.22);
  mk(g, box(0.03, 0.04, 0.3), P.trim(side), 0.25, 0.5, 0.22);
  const tu = new THREE.Group();
  tu.position.set(0, 0.48, -0.24);
  mk(tu, cyl(0.03, 0.04, 0.16, 8), P.dark(), 0, -0.05, 0);
  mk(tu, box(0.06, 0.08, 0.42), P.dark(), 0, 0.04, 0.1);
  mk(tu, box(0.03, 0.03, 0.16), P.barrel(), 0, 0.04, 0.36);
  const muz = new THREE.Object3D(); muz.position.set(0, 0.04, 0.45); tu.add(muz);
  g.add(tu);
  g.userData = { turret: tu, muzzle: muz, wheels, radius: 0.52, aimY: 0.42, height: 0.65, kind: 'vehicle' };
  return g;
}

function warlord(side) {
  const g = new THREE.Group();
  const legs = [];
  for (const sx of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(sx * 0.24, 1.0, 0);
    mk(leg, hingeBox(0.18, 0.55, 0.26), P.body2(), 0, 0, 0);
    mk(leg, hingeBox(0.14, 0.42, 0.18), P.dark(), 0, -0.52, 0.03);
    mk(leg, box(0.24, 0.1, 0.38), P.dark(), 0, -0.95, 0.06);              // foot
    g.add(leg);
    legs.push({ o: leg, ph: sx > 0 ? Math.PI : 0, amp: 0.42, hz: 5 });
  }
  mk(g, box(0.52, 0.2, 0.32), P.body(), 0, 1.02, 0);                      // pelvis
  const torso = new THREE.Group();
  torso.position.set(0, 1.2, 0);
  mk(torso, box(0.68, 0.44, 0.5), P.body(), 0, 0.2, 0);
  mk(torso, box(0.4, 0.12, 0.04), P.glass(), 0, 0.28, 0.26, 0, 0, 0, true); // cockpit slit
  mk(torso, box(0.5, 0.06, 0.06), P.trim(side), 0, 0.06, 0.26);
  mk(torso, box(0.2, 0.14, 0.2), P.body2(), 0, 0.5, -0.04);               // sensor head
  mk(torso, box(0.16, 0.04, 0.02), P.glow(side), 0, 0.52, 0.07, 0, 0, 0, true);
  // right arm: flamethrower
  const rArm = new THREE.Group();
  rArm.position.set(0.46, 0.24, 0);
  mk(rArm, box(0.22, 0.26, 0.28), P.body2());
  mk(rArm, cyl(0.07, 0.09, 0.55, 8), P.dark(), 0, -0.05, 0.3, Math.PI / 2);
  mk(rArm, cyl(0.1, 0.06, 0.12, 8), P.barrel(), 0, -0.05, 0.6, Math.PI / 2);
  mk(rArm, sph(0.035, 6), P.flame(), 0, -0.05, 0.66, 0, 0, 0, true);      // pilot light
  mk(rArm, cyl(0.07, 0.07, 0.24, 8), M('fueltank2', { color: 0x7c3a20, roughness: 0.5, metalness: 0.5 }), 0.02, 0.1, -0.2, 0.3);
  torso.add(rArm);
  // left arm: autocannon
  const lArm = new THREE.Group();
  lArm.position.set(-0.46, 0.24, 0);
  mk(lArm, box(0.2, 0.24, 0.26), P.body2());
  mk(lArm, box(0.08, 0.1, 0.5), P.dark(), 0, -0.04, 0.25);
  mk(lArm, cyl(0.03, 0.03, 0.2, 6), P.barrel(), 0, -0.04, 0.55, Math.PI / 2);
  torso.add(lArm);
  // AA rack on back
  const rack = mk(torso, box(0.34, 0.16, 0.18), P.steel(), 0, 0.42, -0.28, -0.4);
  for (let i = 0; i < 6; i++) mk(rack, cone(0.025, 0.1, 6), M('mtip', { color: 0xcfd2d6, roughness: 0.4, metalness: 0.6 }), -0.12 + (i % 3) * 0.12, 0.06, -0.04 + Math.floor(i / 3) * 0.09);
  // exhausts
  mk(torso, cyl(0.04, 0.04, 0.22, 6), P.dark(), -0.3, 0.46, -0.26, 0.3);
  mk(torso, cyl(0.04, 0.04, 0.22, 6), P.dark(), 0.3, 0.46, -0.26, 0.3);
  mk(torso, cyl(0.03, 0.03, 0.03, 6), P.engine(), -0.3, 0.57, -0.29, 0.3, 0, 0, true);
  mk(torso, cyl(0.03, 0.03, 0.03, 6), P.engine(), 0.3, 0.57, -0.29, 0.3, 0, 0, true);
  const muz = new THREE.Object3D(); muz.position.set(0, -0.05, 0.7); rArm.add(muz);
  g.add(torso);
  g.userData = { turret: torso, muzzle: muz, legs, radius: 0.82, aimY: 1.3, height: 2.0, kind: 'vehicle', hero: true };
  return g;
}

function mortarCrew(side, def) {
  const g = squadFactory('rifle', 2)(side, { squadSize: 2 });
  // shift soldiers aside, add mortar in middle
  g.children.forEach((c) => { if (c.isGroup) c.position.x = c.position.x * 1.6 - 0.0; });
  const mg = new THREE.Group();
  mk(mg, cyl(0.16, 0.18, 0.04, 10), P.dark(), 0, 0.02, 0);                // baseplate
  mk(mg, cyl(0.045, 0.055, 0.45, 8), P.barrel(), 0, 0.2, 0.08, 0.9);      // tube, elevated
  mk(mg, cyl(0.012, 0.012, 0.3, 4), P.steel(), -0.08, 0.14, 0.12, 0.5, 0, 0.4);
  mk(mg, cyl(0.012, 0.012, 0.3, 4), P.steel(), 0.08, 0.14, 0.12, 0.5, 0, -0.4);
  const muz = new THREE.Object3D(); muz.position.set(0, 0.38, 0.22); mg.add(muz);
  g.add(mg);
  g.userData.muzzle = muz;
  g.userData.turret = mg;
  return g;
}

/* ── registry ───────────────────────────────────────────────────────────── */
const FACTORIES = {
  rifle_squad:    squadFactory('rifle', 3),
  recon_squad:    squadFactory('rifle', 2),
  conscript_mob:  squadFactory('rifle', 4),
  missile_team:   squadFactory('launcher', 2),
  stinger_squad:  squadFactory('launcher', 2),
  rpg_brigade:    squadFactory('launcher', 3),
  flame_trooper:  squadFactory('flamer', 2),
  mortar_crew:    mortarCrew,
  scorpion_tank:  scorpionTank,
  gatling_track:  gatlingTrack,
  siege_howitzer: siegeHowitzer,
  harvester,
  technical,
  phantom_tank:   phantomTank,
  venom_drone:    venomDrone,
  razor_jet:      razorJet,
  goliath,
  spectre,
  warlord,
};

function resolveFactory(key, def) {
  if (FACTORIES[key]) return FACTORIES[key];
  // fuzzy: sim may use longer names like 'goliath_supertank'
  for (const k of Object.keys(FACTORIES)) {
    if (key && (key.includes(k) || k.includes(key))) return FACTORIES[k];
  }
  if (def?.isHarvester) return FACTORIES.harvester;
  const ac = def?.armorClass;
  if (ac === 'air') return FACTORIES.venom_drone;
  if (ac === 'infantry') return squadFactory(def?.damageType === 'missile' ? 'launcher' : 'rifle', def?.squadSize || 3);
  return FACTORIES.scorpion_tank;
}

function makeStealthFadable(g) {
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
}

/** Set whole-unit opacity (only works for stealth-fadable units). */
export function setUnitOpacity(g, op) {
  const mats = g?.userData?.fadeMats;
  if (!mats) return;
  for (const m of mats) m.opacity = op * (m.userData.baseOp ?? 1);
}

/**
 * Build a mesh group for a sim unit. unit: {key, side, def}
 * Returned group.userData: {turret?, muzzle?, radius, aimY, height, air?, hoverY?,
 *                           spinners?, wheels?, legs?, fadeMats?}
 */
export function createUnitMesh(unit) {
  const side = unit?.side === 'enemy' ? 'enemy' : 'player';
  const def = unit?.def || {};
  const key = String(unit?.key || '');
  const g = resolveFactory(key, def)(side, def);
  g.userData.side = side;
  g.userData.key = key;
  g.userData.radius ??= 0.5;
  g.userData.aimY ??= 0.4;
  g.userData.height ??= 0.7;
  g.traverse((o) => {
    if (o.isMesh && !o.userData.noShadow) { o.castShadow = true; }
  });
  if (def.stealth) makeStealthFadable(g);
  return g;
}

/** Per-frame sub-part animation: rotors, wheels, gatling spin, leg swings. */
export function animateUnitMesh(g, dt, time, moving) {
  const u = g?.userData;
  if (!u) return;
  if (u.spinners) {
    for (let i = 0; i < u.spinners.length; i++) {
      const s = u.spinners[i];
      s.o.rotation[s.ax] += s.sp * dt * (s.idle || moving ? 1 : 0.18);
    }
  }
  if (u.wheels && moving) {
    for (let i = 0; i < u.wheels.length; i++) u.wheels[i].rotation.x += dt * 7;
  }
  if (u.legs) {
    const k = Math.min(1, dt * 9);
    for (let i = 0; i < u.legs.length; i++) {
      const L = u.legs[i];
      const target = moving ? Math.sin(time * L.hz + L.ph) * L.amp : 0;
      L.o.rotation.x += (target - L.o.rotation.x) * k;
    }
  }
}

// ─── FREEDOM FIGHT — infantry close-up viewer (dev only) ─────────────────────
// Eye-level lineup of game-exact character instances (real createModelMesh
// path: weapon strip, normalize, outfit). Used to iterate on infantry looks.
//   char-view.html?units=coalition/trooper,coalition/javelin   units to show
//     &matcolor=Grey:ff00ff,Wood:00ff00   recolor materials by name (region ID)
//     &spin=1                             each copy yawed 120° (front/side/back)
//     &dist=3.2&y=0.75                    camera tweak
//     &report=5198&run=id&shots=1         headless screenshot POST (t≈1.2s)
// Title reports GFX_OK / GFX_ERR like the other harnesses.
import * as THREE from 'three';
import { preloadModels, createModelMesh } from './models.js';

const P = new URLSearchParams(location.search);
const UNITS = (P.get('units') || 'coalition/trooper').split(',').filter(Boolean);
const COPIES = Number(P.get('copies') || 3);          // rotated copies per unit
const DIST = Number(P.get('dist') || 0);              // 0 = auto from row width

const canvas = document.getElementById('cv');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2620);
scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x5a4a33, 1.0));
const sun = new THREE.DirectionalLight(0xfff2dd, 1.8);
sun.position.set(4, 8, 6);
scene.add(sun);
scene.add(new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x6b5a40, roughness: 1 })
));

// real game template path (respects ?onlyModels= for fast boot)
await preloadModels();

const GAP = 1.3;
const total = UNITS.length * COPIES;
let i = 0;
for (const fk of UNITS) {
  const [f, k] = fk.split('/');
  for (let c = 0; c < COPIES; c++, i++) {
    const g = createModelMesh(f, k);
    if (!g) { window.__ERRS.push('no model ' + fk); continue; }
    g.position.set((i - (total - 1) / 2) * GAP, 0, 0);
    g.rotation.y = (c / COPIES) * Math.PI * 2;   // first copy faces camera
    scene.add(g);
  }
}

// material recolor for body-region identification
const MATCOLOR = P.get('matcolor');
if (MATCOLOR) {
  const map = new Map(MATCOLOR.split(',').map((s) => s.split(':')));
  scene.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      const hex = map.get(m.name);
      if (hex) m.color.set('#' + hex);
    }
  });
}

const rowW = total * GAP;
const dist = DIST || Math.max(2.6, rowW * 0.62);
const camY = Number(P.get('y') || 1.0);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, camY, dist);
camera.lookAt(0, 0.62, 0);

let t = 0, shotDone = false;
const rp = P.get('report');
renderer.setAnimationLoop(() => {
  t += 1 / 60;
  renderer.render(scene, camera);
  if (rp && P.get('shots') && t > 1.2 && !shotDone) {
    shotDone = true;
    try {
      const cv2 = document.createElement('canvas');
      cv2.width = 1000; cv2.height = 562;
      cv2.getContext('2d').drawImage(canvas, 0, 0, 1000, 562);
      fetch(`http://localhost:${rp}/shot?run=${P.get('run') || 'cv'}&t=${t.toFixed(1)}`, { method: 'POST', mode: 'no-cors', body: cv2.toDataURL('image/png') })
        .finally(() => fetch(`http://localhost:${rp}/report?run=${P.get('run') || 'cv'}&msg=DONE`, { mode: 'no-cors' }).catch(() => {}));
    } catch (e) { window.__ERRS.push('shot: ' + e); }
  }
});

document.title = window.__ERRS.length
  ? `GFX_ERR ${window.__ERRS.length}: ${window.__ERRS[0]}`
  : 'GFX_OK';

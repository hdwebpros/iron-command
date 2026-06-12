// ─── FREEDOM FIGHT — CC0/CC-BY candidate model lineup (dev only) ─────────────
// Renders downloaded poly.pizza candidates in a labeled grid for screening.
//   candidates-preview.html?terms=bulldozer,army%20truck&cols=5&cell=7
// Title reports GFX_OK <n> loaded / GFX_ERR like the other preview harnesses.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const P = new URLSearchParams(location.search);
const TERMS = (P.get('terms') || '').split(',').filter(Boolean);
const COLS = Number(P.get('cols') || 5);
const CELL = Number(P.get('cell') || 7);
const SCALE = Number(P.get('scale') || 3.2);   // largest dimension, world units

const canvas = document.getElementById('cv');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(1);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1610);
scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x5a4a33, 1.1));
const sun = new THREE.DirectionalLight(0xfff2dd, 2.0);
sun.position.set(8, 14, 6);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 500);
camera.position.set(0, 30, 20);
camera.lookAt(0, 0, 0);
renderer.setAnimationLoop(() => renderer.render(scene, camera));

const DIR = P.get('dir') || 'candidates';
const IDS = (P.get('ids') || '').split(',').filter(Boolean);
let items;
if (DIR !== 'candidates') {
  items = IDS.map((id) => ({ id, term: DIR, creator: '', license: '' }));
} else {
  const manifest = await (await fetch('/models/candidates/manifest.json')).json();
  items = IDS.length
    ? IDS.map((id) => manifest.find((m) => m.id === id)).filter(Boolean)
    : manifest.filter((m) => !TERMS.length || TERMS.includes(m.term));
}
const rows = Math.ceil(items.length / COLS) || 1;

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(COLS * CELL + 8, rows * CELL + 8),
  new THREE.MeshStandardMaterial({ color: 0x4a4032, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.set(((COLS - 1) * CELL) / 2, -0.02, ((rows - 1) * CELL) / 2);
scene.add(ground);

const loader = new GLTFLoader();
const labels = [];
let loaded = 0, failed = 0;
await Promise.all(items.map(async (m, i) => {
  const cx = (i % COLS) * CELL, cz = Math.floor(i / COLS) * CELL;
  try {
    const gltf = await loader.loadAsync(`/models/${DIR}/${m.id}.glb`);
    const obj = gltf.scene;
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const s = SCALE / Math.max(size.x, size.y, size.z, 0.001);
    obj.scale.setScalar(s);
    if (P.get('spin')) obj.rotation.y = i * Math.PI / 4;   // spin test: instance i yawed i*45°
    const box2 = new THREE.Box3().setFromObject(obj);
    const ctr = box2.getCenter(new THREE.Vector3());
    obj.position.set(cx - ctr.x, -box2.min.y, cz - ctr.z);
    scene.add(obj);
    loaded++;
  } catch (e) {
    window.__ERRS.push(`${m.id}: ${e.message || e}`);
    failed++;
  }
  labels.push({ x: cx, z: cz, text: `#${i} ${m.id}\n${m.creator} ${m.license}` });
}));

// camera: RTS-ish pitch, fit the whole grid
const cx = ((COLS - 1) * CELL) / 2, cz = ((rows - 1) * CELL) / 2;
const span = Math.max(COLS * CELL * 0.78, (rows + 1) * CELL * 1.05);
camera.position.set(cx, span * 0.78, cz + span * 0.6);
camera.lookAt(cx, 0, cz);

// HTML labels projected at each cell's front edge
for (const l of labels) {
  const v = new THREE.Vector3(l.x, 0, l.z + CELL * 0.34).project(camera);
  const div = document.createElement('div');
  div.className = 'lbl';
  div.textContent = l.text;
  div.style.left = `${((v.x + 1) / 2) * innerWidth}px`;
  div.style.top = `${((1 - v.y) / 2) * innerHeight}px`;
  document.body.appendChild(div);
}

document.title = window.__ERRS.length
  ? `GFX_ERR ${window.__ERRS.length}: ${window.__ERRS[0]}`
  : `GFX_OK ${loaded} loaded ${failed} failed`;

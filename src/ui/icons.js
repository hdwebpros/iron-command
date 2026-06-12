// ════════════════════════════════════════════════════════════════════════════
// FREEDOM FIGHT — 3D entity icons for the HUD.
//
// Renders each unit/structure's actual in-game mesh (GLTF model when one is
// loaded, procedural mesh otherwise) into a small offscreen WebGL canvas and
// caches the result as a PNG data URL. entityIcon() returns an <img> tag that
// drops into the same slots the SVG glyphs used; if WebGL is unavailable it
// falls back to the old glyph so the HUD never breaks.
//
// When the GLTF pack finishes loading the cache is cleared and any icons
// already in the DOM are re-rendered in place, so early procedural snapshots
// upgrade to the real models.
// ════════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { createEntityMesh } from '../gfx/meshes.js';
import { onModelsReady } from '../gfx/models.js';
import { svg, glyph } from './meta.js';
import { ICON_ART } from './icon-manifest.js';

/** Baked painted art (Gemini-generated, scripts/gen-icons.mjs) if it exists. */
function artIcon(key, cls) {
  if (!ICON_ART.has(key)) return null;
  return `<img class="${cls} ic-art-icon" src="/icons/${key}.webp" alt="" draggable="false">`;
}

/** Painted emblem for abilities/powers — null when no art is baked. */
export function emblemIcon(key, cls = '') {
  return artIcon(key, cls);
}

const W = 184, H = 168; // ~40:36 aspect, sized for the largest slot (watermark @2x)

let renderer = null;    // null = not tried, false = unavailable
let scene, camera, keyLight, rimLight;
const cache = new Map(); // `${faction||'auto'}/${key}` → dataURL | null

function ensureRenderer() {
  if (renderer !== null) return !!renderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(W, H);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
  } catch (e) {
    console.warn('[icons] WebGL unavailable, keeping SVG glyphs', e?.message || e);
    renderer = false;
    return false;
  }
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(26, W / H, 0.05, 200);
  // same palette as the in-game sun + sky so icons match the world
  scene.add(new THREE.HemisphereLight(0x96aed2, 0xb07c48, 0.95));
  keyLight = new THREE.DirectionalLight(0xffbe7d, 3.0);
  scene.add(keyLight);
  rimLight = new THREE.DirectionalLight(0x9db8ff, 1.3);
  scene.add(rimLight);
  return true;
}

function renderIcon(key, faction) {
  if (!ensureRenderer()) return null;
  let g;
  try {
    g = createEntityMesh({ key, faction: faction || undefined, side: 'player' });
  } catch (e) {
    console.warn('[icons] mesh failed for', key, e?.message || e);
    return null;
  }
  // skinned models: apply the first idle frame so they don't render in T-pose
  if (g.userData.anim) g.userData.anim.mixer.update(0.001);
  scene.add(g);
  g.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(g);
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const r = Math.max(size.length() / 2, 0.4);
  // 3/4 hero angle from the front-right (mesh forward = +Z)
  const dir = new THREE.Vector3(1.15, 0.85, 1.35).normalize();
  const vFit = r / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const hFit = vFit / camera.aspect;
  const dist = Math.max(vFit, hFit) * 0.98;
  camera.position.copy(c).addScaledVector(dir, dist);
  camera.lookAt(c);
  keyLight.position.copy(c).add(new THREE.Vector3(2.4, 3.2, 2.0).multiplyScalar(r));
  keyLight.target = g;
  rimLight.position.copy(c).add(new THREE.Vector3(-2.0, 1.6, -2.6).multiplyScalar(r));
  rimLight.target = g;

  let url = null;
  try {
    renderer.render(scene, camera);
    url = renderer.domElement.toDataURL('image/png');
  } catch (e) {
    console.warn('[icons] render failed for', key, e?.message || e);
  }
  scene.remove(g);
  return url;
}

export function entityIconURL(key, faction) {
  const ck = (faction || 'auto') + '/' + key;
  if (!cache.has(ck)) cache.set(ck, renderIcon(key, faction || null));
  return cache.get(ck);
}

// Re-render icons already in the DOM once the GLTF models arrive.
let hooked = false;
function hookModelUpgrade() {
  if (hooked) return;
  hooked = true;
  onModelsReady(() => {
    cache.clear();
    document.querySelectorAll('img[data-ickey]').forEach((img) => {
      const url = entityIconURL(img.dataset.ickey, img.dataset.icfac || null);
      if (url) img.src = url;
    });
  });
}

/**
 * HTML for an entity icon: baked painted art when available, else an <img>
 * snapshot of the real mesh, else the old SVG glyph. `cls` lands on the
 * element either way so existing size rules keep working.
 */
export function entityIcon(key, { faction = null, cls = '' } = {}) {
  const art = artIcon(key, cls);
  if (art) return art;
  hookModelUpgrade();
  const url = entityIconURL(key, faction);
  if (!url) return svg('0 0 40 36', glyph(key), cls);
  return `<img class="${cls} ic-3d-icon" data-ickey="${key}" data-icfac="${faction || ''}" src="${url}" alt="" draggable="false">`;
}

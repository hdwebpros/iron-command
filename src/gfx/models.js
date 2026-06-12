// ─── IRON COMMAND — CC0 model registry (Quaternius packs, /public/models) ───
// Loads GLTF/FBX unit models once at startup, normalizes them (scale, ground
// offset, forward = +Z), tints them per faction, and hands out instances that
// carry the same userData contract as the procedural meshes (radius, height,
// aimY, turret, muzzle) plus `anim` for clip-driven units.
// Keys not in MODEL_DEFS keep their procedural mesh; until loading finishes
// createEntityMesh also falls back to procedural and the renderer rebuilds
// affected entities via onModelsReady().
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { FACTION_COLORS } from './meshes.js';

// fit: 'l' scales to footprint length, 'h' to height. yaw: model-forward → +Z.
// tintAmt: lerp of every material color toward the faction color.
const CHAR_ANIMS = { idle: 'Idle', move: 'Run_Gun', shoot: 'Idle_Shoot', death: 'Death' };
const TANK = (url, size) => ({
  url, fit: 'l', size, yaw: Math.PI, tintAmt: 0.32,
  turret: 'Tank_Turret', gun: 'Tank_Gun', anims: { move: 'Tank_Forward' },
});
const RIFLE = { url: '/models/toonshooter/chars/Character_Soldier.gltf', fit: 'h', size: 1.25, yaw: Math.PI, tintAmt: 0.42, anims: CHAR_ANIMS };
const ROCKET = { url: '/models/toonshooter/chars/Character_Enemy.gltf', fit: 'h', size: 1.25, yaw: Math.PI, tintAmt: 0.42, anims: CHAR_ANIMS };

const MODEL_DEFS = {
  coalition: {
    trooper: RIFLE,
    javelin: ROCKET,
    paladin: TANK('/models/tanks/Tank2.fbx', 3.2),
  },
  dominion: {
    conscript: RIFLE,
    hunter: ROCKET,
    warmaster: TANK('/models/tanks/Tank3.fbx', 3.5),
    emperor: TANK('/models/tanks/Tank4.fbx', 4.8),
  },
  syndicate: {
    militant: RIFLE,
    stinger: ROCKET,
    scorpion: TANK('/models/tanks/Tank.fbx', 2.9),
  },
};

/* ── loading ────────────────────────────────────────────────────────────── */
const rawCache = new Map();       // url → Promise<{scene, animations}>
const templates = new Map();      // `${faction}/${key}` → processed template
let ready = false;
const readyCbs = [];

function loadRaw(url) {
  let p = rawCache.get(url);
  if (!p) {
    p = (url.endsWith('.fbx') ? new FBXLoader() : new GLTFLoader()).loadAsync(url)
      .then((r) => (r.scene ? { scene: r.scene, animations: r.animations || [] } : { scene: r, animations: r.animations || [] }));
    rawCache.set(url, p);
  }
  return p;
}

function buildTemplate(faction, key, def, raw) {
  const inner = new THREE.Group();
  const model = SkeletonUtils.clone(raw.scene);
  inner.add(model);
  inner.rotation.y = def.yaw || 0;

  // normalize: forward-baked rotation → scale to target → feet on the ground
  let box = new THREE.Box3().setFromObject(inner);
  const d = box.getSize(new THREE.Vector3());
  const cur = def.fit === 'h' ? d.y : Math.max(d.x, d.z);
  inner.scale.multiplyScalar(def.size / (cur || 1));
  inner.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(inner);
  const c = box.getCenter(new THREE.Vector3());
  inner.position.set(-c.x, -box.min.y, -c.z);

  const g = new THREE.Group();
  g.add(inner);

  // per-template material clones, tinted toward the faction color
  const tint = new THREE.Color(FACTION_COLORS[faction] ?? 0xd8b04a);
  const seen = new Map();
  g.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    const fix = (mat) => {
      let m2 = seen.get(mat);
      if (!m2) {
        m2 = mat.clone();
        if (m2.color && def.tintAmt) m2.color.lerp(tint, def.tintAmt);
        seen.set(mat, m2);
      }
      return m2;
    };
    o.material = Array.isArray(o.material) ? o.material.map(fix) : fix(o.material);
  });

  // muzzle anchor at the gun-barrel tip (template forward = +Z)
  let muzzleParentName = null, muzzleLocal = null;
  if (def.gun) {
    const gun = g.getObjectByName(def.gun);
    if (gun) {
      g.updateMatrixWorld(true);
      const gb = new THREE.Box3().setFromObject(gun);
      if (!gb.isEmpty()) {
        const tip = new THREE.Vector3((gb.min.x + gb.max.x) / 2, (gb.min.y + gb.max.y) / 2, gb.max.z);
        muzzleParentName = def.gun;
        muzzleLocal = gun.worldToLocal(tip.clone());
      }
    }
  }

  // animation clips: resolve by name, drop tracks that would fight turret aiming
  const clips = {};
  if (def.anims) {
    for (const [slot, name] of Object.entries(def.anims)) {
      const clip = raw.animations.find((a) => a.name === name || a.name.endsWith('|' + name));
      if (!clip) continue;
      const c2 = clip.clone();
      if (def.turret) c2.tracks = c2.tracks.filter((t) => !/Turret|Gun/i.test(t.name));
      clips[slot] = c2;
    }
  }

  box = new THREE.Box3().setFromObject(g);
  const dim = box.getSize(new THREE.Vector3());
  templates.set(faction + '/' + key, {
    g, def, clips, muzzleParentName, muzzleLocal,
    radius: Math.max(dim.x, dim.z) / 2,
    height: dim.y,
    aimY: dim.y * 0.55,
    skinned: !!raw.animations.length,
  });
}

export function preloadModels() {
  const jobs = [];
  for (const [faction, keys] of Object.entries(MODEL_DEFS)) {
    for (const [key, def] of Object.entries(keys)) {
      jobs.push(loadRaw(def.url)
        .then((raw) => buildTemplate(faction, key, def, raw))
        .catch((e) => console.warn('[models] failed', faction, key, e?.message || e)));
    }
  }
  return Promise.all(jobs).then(() => {
    ready = true;
    for (const cb of readyCbs.splice(0)) cb();
  });
}

/** Run cb once every template finished loading (immediately if already done). */
export function onModelsReady(cb) {
  if (ready) cb(); else readyCbs.push(cb);
}

export function hasModel(faction, key) {
  return templates.has(faction + '/' + key);
}

/**
 * Instance a loaded model template, or null if none/not loaded yet.
 * Returned group carries userData {radius, height, aimY, turret?, muzzle?, anim?}.
 */
export function createModelMesh(faction, key) {
  const t = templates.get(faction + '/' + key);
  if (!t) return null;
  const g = t.skinned ? SkeletonUtils.clone(t.g) : t.g.clone(true);
  const u = g.userData;
  u.radius = t.radius;
  u.height = t.height;
  u.aimY = t.aimY;
  u.model = true;
  if (t.def.turret) u.turret = g.getObjectByName(t.def.turret) || null;
  if (t.muzzleParentName && t.muzzleLocal) {
    const parent = g.getObjectByName(t.muzzleParentName);
    if (parent) {
      const muz = new THREE.Object3D();
      muz.position.copy(t.muzzleLocal);
      parent.add(muz);
      u.muzzle = muz;
    }
  }
  const slots = Object.keys(t.clips);
  if (slots.length) {
    const mixer = new THREE.AnimationMixer(g);
    const actions = {};
    for (const slot of slots) actions[slot] = mixer.clipAction(t.clips[slot]);
    if (actions.death) {
      actions.death.setLoop(THREE.LoopOnce, 1);
      actions.death.clampWhenFinished = true;
    }
    u.anim = { mixer, actions, cur: null, lastAttackT: -1e9 };
    const start = actions.idle || actions.move;
    if (start) { start.play(); u.anim.cur = start; }
  }
  return g;
}

// ─── FREEDOM FIGHT — CC0 model registry (Quaternius packs, /public/models) ───
// Loads GLTF/FBX unit models once at startup, normalizes them (scale, ground
// offset, forward = +Z), tints them per faction, and hands out instances that
// carry the same userData contract as the procedural meshes (radius, height,
// aimY, turret, muzzle) plus `anim` for clip-driven units.
//
// Two instancing strategies:
//  · GLTF characters — SkeletonUtils.clone of a processed template (bone names
//    are unique, cloning is safe) + an AnimationMixer per instance.
//  · FBX tanks — the Quaternius tank rigs (armature-skinned hulls, duplicate
//    bone names, FBX geometric transforms) do not survive cloning or
//    reparenting. We bake them ONCE to plain static meshes (skinned verts
//    sampled at the loaded pose), with an explicit TurretPivot/MuzzlePoint,
//    and instances are cheap Group.clone(true) calls. Tread animation is
//    dropped — the renderer's dust/wheel FX cover movement.
//
// Keys not in MODEL_DEFS keep their procedural mesh; until loading finishes
// createEntityMesh also falls back to procedural and the renderer rebuilds
// affected entities via onModelsReady().
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { FACTION_COLORS } from './meshes.js';

// fit: 'l' scales to footprint length, 'h' to height. yaw: model-forward → +Z
// (tank barrels point -X as authored, so +90°). tintAmt: lerp of material
// colors toward the faction color.
const CHAR_ANIMS = { idle: 'Idle', move: 'Run_Gun', shoot: 'Idle_Shoot', death: 'Death' };
const TANK = (url, size) => ({
  url, fit: 'l', size, yaw: Math.PI / 2, tintAmt: 0.32,
  turret: 'Tank_Turret', gun: 'Tank_Gun',
});
// ToonShooter chars ship with EVERY weapon mesh attached (plus a stray
// Icosphere) — `weapon` picks the one to keep; the rest are stripped before
// normalization so the bbox (and thus the scale) comes from the body alone.
// Chars are authored facing +Z already, so yaw stays 0.
const CHAR = (file, weapon, size = 1.25) => ({
  url: `/models/toonshooter/chars/Character_${file}.gltf`,
  fit: 'h', size, yaw: 0, tintAmt: 0.42, anims: CHAR_ANIMS, weapon,
});
// Static GLB vehicles from /models/units (poly.pizza picks, see CREDITS.md).
const VEH = (file, size, yaw = 0) => ({ url: `/models/units/${file}.glb`, fit: 'l', size, yaw, tintAmt: 0.3 });
const AIR = (file, size, yaw = 0, hoverY = 4.5) => ({ ...VEH(file, size, yaw), hoverY });

const MODEL_DEFS = {
  coalition: {
    trooper:  CHAR('Soldier', 'AK'),
    javelin:  CHAR('Soldier', 'RocketLauncher'),
    marksman: CHAR('Soldier', 'Sniper'),
    ghost:    CHAR('Enemy', 'Sniper_2', 1.4),
    dozer:    VEH('dozer_a', 2.8, Math.PI / 2),
    outrider: VEH('outrider', 3.0, Math.PI),
    paladin:  TANK('/models/tanks/Tank2.fbx', 3.2),
    tempest:  VEH('tempest', 3.5),
    pelican:  AIR('pelican', 3.0, Math.PI / 2),
    specter:  AIR('specter', 3.4, Math.PI / 2),
    falcon:   AIR('falcon', 3.4, -Math.PI / 4, 5.5),
    meteor:   AIR('meteor', 4.4, 0, 6),
  },
  dominion: {
    conscript:  CHAR('Enemy', 'SMG'),
    hunter:     CHAR('Enemy', 'RocketLauncher'),
    hacker:     CHAR('Enemy', 'Pistol'),
    mantis:     CHAR('Enemy', 'Knife_2', 1.4),
    dozer:      VEH('dozer_b', 2.8, Math.PI),
    supplyTruck: VEH('supply_truck', 3.2),
    warmaster:  TANK('/models/tanks/Tank3.fbx', 3.5),
    shredder:   VEH('shredder', 3.0, Math.PI / 2),
    dragon:     VEH('dragon', 3.3, Math.PI / 2),
    hellstorm:  VEH('hellstorm', 3.4),
    emperor:    TANK('/models/tanks/Tank4.fbx', 4.8),
    vulture:    AIR('vulture', 3.4, 0, 5.5),
  },
  syndicate: {
    worker:    CHAR('Hazmat', 'Shovel'),
    militant:  CHAR('Hazmat', 'Shotgun'),
    stinger:   CHAR('Hazmat', 'GrenadeLauncher'),
    fanatic:   CHAR('Hazmat', 'Knife_1'),
    cobra:     CHAR('Hazmat', 'Sniper', 1.4),
    technical: VEH('technical', 2.9),
    scorpion:  TANK('/models/tanks/Tank.fbx', 2.9),
    quad:      VEH('quad', 2.6),
    toxinTractor: VEH('toxin_tractor', 3.0),
    buggy:     VEH('buggy', 2.6, Math.PI),
    scud:      VEH('scud', 3.6),
  },
};

// every removable accessory mesh in the ToonShooter char files
const CHAR_ACCESSORIES = new Set([
  'AK', 'GrenadeLauncher', 'Knife_1', 'Knife_2', 'Pistol', 'Revolver',
  'Revolver_Small', 'RocketLauncher', 'ShortCannon', 'Shotgun', 'Shovel',
  'SMG', 'Sniper', 'Sniper_2', 'Icosphere',
]);

/* ── loading ────────────────────────────────────────────────────────────── */
const rawCache = new Map();       // url → Promise<raw>
const templates = new Map();      // `${faction}/${key}` → template
let ready = false;
const readyCbs = [];

// raw: {kind:'gltf', scene, animations} | {kind:'fbx', scene}
function loadRaw(url) {
  let p = rawCache.get(url);
  if (!p) {
    p = url.endsWith('.fbx')
      ? new FBXLoader().loadAsync(url).then((scene) => ({ kind: 'fbx', scene }))
      : new GLTFLoader().loadAsync(url).then((g) => ({ kind: 'gltf', scene: g.scene, animations: g.animations || [] }));
    rawCache.set(url, p);
  }
  return p;
}

/** Bake a (possibly skinned) hierarchy to flat world-space static meshes. */
function bakeStatic(root) {
  root.updateMatrixWorld(true);
  const out = new THREE.Group();
  const v = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry.clone();
    if (o.isSkinnedMesh) {
      o.skeleton.update();
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        o.applyBoneTransform(i, v);          // skinned position, mesh-local
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      geo.applyMatrix4(o.matrixWorld);
      geo.computeVertexNormals();
    } else {
      geo.applyMatrix4(o.matrixWorld);
    }
    const m = new THREE.Mesh(geo, o.material);
    m.name = o.name;
    out.add(m);                              // all world-space, group identity
  });
  return out;
}

/** Tint + shadow-flag every mesh material (one clone per distinct material). */
function tintMaterials(g, tint, amt) {
  const seen = new Map();
  g.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    const fix = (mat) => {
      let m2 = seen.get(mat);
      if (!m2) {
        m2 = mat.clone();
        if (m2.color && amt) m2.color.lerp(tint, amt);
        seen.set(mat, m2);
      }
      return m2;
    };
    o.material = Array.isArray(o.material) ? o.material.map(fix) : fix(o.material);
  });
}

/** Wrap `content` so forward=+Z, footprint/height = def.size, feet at y=0. */
function normalize(content, def) {
  const inner = new THREE.Group();
  inner.add(content);
  inner.rotation.y = def.yaw || 0;
  const g = new THREE.Group();
  g.add(inner);
  g.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(g);
  const d = box.getSize(new THREE.Vector3());
  const cur = def.fit === 'h' ? d.y : Math.max(d.x, d.z);
  inner.scale.setScalar(def.size / (cur || 1));
  g.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(g);
  const c = box.getCenter(new THREE.Vector3());
  inner.position.set(-c.x, -box.min.y, -c.z);
  g.updateMatrixWorld(true);
  return g;
}

function metrics(g) {
  const box = new THREE.Box3().setFromObject(g);
  const dim = box.getSize(new THREE.Vector3());
  return { radius: Math.max(dim.x, dim.z) / 2, height: dim.y, aimY: dim.y * 0.55 };
}

function buildTankTemplate(faction, key, def, raw) {
  // bake rig → static meshes (world space, loaded pose)
  const baked = bakeStatic(raw.scene);

  // re-root turret + gun onto a named pivot at the turret node's position so
  // the renderer can yaw it (geometry shifts into pivot space)
  const tNode = raw.scene.getObjectByName(def.turret);
  const pivotPos = new THREE.Vector3();
  if (tNode) tNode.getWorldPosition(pivotPos);
  const pivot = new THREE.Object3D();
  pivot.name = 'TurretPivot';
  pivot.position.copy(pivotPos);
  const turretMeshes = baked.children.filter((m) => m.name === def.turret || m.name === def.gun);
  for (const m of turretMeshes) {
    m.geometry.translate(-pivotPos.x, -pivotPos.y, -pivotPos.z);
    pivot.add(m);                            // removes from baked.children
  }
  baked.add(pivot);

  // muzzle: tip of the gun barrel — far end (from pivot) of its longest
  // horizontal axis, in pivot space
  const gunMesh = pivot.children.find((m) => m.name === def.gun);
  if (gunMesh) {
    gunMesh.geometry.computeBoundingBox();
    const gb = gunMesh.geometry.boundingBox;
    const ext = gb.getSize(new THREE.Vector3());
    const ax = ext.x >= ext.z ? 'x' : 'z';
    const tip = gb.getCenter(new THREE.Vector3());
    tip[ax] = Math.abs(gb.min[ax]) > Math.abs(gb.max[ax]) ? gb.min[ax] : gb.max[ax];
    const muz = new THREE.Object3D();
    muz.name = 'MuzzlePoint';
    muz.position.copy(tip);
    pivot.add(muz);
  }

  const g = normalize(baked, def);
  tintMaterials(g, new THREE.Color(FACTION_COLORS[faction] ?? 0xd8b04a), def.tintAmt);
  templates.set(faction + '/' + key, { kind: 'tank', def, g, ...metrics(g) });
}

function buildCharTemplate(faction, key, def, raw) {
  const src = SkeletonUtils.clone(raw.scene);
  // GLTFLoader loads multi-primitive weapon nodes as Groups named 'AK' etc.
  // with anonymous child meshes — match on node name at any level, not isMesh.
  const drop = [];
  src.traverse((o) => { if (CHAR_ACCESSORIES.has(o.name) && o.name !== def.weapon) drop.push(o); });
  for (const o of drop) o.parent.remove(o);
  const g = normalize(src, def);
  tintMaterials(g, new THREE.Color(FACTION_COLORS[faction] ?? 0xd8b04a), def.tintAmt);
  templates.set(faction + '/' + key, { kind: 'char', def, g, animations: raw.animations, ...metrics(g) });
}

function buildStaticTemplate(faction, key, def, raw) {
  const g = normalize(bakeStatic(raw.scene), def);
  tintMaterials(g, new THREE.Color(FACTION_COLORS[faction] ?? 0xd8b04a), def.tintAmt);
  templates.set(faction + '/' + key, { kind: 'static', def, g, ...metrics(g) });
}

export function preloadModels() {
  const jobs = [];
  for (const [faction, keys] of Object.entries(MODEL_DEFS)) {
    for (const [key, def] of Object.entries(keys)) {
      jobs.push(loadRaw(def.url)
        .then((raw) => (raw.kind === 'fbx' ? buildTankTemplate : def.anims ? buildCharTemplate : buildStaticTemplate)(faction, key, def, raw))
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
  const g = t.kind === 'char' ? SkeletonUtils.clone(t.g) : t.g.clone(true);
  const u = g.userData;
  u.radius = t.radius;
  u.height = t.height;
  u.aimY = t.aimY;
  u.model = true;
  if (t.def.hoverY) { u.hoverY = t.def.hoverY; u.air = true; }
  if (t.kind === 'tank' || t.kind === 'static') {
    u.turret = g.getObjectByName('TurretPivot') || null;
    u.muzzle = g.getObjectByName('MuzzlePoint') || null;
    return g;
  }
  // skinned bounds don't track the pose — without this the body can vanish
  // or render stale depending on camera, while bone-attached props remain
  g.traverse((o) => { if (o.isSkinnedMesh) o.frustumCulled = false; });
  // characters: per-instance mixer with idle/move/shoot/death actions
  const mixer = new THREE.AnimationMixer(g);
  const actions = {};
  for (const [slot, name] of Object.entries(t.def.anims || {})) {
    const clip = t.animations.find((a) => a.name === name);
    if (clip) actions[slot] = mixer.clipAction(clip);
  }
  if (actions.death) {
    actions.death.setLoop(THREE.LoopOnce, 1);
    actions.death.clampWhenFinished = true;
  }
  u.anim = { mixer, actions, cur: null, lastAttackT: -1e9 };
  if (actions.idle) { actions.idle.play(); u.anim.cur = actions.idle; }
  return g;
}

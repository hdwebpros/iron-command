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
// `outfit` colors materials per region (see applyOutfit) so every unit reads
// distinct at a glance instead of the old whole-model faction tint.
const CHAR = (file, weapon, outfit, size = 1.35) => ({   // size pre-headScale; ~10% is lost to the head shrink
  url: `/models/toonshooter/chars/Character_${file}.gltf`,
  fit: 'h', size, yaw: 0, anims: CHAR_ANIMS, weapon, outfit,
});

/* ── infantry outfits ────────────────────────────────────────────────────────
   Region → material-name → color. Regions resolve by nearest named ancestor:
   body/head (split per model), pads (Soldier shoulder pads), weapon (the kept
   weapon node). Same material name in different regions colors independently
   (helmet vs jacket are both 'Character_Main').
   Soldier body: Character_Main=jacket  Pants=legs  Black=sleeves+boots
                 DarkGrey=chest rig  Skin=face+hands
   Soldier head: Character_Main=helmet  Grey=goggles  Black=strap+eyes
   Enemy body:   Enemy_Red=jacket  Grey=pants  Black=sleeves+boots  Skin=hands
   Enemy head:   Enemy_Red=hood  Black=mask  Skin=face
   Hazmat:       Hazmat_Main=suit  Black=visor+gloves+boots  DarkGrey=backpack
   `drop` removes nodes (silhouette variety).                              */
// guns are black/dark-grey only (Ryan); launcher keeps a muted red warhead tip
const GUNMETAL = { Grey: 0x33363b, Grey2: 0x232529, DarkGrey: 0x1b1d1f, Black: 0x101012, Wood: 0x262421, LightGrey: 0x3c3f44, DarkWood: 0x1f1d1a, Red: 0x4a2520 };
const LAUNCHER = { ...GUNMETAL, Red: 0x8c3325 };

const SKIN = { pale: 0xd9a877, tan: 0xc08a52, brown: 0x8a5a30, dark: 0x5f3d22 };
// per-instance skin variety pool (cycled in createModelMesh)
const SKIN_POOL = [0xd9a877, 0xc08a52, 0xa06a3c, 0x8a5a30, 0x6e4626, 0xe2b58a];
// Static GLB vehicles from /models/units (poly.pizza picks, see CREDITS.md).
const VEH = (file, size, yaw = 0) => ({ url: `/models/units/${file}.glb`, fit: 'l', size, yaw, tintAmt: 0.3 });
const AIR = (file, size, yaw = 0, hoverY = 4.5) => ({ ...VEH(file, size, yaw), hoverY });

const MODEL_DEFS = {
  coalition: {
    // rifleman: olive fatigues, blue-grey shoulder pads = the faction accent
    trooper:  CHAR('Soldier', 'AK', {
      body: { Skin: SKIN.tan, Character_Main: 0x55603a, Pants: 0x6a5c40, Black: 0x2a2119, DarkGrey: 0x4c4231 },
      head: { Character_Main: 0x46512f, Grey: 0x23262b, Black: 0x1b1c1e },
      pads: { Grey: 0x4c4231 },
      weapon: GUNMETAL,
    }),
    // AT specialist: no pads, tan fatigues, olive tube w/ red warhead
    javelin:  CHAR('Soldier', 'RocketLauncher', {
      body: { Skin: SKIN.brown, Character_Main: 0x8a7448, Pants: 0x5d5138, Black: 0x26201a, DarkGrey: 0x3c3528 },
      head: { Character_Main: 0x756137, Grey: 0x202327, Black: 0x191a1c },
      drop: ['ShoulderPadL', 'ShoulderPadR'],
      weapon: LAUNCHER,
    }),
    // sniper: no helmet (dark watch cap remains), mottled ghillie camo body
    marksman: CHAR('Soldier', 'Sniper', {
      body: { Skin: SKIN.pale, Character_Main: 0x39452c, Pants: 0x3f4a31, Black: 0x231f18, DarkGrey: 0x32402a },
      head: { Grey: 0x1a1c17, Black: 0x141512 },   // near-black cap, not helmet-green
      dropMats: { head: ['Character_Main'] },
      camo: ['Character_Main', 'Pants', 'DarkGrey'],   // body mats that get the camo map
      pads: { Grey: 0x39452c },
      weapon: GUNMETAL,
    }),
    // hero infiltrator: arctic slate-grey hood (Enemy body, NOT dominion red)
    ghost:    CHAR('Enemy', 'Sniper_2', {
      body: { Skin: SKIN.pale, Enemy_Red: 0x49505e, Grey: 0x32353c, Black: 0x1d1f24, DarkGrey: 0x282b31 },
      head: { Enemy_Red: 0x3f4654, Black: 0x16181c },
      weapon: { ...GUNMETAL, Wood: 0x2f3338 },
    }, 1.5),
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
    // rank-and-file: dominion red reads through the maroon jacket/hood
    conscript:  CHAR('Enemy', 'SMG', {
      body: { Skin: SKIN.tan, Enemy_Red: 0x73291f, Grey: 0x4a4a3c, Black: 0x1f1d1a, DarkGrey: 0x2a2622 },
      head: { Enemy_Red: 0x652319, Black: 0x181715 },
      weapon: GUNMETAL,
    }),
    // AT: black hood + black pants split him from the maroon conscript
    hunter:     CHAR('Enemy', 'RocketLauncher', {
      body: { Skin: SKIN.brown, Enemy_Red: 0x571f17, Grey: 0x141517, Black: 0x1c1a17, DarkGrey: 0x262320 },
      head: { Enemy_Red: 0x17181a, Black: 0x101011 },
      weapon: LAUNCHER,
    }),
    // saboteur: never attacks (deploy income only) — unarmed, charcoal coat
    hacker:     CHAR('Enemy', null, {
      body: { Skin: SKIN.pale, Enemy_Red: 0x35312e, Grey: 0x2b2926, Black: 0x1b1a18, DarkGrey: 0x232120 },
      head: { Enemy_Red: 0x6e2a20, Black: 0x161514 },
      dropMats: { head: ['Enemy_Red'] },
    }),
    // hero assassin: near-black with blood-red hood, bare steel knife
    mantis:     CHAR('Enemy', 'Knife_2', {
      body: { Skin: SKIN.dark, Enemy_Red: 0x2c1310, Grey: 0x222020, Black: 0x141312, DarkGrey: 0x1c1a19 },
      head: { Enemy_Red: 0x7e231a, Black: 0x121110 },
      weapon: { Black: 0x17171a, DarkGrey: 0x202126, LightGrey: 0xb9bfc9 },
    }, 1.5),
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
    // suits stop being astronaut-white: each unit gets its own worn color
    worker:    CHAR('Hazmat', 'Shovel', {
      body: { Hazmat_Main: 0x8a7544, Black: 0x26221c, DarkGrey: 0x4f4430 },
      head: { Hazmat_Main: 0x7c6a3e, Black: 0x1a1815 },
      weapon: { DarkWood: 0x4a3520, Grey: 0x4a4e54, Red: 0x8c3325 },
    }),
    // line infantry: militia — helmet + shirt with rig, bare arms, shotgun
    militant:  CHAR('Soldier', 'Shotgun', {
      body: { Skin: SKIN.tan, Character_Main: 0x4e5c30, Pants: 0x44402e, DarkGrey: 0x3a4426 },
      head: { Character_Main: 0x3e4a26, Grey: 0x22251f, Black: 0x181813 },
      bareArms: 'Black',   // sleeves+boots share this mat — arms split to skin
      drop: ['ShoulderPadL', 'ShoulderPadR'],
      weapon: GUNMETAL,
    }),
    // grenadier: grey-green suit, dark launcher (no wood on a launcher)
    stinger:   CHAR('Hazmat', 'GrenadeLauncher', {
      body: { Hazmat_Main: 0x5c6b54, Black: 0x1e201c, DarkGrey: 0x3a4236 },
      head: { Hazmat_Main: 0x525f4b, Black: 0x171815 },
      weapon: LAUNCHER,
    }),
    // cultist: looks like a civilian — bare head, street clothes, knife
    fanatic:   CHAR('Soldier', 'Knife_1', {
      body: { Skin: SKIN.tan, Character_Main: 0x7a3a2e, Pants: 0x39414e, Black: 0x26221e, DarkGrey: 0x6e3328 },
      head: { Grey: 0x3a2c1e, Black: 0x2b2014 },   // leftover goggles+strap read as hair
      dropMats: { head: ['Character_Main'] },
      drop: ['ShoulderPadL', 'ShoulderPadR'],
      weapon: { ...GUNMETAL, LightGrey: 0xb9bfc9 },
    }),
    // hero sniper: no helmet — Enemy body, hood stripped to a bare masked head
    cobra:     CHAR('Enemy', 'Sniper', {
      body: { Skin: SKIN.brown, Enemy_Red: 0x3a3d33, Grey: 0x2c2f29, Black: 0x17181a, DarkGrey: 0x222420 },
      head: { Black: 0x141517 },
      dropMats: { head: ['Enemy_Red'] },
      weapon: GUNMETAL,
    }, 1.5),
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
let skinSeq = 0;                  // cycles SKIN_POOL across char instances
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

// mottled woodland blobs on a small canvas — ghillie/camo `map` for outfits
let camoTex = null;
function getCamoTexture() {
  if (camoTex) return camoTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const c = cv.getContext('2d');
  c.fillStyle = '#48523a';
  c.fillRect(0, 0, 128, 128);
  const tones = ['#2e3823', '#39452c', '#5a6244', '#4a4030', '#242c1b'];
  for (let i = 0; i < 90; i++) {
    c.fillStyle = tones[i % tones.length];
    c.beginPath();
    c.ellipse(Math.random() * 128, Math.random() * 128, 6 + Math.random() * 14, 4 + Math.random() * 9, Math.random() * Math.PI, 0, Math.PI * 2);
    c.fill();
  }
  camoTex = new THREE.CanvasTexture(cv);
  camoTex.wrapS = camoTex.wrapT = THREE.RepeatWrapping;
  camoTex.colorSpace = THREE.SRGBColorSpace;
  return camoTex;
}

// region resolution for character outfits (nearest named ancestor wins)
const REGION_BY_NODE = {
  Body: 'body', Head: 'head',
  // GLTFLoader sanitizes node names ('ShoulderPad.L' → 'ShoulderPadL')
  ShoulderPadL: 'pads', ShoulderPadR: 'pads',
  Character_Enemy: 'body', Character_Enemy_Head: 'head',
  Character_Hazmat: 'body', Character_Hazmat_Head: 'head',
};

/** Color char materials per region (cloned per region, so the helmet and the
 *  jacket can diverge even though both are 'Character_Main'), drop nodes. */
function applyOutfit(g, def) {
  const outfit = def.outfit || {};
  for (const name of outfit.drop || []) {
    const n = g.getObjectByName(name);
    if (n) n.parent.remove(n);
  }
  const clones = new Map();   // `${region}|${srcMat.uuid}` → cloned material
  const dropMeshes = [];      // dropMats: {head:['Character_Main']} removes those primitives
  let bodySkinMat = null, bareArmsMesh = null;
  g.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    let region = 'body';
    for (let p = o; p; p = p.parent) {
      if (REGION_BY_NODE[p.name]) { region = REGION_BY_NODE[p.name]; break; }
      if (p.name === def.weapon) { region = 'weapon'; break; }
    }
    const dm = outfit.dropMats?.[region];
    if (dm && !Array.isArray(o.material) && dm.includes(o.material.name)) {
      dropMeshes.push(o);
      return;
    }
    if (region === 'body' && !Array.isArray(o.material) && o.material.name === outfit.bareArms) bareArmsMesh = o;
    // the pack's UV islands are degenerate (untextured export) — planar-project
    // fresh UVs from rest-pose positions so the camo map actually mottles.
    // Geometry is shared across templates from the same file: clone first.
    if (region === 'body' && !Array.isArray(o.material) && outfit.camo?.includes(o.material.name)) {
      o.geometry = o.geometry.clone();
      const pos = o.geometry.attributes.position;
      const uv = new Float32Array(pos.count * 2);
      for (let i = 0; i < pos.count; i++) {
        uv[i * 2] = (pos.getX(i) + pos.getY(i)) * 1.5;
        uv[i * 2 + 1] = (pos.getZ(i) - pos.getY(i)) * 1.5;
      }
      o.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
    const fix = (mat) => {
      const ck = region + '|' + mat.uuid;
      let m2 = clones.get(ck);
      if (!m2) {
        m2 = mat.clone();
        const hex = outfit[region]?.[mat.name];
        if (hex != null && m2.color) m2.color.set(hex);
        if (region === 'body' && outfit.camo?.includes(mat.name)) {
          m2.map = getCamoTexture();
          m2.color.set(0xffffff);
        }
        if (region === 'body' && mat.name === 'Skin') bodySkinMat = m2;
        clones.set(ck, m2);
      }
      return m2;
    };
    o.material = Array.isArray(o.material) ? o.material.map(fix) : fix(o.material);
  });
  for (const o of dropMeshes) o.parent.remove(o);
  // bareArms: the named body mat covers BOTH sleeves and boots in one
  // primitive — split its triangles by rest-pose height into a skin-material
  // mesh (arms, upper) and the original (boots, lower)
  if (bareArmsMesh && bodySkinMat) {
    const o = bareArmsMesh;
    const pos = o.geometry.attributes.position;
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const thresh = minY + 0.4 * (maxY - minY);
    const idx = o.geometry.index.array;
    const armIdx = [], lowIdx = [];
    for (let i = 0; i < idx.length; i += 3) {
      const cy = (pos.getY(idx[i]) + pos.getY(idx[i + 1]) + pos.getY(idx[i + 2])) / 3;
      (cy > thresh ? armIdx : lowIdx).push(idx[i], idx[i + 1], idx[i + 2]);
    }
    const armGeo = o.geometry.clone();
    armGeo.setIndex(armIdx);
    o.geometry = o.geometry.clone();
    o.geometry.setIndex(lowIdx);
    const arm = o.clone();          // SkinnedMesh clone shares this template's skeleton
    arm.geometry = armGeo;
    arm.material = bodySkinMat;     // named 'Skin' → per-instance tone applies
    o.parent.add(arm);
  }
}

function buildCharTemplate(faction, key, def, raw) {
  const src = SkeletonUtils.clone(raw.scene);
  // GLTFLoader loads multi-primitive weapon nodes as Groups named 'AK' etc.
  // with anonymous child meshes — match on node name at any level, not isMesh.
  const drop = [];
  src.traverse((o) => { if (CHAR_ACCESSORIES.has(o.name) && o.name !== def.weapon) drop.push(o); });
  for (const o of drop) o.parent.remove(o);
  // de-chibi: shrink the Head BONE (the head mesh node shares the name) — no
  // clip has scale tracks, so the scale survives animation. Helmet/hood meshes
  // ride the same bone and shrink with it.
  src.traverse((o) => { if (o.isBone && o.name === 'Head') o.scale.setScalar(def.headScale ?? 0.72); });
  const g = normalize(src, def);
  applyOutfit(g, def);
  templates.set(faction + '/' + key, { kind: 'char', def, g, animations: raw.animations, ...metrics(g) });
}

function buildStaticTemplate(faction, key, def, raw) {
  const g = normalize(bakeStatic(raw.scene), def);
  tintMaterials(g, new THREE.Color(FACTION_COLORS[faction] ?? 0xd8b04a), def.tintAmt);
  templates.set(faction + '/' + key, { kind: 'static', def, g, ...metrics(g) });
}

// [DEBUG-skin1] dev: ?onlyModels=coalition/trooper,coalition/javelin limits
// preloading to listed faction/key pairs (faster repro harness boot)
const ONLY_MODELS = typeof location !== 'undefined'
  ? (new URLSearchParams(location.search).get('onlyModels') || '').split(',').filter(Boolean)
  : [];

export function preloadModels() {
  const jobs = [];
  for (const [faction, keys] of Object.entries(MODEL_DEFS)) {
    for (const [key, def] of Object.entries(keys)) {
      if (ONLY_MODELS.length && !ONLY_MODELS.includes(faction + '/' + key)) continue;
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
  // per-instance skin tone (faces/hands vary across a squad)
  const tone = SKIN_POOL[(skinSeq = (skinSeq + 1) % SKIN_POOL.length)];
  const reSkin = (m) => (m.name === 'Skin' ? Object.assign(m.clone(), { color: new THREE.Color(tone) }) : m);
  g.traverse((o) => {
    if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(reSkin) : reSkin(o.material);
  });
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

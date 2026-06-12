// ─── FREEDOM FIGHT — GfxEngine (DESIGN §13.2, the gfx API contract) ──────────
//   const gfx = new GfxEngine(canvas);
//   gfx.attach(game); gfx.update(dt, state);
//   gfx.pick(cx,cy) / pickRect(x1,y1,x2,y2)
//   gfx.setSelected(ids) / setHover(id) / showGhost / hideGhost
//   gfx.showReticle / hideReticle / flashRally
//   gfx.panCamera / zoomCamera / jumpTo / cameraQuad / minimapBase
//   gfx.screenShake(mag) / dispose()
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import {
  createEntityMesh, animateEntityMesh, setMeshOpacity, overrideMaterials,
  rankTexture, FACTION_COLORS, SIDE_COLORS, INFANTRY_KEYS,
} from './meshes.js';
import { createTerrain } from './terrain.js';
import { preloadModels, onModelsReady, hasModel } from './models.js';
import { Effects } from './effects.js';
import { MAP } from '../sim/map.js';

const HALF = MAP.size / 2;                   // 64
const PAN_LIMIT = HALF - 3;                  // camera look clamp
const SKY_HORIZON = 0xe8a45e;
const SKY_ZENITH = 0x5d7ea8;
const SUN_DIR = new THREE.Vector3(-26, 13, 9).normalize();  // low western sun
const BASE_EXPOSURE = 1.08;
const SUPER_KEYS = { orbitalLance: 1, nuclearMissile: 1, viperStorm: 1 };
const AIR_LAYER = 1;   // aircraft live on layer 0 AND 1; layer 1 re-renders on top

// Second scene pass restricted to AIR_LAYER with the depth buffer cleared, so
// aircraft always read above buildings/terrain instead of clipping behind them.
class AirOverlayPass extends RenderPass {
  render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    const mask = this.camera.layers.mask;
    const shadows = renderer.shadowMap.autoUpdate;
    this.camera.layers.set(AIR_LAYER);
    renderer.shadowMap.autoUpdate = false;   // shadow maps already built by the main pass
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    renderer.shadowMap.autoUpdate = shadows;
    this.camera.layers.mask = mask;
  }
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _ndc = new THREE.Vector2();
const _ray = new THREE.Raycaster();

const wrapAngle = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
// sim angle (atan2(dz,dx), from +x) → mesh yaw (mesh faces +z)
const simToYaw = (a) => Math.PI / 2 - (a || 0);

/* ── sky dome ───────────────────────────────────────────────────────────── */
function makeSky() {
  const geo = new THREE.SphereGeometry(420, 24, 14);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(SKY_ZENITH) },
      bottom: { value: new THREE.Color(SKY_HORIZON) },
      sunDir: { value: SUN_DIR.clone() },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y * 1.5 + 0.14, 0.0, 1.0);
        vec3 col = mix(bottom, top, pow(h, 0.72));
        float sun = pow(max(dot(normalize(vDir), sunDir), 0.0), 14.0);
        col += vec3(1.0, 0.68, 0.36) * sun * 0.85;
        float glow = pow(max(dot(normalize(vDir), sunDir), 0.0), 3.5);
        col += vec3(0.55, 0.30, 0.12) * glow * 0.35;
        float haze = pow(1.0 - abs(vDir.y), 4.5);
        col = mix(col, vec3(0.97, 0.74, 0.50), haze * 0.5);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  return m;
}

/* ── tiny shared glow texture (offline beacon) ──────────────────────────── */
let GLOW_TEX = null;
function glowTex() {
  if (!GLOW_TEX) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 32;
    const c = cv.getContext('2d');
    const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 32, 32);
    GLOW_TEX = new THREE.CanvasTexture(cv);
  }
  return GLOW_TEX;
}

/* ── shared sprite materials for rank/salvage pips ──────────────────────── */
const PIP_MATS = {};
function pipMat(level, salvage) {
  const k = (salvage ? 's' : 'v') + level;
  if (!PIP_MATS[k]) {
    PIP_MATS[k] = new THREE.SpriteMaterial({
      map: rankTexture(level, salvage), transparent: true, depthWrite: false, depthTest: false,
    });
  }
  return PIP_MATS[k];
}

/* ════════════════════════════════════════════════════════════════════════ */
export class GfxEngine {
  constructor(canvasEl) {
    this.canvas = canvasEl;
    this._disposed = false;
    this._time = 0;
    this._shake = 0;
    this._dim = 0;
    this._flash = 0;
    this._game = null;
    this._handlers = [];
    this.skipRender = false;   // dev harness: step simulation visuals without compositing

    const w = canvasEl.clientWidth || window.innerWidth;
    const h = canvasEl.clientHeight || window.innerHeight;

    const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = BASE_EXPOSURE;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(SKY_HORIZON, 90, 320);
    this.scene = scene;
    this._sky = makeSky();
    scene.add(this._sky);

    // ── golden-hour lighting: one shadow-casting sun + hemisphere fill ──
    const sun = new THREE.DirectionalLight(0xffbe7d, 3.0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -34;
    sun.shadow.camera.right = 34;
    sun.shadow.camera.top = 34;
    sun.shadow.camera.bottom = -34;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 190;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);
    this._sun = sun;
    const hemi = new THREE.HemisphereLight(0x96aed2, 0xb07c48, 0.85);
    scene.add(hemi);
    // lights must be on AIR_LAYER too or the overlay pass renders aircraft unlit
    sun.layers.enable(AIR_LAYER);
    hemi.layers.enable(AIR_LAYER);

    // ── camera rig: RTS perspective, ~50° pitch ──
    const camera = new THREE.PerspectiveCamera(46, w / h, 0.5, 600);
    this.camera = camera;
    this._look = { x: MAP.spawns.player.x, z: MAP.spawns.player.z };
    this._lookT = { x: this._look.x, z: this._look.z };
    this._dist = 36; this._distT = 36;
    this._elev = THREE.MathUtils.degToRad(50);
    this._updateCamera(0);

    // ── post ──
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const airPass = new AirOverlayPass(scene, camera);
    airPass.clear = false;
    airPass.clearDepth = true;
    composer.addPass(airPass);
    const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.42, 0.4, 0.83);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    this.composer = composer;
    this.bloom = bloom;

    // ── world ──
    this.terrain = createTerrain(scene);
    this.effects = new Effects(scene, camera, {
      screenShake: (s) => this.screenShake(s),
      setDim: (v) => { this._dim = Math.max(0, Math.min(1, v || 0)); },
      flash: (v) => { this._flash = Math.max(this._flash, v || 0); },
    });

    // ── entity bookkeeping ──
    this._entityLayer = new THREE.Group();
    scene.add(this._entityLayer);
    this._recs = new Map();          // id → rec
    this._lookup = new Map();        // id → latest snapshot (rebuilt each update)
    this._dying = [];                // death animations in flight
    this._selected = new Set();
    this._hoverId = null;

    // CC0 unit models load in the background; entities spawned before that
    // finish get procedural meshes, then rebuild once the templates exist.
    // Registered after _recs exists: onModelsReady fires synchronously when
    // models are already loaded (e.g. on restart).
    preloadModels();
    onModelsReady(() => {
      if (this._disposed) return;
      for (const [id, rec] of [...this._recs]) {
        if (hasModel(rec.group.userData.faction, rec.key)) {
          this._entityLayer.remove(rec.group);
          this._recs.delete(id);
        }
      }
    });

    this._buildOverlays();
    this._buildFog();
    this._minimapCanvas = null;

    this._onResize = () => {
      const ww = this.canvas.clientWidth || window.innerWidth;
      const hh = this.canvas.clientHeight || window.innerHeight;
      this.camera.aspect = ww / hh;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(ww, hh, false);
      this.composer.setSize(ww, hh);
    };
    window.addEventListener('resize', this._onResize);
    this._pickList = [];
  }

  /* ── overlays: selection rings, reticle, ghost, rally ─────────────────── */
  _buildOverlays() {
    const overlay = new THREE.Group();
    this.scene.add(overlay);
    this._overlay = overlay;

    // pooled flat rings (selection / hover / capture)
    this._ringGeo = new THREE.RingGeometry(0.86, 1, 40);
    this._rings = [];
    this._ringUsed = 0;

    // targeting reticle
    const ret = new THREE.Group();
    const rMat = new THREE.MeshBasicMaterial({
      color: 0xffb347, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this._reticleMat = rMat;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 56), rMat);
    ring.rotation.x = -Math.PI / 2;
    ret.add(ring);
    const inner = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.38, 32), rMat);
    inner.rotation.x = -Math.PI / 2;
    ret.add(inner);
    const tickGeo = new THREE.PlaneGeometry(0.035, 0.2);
    for (let i = 0; i < 4; i++) {
      const t = new THREE.Mesh(tickGeo, rMat);
      t.rotation.x = -Math.PI / 2;
      t.rotation.z = (i / 4) * Math.PI * 2;
      const a = (i / 4) * Math.PI * 2;
      t.position.set(Math.sin(a) * 0.84, 0.001, Math.cos(a) * 0.84);
      ret.add(t);
    }
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.05, 10), rMat);
    dot.rotation.x = -Math.PI / 2;
    ret.add(dot);
    ret.position.y = 0.12;
    ret.visible = false;
    overlay.add(ret);
    this._reticle = ret;

    // placement ghost
    this._ghost = null;
    this._ghostKey = '';
    this._ghostValid = null;
    this._ghostMats = {};   // faction|v → material
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x7dffa0, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this._ghostRing = new THREE.Mesh(this._ringGeo, ringMat);
    this._ghostRing.rotation.x = -Math.PI / 2;
    this._ghostRing.position.y = 0.1;
    this._ghostRing.visible = false;
    overlay.add(this._ghostRing);

    // rally markers (persistent for selected structures) + flash pings
    this._rallyMarkers = [];
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.04, 1.3, 6),
        new THREE.MeshBasicMaterial({ color: 0xdde4ea }),
      );
      pole.position.y = 0.65;
      g.add(pole);
      const flagGeo = new THREE.PlaneGeometry(0.62, 0.4);
      flagGeo.translate(0.31, 0, 0);
      const fm = new THREE.MeshBasicMaterial({ color: 0x3da0ff, side: THREE.DoubleSide });
      const flag = new THREE.Mesh(flagGeo, fm);
      flag.position.y = 1.1;
      g.add(flag);
      const base = new THREE.Mesh(this._ringGeo, new THREE.MeshBasicMaterial({
        color: 0x3da0ff, transparent: true, opacity: 0.7, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      base.rotation.x = -Math.PI / 2;
      base.position.y = 0.08;
      base.scale.setScalar(0.55);
      g.add(base);
      g.visible = false;
      overlay.add(g);
      this._rallyMarkers.push({ g, flag });
    }
    this._rallyFlash = null;   // {x, z, t}
  }

  _ring(x, z, r, color, opacity = 0.85, y = 0.1) {
    let m = this._rings[this._ringUsed];
    if (!m) {
      m = new THREE.Mesh(this._ringGeo, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      m.rotation.x = -Math.PI / 2;
      this._overlay.add(m);
      this._rings.push(m);
    }
    if (this._ringUsed >= 64) return;
    this._ringUsed++;
    m.position.set(x, y, z);
    m.scale.setScalar(Math.max(0.2, r));
    m.material.color.setHex(color);
    m.material.opacity = opacity;
    m.visible = true;
  }

  _endRings() {
    for (let i = this._ringUsed; i < this._rings.length; i++) {
      if (!this._rings[i].visible) break;
      this._rings[i].visible = false;
    }
    this._ringUsed = 0;
  }

  /* ── fog of war overlay ────────────────────────────────────────────────── */
  _buildFog() {
    this._fogN = MAP.size / MAP.cell; // fog grid is N×N cells
    this._fogSmall = document.createElement('canvas');
    this._fogSmall.width = this._fogSmall.height = this._fogN;
    this._fogSmallCtx = this._fogSmall.getContext('2d');
    this._fogImg = this._fogSmallCtx.createImageData(this._fogN, this._fogN);
    // pre-fill alpha shroud so the first frame (before any fog data) is dark? no —
    // default fully visible so menu/preview scenes without fog stay clean.
    this._fogBig = document.createElement('canvas');
    this._fogBig.width = this._fogBig.height = 256;
    this._fogBigCtx = this._fogBig.getContext('2d');
    this._fogTex = new THREE.CanvasTexture(this._fogBig);
    this._fogTex.minFilter = THREE.LinearFilter;
    this._fogTex.magFilter = THREE.LinearFilter;
    const geo = new THREE.PlaneGeometry(MAP.size + 10, MAP.size + 10);
    geo.rotateX(-Math.PI / 2);
    const k = (MAP.size + 10) / MAP.size;
    this._fogTex.repeat.set(k, k);
    this._fogTex.offset.set(-(k - 1) / 2, -(k - 1) / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: this._fogTex, transparent: true, depthWrite: false, fog: false,
    });
    this._fogMesh = new THREE.Mesh(geo, mat);
    this._fogMesh.position.y = 0.07;
    this._fogMesh.renderOrder = 5;
    this._fogMesh.visible = false;
    this.scene.add(this._fogMesh);
    this._fogAcc = 1;   // force first update
  }

  _updateFog(dt) {
    const fog = this._game?.fog;
    if (!fog || !fog.grid) { this._fogMesh.visible = false; return; }
    this._fogMesh.visible = true;
    this._fogAcc += dt;
    if (this._fogAcc < 0.12) return;
    this._fogAcc = 0;
    const d = this._fogImg.data;
    const grid = fog.grid;
    const n = Math.min(grid.length, this._fogN * this._fogN);
    for (let i = 0; i < n; i++) {
      const v = grid[i];
      const i4 = i * 4;
      d[i4] = 7; d[i4 + 1] = 6; d[i4 + 2] = 8;
      d[i4 + 3] = v === 2 ? 0 : v === 1 ? 148 : 247;
    }
    this._fogSmallCtx.putImageData(this._fogImg, 0, 0);
    const c = this._fogBigCtx;
    c.clearRect(0, 0, 256, 256);
    c.filter = 'blur(3px)';
    c.imageSmoothingEnabled = true;
    const pad = 256 / this._fogN; // bleed one fog cell past each edge
    c.drawImage(this._fogSmall, -pad, -pad, 256 + 2 * pad, 256 + 2 * pad);
    c.filter = 'none';
    this._fogTex.needsUpdate = true;
  }

  /* ── contract API: attach (sim event → effects wiring) ─────────────────── */
  attach(game) {
    if (!game || typeof game.on !== 'function') return;
    this._detach();
    this._game = game;
    const fx = this.effects;
    const on = (ev, fn) => { game.on(ev, fn); this._handlers.push([ev, fn]); };

    on('spawn', (e) => {
      const ent = e?.entity;
      if (!ent || ent.id == null) return;
      this._ensureRec(ent);
      if (ent.kind === 'unit') fx.deployPuff(ent.x ?? 0, ent.z ?? 0);
    });

    on('death', (e) => {
      if (!e || e.id == null) return;
      this._killRec(e.id, e);
    });

    on('attack', (e) => {
      if (!e || e.id == null) return;
      const rec = this._recs.get(e.id);
      if (!rec || !rec.group.visible) return;
      const t = e.targetId != null ? this._lookup.get(e.targetId) : null;
      // aim the turret / remember the target
      if (t) {
        rec.aimId = e.targetId;
        rec.aimTtl = 2.0;
      }
      const ud = rec.group.userData;
      if (ud.anim) ud.anim.lastAttackT = this._time;
      const muz = ud.muzzle;
      if (muz) muz.getWorldPosition(_v1);
      else _v1.set(rec.x, rec.y + (ud.aimY || 0.4), rec.z);
      const w = e.weapon || 'smallArms';
      // target aim point
      let tx = rec.x, ty = 0.4, tz = rec.z;
      if (t) {
        const trec = this._recs.get(t.id);
        tx = t.x; tz = t.z;
        ty = trec ? trec.y + (trec.group.userData.aimY || 0.4) : 0.4;
      }
      switch (w) {
        case 'flame':
          fx.flameCone(_v1.x, _v1.y, _v1.z, tx, ty, tz);
          break;
        case 'toxin':
          fx.toxinSpray(_v1.x, _v1.y, _v1.z, tx, tz);
          break;
        case 'smallArms':
        case 'gatling':
        case 'sniper':
          fx.muzzleFlash(_v1.x, _v1.y, _v1.z, w);
          if (t) fx.tracer(_v1.x, _v1.y, _v1.z, tx, ty, tz, w);
          break;
        default:
          // travel-time weapons: muzzle flash here, projectile event handles flight
          fx.muzzleFlash(_v1.x, _v1.y, _v1.z, w);
      }
    });

    on('projectile', (e) => {
      if (!e) return;
      // never mutate sim's event object — copy
      fx.projectile({
        fromX: e.fromX, fromZ: e.fromZ, toX: e.toX, toZ: e.toZ,
        weapon: e.weapon, flightTime: e.flightTime, arc: e.arc,
      }, e.weapon === 'bomb' ? 6.0 : 0.8, 0.25);
    });

    on('hit', (e) => {
      if (!e) return;
      if (e.weapon === 'flashbang') {
        fx.empBlast(e.x ?? 0, e.z ?? 0, Math.max(2, e.radius || 3));
        return;
      }
      fx.impact(e.x ?? 0, e.z ?? 0, e.weapon || 'smallArms', e.radius || 1);
    });

    on('constructionStart', (e) => {
      const rec = e?.id != null ? this._recs.get(e.id) : null;
      if (rec) fx.buildDust(rec.x, rec.z, rec.group.userData.radius || 2);
    });
    on('constructionComplete', (e) => {
      const rec = e?.id != null ? this._recs.get(e.id) : null;
      if (rec) {
        fx.buildDust(rec.x, rec.z, rec.group.userData.radius || 2);
        fx.captureFlash(rec.x, rec.z, 0xffe9a0);
      }
    });
    on('sold', (e) => {
      const rec = e?.id != null ? this._recs.get(e.id) : null;
      if (rec) fx.buildDust(rec.x, rec.z, rec.group.userData.radius || 2);
    });
    on('captureComplete', (e) => {
      const rec = e?.id != null ? this._recs.get(e.id) : null;
      if (rec) fx.captureFlash(rec.x, rec.z, SIDE_COLORS[e.newSide] ?? 0xffd84d);
    });
    on('crateSpawn', (e) => { if (e) fx.crateGlint(e.x ?? 0, e.z ?? 0); });
    on('cratePickup', (e) => { if (e) fx.crateGlint(e.x ?? 0, e.z ?? 0); });
    on('husk', (e) => {
      const rec = e?.id != null ? this._recs.get(e.id) : null;
      if (rec) fx.sparksAt(rec.x, rec.y + 0.5, rec.z);
    });
    on('rankUp', () => {});
    on('powerChanged', () => {});
    on('radarPing', (e) => {
      if (e) this.effects.rings.spawn(e.x ?? 0, e.z ?? 0, 0.4, 3.2, 0.8, 0xffd84d, 0.14, 0.6);
    });

    on('powerUsed', (e) => {
      if (!e) return;
      const k = String(e.key || '').toLowerCase();
      const x = e.x ?? 0, z = e.z ?? 0;
      const lvl = e.level || 1;
      if (k.includes('paradrop')) fx.paradrop(x, z, [4, 8, 14][lvl - 1] || 6);
      else if (k.includes('artillery') || k.includes('barrage')) fx.artillery(x, z, 8, [12, 24, 36][lvl - 1] || 12, 4);
      else if (k.includes('emp')) fx.empBlast(x, z, 12);
      else if (k.includes('mine')) {
        for (let i = 0; i < 12; i++) {
          const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 8;
          fx._delay(i * 0.06, 'thud', x + Math.cos(a) * r, z + Math.sin(a) * r);
        }
        fx.rings.spawn(x, z, 1, 8, 0.8, 0xffd84d, 0.12, 0.5);
      } else if (k.includes('strike')) {
        for (let i = 0; i < lvl; i++) {
          for (let s = 0; s < 4; s++) fx._delay(0.5 + i * 0.5 + s * 0.12, 'shell', x - 6 + s * 4 + i * 1.5, z + (i - 1) * 2.5);
        }
      } else if (k.includes('ambush')) {
        for (let i = 0; i < ([4, 8, 16][lvl - 1] || 4); i++) {
          const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 4;
          fx._delay(i * 0.1, 'thud', x + Math.cos(a) * r, z + Math.sin(a) * r);
        }
      } else if (k.includes('sneak')) fx.buildDust(x, z, 2.5);
      else if (k.includes('cash') || k.includes('bounty')) fx.crateGlint(x, z);
      else if (k.includes('spy') || k.includes('drone')) fx.rings.spawn(x, z, 1, 12, 1.2, 0x7ce0ff, 0.14, 0.6);
      // fuelAir / anthrax visuals ride on their 'hit' events
    });

    on('superLaunch', (e) => {
      if (!e) return;
      const x = e.x ?? 0, z = e.z ?? 0;
      const silo = this._findStructure(e.side, e.key);
      if (e.key === 'orbitalLance') {
        fx.orbitalLance(x, z);
      } else if (e.key === 'nuclearMissile') {
        const sx = silo ? silo.x : x - 30, sz = silo ? silo.z : z - 30;
        if (silo) { silo.siloLaunch = 3.0; const u = silo.group.userData; if (u.missile) u.missile.visible = false; }
        fx.nukeLaunch(sx, sz, x, z);
      } else if (e.key === 'viperStorm') {
        const sx = silo ? silo.x : x - 30, sz = silo ? silo.z : z - 30;
        fx.viperStorm(sx, sz, x, z);
      }
      this.screenShake(0.3);
    });
    on('superImpact', (e) => {
      if (!e) return;
      if (e.key === 'nuclearMissile') fx.nukeImpact(e.x ?? 0, e.z ?? 0);
      else this.screenShake(0.25);
    });
    on('superBuilt', () => {});
    on('superReady', (e) => {
      const rec = this._findStructure(e?.side, e?.key);
      if (rec) fx.captureFlash(rec.x, rec.z, 0xffd84d);
    });

    on('gameOver', (e) => {
      // final fireworks over the loser's spawn corner
      const loser = e?.winner === 'player' ? 'enemy' : 'player';
      const sp = MAP.spawns[loser];
      for (let i = 0; i < 8; i++) {
        fx._delay(i * 0.3 + Math.random() * 0.15, 'boomS',
          sp.x + (Math.random() - 0.5) * 10, sp.z + (Math.random() - 0.5) * 10);
      }
      this.screenShake(0.5);
    });
  }

  _detach() {
    if (this._game && typeof this._game.off === 'function') {
      for (const [ev, fn] of this._handlers) {
        try { this._game.off(ev, fn); } catch { /* ignore */ }
      }
    }
    this._handlers.length = 0;
    this._game = null;
  }

  _findStructure(side, key) {
    for (const rec of this._recs.values()) {
      if (rec.key === key && rec.side === side && rec.kind === 'structure') return rec;
    }
    return null;
  }

  /* ── contract API: per-frame update ────────────────────────────────────── */
  update(dt, state) {
    if (this._disposed) return;
    dt = Math.min(Math.max(Number(dt) || 0.016, 0.0001), 0.1);
    this._time += dt;
    const time = this._time;

    this._syncEntities(dt, time, state);
    this._updateDying(dt);
    this.terrain.update(dt, time, state);
    this.effects.update(dt, time);
    this._updateOverlays(dt, time, state);
    this._updateFog(dt);
    this._updateCamera(dt);

    this._flash = Math.max(0, this._flash - dt * 1.6);
    this.renderer.toneMappingExposure = BASE_EXPOSURE * (1 - this._dim * 0.45) + this._flash * 2.4;
    if (!this.skipRender) this.composer.render();
  }

  /* ── contract API: picking ─────────────────────────────────────────────── */
  pick(cx, cy) {
    const rect = this.canvas.getBoundingClientRect();
    _ndc.set(
      ((cx - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((cy - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    _ray.setFromCamera(_ndc, this.camera);

    let entityId = null;
    this._pickList.length = 0;
    for (const rec of this._recs.values()) {
      if (rec.group.visible) this._pickList.push(rec.group);
    }
    const hits = _ray.intersectObjects(this._pickList, true);
    for (let i = 0; i < hits.length; i++) {
      let o = hits[i].object;
      while (o && o.userData.entityId == null) o = o.parent;
      if (o && o.userData.entityId != null) { entityId = o.userData.entityId; break; }
    }
    const gp = _ray.ray.intersectPlane(_plane, _v1);
    if (!gp && entityId == null) return { x: 0, z: 0, entityId: null };
    if (gp) {
      return {
        x: Math.max(-HALF, Math.min(HALF, _v1.x)),
        z: Math.max(-HALF, Math.min(HALF, _v1.z)),
        entityId,
      };
    }
    const rec = this._recs.get(entityId);
    return { x: rec ? rec.x : 0, z: rec ? rec.z : 0, entityId };
  }

  pickRect(x1, y1, x2, y2) {
    const rect = this.canvas.getBoundingClientRect();
    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
    const ids = [];
    for (const rec of this._recs.values()) {
      const ent = rec.ent;
      if (!ent || ent.side !== 'player' || ent.kind !== 'unit') continue;
      _v1.set(rec.x, rec.y + 0.4, rec.z).project(this.camera);
      if (_v1.z > 1) continue;
      const sx = rect.left + (_v1.x * 0.5 + 0.5) * rect.width;
      const sy = rect.top + (-_v1.y * 0.5 + 0.5) * rect.height;
      if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) ids.push(rec.id);
    }
    return ids;
  }

  /* ── contract API: selection / hover / ghost / reticle / rally ─────────── */
  setSelected(ids) {
    this._selected = new Set(Array.isArray(ids) ? ids : ids != null ? [ids] : []);
  }

  setHover(entityId = null) { this._hoverId = entityId ?? null; }

  showGhost(structureKey, factionKey, x, z, valid) {
    const ck = factionKey + '|' + structureKey;
    if (this._ghostKey !== ck) {
      if (this._ghost) { this._overlay.remove(this._ghost); }
      this._ghost = createEntityMesh({ key: structureKey, faction: factionKey, side: 'player', kind: 'structure' });
      this._ghost.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
      this._overlay.add(this._ghost);
      this._ghostKey = ck;
      this._ghostValid = null;
    }
    const v = !!valid;
    if (this._ghostValid !== v) {
      const mk = factionKey + (v ? '|ok' : '|bad');
      let mat = this._ghostMats[mk];
      if (!mat) {
        const fc = new THREE.Color(FACTION_COLORS[factionKey] ?? 0xd8b04a);
        fc.lerp(new THREE.Color(v ? 0x7dffa0 : 0xff5544), 0.55);
        mat = new THREE.MeshBasicMaterial({
          color: fc, transparent: true, opacity: 0.45, depthWrite: false,
        });
        this._ghostMats[mk] = mat;
      }
      overrideMaterials(this._ghost, mat);
      this._ghostRing.material.color.setHex(v ? 0x7dffa0 : 0xff5544);
      this._ghostValid = v;
    }
    this._ghost.position.set(x, 0.02, z);
    this._ghost.visible = true;
    this._ghostRing.position.set(x, 0.1, z);
    this._ghostRing.scale.setScalar(this._ghost.userData.radius || 2);
    this._ghostRing.visible = true;
  }

  hideGhost() {
    if (this._ghost) this._ghost.visible = false;
    this._ghostRing.visible = false;
  }

  showReticle(x, z, radius = 3, color = 0xffb347) {
    if (x == null || !Number.isFinite(x)) { this._reticle.visible = false; return; }
    this._reticle.position.set(x, 0.12, z);
    this._reticle.scale.setScalar(Math.max(0.5, radius));
    this._reticleMat.color.setHex(color);
    this._reticle.visible = true;
  }

  hideReticle() { this._reticle.visible = false; }

  flashRally(structureId, x, z) {
    this._rallyFlash = { x, z, t: 1.4 };
  }

  /* ── contract API: camera ──────────────────────────────────────────────── */
  panCamera(dx, dz) {
    this._lookT.x = Math.max(-PAN_LIMIT, Math.min(PAN_LIMIT, this._lookT.x + (Number(dx) || 0)));
    this._lookT.z = Math.max(-PAN_LIMIT, Math.min(PAN_LIMIT, this._lookT.z + (Number(dz) || 0)));
  }

  zoomCamera(deltaY) {
    let d = Number(deltaY) || 0;
    if (Math.abs(d) > 4) d *= 0.022;   // raw wheel pixels → world units
    this._distT = Math.max(16, Math.min(60, this._distT + d));
  }

  jumpTo(x, z) {
    this._lookT.x = this._look.x = Math.max(-PAN_LIMIT, Math.min(PAN_LIMIT, Number(x) || 0));
    this._lookT.z = this._look.z = Math.max(-PAN_LIMIT, Math.min(PAN_LIMIT, Number(z) || 0));
  }

  cameraLook() {
    return { x: this._look.x, z: this._look.z };
  }

  cameraQuad() {
    const out = [];
    for (const [nx, ny] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      _ndc.set(nx, ny);
      _ray.setFromCamera(_ndc, this.camera);
      const hit = _ray.ray.intersectPlane(_plane, _v1);
      if (hit) out.push({ x: _v1.x, z: _v1.z });
      else {
        _ray.ray.at(300, _v1);
        out.push({ x: _v1.x, z: _v1.z });
      }
    }
    return out;
  }

  /* ── contract API: minimap snapshot (terrain only, once) ───────────────── */
  minimapBase() {
    if (this._minimapCanvas) return this._minimapCanvas;
    const S = 256;
    const rt = new THREE.WebGLRenderTarget(S, S, { colorSpace: THREE.SRGBColorSpace });
    const cam = new THREE.OrthographicCamera(-HALF, HALF, HALF, -HALF, 1, 300);
    cam.position.set(0, 120, 0);
    cam.up.set(0, 0, -1);
    cam.lookAt(0, 0, 0);
    // hide everything except terrain
    const hidden = [];
    const hide = (o) => { if (o && o.visible) { o.visible = false; hidden.push(o); } };
    hide(this.effects.group);
    hide(this._entityLayer);
    hide(this._overlay);
    hide(this._fogMesh);
    hide(this._sky);
    const oldTm = this.renderer.toneMapping;
    this.renderer.setRenderTarget(rt);
    this.renderer.render(this.scene, cam);
    const buf = new Uint8Array(S * S * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, S, S, buf);
    this.renderer.setRenderTarget(null);
    this.renderer.toneMapping = oldTm;
    for (const o of hidden) o.visible = true;
    rt.dispose();
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(S, S);
    // GPU rows are bottom-up → flip
    for (let y = 0; y < S; y++) {
      const src = (S - 1 - y) * S * 4;
      img.data.set(buf.subarray(src, src + S * 4), y * S * 4);
    }
    ctx.putImageData(img, 0, 0);
    this._minimapCanvas = cv;
    return cv;
  }

  screenShake(strength = 0.3) {
    this._shake = Math.min(3, this._shake + Math.max(0, Number(strength) || 0));
  }

  dispose() {
    this._disposed = true;
    window.removeEventListener('resize', this._onResize);
    this._detach();
    this.effects.dispose();
    this.terrain.dispose();
    this.scene.clear();
    this._recs.clear();
    this._dying.length = 0;
    this.composer.dispose?.();
    this.renderer.dispose();
  }

  /* ── internals: entity lifecycle ───────────────────────────────────────── */
  _ensureRec(ent) {
    let rec = this._recs.get(ent.id);
    if (rec) {
      // rebuild mesh if identity changed (capture flips side, crew-snipe → husk)
      if (rec.key !== ent.key || rec.kind !== ent.kind || rec.side !== ent.side) {
        this._entityLayer.remove(rec.group);
        this._recs.delete(ent.id);
        rec = null;
      } else {
        return rec;
      }
    }
    const group = createEntityMesh(ent);
    group.userData.entityId = ent.id;
    const u = group.userData;
    const air = !!u.air && ent.kind === 'unit';
    if (air) group.traverse((o) => o.layers.enable(AIR_LAYER));
    const x = ent.x ?? 0, z = ent.z ?? 0;
    rec = {
      id: ent.id, ent,
      key: ent.key, kind: ent.kind, side: ent.side,
      group, air,
      x, z, y: air ? 0.3 : 0,
      yaw: simToYaw(ent.angle),
      prevYaw: 0, bank: 0,
      simPx: x, simPz: z,
      aimId: null, aimTtl: 0,
      smokeAcc: Math.random(), fireAcc: Math.random() * 0.4, sparkAcc: 0, dustAcc: 0,
      vetLvl: 0, vetSpr: null, salLvl: 0, salSpr: null,
      blinkSpr: null,
      scaffold: null,
      siloLaunch: 0,
      bobPhase: (ent.id * 1.7) % (Math.PI * 2),
    };
    rec.prevYaw = rec.yaw;
    group.position.set(x, rec.y, z);
    group.rotation.y = rec.yaw;
    this._entityLayer.add(group);
    this._recs.set(ent.id, rec);
    return rec;
  }

  _removeRec(id) {
    const rec = this._recs.get(id);
    if (!rec) return;
    this._entityLayer.remove(rec.group);
    this._recs.delete(id);
  }

  _killRec(id, ev) {
    const rec = this._recs.get(id);
    const x = rec ? rec.x : (ev.x ?? 0);
    const z = rec ? rec.z : (ev.z ?? 0);
    const fx = this.effects;
    const kind = ev.kind || (rec ? rec.kind : 'unit');
    const key = ev.key || (rec ? rec.key : '');
    if (kind === 'structure') {
      const r = rec ? (rec.group.userData.radius || 2) : 2;
      fx.structureDeath(x, z, r);
      if (rec) {
        this._recs.delete(id);
        this._dying.push({ g: rec.group, t: 0, ttl: 0.8, kind: 'structure' });
      }
    } else if (kind === 'crate') {
      this._removeRec(id);
    } else if (INFANTRY_KEYS.has(key)) {
      fx.infantryDeath(x, z);
      if (rec) {
        this._recs.delete(id);
        const a = rec.group.userData.anim;
        if (a?.actions.death) {
          // model infantry play their own Death clip instead of the topple
          if (a.cur) a.cur.fadeOut(0.08);
          a.actions.death.reset().fadeIn(0.08).play();
          a.cur = a.actions.death;
          this._dying.push({ g: rec.group, t: 0, ttl: 1.6, kind: 'infantryModel' });
        } else {
          this._dying.push({ g: rec.group, t: 0, ttl: 1.0, kind: 'infantry' });
        }
      }
    } else if (rec && rec.air) {
      // aircraft: flame out, tumble, ground burst
      fx.vehicleDeath(x, z, 0.7);
      this._recs.delete(id);
      this._dying.push({ g: rec.group, t: 0, ttl: 0.9, kind: 'aircraft', vy: 1.5, x, z });
    } else {
      const scale = rec ? Math.min(1.8, (rec.group.userData.radius || 0.8) * 1.1) : 1;
      fx.vehicleDeath(x, z, scale);
      this._removeRec(id);
    }
  }

  _updateDying(dt) {
    const fx = this.effects;
    for (let i = this._dying.length - 1; i >= 0; i--) {
      const d = this._dying[i];
      d.t += dt;
      const t = d.t / d.ttl;
      if (t >= 1) {
        this._entityLayer.remove(d.g);
        this._dying.splice(i, 1);
        if (d.kind === 'aircraft') fx.impact(d.g.position.x, d.g.position.z, 'missile', 1);
        continue;
      }
      if (d.kind === 'infantry') {
        const e = Math.min(1, t * 2.2);
        d.g.rotation.x = -e * Math.PI / 2 * 0.94;
        if (t > 0.45) setMeshOpacity(d.g, 1 - (t - 0.45) / 0.55);
      } else if (d.kind === 'infantryModel') {
        d.g.userData.anim?.mixer.update(dt);
        if (t > 0.6) setMeshOpacity(d.g, 1 - (t - 0.6) / 0.4);
      } else if (d.kind === 'structure') {
        const e = t * t;
        d.g.scale.y = Math.max(0.06, 1 - e * 0.95);
        d.g.position.y = -e * 0.5;
        d.g.rotation.z = e * 0.05;
      } else if (d.kind === 'aircraft') {
        d.vy -= 14 * dt;
        d.g.position.y = Math.max(0.3, d.g.position.y + d.vy * dt);
        d.g.rotation.z += dt * 4;
        d.g.rotation.x += dt * 1.6;
        if (Math.random() < 0.5) {
          fx.smoke.spawn(d.g.position.x, d.g.position.y, d.g.position.z, {
            ttl: 0.8, s0: 0.4, s1: 1.1, vy: 0.4, o0: 0.6, c0: 0x2e2a26, rv: 1,
          });
        }
      }
    }
  }

  /* ── internals: per-frame entity sync ──────────────────────────────────── */
  _syncEntities(dt, time, state) {
    const fx = this.effects;
    fx.beginBars();
    const ents = state?.entities;
    if (!Array.isArray(ents)) { fx.endBars(); return; }

    const lookup = this._lookup;
    lookup.clear();
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e && e.id != null) lookup.set(e.id, e);
    }
    // defensive removal (death events normally do this first)
    if (this._recs.size > lookup.size) {
      for (const id of this._recs.keys()) {
        if (!lookup.has(id)) this._removeRec(id);
      }
    }

    const playerSuper = state?.player?.super || null;
    const enemySuper = state?.enemy?.super || null;
    const k = 1 - Math.exp(-dt * 11);
    const yawK = Math.min(1, dt * 9);

    for (let i = 0; i < ents.length; i++) {
      const ent = ents[i];
      if (!ent || ent.id == null) continue;
      const rec = this._ensureRec(ent);
      rec.ent = ent;
      const g = rec.group;
      const u = g.userData;

      // fog visibility
      if (ent.visible === false) { g.visible = false; continue; }
      if (!g.visible) g.visible = true;

      // ── position interpolation ──
      const ux = ent.x ?? rec.x, uz = ent.z ?? rec.z;
      if (Math.abs(ux - rec.x) > 10 || Math.abs(uz - rec.z) > 10) { rec.x = ux; rec.z = uz; } // teleport (tunnels)
      else { rec.x += (ux - rec.x) * k; rec.z += (uz - rec.z) * k; }
      const mdx = ux - rec.simPx, mdz = uz - rec.simPz;
      rec.simPx = ux; rec.simPz = uz;
      const moving = Math.hypot(mdx, mdz) > dt * 0.25;

      // ── facing ──
      if (rec.kind === 'unit' || rec.kind === 'husk') {
        let desired = rec.yaw;
        if (moving) desired = Math.atan2(mdx, mdz);
        else if (ent.angle != null) desired = simToYaw(ent.angle);
        rec.prevYaw = rec.yaw;
        rec.yaw += wrapAngle(desired - rec.yaw) * yawK;
        g.rotation.y = rec.yaw;
      }

      // ── altitude ──
      if (rec.air) {
        const hoverY = (u.hoverY || 4.5) + Math.sin(time * 1.9 + rec.bobPhase) * 0.14;
        rec.y += (hoverY - rec.y) * Math.min(1, dt * 2.2);
        const yawRate = wrapAngle(rec.yaw - rec.prevYaw) / Math.max(dt, 1e-4);
        const bankT = Math.max(-0.45, Math.min(0.45, -yawRate * 0.3));
        rec.bank += (bankT - rec.bank) * Math.min(1, dt * 4);
        g.rotation.z = rec.bank;
      } else {
        rec.y = 0;
      }

      // ── construction rise / scaffold ──
      let yOff = 0;
      const building = rec.kind === 'structure' && ent.building != null && ent.building < 1;
      if (building) {
        const p = Math.max(0.04, ent.building);
        yOff = -(u.height || 2) * (1 - p) * 0.85;
        if (!rec.scaffold) rec.scaffold = this._makeScaffold(u.radius || 2, u.height || 2);
        rec.scaffold.position.set(rec.x, 0, rec.z);
        if (!rec.scaffold.parent) this._entityLayer.add(rec.scaffold);
        rec.dustAcc -= dt;
        if (rec.dustAcc <= 0) {
          rec.dustAcc = 0.28;
          fx.buildDust(rec.x, rec.z, (u.radius || 2) * 0.8);
        }
      } else if (rec.scaffold) {
        if (rec.scaffold.parent) this._entityLayer.remove(rec.scaffold);
        rec.scaffold = null;
      }
      g.position.set(rec.x, rec.y + yOff, rec.z);

      // ── turret aiming ──
      if (u.turret) {
        if (rec.aimTtl > 0) rec.aimTtl -= dt;
        const t = rec.aimId != null && rec.aimTtl > 0 ? lookup.get(rec.aimId) : null;
        let rel = 0;
        if (t) {
          const aimYaw = Math.atan2(t.x - rec.x, t.z - rec.z);
          rel = wrapAngle(aimYaw - (rec.kind === 'structure' ? simToYaw(ent.angle) : rec.yaw));
        }
        const cur = u.turret.rotation.y;
        u.turret.rotation.y = cur + wrapAngle(rel - cur) * Math.min(1, dt * (t ? 9 : 1.6));
      }

      // ── stealth ghosting (player's own) ──
      if (ent.stealthed && ent.side === 'player') {
        setMeshOpacity(g, 0.36 + 0.07 * Math.sin(time * 5 + rec.bobPhase));
        rec.wasGhost = true;
      } else if (rec.wasGhost) {
        setMeshOpacity(g, 1);
        rec.wasGhost = false;
      }

      // ── power state + glow dim ──
      if (u.powerMats) {
        const off = rec.kind === 'structure' && (ent.powered === false || ent.disabled > 0);
        const f = off ? 0.08 : 1;
        for (let j = 0; j < u.powerMats.length; j++) {
          const pm = u.powerMats[j];
          pm.mat.emissiveIntensity = pm.base * f;
        }
        // blinking amber beacon when offline
        if (off) {
          if (!rec.blinkSpr) {
            rec.blinkSpr = new THREE.Sprite(new THREE.SpriteMaterial({
              map: glowTex(), color: 0xffb030, transparent: true, depthWrite: false,
              blending: THREE.AdditiveBlending,
            }));
            rec.blinkSpr.scale.setScalar(0.6);
            g.add(rec.blinkSpr);
            rec.blinkSpr.position.set(0, (u.height || 2) + 0.4, 0);
          }
          rec.blinkSpr.visible = Math.sin(time * 7 + rec.bobPhase) > 0;
        } else if (rec.blinkSpr) {
          rec.blinkSpr.visible = false;
        }
      }

      // ── disabled sparks (EMP / Mantis hack) ──
      if (ent.disabled > 0 && g.visible) {
        rec.sparkAcc -= dt;
        if (rec.sparkAcc <= 0) {
          rec.sparkAcc = 0.12 + Math.random() * 0.1;
          fx.sparksAt(rec.x, rec.y + (u.aimY || 0.5), rec.z);
        }
      }

      // ── damage smoke / fire ──
      const maxHp = ent.maxHp || 1;
      const hpFrac = (ent.hp ?? maxHp) / maxHp;
      if (!building && rec.kind !== 'crate' && !INFANTRY_KEYS.has(rec.key) && hpFrac < 0.5 && hpFrac > 0) {
        rec.smokeAcc -= dt;
        if (rec.smokeAcc <= 0) {
          rec.smokeAcc = rec.kind === 'structure' ? 0.16 : 0.3;
          const r = (u.radius || 1) * 0.5;
          const ox = (Math.random() - 0.5) * r, oz = (Math.random() - 0.5) * r;
          fx.smoke.spawn(rec.x + ox, rec.y + (u.height || 1) * 0.55, rec.z + oz, {
            ttl: 1.2 + Math.random() * 0.8, s0: 0.3, s1: 1.2 * Math.max(1, r),
            vy: 0.9 + Math.random() * 0.5, vx: (Math.random() - 0.5) * 0.3, vz: (Math.random() - 0.5) * 0.3,
            o0: 0.5, c0: 0x2f2b27, rv: (Math.random() - 0.5) * 2, drag: 0.5,
          });
        }
        if (hpFrac < 0.25) {
          rec.fireAcc -= dt;
          if (rec.fireAcc <= 0) {
            rec.fireAcc = 0.12;
            const r = (u.radius || 1) * 0.4;
            fx.add.spawn(rec.x + (Math.random() - 0.5) * r, rec.y + (u.height || 1) * 0.35, rec.z + (Math.random() - 0.5) * r, {
              ttl: 0.45 + Math.random() * 0.3, s0: 0.3, s1: 0.85,
              vy: 1.4 + Math.random(), o0: 0.85, c0: 0xffc060, c1: 0xc02e08,
            });
          }
        }
      }

      // ── garrison flag ──
      if (u.garrisonFlag) {
        const occ = ent.garrison && ent.garrison.length > 0;
        u.garrisonFlag.o.visible = !!occ;
        if (occ) {
          const occupier = lookup.get(ent.garrison[0]);
          const sideCol = SIDE_COLORS[occupier ? occupier.side : ent.side] ?? 0xffd84d;
          u.garrisonFlag.mat.emissive.setHex(sideCol);
        }
      }

      // ── capture progress ──
      if (ent.capture && ent.capture.progress > 0) {
        const col = SIDE_COLORS[ent.capture.by] ?? 0xffd84d;
        this._ring(rec.x, rec.z, (u.radius || 1.5) + 0.6 + Math.sin(time * 6) * 0.12, col, 0.5);
        fx.drawBar(rec.x, rec.y + (u.height || 1.5) + 1.0, rec.z, ent.capture.progress, 1.2);
      }

      // ── carrying cargo (collectors) ──
      if (u.cargoMesh) u.cargoMesh.visible = !!ent.carrying;

      // ── superweapon structure states ──
      if (rec.kind === 'structure' && SUPER_KEYS[rec.key] && !building) {
        let sup = null;
        if (ent.side === 'player') sup = playerSuper && (playerSuper.id == null || playerSuper.id === ent.id) ? playerSuper : null;
        else if (ent.side === 'enemy') sup = enemySuper;
        const frac = sup ? Math.min(1, (sup.charge ?? 0) / Math.max(1, sup.total ?? 1)) : 0;
        const ready = !!(sup && sup.ready);
        const glowI = 0.35 + frac * 1.6 + (ready ? 1.2 + Math.sin(time * 5) * 0.8 : 0);
        if (u.superGlow) u.superGlow.material.emissiveIntensity = glowI;
        if (u.superGlowMeshes) {
          for (let j = 0; j < u.superGlowMeshes.length; j++) {
            u.superGlowMeshes[j].material.emissiveIntensity =
              ready ? glowI * (Math.sin(time * 6 + j * 1.4) > 0 ? 1 : 0.3) : glowI;
          }
        }
        if (u.silo) {
          if (rec.siloLaunch > 0) rec.siloLaunch -= dt;
          const openT = ready || rec.siloLaunch > 0 ? 1 : frac > 0.92 ? (frac - 0.92) / 0.08 : 0;
          u.silo.open += (openT - u.silo.open) * Math.min(1, dt * 2);
          u.silo.left.rotation.z = -u.silo.open * 2.9;
          u.silo.right.rotation.z = -u.silo.open * 2.9;
          if (u.missile) u.missile.visible = u.silo.open > 0.85 && rec.siloLaunch <= 0;
        }
        if (u.superRack) {
          const want = ready ? -1.15 : -0.5;
          u.superRack.rotation.x += (want - u.superRack.rotation.x) * Math.min(1, dt * 1.5);
        }
      }

      // ── veterancy chevrons / salvage pips ──
      const vet = ent.vet || 0;
      if (vet !== rec.vetLvl) {
        rec.vetLvl = vet;
        if (vet > 0) {
          if (!rec.vetSpr) {
            rec.vetSpr = new THREE.Sprite(pipMat(vet, false));
            rec.vetSpr.scale.set(0.5, 0.5, 1);
            if (rec.air) rec.vetSpr.layers.enable(AIR_LAYER);
            g.add(rec.vetSpr);
          } else rec.vetSpr.material = pipMat(vet, false);
          rec.vetSpr.position.set(0.4, (u.height || 0.8) + 0.55, 0);
          rec.vetSpr.visible = true;
        } else if (rec.vetSpr) rec.vetSpr.visible = false;
      }
      const sal = ent.salvage || 0;
      if (sal !== rec.salLvl) {
        rec.salLvl = sal;
        if (sal > 0) {
          if (!rec.salSpr) {
            rec.salSpr = new THREE.Sprite(pipMat(sal, true));
            rec.salSpr.scale.set(0.5, 0.5, 1);
            if (rec.air) rec.salSpr.layers.enable(AIR_LAYER);
            g.add(rec.salSpr);
          } else rec.salSpr.material = pipMat(sal, true);
          rec.salSpr.position.set(-0.4, (u.height || 0.8) + 0.55, 0);
          rec.salSpr.visible = true;
        } else if (rec.salSpr) rec.salSpr.visible = false;
      }

      // ── health bar (damaged or selected) ──
      const selected = this._selected.has(ent.id);
      if ((selected || (hpFrac < 1 && hpFrac > 0)) && rec.kind !== 'crate') {
        const w = Math.max(0.8, (u.radius || 0.6) * 1.1);
        fx.drawBar(rec.x, rec.y + yOff + (u.height || 0.8) + 0.5, rec.z, hpFrac, w);
      }

      // ── production progress (own building training a unit) ──
      if (rec.kind === 'structure' && ent.side === 'player' && !building
          && Array.isArray(ent.queue) && ent.queue.length) {
        const w = Math.max(0.7, (u.radius || 1.5) * 0.7);
        fx.drawBar(rec.x, rec.y + (u.height || 1.5) + 0.78, rec.z, ent.queue[0].progress || 0, w, 0x28d3e8, 0.6);
      }

      animateEntityMesh(g, dt, time, moving);
    }
    fx.endBars();
  }

  _makeScaffold(r, h) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0xb9871f, roughness: 0.7, metalness: 0.3 });
    const pole = new THREE.CylinderGeometry(0.05, 0.05, h + 0.6, 5);
    const beam = new THREE.BoxGeometry(r * 2, 0.07, 0.07);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const p = new THREE.Mesh(pole, mat);
      p.position.set(sx * r, (h + 0.6) / 2, sz * r);
      g.add(p);
    }
    for (const sz of [-1, 1]) {
      const b = new THREE.Mesh(beam, mat);
      b.position.set(0, h + 0.5, sz * r);
      g.add(b);
    }
    for (const sx of [-1, 1]) {
      const b = new THREE.Mesh(beam, mat);
      b.rotation.y = Math.PI / 2;
      b.position.set(sx * r, h + 0.5, 0);
      g.add(b);
    }
    return g;
  }

  /* ── internals: overlays per-frame ─────────────────────────────────────── */
  _updateOverlays(dt, time, state) {
    // selection / hover rings
    for (const id of this._selected) {
      const rec = this._recs.get(id);
      if (!rec || !rec.group.visible) continue;
      const ent = rec.ent;
      const r = (ent?.sel || rec.group.userData.radius || 0.6) + 0.3;
      const col = rec.side === 'player' ? 0x9fffc2 : rec.side === 'enemy' ? 0xff8a70 : 0xffe28a;
      this._ring(rec.x, rec.z, r * (1 + Math.sin(time * 5) * 0.04), col, 0.9);
    }
    if (this._hoverId != null && !this._selected.has(this._hoverId)) {
      const rec = this._recs.get(this._hoverId);
      if (rec && rec.group.visible) {
        const r = (rec.ent?.sel || rec.group.userData.radius || 0.6) + 0.3;
        this._ring(rec.x, rec.z, r, 0xffffff, 0.35);
      }
    }

    // rally markers for selected structures
    let used = 0;
    for (const id of this._selected) {
      if (used >= this._rallyMarkers.length) break;
      const rec = this._recs.get(id);
      const rally = rec?.ent?.rally;
      if (!rec || rec.kind !== 'structure' || !rally) continue;
      const m = this._rallyMarkers[used++];
      m.g.position.set(rally.x, 0, rally.z);
      m.flag.rotation.y = Math.sin(time * 2.6) * 0.3;
      m.g.visible = true;
    }
    // rally flash ping
    if (this._rallyFlash) {
      const f = this._rallyFlash;
      f.t -= dt;
      if (f.t <= 0) this._rallyFlash = null;
      else {
        if (used < this._rallyMarkers.length) {
          const m = this._rallyMarkers[used++];
          m.g.position.set(f.x, 0, f.z);
          m.flag.rotation.y = Math.sin(time * 8) * 0.4;
          m.g.visible = true;
        }
        this._ring(f.x, f.z, 0.5 + (1.4 - f.t) * 1.6, 0x3da0ff, f.t / 1.4);
      }
    }
    for (let i = used; i < this._rallyMarkers.length; i++) this._rallyMarkers[i].g.visible = false;

    if (this._reticle.visible) this._reticle.rotation.y += dt * 0.8;
    if (this._ghost && this._ghost.visible) {
      const mk = this._ghostKey.split('|')[0] + (this._ghostValid ? '|ok' : '|bad');
      const mat = this._ghostMats[mk];
      if (mat) mat.opacity = 0.38 + Math.sin(time * 4) * 0.1;
    }
    this._endRings();
  }

  /* ── internals: camera ─────────────────────────────────────────────────── */
  _updateCamera(dt) {
    const k = dt > 0 ? Math.min(1, dt * 6) : 1;
    this._look.x += (this._lookT.x - this._look.x) * k;
    this._look.z += (this._lookT.z - this._look.z) * k;
    this._dist += (this._distT - this._dist) * k;

    const y = Math.sin(this._elev) * this._dist;
    const back = Math.cos(this._elev) * this._dist;

    this._shake = Math.max(0, this._shake - this._shake * 3.2 * dt - 0.02 * dt);
    const sh = this._shake;
    const sx = sh > 0.001 ? (Math.random() - 0.5) * sh * 0.35 : 0;
    const sy = sh > 0.001 ? (Math.random() - 0.5) * sh * 0.25 : 0;
    const sz = sh > 0.001 ? (Math.random() - 0.5) * sh * 0.35 : 0;

    this.camera.position.set(this._look.x + sx, y + sy, this._look.z + back + sz);
    _v2.set(this._look.x + sx * 0.4, 0, this._look.z + sz * 0.4);
    this.camera.lookAt(_v2);

    // sun + sky follow the view so shadows stay crisp everywhere on the map
    this._sun.position.set(
      this._look.x + SUN_DIR.x * 90,
      SUN_DIR.y * 90,
      this._look.z + SUN_DIR.z * 90,
    );
    this._sun.target.position.set(this._look.x, 0, this._look.z);
    this._sky.position.set(this._look.x, 0, this._look.z);
  }
}

export default GfxEngine;

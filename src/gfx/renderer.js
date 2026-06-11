// ─── IRON COMMAND — GfxEngine (the Gfx API contract) ────────────────────────
// const gfx = new GfxEngine(canvasEl)
// gfx.attach(game); gfx.update(dt, game.state); gfx.pick(cx, cy);
// gfx.setHover / showDeployZone / setSelected / screenShake / dispose
// extras: panCamera(dx,dz), zoomCamera(delta), recenter(), showReticle, hideReticle
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { createUnitMesh, animateUnitMesh, setUnitOpacity, TEAM_COLORS } from './meshes.js';
import { createTerrain } from './terrain.js';
import { Effects } from './effects.js';

const SKY_HORIZON = 0xe8a45e;
const SKY_ZENITH = 0x5d7ea8;
const SUN_POS = [-26, 11, 9]; // low in the west — long golden-hour shadows
const BASE_Z = { player: 10, enemy: -10 };
const BASE_EXPOSURE = 1.08;

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _ndc = new THREE.Vector2();

const wrapAngle = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

function makeSky() {
  const geo = new THREE.SphereGeometry(190, 24, 14);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(SKY_ZENITH) },
      bottom: { value: new THREE.Color(SKY_HORIZON) },
      sunDir: { value: new THREE.Vector3(...SUN_POS).normalize() },
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

function gridTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  c.fillStyle = 'rgba(90,230,130,0.16)';
  c.fillRect(0, 0, 64, 64);
  c.strokeStyle = 'rgba(140,255,170,0.85)';
  c.lineWidth = 2;
  c.strokeRect(1, 1, 62, 62);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

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
    scene.fog = new THREE.Fog(SKY_HORIZON, 40, 115);
    this.scene = scene;
    scene.add(makeSky());

    // ── lights: low golden-hour sun + cool sky / warm sand-bounce fill ──
    const sun = new THREE.DirectionalLight(0xffbe7d, 3.0);
    sun.position.set(SUN_POS[0], SUN_POS[1], SUN_POS[2]);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -19;
    sun.shadow.camera.right = 19;
    sun.shadow.camera.top = 20;
    sun.shadow.camera.bottom = -20;
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 80;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);
    const hemi = new THREE.HemisphereLight(0x96aed2, 0xb07c48, 0.8);
    scene.add(hemi);

    // ── camera rig ──
    const camera = new THREE.PerspectiveCamera(50, w / h, 0.5, 400);
    this.camera = camera;
    this._pan = { x: 0, z: 0 };          // current
    this._panT = { x: 0, z: 0 };         // target
    this._dist = 26;
    this._distT = 26;
    this._lookBase = new THREE.Vector3(0, 0, 1.2);
    this._elev = THREE.MathUtils.degToRad(36);
    this._updateCamera(0);

    // ── post ──
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.45, 0.4, 0.82);
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

    // ── unit bookkeeping ──
    this._units = new Map();      // id → rec
    this._unitRoots = [];         // for picking (kept in sync)
    this._idLookup = new Map();   // sim id → sim unit (rebuilt each update)
    this._baseTurrets = {
      player: { yaw: 0, fireAcc: 0 },
      enemy: { yaw: 0, fireAcc: 0 },
    };

    // ── overlays ──
    this._buildOverlays();

    // ── resize ──
    this._onResize = () => {
      const ww = this.canvas.clientWidth || window.innerWidth;
      const hh = this.canvas.clientHeight || window.innerHeight;
      this.camera.aspect = ww / hh;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(ww, hh, false);
      this.composer.setSize(ww, hh);
    };
    window.addEventListener('resize', this._onResize);

    this._raycaster = new THREE.Raycaster();
    this._pickList = [];
  }

  /* ── overlays: hover tile, selection ring, deploy zone, power reticle ─── */
  _buildOverlays() {
    const scene = this.scene;
    // hover tile
    const hoverMat = new THREE.MeshBasicMaterial({
      map: gridTexture(), transparent: true, opacity: 0.9, depthWrite: false, color: 0xbfffd0,
    });
    this._hover = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), hoverMat);
    this._hover.rotation.x = -Math.PI / 2;
    this._hover.position.y = 0.09;
    this._hover.visible = false;
    scene.add(this._hover);

    // selection ring
    const selMat = new THREE.MeshBasicMaterial({
      color: 0x55c8ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this._selRing = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 36), selMat);
    this._selRing.rotation.x = -Math.PI / 2;
    this._selRing.position.y = 0.1;
    this._selRing.visible = false;
    scene.add(this._selRing);
    this._selectedId = null;

    // deploy zone (rows |z| 5..9, x −7..7)
    const dzTex = gridTexture();
    dzTex.repeat.set(14, 4);
    const dzMat = new THREE.MeshBasicMaterial({ map: dzTex, transparent: true, opacity: 0.55, depthWrite: false });
    this._deploy = new THREE.Mesh(new THREE.PlaneGeometry(14, 4), dzMat);
    this._deploy.rotation.x = -Math.PI / 2;
    this._deploy.position.set(0, 0.08, 7);
    this._deploy.visible = false;
    scene.add(this._deploy);

    // power-target reticle
    const ret = new THREE.Group();
    const rMat = new THREE.MeshBasicMaterial({
      color: 0xffb347, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 48), rMat);
    ring.rotation.x = -Math.PI / 2;
    ret.add(ring);
    const tickGeo = new THREE.PlaneGeometry(0.04, 0.22);
    for (let i = 0; i < 4; i++) {
      const t = new THREE.Mesh(tickGeo, rMat);
      t.rotation.x = -Math.PI / 2;
      t.rotation.z = (i / 4) * Math.PI * 2;
      const a = (i / 4) * Math.PI * 2;
      t.position.set(Math.sin(a) * 0.82, 0.001, Math.cos(a) * 0.82);
      ret.add(t);
    }
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.07, 12), rMat);
    dot.rotation.x = -Math.PI / 2;
    ret.add(dot);
    ret.position.y = 0.1;
    ret.visible = false;
    scene.add(ret);
    this._reticle = ret;
  }

  /* ── contract API ─────────────────────────────────────────────────────── */

  attach(game) {
    if (!game || typeof game.on !== 'function') return;
    this._game = game;
    const on = (ev, fn) => {
      game.on(ev, fn);
      this._handlers.push([ev, fn]);
    };

    on('spawn', (e) => {
      const u = e?.unit ?? e;
      if (!u || u.id == null) return;
      this._ensureUnit(u);
      this.effects.deployPuff(u.x ?? 0, u.z ?? 0);
    });

    on('death', (e) => {
      const u = e?.unit ?? e;
      if (!u || u.id == null) return;
      const rec = this._units.get(u.id);
      const x = rec ? rec.x : (u.x ?? 0);
      const z = rec ? rec.z : (u.z ?? 0);
      const y = rec ? rec.y : 0;
      const ac = u.def?.armorClass || 'vehicle';
      const scale = u.def?.hero ? 1.7 : 1;
      this.effects.explosion(x, y + 0.2, z, ac === 'infantry' ? 'infantry' : ac, scale);
      this._removeUnit(u.id);
    });

    on('attack', (e) => {
      const u = e?.unit;
      const t = e?.target;
      if (!u || u.id == null) return;
      const rec = this._units.get(u.id);
      if (!rec) return;
      const dmg = u.def?.damageType || 'bullet';
      // instant turret aim
      if (t && rec.group.userData.turret) {
        rec.turretAim = Math.atan2((t.x ?? rec.x) - rec.x, (t.z ?? rec.z) - rec.z);
        rec.hasAim = true;
      }
      const muz = rec.group.userData.muzzle;
      if (muz) muz.getWorldPosition(_v1);
      else _v1.set(rec.x, rec.y + 0.4, rec.z);
      this.effects.muzzleFlash(_v1.x, _v1.y, _v1.z, dmg);
      if (dmg === 'bullet' && t) {
        const trec = t.id != null ? this._units.get(t.id) : null;
        const ty = trec ? trec.y + (trec.group.userData.aimY || 0.3) : (t.def?.armorClass === 'air' ? 2.2 : 0.4);
        this.effects.tracer(_v1.x, _v1.y, _v1.z, t.x ?? rec.x, ty, t.z ?? rec.z);
      }
    });

    on('projectile', (e) => {
      if (!e) return;
      // copy — never mutate the sim's event object
      this.effects.projectile({
        from: e.from, to: e.to, dmgType: e.dmgType,
        flightTime: e.flightTime, targetAir: e.targetAir,
        fromY: e.targetAir ? 0.6 : 0.55, // launch from ~turret height
      });
    });

    on('hit', (e) => {
      if (!e) return;
      this.effects.impact(e.x ?? 0, e.z ?? 0, e.dmgType || 'bullet');
    });

    on('nukeLaunch', (e) => {
      const impactZ = e?.impactZ ?? (e?.side === 'player' ? -10 : 10);
      this.terrain.openSilo();
      this.effects.nukeLaunch(0, 0, 0, impactZ);
    });

    on('nukeImpact', (e) => {
      this.effects.nukeImpact(e?.x ?? 0, e?.z ?? 0);
    });

    on('padCaptured', (e) => {
      const pad = e?.pad;
      this.effects.padFlash(pad?.x ?? 0, pad?.z ?? 0, e?.owner);
    });

    on('powerUsed', (e) => {
      if (!e) return;
      const k = String(e.key || '').toLowerCase();
      const x = e.x ?? 0, z = e.z ?? 0;
      if (k.includes('emp')) this.effects.empBlast(x, z, 4);
      else if (k.includes('napalm') || k.includes('burn') || k.includes('flame') || k.includes('fire')) this.effects.napalmRun(x, z, e.side);
      else this.effects.artillery(x, z, 3, 8, 2);
    });

    on('baseHit', (e) => {
      const side = e?.side === 'enemy' ? 'enemy' : 'player';
      const bz = BASE_Z[side];
      this.effects.impact((Math.random() - 0.5) * 2.4, bz + (Math.random() - 0.5) * 1.4, 'cannon', 0.6);
      if (side === 'player') this.screenShake(0.12);
    });

    on('gameOver', (e) => {
      const loser = e?.winner === 'player' ? 'enemy' : 'player';
      const bz = BASE_Z[loser];
      for (let i = 0; i < 7; i++) {
        this.effects._delay(i * 0.25 + Math.random() * 0.1, 'boom', (Math.random() - 0.5) * 3.5, bz + (Math.random() - 0.5) * 2);
      }
      this.screenShake(0.6);
    });
  }

  update(dt, state) {
    if (this._disposed) return;
    dt = Math.min(Math.max(Number(dt) || 0.016, 0.0001), 0.1);
    this._time += dt;
    const time = this._time;

    this._syncUnits(dt, state);
    this.terrain.updatePads(state?.pads);
    this._updateBaseTurrets(dt, state);
    this.terrain.update(dt, time, state);
    this.effects.update(dt, time);

    // selection ring follows selected unit
    if (this._selectedId != null) {
      const rec = this._units.get(this._selectedId);
      if (rec) {
        const r = rec.group.userData.radius || 0.5;
        this._selRing.position.set(rec.x, 0.1, rec.z);
        const pulse = 1 + Math.sin(time * 5) * 0.06;
        this._selRing.scale.setScalar((r + 0.25) * pulse);
        this._selRing.visible = true;
      } else {
        this._selRing.visible = false;
      }
    }
    if (this._hover.visible) {
      this._hover.material.opacity = 0.65 + Math.sin(time * 6) * 0.25;
    }
    if (this._reticle.visible) {
      this._reticle.rotation.y += dt * 0.9;
    }
    if (this._deploy.visible) {
      this._deploy.material.opacity = 0.42 + Math.sin(time * 3) * 0.13;
    }

    this._updateCamera(dt);

    // exposure: nuke dim + white flash
    this._flash = Math.max(0, this._flash - dt * 1.6);
    this.renderer.toneMappingExposure = BASE_EXPOSURE * (1 - this._dim * 0.45) + this._flash * 2.4;

    this.composer.render();
  }

  /** Raycast units first, then the ground plane. → {x, z, unitId|null} | null */
  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    _ndc.set(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    this._raycaster.setFromCamera(_ndc, this.camera);

    let unitId = null;
    this._pickList.length = 0;
    for (let i = 0; i < this._unitRoots.length; i++) {
      if (this._unitRoots[i].visible) this._pickList.push(this._unitRoots[i]);
    }
    const hits = this._raycaster.intersectObjects(this._pickList, true);
    for (let i = 0; i < hits.length; i++) {
      let o = hits[i].object;
      while (o && o.userData.unitId == null) o = o.parent;
      if (o && o.userData.unitId != null) { unitId = o.userData.unitId; break; }
    }

    const gp = this._raycaster.ray.intersectPlane(_plane, _v1);
    if (!gp && unitId == null) return null;
    if (gp) return { x: _v1.x, z: _v1.z, unitId };
    const rec = this._units.get(unitId);
    return { x: rec ? rec.x : 0, z: rec ? rec.z : 0, unitId };
  }

  /** Hover tile highlight. Call setHover(null) to hide. */
  setHover(x, z) {
    if (x == null || z == null || !Number.isFinite(x) || !Number.isFinite(z)) {
      this._hover.visible = false;
      return;
    }
    const tx = Math.max(-6.5, Math.min(6.5, Math.floor(x) + 0.5));
    const tz = Math.max(-10.5, Math.min(10.5, Math.floor(z) + 0.5));
    this._hover.position.set(tx, 0.09, tz);
    this._hover.visible = true;
  }

  /** Show translucent deploy grid for a side; showDeployZone(null) hides it. */
  showDeployZone(side, unitKey = null) {
    if (side !== 'player' && side !== 'enemy') {
      this._deploy.visible = false;
      return;
    }
    this._deploy.position.z = side === 'player' ? 7 : -7;
    this._deploy.visible = true;
  }

  setSelected(unitId = null) {
    this._selectedId = unitId ?? null;
    if (this._selectedId == null) this._selRing.visible = false;
  }

  /** Power-target reticle (extra, per contract note). radius in tiles. */
  showReticle(x, z, radius = 3) {
    if (x == null || !Number.isFinite(x)) { this._reticle.visible = false; return; }
    this._reticle.position.set(x, 0.1, z);
    this._reticle.scale.setScalar(Math.max(0.4, radius));
    this._reticle.visible = true;
  }

  hideReticle() { this._reticle.visible = false; }

  screenShake(strength = 0.3) {
    this._shake = Math.min(3, this._shake + Math.max(0, Number(strength) || 0));
  }

  /* camera controls (called by main.js for WASD / edge pan / wheel / space) */
  panCamera(dx, dz) {
    this._panT.x = Math.max(-4, Math.min(4, this._panT.x + (Number(dx) || 0)));
    this._panT.z = Math.max(-4, Math.min(4, this._panT.z + (Number(dz) || 0)));
  }

  zoomCamera(delta) {
    let d = Number(delta) || 0;
    if (Math.abs(d) > 4) d *= 0.02; // raw wheel deltaY pixels → tiles
    this._distT = Math.max(18, Math.min(34, this._distT + d));
  }

  recenter() {
    this._panT.x = 0;
    this._panT.z = 0;
    this._distT = 26;
  }

  dispose() {
    this._disposed = true;
    window.removeEventListener('resize', this._onResize);
    if (this._game && typeof this._game.off === 'function') {
      for (const [ev, fn] of this._handlers) {
        try { this._game.off(ev, fn); } catch { /* ignore */ }
      }
    }
    this._handlers.length = 0;
    this.effects.dispose();
    this.terrain.dispose();
    this.scene.clear();
    this.composer.dispose?.();
    this.renderer.dispose();
  }

  /* ── internals ────────────────────────────────────────────────────────── */

  _ensureUnit(u) {
    let rec = this._units.get(u.id);
    if (rec) return rec;
    const group = createUnitMesh(u);
    group.userData.unitId = u.id;
    const air = !!group.userData.air;
    const x = u.x ?? 0, z = u.z ?? 0;
    rec = {
      id: u.id,
      side: u.side === 'enemy' ? 'enemy' : 'player',
      group,
      air,
      x, z,
      y: air ? (group.userData.hoverY || 2.0) : 0,
      yaw: u.side === 'player' ? Math.PI : 0,
      prevYaw: 0,
      bank: 0,
      simPx: x, simPz: z,
      turretAim: 0,
      hasAim: false,
      sparkT: 0,
      stealthHidden: false,
      bobPhase: (u.id * 1.7) % (Math.PI * 2) || Math.random() * 6,
    };
    rec.prevYaw = rec.yaw;
    group.position.set(x, air ? 0.2 : 0, z); // air units rise to hover
    group.rotation.y = rec.yaw;
    this.scene.add(group);
    this._units.set(u.id, rec);
    this._unitRoots.push(group);
    return rec;
  }

  _removeUnit(id) {
    const rec = this._units.get(id);
    if (!rec) return;
    this.scene.remove(rec.group);
    const i = this._unitRoots.indexOf(rec.group);
    if (i >= 0) this._unitRoots.splice(i, 1);
    this._units.delete(id);
  }

  _syncUnits(dt, state) {
    const units = state?.units;
    this.effects.beginBars();
    if (!Array.isArray(units)) { this.effects.endBars(); return; }

    const lookup = this._idLookup;
    lookup.clear();
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u && u.id != null) lookup.set(u.id, u);
    }

    // remove meshes for units no longer in state (death event normally
    // handles this first — this is the defensive fallback)
    if (this._units.size !== lookup.size) {
      for (const id of this._units.keys()) {
        if (!lookup.has(id)) this._removeUnit(id);
      }
    }

    const time = this._time;
    const k = 1 - Math.exp(-dt * 11);
    const yawK = Math.min(1, dt * 8);

    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (!u || u.id == null) continue;
      const rec = this._ensureUnit(u);
      const g = rec.group;
      const ud = g.userData;

      // position lerp toward sim
      const ux = u.x ?? rec.x, uz = u.z ?? rec.z;
      rec.x += (ux - rec.x) * k;
      rec.z += (uz - rec.z) * k;

      // movement direction from sim deltas
      const mdx = ux - rec.simPx, mdz = uz - rec.simPz;
      rec.simPx = ux; rec.simPz = uz;
      const mlen = Math.hypot(mdx, mdz);
      const moving = mlen > dt * 0.25 && !u.stunned;

      // facing: movement dir; when attacking face target
      let desiredYaw = rec.yaw;
      let aimYaw = null;
      const target = u.targetId != null ? lookup.get(u.targetId) : null;
      if (target) aimYaw = Math.atan2((target.x ?? rec.x) - rec.x, (target.z ?? rec.z) - rec.z);
      if (moving && mlen > 1e-4) desiredYaw = Math.atan2(mdx, mdz);
      else if (u.state === 'attacking' && aimYaw != null && !ud.turret) desiredYaw = aimYaw;
      rec.prevYaw = rec.yaw;
      rec.yaw += wrapAngle(desiredYaw - rec.yaw) * yawK;
      g.rotation.y = rec.yaw;

      // height: air hover bob, ground stick
      if (rec.air) {
        const hoverY = (ud.hoverY || 2.0) + Math.sin(time * 1.9 + rec.bobPhase) * 0.12;
        rec.y += (hoverY - rec.y) * Math.min(1, dt * 3);
        // banking from yaw rate
        const yawRate = wrapAngle(rec.yaw - rec.prevYaw) / dt;
        const bankT = Math.max(-0.45, Math.min(0.45, -yawRate * 0.35));
        rec.bank += (bankT - rec.bank) * Math.min(1, dt * 4);
        g.rotation.z = rec.bank;
      } else {
        rec.y = 0;
      }
      g.position.set(rec.x, rec.y, rec.z);

      // turret aim
      if (ud.turret) {
        let rel = null;
        if (aimYaw != null) { rel = wrapAngle(aimYaw - rec.yaw); rec.hasAim = true; rec.turretAim = aimYaw; }
        else if (rec.hasAim) rel = wrapAngle(rec.turretAim - rec.yaw);
        const cur = ud.turret.rotation.y;
        const tgt = rel != null ? rel : 0;
        ud.turret.rotation.y = cur + wrapAngle(tgt - cur) * Math.min(1, dt * 9);
        if (target == null && u.state !== 'attacking') rec.hasAim = false;
      }

      // stealth visuals: friendly = shimmer, enemy = hidden
      if (u.stealthed) {
        if (rec.side === 'player') {
          g.visible = true;
          setUnitOpacity(g, 0.2 + 0.08 * Math.sin(time * 6 + rec.bobPhase));
          rec.stealthHidden = false;
        } else {
          g.visible = false;
          rec.stealthHidden = true;
        }
      } else {
        if (rec.stealthHidden) rec.stealthHidden = false;
        if (!g.visible) g.visible = true;
        if (ud.fadeMats) setUnitOpacity(g, 1);
      }

      // stun sparks
      if (u.stunned && g.visible) {
        rec.sparkT -= dt;
        if (rec.sparkT <= 0) {
          rec.sparkT = 0.1 + Math.random() * 0.12;
          this.effects.stunSparks(rec.x, rec.y + (ud.aimY || 0.4), rec.z);
        }
      }

      // health bar above damaged units
      const maxHp = u.maxHp ?? u.def?.hp;
      if (g.visible && Number.isFinite(u.hp) && Number.isFinite(maxHp) && maxHp > 0 && u.hp < maxHp && u.hp > 0) {
        this.effects.drawBar(rec.x, rec.y + (ud.height || 0.7) + 0.45, rec.z, u.hp / maxHp);
      }

      animateUnitMesh(g, dt, time, moving);
    }
    this.effects.endBars();
  }

  _updateBaseTurrets(dt, state) {
    const units = state?.units;
    for (const side of ['player', 'enemy']) {
      const base = this.terrain.bases[side];
      if (!base) continue;
      const bt = this._baseTurrets[side];
      const bz = BASE_Z[side];
      let best = null, bestD = 4.6;
      if (Array.isArray(units)) {
        for (let i = 0; i < units.length; i++) {
          const u = units[i];
          if (!u || u.side === side || u.stealthed) continue;
          const d = Math.hypot((u.x ?? 0) - 0, (u.z ?? 0) - bz);
          if (d < bestD) { bestD = d; best = u; }
        }
      }
      if (best) {
        const worldYaw = Math.atan2((best.x ?? 0) - 0, (best.z ?? 0) - bz);
        const rel = wrapAngle(worldYaw - base.rotY);
        base.turret.rotation.y += wrapAngle(rel - base.turret.rotation.y) * Math.min(1, dt * 6);
        bt.fireAcc -= dt;
        if (bt.fireAcc <= 0) {
          bt.fireAcc = 0.45 + Math.random() * 0.2;
          base.muzzle.getWorldPosition(_v1);
          const trec = best.id != null ? this._units.get(best.id) : null;
          const ty = trec ? trec.y + (trec.group.userData.aimY || 0.3) : 0.4;
          this.effects.muzzleFlash(_v1.x, _v1.y, _v1.z, 'bullet');
          this.effects.tracer(_v1.x, _v1.y, _v1.z, best.x ?? 0, ty, best.z ?? bz);
        }
      } else {
        bt.fireAcc = 0.2;
        base.turret.rotation.y += wrapAngle(0 - base.turret.rotation.y) * Math.min(1, dt * 1.5);
      }
    }
  }

  _updateCamera(dt) {
    const k = dt > 0 ? Math.min(1, dt * 5) : 1;
    this._pan.x += (this._panT.x - this._pan.x) * k;
    this._pan.z += (this._panT.z - this._pan.z) * k;
    this._dist += (this._distT - this._dist) * k;

    // subtle idle drift
    const driftX = Math.sin(this._time * 0.21) * 0.07;
    const driftZ = Math.cos(this._time * 0.16) * 0.05;

    const lookX = this._lookBase.x + this._pan.x + driftX;
    const lookZ = this._lookBase.z + this._pan.z + driftZ;

    const y = Math.sin(this._elev) * this._dist;
    const back = Math.cos(this._elev) * this._dist;

    // shake
    this._shake = Math.max(0, this._shake - this._shake * 3.2 * dt - 0.02 * dt);
    const sh = this._shake;
    const sx = sh > 0.001 ? (Math.random() - 0.5) * sh * 0.3 : 0;
    const sy = sh > 0.001 ? (Math.random() - 0.5) * sh * 0.22 : 0;
    const sz = sh > 0.001 ? (Math.random() - 0.5) * sh * 0.3 : 0;

    this.camera.position.set(lookX + sx, y + sy, lookZ + back + sz);
    _v2.set(lookX + sx * 0.4, 0, lookZ + sz * 0.4);
    this.camera.lookAt(_v2);
  }
}

export default GfxEngine;

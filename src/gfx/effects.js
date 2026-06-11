// ─── IRON COMMAND — effects: particles, projectiles, explosions, powers ────
// Everything is pooled at construction time — no per-frame allocations in hot
// paths. One Effects instance owns all pools.
import * as THREE from 'three';
import { TEAM_COLORS } from './meshes.js';

/* ── procedural sprite textures ─────────────────────────────────────────── */
function radialTex(size, stops, noise = 0) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [t, col] of stops) g.addColorStop(t, col);
  c.fillStyle = g;
  c.fillRect(0, 0, size, size);
  if (noise) {
    for (let i = 0; i < noise; i++) {
      c.fillStyle = `rgba(0,0,0,${Math.random() * 0.25})`;
      const r = 2 + Math.random() * size * 0.12;
      c.beginPath();
      c.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2);
      c.fill();
    }
    // re-mask edges so noise doesn't square off the sprite
    c.globalCompositeOperation = 'destination-in';
    const m = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    m.addColorStop(0, 'rgba(255,255,255,1)');
    m.addColorStop(0.7, 'rgba(255,255,255,0.9)');
    m.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = m;
    c.fillRect(0, 0, size, size);
    c.globalCompositeOperation = 'source-over';
  }
  return new THREE.CanvasTexture(cv);
}

let TEXES = null;
function texes() {
  if (!TEXES) {
    TEXES = {
      glow: radialTex(128, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.85)'], [1, 'rgba(255,255,255,0)']]),
      smoke: radialTex(128, [[0, 'rgba(200,200,200,0.9)'], [0.5, 'rgba(160,160,160,0.55)'], [1, 'rgba(140,140,140,0)']], 24),
      spark: radialTex(64, [[0, 'rgba(255,255,255,1)'], [0.15, 'rgba(255,255,255,0.9)'], [1, 'rgba(255,255,255,0)']]),
    };
  }
  return TEXES;
}

const _c1 = new THREE.Color();

/* ── sprite particle pool ───────────────────────────────────────────────── */
class SpritePool {
  constructor(scene, count, tex, blending) {
    this.items = [];
    this.cursor = 0;
    for (let i = 0; i < count; i++) {
      const m = new THREE.SpriteMaterial({
        map: tex, blending, transparent: true, depthWrite: false, opacity: 0, rotation: 0,
      });
      const s = new THREE.Sprite(m);
      s.visible = false;
      s.frustumCulled = false;
      scene.add(s);
      this.items.push({
        s, m, life: 0, ttl: 1,
        vx: 0, vy: 0, vz: 0, g: 0, drag: 0,
        s0: 1, s1: 1, o0: 1, rv: 0,
        c0: new THREE.Color(1, 1, 1), c1: new THREE.Color(1, 1, 1), useC1: false,
      });
    }
  }

  spawn(x, y, z, o) {
    const items = this.items;
    let p = null;
    for (let i = 0; i < items.length; i++) {
      this.cursor = (this.cursor + 1) % items.length;
      if (items[this.cursor].life <= 0) { p = items[this.cursor]; break; }
    }
    if (!p) p = items[this.cursor]; // steal oldest slot
    p.s.position.set(x, y, z);
    p.ttl = p.life = o.ttl ?? 1;
    p.vx = o.vx ?? 0; p.vy = o.vy ?? 0; p.vz = o.vz ?? 0;
    p.g = o.g ?? 0; p.drag = o.drag ?? 0;
    p.s0 = o.s0 ?? 1; p.s1 = o.s1 ?? p.s0;
    p.o0 = o.o0 ?? 1;
    p.rv = o.rv ?? 0;
    p.m.rotation = o.rot ?? Math.random() * Math.PI * 2;
    p.c0.setHex(o.c0 ?? 0xffffff);
    p.useC1 = o.c1 !== undefined;
    if (p.useC1) p.c1.setHex(o.c1);
    p.m.color.copy(p.c0);
    p.m.opacity = p.o0;
    p.s.scale.setScalar(p.s0);
    p.s.visible = true;
    return p;
  }

  update(dt) {
    const items = this.items;
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; p.m.opacity = 0; continue; }
      const t = 1 - p.life / p.ttl;
      if (p.drag) { const d = Math.max(0, 1 - p.drag * dt); p.vx *= d; p.vy *= d; p.vz *= d; }
      p.vy += p.g * dt;
      p.s.position.x += p.vx * dt;
      p.s.position.y += p.vy * dt;
      p.s.position.z += p.vz * dt;
      p.s.scale.setScalar(p.s0 + (p.s1 - p.s0) * t);
      p.m.opacity = p.o0 * (1 - t) * (1 - t * 0.3);
      p.m.rotation += p.rv * dt;
      if (p.useC1) p.m.color.lerpColors(p.c0, p.c1, t);
    }
  }
}

/* ── scrap chunk pool (vehicle debris) ──────────────────────────────────── */
class ScrapPool {
  constructor(scene, count) {
    this.items = [];
    this.cursor = 0;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.7, metalness: 0.5 });
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.castShadow = true;
      scene.add(m);
      this.items.push({ m, life: 0, ttl: 1, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0 });
    }
  }

  spawn(x, y, z, power) {
    this.cursor = (this.cursor + 1) % this.items.length;
    const p = this.items[this.cursor];
    p.m.position.set(x, y, z);
    const s = 0.05 + Math.random() * 0.1 * power;
    p.m.scale.set(s, s * (0.5 + Math.random()), s * (0.5 + Math.random()));
    p.life = p.ttl = 1.2 + Math.random() * 0.8;
    const a = Math.random() * Math.PI * 2;
    const v = (1.5 + Math.random() * 3) * power;
    p.vx = Math.cos(a) * v;
    p.vz = Math.sin(a) * v;
    p.vy = 3 + Math.random() * 4 * power;
    p.rx = (Math.random() - 0.5) * 12;
    p.ry = (Math.random() - 0.5) * 12;
    p.m.visible = true;
  }

  update(dt) {
    for (let i = 0; i < this.items.length; i++) {
      const p = this.items[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.m.visible = false; continue; }
      p.vy -= 12 * dt;
      p.m.position.x += p.vx * dt;
      p.m.position.y += p.vy * dt;
      p.m.position.z += p.vz * dt;
      if (p.m.position.y < 0.04) { p.m.position.y = 0.04; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
      p.m.rotation.x += p.rx * dt;
      p.m.rotation.y += p.ry * dt;
    }
  }
}

/* ── transient point lights ─────────────────────────────────────────────── */
class LightPool {
  constructor(scene, count) {
    this.items = [];
    this.cursor = 0;
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 12, 2);
      l.visible = false;
      scene.add(l);
      this.items.push({ l, life: 0, ttl: 1, i0: 1 });
    }
  }

  spawn(x, y, z, color, intensity, ttl) {
    this.cursor = (this.cursor + 1) % this.items.length;
    const p = this.items[this.cursor];
    p.l.position.set(x, y, z);
    p.l.color.setHex(color);
    p.i0 = intensity;
    p.life = p.ttl = ttl;
    p.l.intensity = intensity;
    p.l.visible = true;
  }

  update(dt) {
    for (let i = 0; i < this.items.length; i++) {
      const p = this.items[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.l.visible = false; p.l.intensity = 0; continue; }
      const t = p.life / p.ttl;
      p.l.intensity = p.i0 * t * t;
    }
  }
}

/* ── tracer pool ────────────────────────────────────────────────────────── */
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _mid = new THREE.Vector3();

class TracerPool {
  constructor(scene, count) {
    this.items = [];
    this.cursor = 0;
    const geo = new THREE.BoxGeometry(0.035, 0.035, 1);
    for (let i = 0; i < count; i++) {
      const m = new THREE.MeshBasicMaterial({
        color: 0xffd28a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, m);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.items.push({ mesh, m, life: 0, ttl: 0.09 });
    }
  }

  spawn(x1, y1, z1, x2, y2, z2, color = 0xffd28a, thick = 1) {
    this.cursor = (this.cursor + 1) % this.items.length;
    const p = this.items[this.cursor];
    _from.set(x1, y1, z1);
    _to.set(x2, y2, z2);
    _mid.addVectors(_from, _to).multiplyScalar(0.5);
    const len = _from.distanceTo(_to);
    p.mesh.position.copy(_mid);
    p.mesh.lookAt(_to);
    p.mesh.scale.set(thick, thick, Math.max(0.01, len));
    p.m.color.setHex(color);
    p.life = p.ttl = 0.09;
    p.m.opacity = 0.95;
    p.mesh.visible = true;
  }

  update(dt) {
    for (let i = 0; i < this.items.length; i++) {
      const p = this.items[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.mesh.visible = false; continue; }
      p.m.opacity = 0.95 * (p.life / p.ttl);
    }
  }
}

/* ── expanding ground rings (EMP / shockwaves) ──────────────────────────── */
class RingPool {
  constructor(scene, count) {
    this.items = [];
    this.cursor = 0;
    const geo = new THREE.RingGeometry(0.86, 1, 48);
    for (let i = 0; i < count; i++) {
      const m = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, m);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.items.push({ mesh, m, life: 0, ttl: 1, r0: 0.3, r1: 4 });
    }
  }

  spawn(x, z, r0, r1, ttl, color, y = 0.12, opacity = 0.9) {
    this.cursor = (this.cursor + 1) % this.items.length;
    const p = this.items[this.cursor];
    p.mesh.position.set(x, y, z);
    p.r0 = r0; p.r1 = r1;
    p.life = p.ttl = ttl;
    p.m.color.setHex(color);
    p.o0 = opacity;
    p.mesh.scale.setScalar(Math.max(0.01, r0));
    p.m.opacity = opacity;
    p.mesh.visible = true;
  }

  update(dt) {
    for (let i = 0; i < this.items.length; i++) {
      const p = this.items[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.mesh.visible = false; continue; }
      const t = 1 - p.life / p.ttl;
      const e = 1 - (1 - t) * (1 - t); // ease-out
      p.mesh.scale.setScalar(Math.max(0.01, p.r0 + (p.r1 - p.r0) * e));
      p.m.opacity = (p.o0 ?? 0.9) * (1 - t);
    }
  }
}

/* ── projectile pool (shells & missiles) ────────────────────────────────── */
class ProjectilePool {
  constructor(scene, count) {
    this.items = [];
    this.cursor = 0;
    const shellMat = new THREE.MeshBasicMaterial({ color: 0xffc06a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xc7ccd1, roughness: 0.4, metalness: 0.6 });
    const exhMat = new THREE.SpriteMaterial({ map: texes().glow, color: 0xffa040, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    const shellGeo = new THREE.CapsuleGeometry(0.05, 0.2, 2, 6);
    const missGeo = new THREE.CylinderGeometry(0.04, 0.05, 0.3, 6);
    const noseGeo = new THREE.ConeGeometry(0.04, 0.1, 6);
    for (let i = 0; i < count; i++) {
      const g = new THREE.Group();
      const shell = new THREE.Mesh(shellGeo, shellMat);
      shell.rotation.x = Math.PI / 2;
      const missile = new THREE.Group();
      const mb = new THREE.Mesh(missGeo, bodyMat);
      mb.rotation.x = Math.PI / 2;
      missile.add(mb);
      const nose = new THREE.Mesh(noseGeo, bodyMat);
      nose.rotation.x = Math.PI / 2;
      nose.position.z = 0.2;
      missile.add(nose);
      const exh = new THREE.Sprite(exhMat);
      exh.scale.setScalar(0.35);
      exh.position.z = -0.22;
      missile.add(exh);
      g.add(shell, missile);
      g.visible = false;
      g.frustumCulled = false;
      scene.add(g);
      this.items.push({
        g, shell, missile, active: false,
        fx: 0, fy: 0, fz: 0, tx: 0, ty: 0, tz: 0,
        t: 0, dur: 1, type: 'cannon', arc: 1, lat: 0, trailAcc: 0,
      });
    }
  }

  spawn(ev) {
    this.cursor = (this.cursor + 1) % this.items.length;
    const p = this.items[this.cursor];
    p.active = true;
    p.fx = ev.from?.x ?? 0;
    p.fz = ev.from?.z ?? 0;
    p.fy = ev.fromY ?? 0.5;
    p.tx = ev.to?.x ?? p.fx;
    p.tz = ev.to?.z ?? p.fz;
    p.ty = ev.targetAir ? 2.2 : 0.25;
    p.t = 0;
    p.dur = Math.max(0.08, Number(ev.flightTime) || 0.5);
    p.type = ev.dmgType === 'missile' ? 'missile' : 'cannon';
    const dist = Math.hypot(p.tx - p.fx, p.tz - p.fz);
    p.arc = p.type === 'missile' ? 0.5 + dist * 0.1 : 0.4 + dist * 0.16;
    p.lat = p.type === 'missile' ? (Math.random() - 0.5) * Math.min(1.4, dist * 0.3) : 0;
    p.trailAcc = 0;
    p.shell.visible = p.type === 'cannon';
    p.missile.visible = p.type === 'missile';
    p.g.position.set(p.fx, p.fy, p.fz);
    p.g.visible = true;
  }

  update(dt, fx /* effects, for trails */) {
    for (let i = 0; i < this.items.length; i++) {
      const p = this.items[i];
      if (!p.active) continue;
      p.t += dt;
      const t = Math.min(1, p.t / p.dur);
      if (t >= 1) {
        p.active = false;
        p.g.visible = false;
        continue;
      }
      // lateral homing curve (missiles) — fades to 0 at impact
      const latOff = p.lat * Math.sin(t * Math.PI);
      const dx = p.tx - p.fx, dz = p.tz - p.fz;
      const dl = Math.hypot(dx, dz) || 1;
      const px = -dz / dl, pz = dx / dl;
      const lastX = p.g.position.x, lastY = p.g.position.y, lastZ = p.g.position.z;
      const x = p.fx + dx * t + px * latOff;
      const z = p.fz + dz * t + pz * latOff;
      const y = p.fy + (p.ty - p.fy) * t + Math.sin(t * Math.PI) * p.arc;
      p.g.position.set(x, y, z);
      _to.set(x + (x - lastX), y + (y - lastY), z + (z - lastZ));
      if (_to.distanceToSquared(p.g.position) > 1e-8) p.g.lookAt(_to);
      // smoke trail for missiles
      if (p.type === 'missile' && fx) {
        p.trailAcc += dt;
        while (p.trailAcc > 0.035) {
          p.trailAcc -= 0.035;
          fx.smoke.spawn(x, y, z, {
            ttl: 0.7 + Math.random() * 0.4, s0: 0.16, s1: 0.55,
            vx: (Math.random() - 0.5) * 0.3, vy: 0.3, vz: (Math.random() - 0.5) * 0.3,
            o0: 0.45, c0: 0xc9c9c9, rv: 1,
          });
        }
      }
    }
  }
}

/* ── health bar pool ────────────────────────────────────────────────────── */
class BarPool {
  constructor(scene, count) {
    this.items = [];
    this.used = 0;
    const bgGeo = new THREE.PlaneGeometry(0.78, 0.1);
    const fgGeo = new THREE.PlaneGeometry(0.72, 0.055);
    const bgMat = new THREE.MeshBasicMaterial({ color: 0x101214, transparent: true, opacity: 0.75, depthWrite: false });
    for (let i = 0; i < count; i++) {
      const g = new THREE.Group();
      const bg = new THREE.Mesh(bgGeo, bgMat);
      const fg = new THREE.Mesh(fgGeo, new THREE.MeshBasicMaterial({ color: 0x4dd24d, depthWrite: false, transparent: true, opacity: 0.95 }));
      fg.position.z = 0.005;
      g.add(bg, fg);
      g.visible = false;
      g.frustumCulled = false;
      scene.add(g);
      this.items.push({ g, fg });
    }
  }

  begin() { this.used = 0; }

  draw(x, y, z, frac, quat) {
    if (this.used >= this.items.length) return;
    const p = this.items[this.used++];
    frac = Math.min(1, Math.max(0, frac));
    p.g.position.set(x, y, z);
    p.g.quaternion.copy(quat);
    p.fg.scale.x = Math.max(0.02, frac);
    p.fg.position.x = -(1 - frac) * 0.36;
    p.fg.material.color.setHSL(frac * 0.33, 0.85, 0.5);
    p.g.visible = true;
  }

  end() {
    for (let i = this.used; i < this.items.length; i++) {
      if (!this.items[i].g.visible) break;
      this.items[i].g.visible = false;
    }
  }
}

/* ── napalm strafing jet ────────────────────────────────────────────────── */
function buildStrafeJet() {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x4b4f44, roughness: 0.6, metalness: 0.4 });
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.17, 1.3, 8), body);
  fus.rotation.x = Math.PI / 2;
  g.add(fus);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.4, 8), body);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 0.85;
  g.add(nose);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.04, 0.45), body);
  wing.position.z = -0.05;
  g.add(wing);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 0.25), body);
  tail.position.z = -0.62;
  g.add(tail);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.32, 0.26), body);
  fin.position.set(0, 0.18, -0.62);
  g.add(fin);
  const exh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.1, 0.1, 8),
    new THREE.MeshStandardMaterial({ color: 0x1d1106, emissive: 0xff9a3d, emissiveIntensity: 2.6 }),
  );
  exh.rotation.x = Math.PI / 2;
  exh.position.z = -0.7;
  g.add(exh);
  g.visible = false;
  return g;
}

/* ── nuke missile ───────────────────────────────────────────────────────── */
function buildNukeMissile() {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.35, metalness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2c2f32, roughness: 0.6, metalness: 0.4 });
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 1.7, 12), body);
  tube.position.y = 0.85;
  g.add(tube);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.55, 12), body);
  nose.position.y = 1.97;
  g.add(nose);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.235, 0.12, 12), dark);
  band.position.y = 1.45;
  g.add(band);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.45, 0.3), dark);
    fin.position.set(Math.cos(a) * 0.26, 0.25, Math.sin(a) * 0.26);
    fin.rotation.y = -a;
    g.add(fin);
  }
  const exh = new THREE.Sprite(new THREE.SpriteMaterial({ map: texes().glow, color: 0xffa040, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  exh.scale.setScalar(1.4);
  exh.position.y = -0.15;
  g.add(exh);
  g.visible = false;
  return g;
}

/* ════════════════════════════════════════════════════════════════════════ */
export class Effects {
  /**
   * hooks: { screenShake(strength), setDim(v 0..1), flash(v 0..1) } — all optional
   */
  constructor(scene, camera, hooks = {}) {
    this.scene = scene;
    this.camera = camera;
    this.hooks = hooks;
    const T = texes();
    this.add = new SpritePool(scene, 200, T.glow, THREE.AdditiveBlending);
    this.spark = new SpritePool(scene, 90, T.spark, THREE.AdditiveBlending);
    this.smoke = new SpritePool(scene, 170, T.smoke, THREE.NormalBlending);
    this.scrap = new ScrapPool(scene, 40);
    this.lights = new LightPool(scene, 6);
    this.tracers = new TracerPool(scene, 30);
    this.rings = new RingPool(scene, 8);
    this.projectiles = new ProjectilePool(scene, 26);
    this.bars = new BarPool(scene, 90);
    this.jet = buildStrafeJet();
    scene.add(this.jet);
    this.nukeMissile = buildNukeMissile();
    scene.add(this.nukeMissile);

    // persistent ground emitters (napalm fire, burning wrecks…) — fixed slots
    this.emitters = [];
    for (let i = 0; i < 28; i++) this.emitters.push({ active: false, kind: 'fire', x: 0, z: 0, life: 0, acc: 0, rate: 0.07 });

    // delayed one-shots (artillery shells, gameOver barrage) — fixed slots
    this.delayed = [];
    for (let i = 0; i < 40; i++) this.delayed.push({ active: false, t: 0, kind: '', x: 0, z: 0, a: 0 });

    this.flyover = { active: false, t: 0, dur: 1.2, x: 0, z0: 0, z1: 0 };
    this.nuke = { phase: 'idle', t: 0, x: 0, z: 0, dim: 0 };
    this.time = 0;
  }

  /* ── low level spawn helpers ──────────────────────────────────────────── */
  _fireball(x, y, z, scale, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.3 * scale;
      this.add.spawn(x + Math.cos(a) * r, y + Math.random() * 0.3 * scale, z + Math.sin(a) * r, {
        ttl: 0.35 + Math.random() * 0.4, s0: 0.4 * scale, s1: 1.5 * scale,
        vx: Math.cos(a) * scale * 0.8, vy: 1.2 * scale, vz: Math.sin(a) * scale * 0.8,
        o0: 0.95, c0: 0xffd9a0, c1: 0xe23c10, rv: (Math.random() - 0.5) * 4, drag: 2,
      });
    }
  }

  _smokePuffs(x, y, z, scale, n, dark = false) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.smoke.spawn(x + Math.cos(a) * 0.2 * scale, y + Math.random() * 0.2, z + Math.sin(a) * 0.2 * scale, {
        ttl: 1.1 + Math.random() * 1.2, s0: 0.5 * scale, s1: 1.9 * scale,
        vx: Math.cos(a) * 0.5 * scale, vy: 0.9 + Math.random() * 0.8, vz: Math.sin(a) * 0.5 * scale,
        o0: dark ? 0.65 : 0.42, c0: dark ? 0x35312c : 0x8d867c, rv: (Math.random() - 0.5) * 1.5, drag: 1.2,
      });
    }
  }

  _sparks(x, y, z, n, color = 0xffd28a, v = 5) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = Math.random();
      this.spark.spawn(x, y, z, {
        ttl: 0.25 + Math.random() * 0.35, s0: 0.12, s1: 0.03,
        vx: Math.cos(a) * v * (0.4 + Math.random()), vy: up * v, vz: Math.sin(a) * v * (0.4 + Math.random()),
        o0: 1, c0: color, g: -9,
      });
    }
  }

  /* ── public effect API ────────────────────────────────────────────────── */
  muzzleFlash(x, y, z, dmgType = 'bullet') {
    const big = dmgType === 'cannon';
    this.add.spawn(x, y, z, {
      ttl: big ? 0.12 : 0.07, s0: big ? 0.7 : 0.35, s1: big ? 1.1 : 0.5,
      o0: 1, c0: 0xffe2a8, c1: 0xff8830,
    });
    if (big) {
      this._sparks(x, y, z, 3, 0xffc070, 3);
      this.lights.spawn(x, y + 0.2, z, 0xffaa55, 8, 0.12);
    }
  }

  tracer(x1, y1, z1, x2, y2, z2) {
    this.tracers.spawn(x1, y1, z1, x2, y2, z2);
  }

  flameCone(x, y, z, tx, ty, tz, dur = 0.45) {
    // burst of flame particles streaming source → target
    const dx = tx - x, dy = ty - y, dz = tz - z;
    const dl = Math.hypot(dx, dy, dz) || 1;
    const n = 10;
    for (let i = 0; i < n; i++) {
      const sp = (2.4 + Math.random() * 2.2);
      const jx = (Math.random() - 0.5) * 0.7, jz = (Math.random() - 0.5) * 0.7;
      this.add.spawn(x, y, z, {
        ttl: dl / sp * (0.7 + Math.random() * 0.5), s0: 0.18, s1: 0.85,
        vx: (dx / dl) * sp + jx, vy: (dy / dl) * sp + 0.4, vz: (dz / dl) * sp + jz,
        o0: 0.85, c0: 0xffd070, c1: 0xd84410, drag: 0.6,
      });
    }
    this.lights.spawn(x + dx * 0.3, y + 0.3, z + dz * 0.3, 0xff7722, 5, 0.3);
  }

  projectile(ev) {
    if (!ev) return;
    if (ev.dmgType === 'flame') {
      const fy = ev.fromY ?? 0.45;
      this.flameCone(ev.from?.x ?? 0, fy, ev.from?.z ?? 0, ev.to?.x ?? 0, ev.targetAir ? 2.2 : 0.3, ev.to?.z ?? 0);
      return;
    }
    this.projectiles.spawn(ev);
  }

  impact(x, z, dmgType, y = 0.15) {
    switch (dmgType) {
      case 'bullet':
        this._sparks(x, y + 0.15, z, 4, 0xffd28a, 3.5);
        this.smoke.spawn(x, y + 0.1, z, { ttl: 0.5, s0: 0.15, s1: 0.5, vy: 0.8, o0: 0.3, c0: 0xa89878 });
        break;
      case 'cannon':
        this._fireball(x, y + 0.1, z, 0.7, 4);
        this._smokePuffs(x, y, z, 0.7, 3);
        this._sparks(x, y + 0.2, z, 6, 0xffc070, 5);
        this.lights.spawn(x, y + 0.5, z, 0xff9944, 14, 0.18);
        this.rings.spawn(x, z, 0.2, 1.1, 0.3, 0xffaa66, 0.1, 0.4);
        break;
      case 'missile':
        this._fireball(x, y + 0.2, z, 0.8, 5);
        this._smokePuffs(x, y, z, 0.9, 4);
        this.lights.spawn(x, y + 0.5, z, 0xff8844, 14, 0.2);
        break;
      case 'flame':
        for (let i = 0; i < 5; i++) {
          this.add.spawn(x + (Math.random() - 0.5) * 0.6, y + 0.1, z + (Math.random() - 0.5) * 0.6, {
            ttl: 0.5 + Math.random() * 0.4, s0: 0.3, s1: 0.9, vy: 1.4 + Math.random(),
            o0: 0.8, c0: 0xffc060, c1: 0xc83a10,
          });
        }
        this._smokePuffs(x, y + 0.3, z, 0.6, 2, true);
        break;
      default:
        this._sparks(x, y + 0.15, z, 3);
    }
  }

  explosion(x, y, z, kind = 'vehicle', scale = 1) {
    const inf = kind === 'infantry';
    const s = inf ? scale * 0.55 : scale;
    // flash
    this.add.spawn(x, y + 0.3 * s, z, { ttl: 0.12, s0: 1.6 * s, s1: 2.6 * s, o0: 1, c0: 0xffffff });
    this._fireball(x, y + 0.2, z, s, inf ? 4 : 8);
    this._smokePuffs(x, y + 0.1, z, s, inf ? 3 : 7, !inf);
    this._sparks(x, y + 0.3, z, inf ? 5 : 12, 0xffc070, 5 * s);
    this.lights.spawn(x, y + 0.8, z, 0xff9944, 22 * s, 0.35);
    if (!inf) {
      const n = kind === 'air' ? 5 : 7;
      for (let i = 0; i < n; i++) this.scrap.spawn(x, y + 0.3, z, s);
      this.rings.spawn(x, z, 0.3, 2.2 * s, 0.45, 0xffa050, 0.1, 0.35);
    }
    this.hooks.screenShake?.(Math.min(0.5, 0.12 * s));
  }

  empBlast(x, z, radius = 4) {
    this.rings.spawn(x, z, 0.4, radius, 0.9, 0x55baff, 0.18, 1.0);
    this.rings.spawn(x, z, 0.2, radius * 0.7, 0.6, 0x99e0ff, 0.3, 0.8);
    this.add.spawn(x, 0.8, z, { ttl: 0.4, s0: 1.5, s1: 4.5, o0: 0.9, c0: 0x77ccff });
    this._sparks(x, 0.6, z, 16, 0x88d8ff, 7);
    this.lights.spawn(x, 1.2, z, 0x66bbff, 26, 0.5);
    this.hooks.screenShake?.(0.25);
  }

  stunSparks(x, y, z) {
    const a = Math.random() * Math.PI * 2;
    this.spark.spawn(x + Math.cos(a) * 0.3, y + (Math.random() - 0.3) * 0.4, z + Math.sin(a) * 0.3, {
      ttl: 0.18 + Math.random() * 0.15, s0: 0.16, s1: 0.04,
      vx: Math.cos(a) * 1.5, vy: 1 + Math.random() * 2, vz: Math.sin(a) * 1.5,
      o0: 1, c0: 0x88d8ff,
    });
  }

  /** plane flyover + persistent fire wall (~5 s) along z through (x,z) */
  napalmRun(x, z, side = 'enemy') {
    const dir = side === 'player' ? -1 : 1; // fly toward the opposing base
    this.flyover.active = true;
    this.flyover.t = 0;
    this.flyover.dur = 1.5;
    this.flyover.x = x;
    this.flyover.z0 = z - dir * 14;
    this.flyover.z1 = z + dir * 14;
    // fire wall 6 long (z) × 2 wide (x), staggered ignition
    let d = 0.55;
    for (let i = 0; i < 8; i++) {
      const fz = z - dir * 3 + dir * i * 0.8;
      for (const fxo of [-0.5, 0.5]) {
        this._delay(d, 'fire', x + fxo + (Math.random() - 0.5) * 0.4, fz);
      }
      d += 0.07;
    }
  }

  /** staggered ground explosions in a circle (artillery barrage) */
  artillery(x, z, radius = 3, shells = 8, over = 2) {
    for (let i = 0; i < shells; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      this._delay((i / shells) * over + Math.random() * 0.15, 'shell', x + Math.cos(a) * r, z + Math.sin(a) * r);
    }
  }

  _delay(t, kind, x, z) {
    for (let i = 0; i < this.delayed.length; i++) {
      const d = this.delayed[i];
      if (!d.active) {
        d.active = true; d.t = t; d.kind = kind; d.x = x; d.z = z;
        return;
      }
    }
  }

  _igniteFire(x, z, life = 5) {
    for (let i = 0; i < this.emitters.length; i++) {
      const e = this.emitters[i];
      if (!e.active) {
        e.active = true; e.kind = 'fire'; e.x = x; e.z = z; e.life = life; e.acc = 0;
        e.rate = 0.08 + Math.random() * 0.04;
        return;
      }
    }
  }

  nukeLaunch(siloX = 0, siloZ = 0, targetX = 0, targetZ = 10) {
    const n = this.nuke;
    n.phase = 'rise';
    n.t = 0;
    n.x = targetX;
    n.z = targetZ;
    this.nukeMissile.position.set(siloX, 0.4, siloZ);
    this.nukeMissile.rotation.set(0, 0, 0);
    this.nukeMissile.visible = true;
    this.hooks.screenShake?.(0.3);
  }

  nukeImpact(x, z) {
    const n = this.nuke;
    n.phase = 'idle';
    n.dim = 0;
    this.hooks.setDim?.(0);
    this.nukeMissile.visible = false;
    // warhead streak from the sky
    this.tracers.spawn(x + 2, 26, z - 3, x, 0.5, z, 0xffffff, 4);
    // white flash
    this.hooks.flash?.(1);
    this.add.spawn(x, 2, z, { ttl: 0.3, s0: 10, s1: 26, o0: 1, c0: 0xffffff });
    // core fireball
    for (let i = 0; i < 10; i++) {
      this.add.spawn(x + (Math.random() - 0.5) * 1.5, 0.8 + Math.random() * 1.5, z + (Math.random() - 0.5) * 1.5, {
        ttl: 1.2 + Math.random() * 0.8, s0: 1.5, s1: 6.5,
        vy: 2.5 + Math.random() * 2, o0: 0.95, c0: 0xfff0b0, c1: 0xd83008, rv: (Math.random() - 0.5) * 2, drag: 0.8,
      });
    }
    // mushroom stem + cap (layered smoke, staggered)
    for (let i = 0; i < 14; i++) {
      this._delay(0.15 + i * 0.1, 'stem', x, z);
      if (i < 10) this._delay(0.7 + i * 0.16, 'cap', x, z);
    }
    // ground shockwave + dust ring
    this.rings.spawn(x, z, 0.5, 13, 1.5, 0xffc890, 0.15, 0.9);
    this.rings.spawn(x, z, 0.3, 9, 1.1, 0xffffff, 0.4, 0.5);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      this.smoke.spawn(x + Math.cos(a) * 2, 0.4, z + Math.sin(a) * 2, {
        ttl: 1.8, s0: 1.2, s1: 3.2, vx: Math.cos(a) * 4.5, vz: Math.sin(a) * 4.5, vy: 0.6,
        o0: 0.55, c0: 0x9b8868, drag: 1.4,
      });
    }
    for (let i = 0; i < 10; i++) this.scrap.spawn(x, 0.5, z, 2.2);
    this.lights.spawn(x, 3, z, 0xffd9a0, 60, 4.0); // lingering glow
    this._igniteFire(x + 0.8, z + 0.5, 6);
    this._igniteFire(x - 0.7, z - 0.6, 6);
    this.hooks.screenShake?.(2.8);
  }

  padFlash(x, z, side) {
    const col = TEAM_COLORS[side] ?? 0xffc24d;
    this.rings.spawn(x, z, 0.3, 2.2, 0.7, col, 0.2, 0.9);
    this.add.spawn(x, 0.5, z, { ttl: 0.4, s0: 1, s1: 2.4, o0: 0.8, c0: col });
  }

  deployPuff(x, z) {
    this._smokePuffs(x, 0.1, z, 0.7, 4);
  }

  /* ── health bars (call begin → draw* → end each frame) ────────────────── */
  beginBars() { this.bars.begin(); }
  drawBar(x, y, z, frac) { this.bars.draw(x, y, z, frac, this.camera.quaternion); }
  endBars() { this.bars.end(); }

  /* ── frame update ─────────────────────────────────────────────────────── */
  update(dt, time) {
    this.time = time;
    this.add.update(dt);
    this.spark.update(dt);
    this.smoke.update(dt);
    this.scrap.update(dt);
    this.lights.update(dt);
    this.tracers.update(dt);
    this.rings.update(dt);
    this.projectiles.update(dt, this);

    // delayed one-shots
    for (let i = 0; i < this.delayed.length; i++) {
      const d = this.delayed[i];
      if (!d.active) continue;
      d.t -= dt;
      if (d.t > 0) continue;
      d.active = false;
      if (d.kind === 'shell') {
        // incoming streak + ground explosion
        this.tracers.spawn(d.x + 1.2, 14, d.z - 1.6, d.x, 0.3, d.z, 0xffe0b0, 2);
        this._fireball(d.x, 0.25, d.z, 1.1, 6);
        this._smokePuffs(d.x, 0.1, d.z, 1.1, 5);
        this._sparks(d.x, 0.4, d.z, 8, 0xffc070, 6);
        this.rings.spawn(d.x, d.z, 0.2, 1.8, 0.4, 0xffa050, 0.1, 0.4);
        this.lights.spawn(d.x, 0.8, d.z, 0xff9944, 18, 0.3);
        this.hooks.screenShake?.(0.18);
      } else if (d.kind === 'fire') {
        this._igniteFire(d.x, d.z, 5);
        this._fireball(d.x, 0.2, d.z, 0.8, 3);
      } else if (d.kind === 'boom') {
        this.explosion(d.x, 0.3, d.z, 'vehicle', 1.4);
      } else if (d.kind === 'stem') {
        this.smoke.spawn(d.x + (Math.random() - 0.5), 0.5, d.z + (Math.random() - 0.5), {
          ttl: 2.6, s0: 1.6, s1: 3.4, vy: 4.2 + Math.random() * 1.5,
          o0: 0.7, c0: 0x6b5d4c, rv: (Math.random() - 0.5), drag: 0.25,
        });
        this.add.spawn(d.x, 1 + Math.random() * 2, d.z, {
          ttl: 1.0, s0: 1.2, s1: 2.5, vy: 3.5, o0: 0.4, c0: 0xff9040, c1: 0x802008,
        });
      } else if (d.kind === 'cap') {
        const a = Math.random() * Math.PI * 2;
        const r = 0.5 + Math.random() * 2.2;
        this.smoke.spawn(d.x + Math.cos(a) * r, 8.5 + Math.random() * 1.5, d.z + Math.sin(a) * r, {
          ttl: 3.5, s0: 2.2, s1: 5.0, vx: Math.cos(a) * 1.1, vz: Math.sin(a) * 1.1, vy: 0.7,
          o0: 0.6, c0: 0x7d6f5c, rv: (Math.random() - 0.5) * 0.6, drag: 0.3,
        });
      }
    }

    // persistent emitters
    for (let i = 0; i < this.emitters.length; i++) {
      const e = this.emitters[i];
      if (!e.active) continue;
      e.life -= dt;
      if (e.life <= 0) { e.active = false; continue; }
      e.acc += dt;
      while (e.acc > e.rate) {
        e.acc -= e.rate;
        const jx = (Math.random() - 0.5) * 0.5, jz = (Math.random() - 0.5) * 0.5;
        this.add.spawn(e.x + jx, 0.15, e.z + jz, {
          ttl: 0.5 + Math.random() * 0.4, s0: 0.35, s1: 0.95,
          vy: 1.6 + Math.random(), o0: 0.85, c0: 0xffc060, c1: 0xc02e08,
        });
        if (Math.random() < 0.3) {
          this.smoke.spawn(e.x + jx, 0.7, e.z + jz, {
            ttl: 1.4, s0: 0.4, s1: 1.3, vy: 1.2, o0: 0.4, c0: 0x2e2a26, rv: 0.8,
          });
        }
      }
    }

    // strafing jet flyover
    if (this.flyover.active) {
      const f = this.flyover;
      f.t += dt;
      const t = f.t / f.dur;
      if (t >= 1) {
        f.active = false;
        this.jet.visible = false;
      } else {
        const z = f.z0 + (f.z1 - f.z0) * t;
        this.jet.position.set(f.x, 5.5 - Math.sin(t * Math.PI) * 1.8, z);
        this.jet.lookAt(f.x, 5.5 - Math.sin((t + 0.02) * Math.PI) * 1.8, f.z1);
        this.jet.visible = true;
      }
    }

    // nuke rise phase
    if (this.nuke.phase === 'rise') {
      const n = this.nuke;
      n.t += dt;
      const t = n.t;
      const y = 0.4 + t * t * 7.5;
      this.nukeMissile.position.y = y;
      this.nukeMissile.rotation.z = Math.min(0.18, t * 0.06) * (n.x >= 0 ? -1 : 1);
      // exhaust
      this.add.spawn(this.nukeMissile.position.x, y - 0.3, this.nukeMissile.position.z, {
        ttl: 0.3, s0: 0.8, s1: 0.3, o0: 0.95, c0: 0xffd080, c1: 0xff7020,
      });
      this.smoke.spawn(this.nukeMissile.position.x + (Math.random() - 0.5) * 0.4, Math.max(0.4, y - 0.9), this.nukeMissile.position.z + (Math.random() - 0.5) * 0.4, {
        ttl: 2.2, s0: 0.6, s1: 2.0, vy: 0.4, vx: (Math.random() - 0.5), vz: (Math.random() - 0.5),
        o0: 0.6, c0: 0xcfc8bc, rv: (Math.random() - 0.5), drag: 0.6,
      });
      // screen dims slightly while the bird is up
      n.dim = Math.min(0.3, n.dim + dt * 0.12);
      this.hooks.setDim?.(n.dim);
      if (y > 34) {
        this.nukeMissile.visible = false;
        n.phase = 'wait';
      }
    } else if (this.nuke.phase === 'wait') {
      this.nuke.t += dt;
      if (this.nuke.t > 14) { // failsafe: never dim forever
        this.nuke.phase = 'idle';
        this.hooks.setDim?.(0);
      }
    }
  }

  dispose() {
    // pools are owned by the scene; renderer disposes the scene wholesale
    this.nuke.phase = 'idle';
  }
}

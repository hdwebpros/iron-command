// ─── FREEDOM FIGHT — effects: pooled particles, projectiles, superweapons ───
// Everything is pooled at construction time — no per-frame allocations in hot
// paths. One Effects instance owns all pools (all parented under one group so
// the renderer can hide FX wholesale for the minimap snapshot).
import * as THREE from 'three';

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
      scorch: radialTex(128, [[0, 'rgba(12,10,8,0.85)'], [0.55, 'rgba(16,13,10,0.55)'], [1, 'rgba(20,16,12,0)']], 30),
      pool: radialTex(128, [[0, 'rgba(80,210,90,0.75)'], [0.6, 'rgba(58,166,75,0.5)'], [1, 'rgba(40,120,55,0)']], 16),
    };
  }
  return TEXES;
}

/* ── sprite particle pool ───────────────────────────────────────────────── */
class SpritePool {
  constructor(parent, count, tex, blending) {
    this.items = [];
    this.cursor = 0;
    for (let i = 0; i < count; i++) {
      const m = new THREE.SpriteMaterial({ map: tex, blending, transparent: true, depthWrite: false, opacity: 0 });
      const s = new THREE.Sprite(m);
      s.visible = false;
      parent.add(s);
      this.items.push({
        s, m, life: 0, ttl: 1, vx: 0, vy: 0, vz: 0, g: 0, drag: 0,
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
    if (!p) p = items[this.cursor];
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

/* ── ground decals (scorch / toxin pools / radiation) ───────────────────── */
class DecalPool {
  constructor(parent, count, tex, color, blending = THREE.NormalBlending) {
    this.items = [];
    this.cursor = 0;
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < count; i++) {
      const m = new THREE.MeshBasicMaterial({
        map: tex, color, transparent: true, opacity: 0, depthWrite: false, blending,
      });
      const mesh = new THREE.Mesh(geo, m);
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = Math.random() * Math.PI * 2;
      mesh.renderOrder = 1;
      mesh.visible = false;
      parent.add(mesh);
      this.items.push({ mesh, m, life: 0, ttl: 1, o0: 0.8, pulse: 0 });
    }
  }

  spawn(x, z, r, ttl, opacity = 0.8, pulse = 0, y = 0.04) {
    this.cursor = (this.cursor + 1) % this.items.length;
    const p = this.items[this.cursor];
    p.mesh.position.set(x, y + this.cursor * 0.0015, z);
    p.mesh.scale.setScalar(r * 2);
    p.life = p.ttl = ttl;
    p.o0 = opacity;
    p.pulse = pulse;
    p.m.opacity = opacity;
    p.mesh.visible = true;
  }

  update(dt, time) {
    for (let i = 0; i < this.items.length; i++) {
      const p = this.items[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.mesh.visible = false; continue; }
      const t = p.life / p.ttl;
      let o = p.o0 * Math.min(1, t * 4);
      if (p.pulse) o *= 0.75 + 0.25 * Math.sin(time * p.pulse + i);
      p.m.opacity = o;
    }
  }
}

/* ── scrap chunk pool ───────────────────────────────────────────────────── */
class ScrapPool {
  constructor(parent, count) {
    this.items = [];
    this.cursor = 0;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.7, metalness: 0.5 });
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.castShadow = true;
      parent.add(m);
      this.items.push({ m, life: 0, ttl: 1, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0 });
    }
  }

  spawn(x, y, z, power) {
    this.cursor = (this.cursor + 1) % this.items.length;
    const p = this.items[this.cursor];
    p.m.position.set(x, y, z);
    const s = 0.07 + Math.random() * 0.12 * power;
    p.m.scale.set(s, s * (0.5 + Math.random()), s * (0.5 + Math.random()));
    p.life = p.ttl = 1.2 + Math.random() * 0.8;
    const a = Math.random() * Math.PI * 2;
    const v = (1.5 + Math.random() * 3.5) * power;
    p.vx = Math.cos(a) * v;
    p.vz = Math.sin(a) * v;
    p.vy = 3.5 + Math.random() * 4.5 * power;
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
      p.vy -= 13 * dt;
      p.m.position.x += p.vx * dt;
      p.m.position.y += p.vy * dt;
      p.m.position.z += p.vz * dt;
      if (p.m.position.y < 0.05) { p.m.position.y = 0.05; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
      p.m.rotation.x += p.rx * dt;
      p.m.rotation.y += p.ry * dt;
    }
  }
}

/* ── transient point lights ─────────────────────────────────────────────── */
class LightPool {
  constructor(parent, count) {
    this.items = [];
    this.cursor = 0;
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 18, 2);
      l.visible = false;
      parent.add(l);
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

/* ── tracer pool (also sniper crack lines / beams) ──────────────────────── */
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _mid = new THREE.Vector3();

class TracerPool {
  constructor(parent, count) {
    this.items = [];
    this.cursor = 0;
    const geo = new THREE.BoxGeometry(0.05, 0.05, 1);
    for (let i = 0; i < count; i++) {
      const m = new THREE.MeshBasicMaterial({
        color: 0xffd28a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, m);
      mesh.visible = false;
      mesh.frustumCulled = false;
      parent.add(mesh);
      this.items.push({ mesh, m, life: 0, ttl: 0.09 });
    }
  }

  spawn(x1, y1, z1, x2, y2, z2, color = 0xffd28a, thick = 1, ttl = 0.09) {
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
    p.life = p.ttl = ttl;
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

/* ── expanding ground rings ─────────────────────────────────────────────── */
class RingPool {
  constructor(parent, count) {
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
      parent.add(mesh);
      this.items.push({ mesh, m, life: 0, ttl: 1, r0: 0.3, r1: 4, o0: 0.9 });
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
      const e = 1 - (1 - t) * (1 - t);
      p.mesh.scale.setScalar(Math.max(0.01, p.r0 + (p.r1 - p.r0) * e));
      p.m.opacity = p.o0 * (1 - t);
    }
  }
}

/* ── projectile pool (cannon shells, missiles, bombs, viper rockets) ────── */
class ProjectilePool {
  constructor(parent, count) {
    this.items = [];
    this.cursor = 0;
    const shellMat = new THREE.MeshBasicMaterial({ color: 0xffc06a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xc7ccd1, roughness: 0.4, metalness: 0.6 });
    const bombMat = new THREE.MeshStandardMaterial({ color: 0x3a4046, roughness: 0.5, metalness: 0.6 });
    const exhMat = new THREE.SpriteMaterial({ map: texes().glow, color: 0xffa040, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    const shellGeo = new THREE.CapsuleGeometry(0.06, 0.24, 2, 6);
    const missGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.4, 6);
    const noseGeo = new THREE.ConeGeometry(0.05, 0.13, 6);
    const bombGeo = new THREE.CapsuleGeometry(0.1, 0.3, 2, 8);
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
      nose.position.z = 0.26;
      missile.add(nose);
      const exh = new THREE.Sprite(exhMat);
      exh.scale.setScalar(0.4);
      exh.position.z = -0.28;
      missile.add(exh);
      const bomb = new THREE.Mesh(bombGeo, bombMat);
      bomb.rotation.x = Math.PI / 2;
      g.add(shell, missile, bomb);
      g.visible = false;
      g.frustumCulled = false;
      parent.add(g);
      this.items.push({
        g, shell, missile, bomb, active: false,
        fx: 0, fy: 0, fz: 0, tx: 0, ty: 0, tz: 0,
        t: 0, dur: 1, kind: 'shell', arcH: 1, lat: 0, trailAcc: 0, onArrive: null,
      });
    }
  }

  /** o: {fromX, fromZ, toX, toZ, weapon, flightTime, arc, fromY?, toY?, onArrive?} */
  spawn(o) {
    this.cursor = (this.cursor + 1) % this.items.length;
    const p = this.items[this.cursor];
    p.active = true;
    p.fx = o.fromX ?? 0; p.fz = o.fromZ ?? 0;
    p.fy = o.fromY ?? 0.7;
    p.tx = o.toX ?? p.fx; p.tz = o.toZ ?? p.fz;
    p.ty = o.toY ?? 0.25;
    p.t = 0;
    p.dur = Math.max(0.1, Number(o.flightTime) || 0.5);
    const w = o.weapon || 'cannon';
    p.kind = w === 'bomb' ? 'bomb' : (w === 'missile' || w === 'explosion') ? 'missile' : 'shell';
    const dist = Math.hypot(p.tx - p.fx, p.tz - p.fz);
    p.arcH = o.arc ? Math.max(3.5, dist * 0.38) : (p.kind === 'missile' ? 0.6 + dist * 0.06 : 0.3 + dist * 0.08);
    if (p.kind === 'bomb') p.arcH = 0;
    p.lat = p.kind === 'missile' && !o.arc ? (Math.random() - 0.5) * Math.min(1.6, dist * 0.25) : 0;
    p.trailAcc = 0;
    p.onArrive = o.onArrive || null;
    p.shell.visible = p.kind === 'shell';
    p.missile.visible = p.kind === 'missile';
    p.bomb.visible = p.kind === 'bomb';
    p.g.position.set(p.fx, p.fy, p.fz);
    p.g.visible = true;
  }

  update(dt, fx) {
    for (let i = 0; i < this.items.length; i++) {
      const p = this.items[i];
      if (!p.active) continue;
      p.t += dt;
      const t = Math.min(1, p.t / p.dur);
      if (t >= 1) {
        p.active = false;
        p.g.visible = false;
        if (p.onArrive) { const f = p.onArrive; p.onArrive = null; f(p.tx, p.tz); }
        continue;
      }
      const latOff = p.lat * Math.sin(t * Math.PI);
      const dx = p.tx - p.fx, dz = p.tz - p.fz;
      const dl = Math.hypot(dx, dz) || 1;
      const pxn = -dz / dl, pzn = dx / dl;
      const lastX = p.g.position.x, lastY = p.g.position.y, lastZ = p.g.position.z;
      const x = p.fx + dx * t + pxn * latOff;
      const z = p.fz + dz * t + pzn * latOff;
      let y;
      if (p.kind === 'bomb') y = p.fy + (p.ty - p.fy) * t * t; // gravity drop
      else y = p.fy + (p.ty - p.fy) * t + Math.sin(t * Math.PI) * p.arcH;
      p.g.position.set(x, y, z);
      _to.set(x + (x - lastX), y + (y - lastY), z + (z - lastZ));
      if (_to.distanceToSquared(p.g.position) > 1e-8) p.g.lookAt(_to);
      if (p.kind === 'missile' && fx) {
        p.trailAcc += dt;
        while (p.trailAcc > 0.04) {
          p.trailAcc -= 0.04;
          fx.smoke.spawn(x, y, z, {
            ttl: 0.6 + Math.random() * 0.4, s0: 0.18, s1: 0.6,
            vx: (Math.random() - 0.5) * 0.3, vy: 0.3, vz: (Math.random() - 0.5) * 0.3,
            o0: 0.4, c0: 0xc9c9c9, rv: 1,
          });
        }
      }
    }
  }
}

/* ── health bar pool ────────────────────────────────────────────────────── */
class BarPool {
  constructor(parent, count) {
    this.items = [];
    this.used = 0;
    const bgGeo = new THREE.PlaneGeometry(1.0, 0.13);
    const fgGeo = new THREE.PlaneGeometry(0.94, 0.075);
    const bgMat = new THREE.MeshBasicMaterial({ color: 0x101214, transparent: true, opacity: 0.75, depthWrite: false });
    for (let i = 0; i < count; i++) {
      const g = new THREE.Group();
      const bg = new THREE.Mesh(bgGeo, bgMat);
      const fg = new THREE.Mesh(fgGeo, new THREE.MeshBasicMaterial({ color: 0x4dd24d, depthWrite: false, transparent: true, opacity: 0.95 }));
      fg.position.z = 0.005;
      g.add(bg, fg);
      g.visible = false;
      g.frustumCulled = false;
      parent.add(g);
      this.items.push({ g, fg });
    }
  }

  begin() { this.used = 0; }

  draw(x, y, z, frac, quat, w = 1, color = null, h = 1) {
    if (this.used >= this.items.length) return;
    const p = this.items[this.used++];
    frac = Math.min(1, Math.max(0, frac));
    p.g.position.set(x, y, z);
    p.g.quaternion.copy(quat);
    p.g.scale.set(w, h, 1);
    p.fg.scale.x = Math.max(0.02, frac);
    p.fg.position.x = -(1 - frac) * 0.47;
    if (color != null) p.fg.material.color.setHex(color);
    else p.fg.material.color.setHSL(frac * 0.33, 0.85, 0.5);
    p.g.visible = true;
  }

  end() {
    for (let i = this.used; i < this.items.length; i++) {
      if (!this.items[i].g.visible) break;
      this.items[i].g.visible = false;
    }
  }
}

/* ── orbital lance beam ─────────────────────────────────────────────────── */
function buildLanceBeam() {
  const g = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.5, 80, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xcfe9ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  core.position.y = 40;
  const halo = new THREE.Mesh(
    new THREE.CylinderGeometry(1.0, 1.6, 80, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x4fa8ff, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  halo.position.y = 40;
  g.add(core, halo);
  g.visible = false;
  return { g, core, halo };
}

/* ── nuke missile (descent body reused for launch) ──────────────────────── */
function buildNukeMissile() {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.35, metalness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2c2f32, roughness: 0.6, metalness: 0.4 });
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 2.2, 12), body);
  tube.position.y = 1.1;
  g.add(tube);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.7, 12), body);
  nose.position.y = 2.55;
  g.add(nose);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.55, 0.36), dark);
    fin.position.set(Math.cos(a) * 0.33, 0.3, Math.sin(a) * 0.33);
    fin.rotation.y = -a;
    g.add(fin);
  }
  const exh = new THREE.Sprite(new THREE.SpriteMaterial({ map: texes().glow, color: 0xffa040, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  exh.scale.setScalar(1.8);
  exh.position.y = -0.2;
  g.add(exh);
  g.visible = false;
  return g;
}

/* ════════════════════════════════════════════════════════════════════════ */
export class Effects {
  /** hooks: { screenShake(strength), setDim(v), flash(v) } */
  constructor(scene, camera, hooks = {}) {
    this.group = new THREE.Group();
    scene.add(this.group);
    const P = this.group;
    this.camera = camera;
    this.hooks = hooks;
    const T = texes();
    this.add = new SpritePool(P, 320, T.glow, THREE.AdditiveBlending);
    this.spark = new SpritePool(P, 140, T.spark, THREE.AdditiveBlending);
    this.smoke = new SpritePool(P, 300, T.smoke, THREE.NormalBlending);
    this.scrap = new ScrapPool(P, 50);
    this.lights = new LightPool(P, 8);
    this.tracers = new TracerPool(P, 64);
    this.rings = new RingPool(P, 12);
    this.projectiles = new ProjectilePool(P, 64);
    this.bars = new BarPool(P, 150);
    this.scorch = new DecalPool(P, 28, T.scorch, 0xffffff);
    this.toxinPools = new DecalPool(P, 18, T.pool, 0xffffff);
    this.radiation = new DecalPool(P, 3, T.pool, 0xc8b454);
    this.lance = buildLanceBeam();
    P.add(this.lance.g);
    this.nukeMissile = buildNukeMissile();
    P.add(this.nukeMissile);

    // persistent ground fire emitters
    this.emitters = [];
    for (let i = 0; i < 36; i++) this.emitters.push({ active: false, x: 0, z: 0, life: 0, acc: 0, rate: 0.07 });
    // delayed one-shots
    this.delayed = [];
    for (let i = 0; i < 64; i++) this.delayed.push({ active: false, t: 0, kind: '', x: 0, z: 0, x2: 0, z2: 0 });

    this.lanceState = { active: false, t: 0, dur: 6, x: 0, z: 0, dx: 0, dz: 0, acc: 0 };
    this.nuke = { phase: 'idle', t: 0, x: 0, z: 0, dim: 0, sx: 0, sz: 0 };
    this.time = 0;
  }

  /* ── low level helpers ────────────────────────────────────────────────── */
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
        ttl: 0.25 + Math.random() * 0.35, s0: 0.14, s1: 0.03,
        vx: Math.cos(a) * v * (0.4 + Math.random()), vy: up * v, vz: Math.sin(a) * v * (0.4 + Math.random()),
        o0: 1, c0: color, g: -9,
      });
    }
  }

  _toxinBurst(x, z, scale = 1) {
    for (let i = 0; i < 7 * scale; i++) {
      const a = Math.random() * Math.PI * 2;
      this.add.spawn(x, 0.25, z, {
        ttl: 0.5 + Math.random() * 0.5, s0: 0.3 * scale, s1: 1.1 * scale,
        vx: Math.cos(a) * 2.2 * scale, vy: 1.2 + Math.random() * 1.4, vz: Math.sin(a) * 2.2 * scale,
        o0: 0.7, c0: 0x9aff7a, c1: 0x1d6b2a, drag: 1.4,
      });
    }
    this.toxinPools.spawn(x, z, 1.4 * scale, 5.5, 0.7, 5);
    this.lights.spawn(x, 0.6, z, 0x55ff66, 8 * scale, 0.3);
  }

  _delay(t, kind, x, z, x2 = 0, z2 = 0) {
    for (let i = 0; i < this.delayed.length; i++) {
      const d = this.delayed[i];
      if (!d.active) { d.active = true; d.t = t; d.kind = kind; d.x = x; d.z = z; d.x2 = x2; d.z2 = z2; return; }
    }
  }

  igniteFire(x, z, life = 5) {
    for (let i = 0; i < this.emitters.length; i++) {
      const e = this.emitters[i];
      if (!e.active) {
        e.active = true; e.x = x; e.z = z; e.life = life; e.acc = 0;
        e.rate = 0.08 + Math.random() * 0.04;
        return;
      }
    }
  }

  /* ── per-weapon attack visuals (instant weapons) ──────────────────────── */
  muzzleFlash(x, y, z, weapon = 'smallArms') {
    const big = weapon === 'cannon' || weapon === 'explosion';
    this.add.spawn(x, y, z, {
      ttl: big ? 0.13 : 0.07, s0: big ? 0.8 : 0.4, s1: big ? 1.3 : 0.55,
      o0: 1, c0: 0xffe2a8, c1: 0xff8830,
    });
    if (big) {
      this._sparks(x, y, z, 3, 0xffc070, 3);
      this.lights.spawn(x, y + 0.2, z, 0xffaa55, 9, 0.12);
    }
  }

  tracer(x1, y1, z1, x2, y2, z2, weapon = 'smallArms') {
    if (weapon === 'sniper') {
      this.tracers.spawn(x1, y1, z1, x2, y2, z2, 0xeaf6ff, 1.6, 0.16);
      this.add.spawn(x2, y2, z2, { ttl: 0.1, s0: 0.3, s1: 0.1, o0: 1, c0: 0xffffff });
    } else if (weapon === 'gatling') {
      this.tracers.spawn(x1, y1, z1, x2, y2, z2, 0xffb35e, 1.1);
    } else {
      this.tracers.spawn(x1, y1, z1, x2, y2, z2, 0xffd28a, 0.9);
    }
  }

  flameCone(x, y, z, tx, ty, tz) {
    const dx = tx - x, dy = ty - y, dz = tz - z;
    const dl = Math.hypot(dx, dy, dz) || 1;
    for (let i = 0; i < 10; i++) {
      const sp = 3.0 + Math.random() * 2.6;
      const jx = (Math.random() - 0.5) * 0.8, jz = (Math.random() - 0.5) * 0.8;
      this.add.spawn(x, y, z, {
        ttl: (dl / sp) * (0.7 + Math.random() * 0.5), s0: 0.2, s1: 0.95,
        vx: (dx / dl) * sp + jx, vy: (dy / dl) * sp + 0.4, vz: (dz / dl) * sp + jz,
        o0: 0.85, c0: 0xffd070, c1: 0xd84410, drag: 0.6,
      });
    }
    this.lights.spawn(x + dx * 0.3, y + 0.3, z + dz * 0.3, 0xff7722, 5, 0.3);
  }

  toxinSpray(x, y, z, tx, tz) {
    const dx = tx - x, dz = tz - z;
    const dl = Math.hypot(dx, dz) || 1;
    for (let i = 0; i < 8; i++) {
      const sp = 2.6 + Math.random() * 2;
      this.add.spawn(x, y, z, {
        ttl: (dl / sp) * (0.7 + Math.random() * 0.4), s0: 0.16, s1: 0.7,
        vx: (dx / dl) * sp + (Math.random() - 0.5) * 0.7, vy: 0.5, vz: (dz / dl) * sp + (Math.random() - 0.5) * 0.7,
        o0: 0.7, c0: 0xa6ff85, c1: 0x216b2e, drag: 0.5,
      });
    }
    this.toxinPools.spawn(tx, tz, 1.0, 4.5, 0.55, 5);
  }

  /** travel-time projectile from a sim event {fromX,fromZ,toX,toZ,weapon,flightTime,arc} */
  projectile(ev, fromY = 0.7, toY = 0.3) {
    this.projectiles.spawn({ ...ev, fromY, toY });
  }

  /* ── impacts (sim 'hit' events) ───────────────────────────────────────── */
  impact(x, z, weapon = 'smallArms', radius = 1) {
    const y = 0.15;
    switch (weapon) {
      case 'smallArms':
      case 'gatling':
        this._sparks(x, y + 0.15, z, 4, 0xffd28a, 3.5);
        this.smoke.spawn(x, y + 0.1, z, { ttl: 0.5, s0: 0.18, s1: 0.55, vy: 0.8, o0: 0.3, c0: 0xa89878 });
        break;
      case 'sniper':
        this._sparks(x, y + 0.3, z, 3, 0xeaf6ff, 4);
        break;
      case 'cannon':
        this._fireball(x, y + 0.1, z, 0.8, 4);
        this._smokePuffs(x, y, z, 0.9, 4);
        this._sparks(x, y + 0.2, z, 7, 0xffc070, 5.5);
        this.lights.spawn(x, y + 0.5, z, 0xff9944, 15, 0.18);
        this.rings.spawn(x, z, 0.2, 1.3, 0.3, 0xffaa66, 0.1, 0.4);
        this.hooks.screenShake?.(0.05);
        break;
      case 'missile':
        this._fireball(x, y + 0.2, z, 1.0, 6);
        this._smokePuffs(x, y, z, 1.0, 4);
        this.lights.spawn(x, y + 0.5, z, 0xff8844, 15, 0.2);
        this.rings.spawn(x, z, 0.2, 1.5, 0.35, 0xff9966, 0.1, 0.4);
        this.hooks.screenShake?.(0.06);
        break;
      case 'flame':
        for (let i = 0; i < 5; i++) {
          this.add.spawn(x + (Math.random() - 0.5) * 0.7, y + 0.1, z + (Math.random() - 0.5) * 0.7, {
            ttl: 0.5 + Math.random() * 0.4, s0: 0.35, s1: 1.0, vy: 1.5 + Math.random(),
            o0: 0.8, c0: 0xffc060, c1: 0xc83a10,
          });
        }
        this._smokePuffs(x, y + 0.3, z, 0.7, 2, true);
        this.igniteFire(x + (Math.random() - 0.5), z + (Math.random() - 0.5), 4 + Math.random() * 2);
        this.scorch.spawn(x, z, 1.1, 14, 0.5);
        break;
      case 'toxin':
        this._toxinBurst(x, z, Math.max(0.8, radius * 0.4));
        break;
      case 'explosion':
        this._fireball(x, y + 0.2, z, 1.3, 7);
        this._smokePuffs(x, y, z, 1.3, 6, true);
        this._sparks(x, y + 0.3, z, 9, 0xffc070, 6);
        this.rings.spawn(x, z, 0.3, Math.max(2, radius), 0.5, 0xffa050, 0.1, 0.5);
        this.lights.spawn(x, y + 0.8, z, 0xff9944, 20, 0.3);
        this.scorch.spawn(x, z, Math.max(1.2, radius * 0.6), 18, 0.6);
        this.hooks.screenShake?.(0.12);
        break;
      case 'bomb':
        this._fireball(x, y + 0.3, z, 1.8, 9);
        this._smokePuffs(x, y, z, 1.8, 8, true);
        this.rings.spawn(x, z, 0.4, Math.max(3, radius * 1.2), 0.7, 0xffb070, 0.12, 0.7);
        this.lights.spawn(x, y + 1, z, 0xffaa55, 30, 0.4);
        this.scorch.spawn(x, z, Math.max(1.8, radius * 0.7), 22, 0.7);
        this.igniteFire(x + 0.6, z, 4); this.igniteFire(x - 0.5, z + 0.4, 4);
        this.hooks.screenShake?.(0.35);
        break;
      case 'beam':
        this._sparks(x, y + 0.3, z, 10, 0xbfe2ff, 7);
        this._fireball(x, y + 0.1, z, 0.9, 4);
        this.scorch.spawn(x, z, 1.0, 20, 0.7);
        break;
      default:
        this._sparks(x, y + 0.15, z, 3);
    }
  }

  /* ── deaths ───────────────────────────────────────────────────────────── */
  vehicleDeath(x, z, scale = 1) {
    this.add.spawn(x, 0.4 * scale, z, { ttl: 0.12, s0: 1.6 * scale, s1: 2.6 * scale, o0: 1, c0: 0xffffff });
    this._fireball(x, 0.3, z, scale, 8);
    this._smokePuffs(x, 0.2, z, scale, 7, true);
    this._sparks(x, 0.4, z, 12, 0xffc070, 5 * scale);
    this.lights.spawn(x, 0.8, z, 0xff9944, 22 * scale, 0.35);
    for (let i = 0; i < 7; i++) this.scrap.spawn(x, 0.35, z, scale);
    this.rings.spawn(x, z, 0.3, 2.2 * scale, 0.45, 0xffa050, 0.1, 0.35);
    this.scorch.spawn(x, z, 1.3 * scale, 25, 0.65);
    this.hooks.screenShake?.(Math.min(0.5, 0.12 * scale));
  }

  infantryDeath(x, z) {
    this._sparks(x, 0.4, z, 4, 0xffb0a0, 3);
    this.smoke.spawn(x, 0.3, z, { ttl: 0.8, s0: 0.3, s1: 0.8, vy: 0.6, o0: 0.35, c0: 0x8d867c });
  }

  structureDeath(x, z, r = 2) {
    this.add.spawn(x, 0.8, z, { ttl: 0.16, s0: 2.4, s1: 4.5, o0: 1, c0: 0xffffff });
    this._fireball(x, 0.5, z, 1.9, 10);
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.random() * r;
      this._delay(Math.random() * 0.7, 'boomS', x + Math.cos(a) * rr, z + Math.sin(a) * rr);
    }
    this._smokePuffs(x, 0.4, z, 2.4, 10, true);
    for (let i = 0; i < 12; i++) this.scrap.spawn(x, 0.6, z, 1.8);
    this.rings.spawn(x, z, 0.5, r + 2.5, 0.8, 0xffb070, 0.12, 0.6);
    this.lights.spawn(x, 1.4, z, 0xff9944, 34, 0.5);
    this.scorch.spawn(x, z, r * 1.1, 40, 0.75);
    this.igniteFire(x + r * 0.4, z, 7);
    this.igniteFire(x - r * 0.3, z + r * 0.3, 6);
    this.hooks.screenShake?.(0.45);
  }

  /* ── misc game beats ──────────────────────────────────────────────────── */
  deployPuff(x, z, scale = 0.8) { this._smokePuffs(x, 0.1, z, scale, 4); }

  buildDust(x, z, r = 2) {
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2;
      this.smoke.spawn(x + Math.cos(a) * r * 0.6, 0.1, z + Math.sin(a) * r * 0.6, {
        ttl: 0.9 + Math.random() * 0.6, s0: 0.4, s1: 1.4, vy: 0.7 + Math.random() * 0.5,
        vx: Math.cos(a) * 0.7, vz: Math.sin(a) * 0.7, o0: 0.4, c0: 0xb59d76, rv: 1,
      });
    }
  }

  crateGlint(x, z) {
    this.add.spawn(x, 0.5, z, { ttl: 0.5, s0: 0.3, s1: 1.4, o0: 0.9, c0: 0xffe9a0 });
    this._sparks(x, 0.4, z, 6, 0xffe9a0, 3);
    this.rings.spawn(x, z, 0.2, 1.2, 0.5, 0xffd84d, 0.1, 0.6);
  }

  captureFlash(x, z, color = 0xffd84d) {
    this.rings.spawn(x, z, 0.3, 2.4, 0.7, color, 0.2, 0.9);
    this.add.spawn(x, 0.6, z, { ttl: 0.4, s0: 1, s1: 2.4, o0: 0.8, c0: color });
  }

  empBlast(x, z, radius = 8) {
    this.rings.spawn(x, z, 0.4, radius, 0.9, 0x55baff, 0.18, 1.0);
    this.rings.spawn(x, z, 0.2, radius * 0.7, 0.6, 0x99e0ff, 0.3, 0.8);
    this.add.spawn(x, 0.8, z, { ttl: 0.4, s0: 1.5, s1: 4.5, o0: 0.9, c0: 0x77ccff });
    this._sparks(x, 0.6, z, 16, 0x88d8ff, 7);
    this.lights.spawn(x, 1.2, z, 0x66bbff, 26, 0.5);
    this.hooks.screenShake?.(0.25);
  }

  sparksAt(x, y, z) {
    const a = Math.random() * Math.PI * 2;
    this.spark.spawn(x + Math.cos(a) * 0.3, y + (Math.random() - 0.3) * 0.4, z + Math.sin(a) * 0.3, {
      ttl: 0.18 + Math.random() * 0.15, s0: 0.16, s1: 0.04,
      vx: Math.cos(a) * 1.5, vy: 1 + Math.random() * 2, vz: Math.sin(a) * 1.5,
      o0: 1, c0: 0x88d8ff,
    });
  }

  /** staggered ground explosions in a circle (artillery barrage power) */
  artillery(x, z, radius = 8, shells = 12, over = 3) {
    for (let i = 0; i < shells; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      this._delay((i / shells) * over + Math.random() * 0.15, 'shell', x + Math.cos(a) * r, z + Math.sin(a) * r);
    }
  }

  paradrop(x, z, n = 6) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 4;
      this._delay(i * 0.12, 'chute', x + Math.cos(a) * r, z + Math.sin(a) * r);
    }
  }

  /* ── superweapons ─────────────────────────────────────────────────────── */
  orbitalLance(x, z) {
    const ls = this.lanceState;
    ls.active = true;
    ls.t = 0;
    ls.dur = 6;
    const a = Math.random() * Math.PI * 2;
    ls.x = x - Math.cos(a) * 6;
    ls.z = z - Math.sin(a) * 6;
    ls.dx = Math.cos(a) * 12 / ls.dur;
    ls.dz = Math.sin(a) * 12 / ls.dur;
    ls.acc = 0;
    this.lance.g.visible = true;
    // sky flash
    this.hooks.flash?.(0.5);
    this.hooks.screenShake?.(0.5);
  }

  nukeLaunch(siloX, siloZ, targetX, targetZ) {
    const n = this.nuke;
    n.phase = 'rise';
    n.t = 0;
    n.x = targetX; n.z = targetZ;
    n.sx = siloX; n.sz = siloZ;
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
    this.tracers.spawn(x + 3, 42, z - 5, x, 0.5, z, 0xffffff, 5, 0.25);
    this.hooks.flash?.(1);
    this.add.spawn(x, 3, z, { ttl: 0.35, s0: 14, s1: 34, o0: 1, c0: 0xffffff });
    for (let i = 0; i < 12; i++) {
      this.add.spawn(x + (Math.random() - 0.5) * 2.5, 1 + Math.random() * 2.5, z + (Math.random() - 0.5) * 2.5, {
        ttl: 1.3 + Math.random() * 0.9, s0: 2.2, s1: 9,
        vy: 3.5 + Math.random() * 2.5, o0: 0.95, c0: 0xfff0b0, c1: 0xd83008, rv: (Math.random() - 0.5) * 2, drag: 0.8,
      });
    }
    for (let i = 0; i < 22; i++) {
      this._delay(0.15 + i * 0.11, 'stem', x, z);
      if (i < 18) this._delay(0.7 + i * 0.17, 'cap', x, z);
    }
    this.rings.spawn(x, z, 0.5, 17, 1.6, 0xffc890, 0.15, 0.9);
    this.rings.spawn(x, z, 0.3, 12, 1.2, 0xffffff, 0.4, 0.5);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      this.smoke.spawn(x + Math.cos(a) * 2.5, 0.4, z + Math.sin(a) * 2.5, {
        ttl: 1.9, s0: 1.6, s1: 4.2, vx: Math.cos(a) * 6, vz: Math.sin(a) * 6, vy: 0.7,
        o0: 0.55, c0: 0x9b8868, drag: 1.4,
      });
    }
    for (let i = 0; i < 12; i++) this.scrap.spawn(x, 0.6, z, 2.6);
    this.lights.spawn(x, 4, z, 0xffd9a0, 70, 4.5);
    this.scorch.spawn(x, z, 9, 45, 0.85);
    this.radiation.spawn(x, z, 10, 30, 0.4, 2.2, 0.08); // lingering green-amber shimmer
    this.igniteFire(x + 1.5, z + 1, 8);
    this.igniteFire(x - 1.2, z - 1.4, 8);
    this.igniteFire(x + 0.4, z - 2, 7);
    this.hooks.screenShake?.(3.0);
  }

  viperStorm(fromX, fromZ, x, z) {
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 8;
      this._delay(i * 0.85, 'viper', fromX, fromZ, x + Math.cos(a) * r, z + Math.sin(a) * r);
    }
    this.hooks.screenShake?.(0.2);
  }

  /* ── health bars ──────────────────────────────────────────────────────── */
  beginBars() { this.bars.begin(); }
  drawBar(x, y, z, frac, w = 1, color = null, h = 1) { this.bars.draw(x, y, z, frac, this.camera.quaternion, w, color, h); }
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
    this.scorch.update(dt, time);
    this.toxinPools.update(dt, time);
    this.radiation.update(dt, time);

    // delayed one-shots
    for (let i = 0; i < this.delayed.length; i++) {
      const d = this.delayed[i];
      if (!d.active) continue;
      d.t -= dt;
      if (d.t > 0) continue;
      d.active = false;
      switch (d.kind) {
        case 'shell':
          this.tracers.spawn(d.x + 1.4, 18, d.z - 2, d.x, 0.3, d.z, 0xffe0b0, 2, 0.12);
          this._fireball(d.x, 0.25, d.z, 1.1, 6);
          this._smokePuffs(d.x, 0.1, d.z, 1.1, 5);
          this._sparks(d.x, 0.4, d.z, 8, 0xffc070, 6);
          this.rings.spawn(d.x, d.z, 0.2, 1.8, 0.4, 0xffa050, 0.1, 0.4);
          this.scorch.spawn(d.x, d.z, 0.9, 12, 0.5);
          this.hooks.screenShake?.(0.1);
          break;
        case 'boomS':
          this._fireball(d.x, 0.3, d.z, 1.2, 5);
          this._smokePuffs(d.x, 0.2, d.z, 1.2, 4, true);
          for (let k = 0; k < 3; k++) this.scrap.spawn(d.x, 0.4, d.z, 1.4);
          this.hooks.screenShake?.(0.08);
          break;
        case 'stem':
          this.smoke.spawn(d.x + (Math.random() - 0.5) * 1.4, 0.6, d.z + (Math.random() - 0.5) * 1.4, {
            ttl: 3.4, s0: 2.4, s1: 5.0, vy: 5.5 + Math.random() * 2,
            o0: 0.8, c0: 0x6b5d4c, rv: (Math.random() - 0.5), drag: 0.25,
          });
          this.add.spawn(d.x, 1.5 + Math.random() * 3, d.z, {
            ttl: 1.0, s0: 1.6, s1: 3.4, vy: 4.5, o0: 0.4, c0: 0xff9040, c1: 0x802008,
          });
          break;
        case 'cap': {
          const a = Math.random() * Math.PI * 2;
          const r = 0.5 + Math.random() * 3;
          this.smoke.spawn(d.x + Math.cos(a) * r, 11.5 + Math.random() * 2, d.z + Math.sin(a) * r, {
            ttl: 4.6, s0: 3.4, s1: 7.2, vx: Math.cos(a) * 1.4, vz: Math.sin(a) * 1.4, vy: 0.8,
            o0: 0.72, c0: 0x7d6f5c, rv: (Math.random() - 0.5) * 0.6, drag: 0.3,
          });
          break;
        }
        case 'viper':
          // one toxin rocket: visual projectile that detonates on arrival
          this.muzzleFlash(d.x, 1.6, d.z, 'explosion');
          this.projectiles.spawn({
            fromX: d.x, fromZ: d.z, toX: d.x2, toZ: d.z2,
            weapon: 'missile', flightTime: 1.6, arc: true, fromY: 1.4, toY: 0.2,
            onArrive: (tx, tz) => {
              this._fireball(tx, 0.3, tz, 1.3, 6);
              this._toxinBurst(tx, tz, 1.5);
              this.rings.spawn(tx, tz, 0.3, 3, 0.5, 0x77e07a, 0.1, 0.5);
              this.scorch.spawn(tx, tz, 1.2, 18, 0.5);
              this.hooks.screenShake?.(0.15);
            },
          });
          break;
        case 'chute': {
          // tiny parachute puff + trooper thud
          this.smoke.spawn(d.x, 2.2, d.z, { ttl: 1.0, s0: 0.7, s1: 0.3, vy: -1.6, o0: 0.7, c0: 0xe8e2d2 });
          this._delay(0.8, 'thud', d.x, d.z);
          break;
        }
        case 'thud':
          this.deployPuff(d.x, d.z, 0.5);
          break;
        case 'fire':
          this.igniteFire(d.x, d.z, 5);
          this._fireball(d.x, 0.2, d.z, 0.8, 3);
          break;
      }
    }

    // persistent fire emitters
    for (let i = 0; i < this.emitters.length; i++) {
      const e = this.emitters[i];
      if (!e.active) continue;
      e.life -= dt;
      if (e.life <= 0) { e.active = false; continue; }
      e.acc += dt;
      while (e.acc > e.rate) {
        e.acc -= e.rate;
        const jx = (Math.random() - 0.5) * 0.6, jz = (Math.random() - 0.5) * 0.6;
        this.add.spawn(e.x + jx, 0.15, e.z + jz, {
          ttl: 0.5 + Math.random() * 0.4, s0: 0.4, s1: 1.05,
          vy: 1.7 + Math.random(), o0: 0.85, c0: 0xffc060, c1: 0xc02e08,
        });
        if (Math.random() < 0.3) {
          this.smoke.spawn(e.x + jx, 0.8, e.z + jz, {
            ttl: 1.4, s0: 0.4, s1: 1.4, vy: 1.3, o0: 0.4, c0: 0x2e2a26, rv: 0.8,
          });
        }
      }
    }

    // orbital lance sweep
    if (this.lanceState.active) {
      const ls = this.lanceState;
      ls.t += dt;
      if (ls.t >= ls.dur) {
        ls.active = false;
        this.lance.g.visible = false;
      } else {
        const x = ls.x + ls.dx * ls.t;
        const z = ls.z + ls.dz * ls.t;
        this.lance.g.position.set(x, 0, z);
        const w = 0.8 + Math.sin(ls.t * 30) * 0.12;
        this.lance.core.scale.set(w, 1, w);
        this.lance.halo.scale.set(1 + Math.sin(ls.t * 18) * 0.15, 1, 1 + Math.sin(ls.t * 18) * 0.15);
        ls.acc += dt;
        while (ls.acc > 0.05) {
          ls.acc -= 0.05;
          this._sparks(x, 0.4, z, 3, 0xbfe2ff, 6);
          this.add.spawn(x, 0.3, z, { ttl: 0.4, s0: 0.8, s1: 2.0, vy: 2.5, o0: 0.9, c0: 0xeaf6ff, c1: 0xff7a30 });
          this.smoke.spawn(x, 0.6, z, { ttl: 1.6, s0: 0.6, s1: 2.0, vy: 1.8, o0: 0.5, c0: 0x3b332c, rv: 1 });
          if (Math.random() < 0.4) this.scorch.spawn(x + (Math.random() - 0.5), z + (Math.random() - 0.5), 1.1, 24, 0.7);
          if (Math.random() < 0.25) this.igniteFire(x + (Math.random() - 0.5) * 1.4, z + (Math.random() - 0.5) * 1.4, 4);
        }
        this.lights.spawn(x, 2, z, 0x9fd0ff, 26, 0.1);
        this.hooks.screenShake?.(0.04);
      }
    }

    // nuke rise
    if (this.nuke.phase === 'rise') {
      const n = this.nuke;
      n.t += dt;
      const y = 0.4 + n.t * n.t * 9;
      this.nukeMissile.position.y = y;
      this.nukeMissile.rotation.z = Math.min(0.2, n.t * 0.07) * (n.x >= n.sx ? -1 : 1);
      this.add.spawn(this.nukeMissile.position.x, y - 0.4, this.nukeMissile.position.z, {
        ttl: 0.3, s0: 1.0, s1: 0.4, o0: 0.95, c0: 0xffd080, c1: 0xff7020,
      });
      this.smoke.spawn(this.nukeMissile.position.x + (Math.random() - 0.5) * 0.5, Math.max(0.4, y - 1.1), this.nukeMissile.position.z + (Math.random() - 0.5) * 0.5, {
        ttl: 2.4, s0: 0.8, s1: 2.4, vy: 0.4, vx: (Math.random() - 0.5), vz: (Math.random() - 0.5),
        o0: 0.6, c0: 0xcfc8bc, rv: (Math.random() - 0.5), drag: 0.6,
      });
      n.dim = Math.min(0.3, n.dim + dt * 0.12);
      this.hooks.setDim?.(n.dim);
      if (y > 46) {
        this.nukeMissile.visible = false;
        n.phase = 'wait';
      }
    } else if (this.nuke.phase === 'wait') {
      this.nuke.t += dt;
      if (this.nuke.t > 16) { // failsafe
        this.nuke.phase = 'idle';
        this.hooks.setDim?.(0);
      }
    }
  }

  dispose() {
    this.nuke.phase = 'idle';
    this.group.parent?.remove(this.group);
  }
}

// FREEDOM FIGHT — Game simulation core. Pure ES module, zero three/DOM imports.
// Runs under plain node. Deterministic (seeded RNG). Fixed dt = 1/30.
//
// Public API (DESIGN §13.1):
//   const game = new Game({ playerFaction, aiFaction, difficulty, seed });
//   game.tick(dt); game.issue(side, cmd) → {ok, reason?}; game.on/off(event, fn);
//   game.state; game.fog; game.entity(id); game.sideFog(side) [extra].
//
// Stealth rule (chosen & documented): a stealthWhenStill unit is stealthed while
// NOT moving and NOT having fired in the last 2s. It is revealed to the enemy if:
//   (a) it has fired within the last 2s, OR (b) an enemy detector (Command Center,
//   any defensive structure, base radar) is within 4 units, OR (c) any enemy unit's
//   vision is within 5 units. Demo traps follow the same still-stealth rule.

import {
  TICK, POP_CAP, PLAYER, ENEMY, NEUTRAL, mulberry32, dmgMultiplier,
  INSTANT_WEAPONS, PROJ_SPEED, SPLASH_RADIUS, clamp, dist, dist2,
  UNDER_ATTACK_THROTTLE,
} from './constants.js';
import {
  FACTIONS, SUPERWEAPONS, RANK_THRESHOLDS, RANK_POINTS, VET_LEVELS,
} from './factions.js';
import { MAP, GRID_W, GRID_H, buildPassGrid, worldToCell, cellToWorld } from './map.js';
import { SpatialHash, findPath } from './path.js';

const HALF = MAP.size / 2;
const PLAYABLE = HALF - MAP.border; // 86
const FOG_W = GRID_W, FOG_H = GRID_H;
const DETECT_RADIUS = 4;     // enemy detector range that reveals stealth
const VISION_REVEAL = 5;     // enemy unit within this reveals stealth
const REVEAL_AFTER_FIRE = 2; // seconds revealed after firing
const CAPTURE_TIME = 12;     // seconds to capture
const SALVAGE_LIFETIME = 30;
const HORDE_RADIUS = 8;
const HORDE_MIN = 5;

let NEXT_ID = 1;

export class Game {
  constructor({ playerFaction, aiFaction, difficulty = 'hard', seed = 12345 } = {}) {
    this.playerFaction = playerFaction;
    this.aiFaction = aiFaction;
    this.difficulty = difficulty;
    this.rng = mulberry32(seed >>> 0);

    this.faction = { player: playerFaction, enemy: aiFaction };
    this.passGrid = buildPassGrid();

    // Listeners
    this._listeners = new Map();
    this._eventBuf = [];

    // Entities
    this.entities = new Map(); // id → entity
    this._projectiles = [];
    this._effects = [];        // timed area effects (fire patch, toxin pool, radiation)
    this._pendingSpawnEvents = [];

    // Per-side bookkeeping
    this.sides = {};
    for (const side of [PLAYER, ENEMY]) {
      const f = this.faction[side];
      this.sides[side] = {
        faction: f,
        money: 10000,
        powerOut: 0, powerUse: 0, lowPower: false,
        radar: false,
        pop: 0, popCap: POP_CAP,
        rankXp: 0, rank: 0, points: 0, pointsSpent: 0,
        powers: {},       // key → level
        powerCd: {},      // key → seconds left
        upgrades: {},     // key → true
        super: null,      // {id, key, charge, total, ready}
        incomeAccum: 0, incomeWindow: 0, // for $/s readout
        incomeRecent: 0,
        lastUnderAttack: { base: -100, units: -100, harvester: -100 },
        cashBounty: 0,    // syndicate passive bounty fraction
        heroAlive: false,
        secondaryTimers: {}, // structureId → timer
        stats: { unitsBuilt: 0, unitsLost: 0, kills: 0, moneyEarned: 0, supersFired: 0 },
      };
    }

    // Fog grids per side (0 shroud / 1 explored / 2 visible).
    this.fogGrid = { player: new Uint8Array(FOG_W * FOG_H), enemy: new Uint8Array(FOG_W * FOG_H) };
    this.fog = { w: FOG_W, h: FOG_H, cell: MAP.cell, grid: this.fogGrid.player };

    this.spatial = new SpatialHash(6);

    this.time = 0;
    this.state = null;

    this._initWorld();
    this._rebuildState();
  }

  // ─── Event system ─────────────────────────────────────────────────────────
  on(event, fn) {
    let s = this._listeners.get(event);
    if (!s) { s = new Set(); this._listeners.set(event, s); }
    s.add(fn);
  }
  off(event, fn) {
    const s = this._listeners.get(event);
    if (s) s.delete(fn);
  }
  _emit(event, payload) {
    const s = this._listeners.get(event);
    if (s) for (const fn of s) { try { fn(payload); } catch (e) { /* listener errors isolated */ } }
  }
  _eva(key, x, z) { this._emit('eva', { key, x, z }); }

  // ─── World init ─────────────────────────────────────────────────────────────
  _initWorld() {
    // Neutral world objects as structures (side:'neutral').
    for (const d of MAP.supplyDocks) this._spawnNeutral('supplyDock', d.x, d.z, { amount: d.amount, maxHp: 99999 });
    for (const p of MAP.supplyPiles) this._spawnNeutral('supplyPile', p.x, p.z, { amount: p.amount, maxHp: 99999 });
    for (const o of MAP.oilDerricks) this._spawnNeutral('oilDerrick', o.x, o.z, { maxHp: 800, capturable: true });
    for (const c of MAP.civBuildings) this._spawnNeutral('civBuilding', c.x, c.z, { maxHp: 400, garrison: 5, garrisonSlots: 5 });

    // Starting bases: Command Center + free builder for each side.
    for (const side of [PLAYER, ENEMY]) {
      const f = this.faction[side];
      const sp = MAP.spawns[side];
      const cc = this._spawnStructure(side, 'commandCenter', sp.x, sp.z, true);
      cc.angle = sp.angle || 0;
      const builderKey = FACTIONS[f].builder;
      const bx = sp.x + (side === PLAYER ? 5 : -5);
      const bz = sp.z + (side === PLAYER ? 5 : -5);
      this._spawnUnit(side, builderKey, bx, bz);
    }
    this._recomputePower(PLAYER);
    this._recomputePower(ENEMY);
  }

  _spawnNeutral(key, x, z, extra = {}) {
    const e = {
      id: NEXT_ID++, side: NEUTRAL, kind: 'structure', key, faction: null,
      x, z, angle: 0, hp: extra.maxHp || 1000, maxHp: extra.maxHp || 1000,
      vet: 0, radius: key === 'supplyDock' ? 3 : 2.2,
      ...extra, garrisonList: [], capture: null,
    };
    this.entities.set(e.id, e);
    this._queueSpawnEvent(e);
    return e;
  }

  _structRadius(key) {
    if (key === 'commandCenter') return 4;
    if (key === 'demoTrap') return 1.2;
    return 2.6;
  }

  _spawnStructure(side, key, x, z, complete = false) {
    const f = this.faction[side];
    const def = FACTIONS[f].structures[key];
    const e = {
      id: NEXT_ID++, side, kind: 'structure', key, faction: f,
      x, z, angle: 0, hp: complete ? def.hp : Math.max(1, def.hp * 0.1), maxHp: def.hp,
      vet: 0, radius: this._structRadius(key),
      def, building: complete ? null : 0, buildRate: def.build,
      queue: [], rally: null, garrisonList: [], garrisonSlots: def.garrison || 0,
      powered: true, disabled: 0, capture: null,
      fireCd: 0, spinup: 0, secTimer: def.income ? def.income.interval : 0,
      complete,
    };
    this.entities.set(e.id, e);
    this._markCellsBlocked(e, true);
    this._queueSpawnEvent(e);
    if (complete) this._emit('constructionComplete', { id: e.id });
    return e;
  }

  _spawnUnit(side, key, x, z, opts = {}) {
    const f = this.faction[side];
    const def = FACTIONS[f].units[key];
    const e = {
      id: NEXT_ID++, side, kind: 'unit', key, faction: f,
      x, z, angle: 0, hp: def.hp, maxHp: def.hp, vet: 0, xp: 0,
      radius: 0.4, def,
      state: 'idle', target: null, attackTarget: null,
      path: null, pathGoal: null, pathIdx: 0, moveGoal: null,
      guardPos: null, attackMove: null, holdPos: null,
      fireCd: 0, spinup: 0, lastFire: -100, revealUntil: -100,
      carrying: 0, cargo: [], salvage: 0, deployed: false, deployTimer: 0,
      abilityCd: {}, garrisonedIn: null,
      collector: def.harvester ? { phase: 'idle', dockId: null, cycleT: 0 } : null,
      build: null, repairTarget: null, captureTarget: null,
      vx: 0, vz: 0, husk: false, burst: 0, rearming: 0, padId: null,
      ...opts,
    };
    if (opts.hp) e.hp = opts.hp;
    if (def.hero) this.sides[side].heroAlive = true;
    this.entities.set(e.id, e);
    this.sides[side].pop += def.pop;
    this._queueSpawnEvent(e);
    return e;
  }

  _queueSpawnEvent(e) { this._pendingSpawnEvents.push(e); }
  _flushSpawnEvents() {
    if (this._pendingSpawnEvents.length) {
      for (const e of this._pendingSpawnEvents) this._emit('spawn', { entity: this._entitySnapshot(e) });
      this._pendingSpawnEvents.length = 0;
    }
  }

  _markCellsBlocked(struct, blocked) {
    // Mark grid cells under a structure as impassable (ground). Skip demoTrap (small).
    if (struct.key === 'demoTrap' || struct.kind !== 'structure') return;
    const r = struct.radius;
    const { cx, cz } = worldToCell(struct.x, struct.z);
    const span = Math.ceil(r / MAP.cell);
    for (let dz = -span; dz <= span; dz++) {
      for (let dx = -span; dx <= span; dx++) {
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= GRID_W || nz >= GRID_H) continue;
        const w = cellToWorld(nx, nz);
        if (dist(w.x, w.z, struct.x, struct.z) <= r + 0.5) {
          // We don't unblock terrain (rocks/border) when removing a structure.
          if (blocked) this.passGrid[nz * GRID_W + nx] = 1;
          else {
            // Recompute that cell from terrain only.
            const blockedTerrain = this._terrainBlocked(w.x, w.z);
            this.passGrid[nz * GRID_W + nx] = blockedTerrain ? 1 : 0;
          }
        }
      }
    }
  }

  _terrainBlocked(x, z) {
    if (Math.abs(x) > PLAYABLE || Math.abs(z) > PLAYABLE) return true;
    for (const b of MAP.blockers) {
      const dx = x - b.x, dz = z - b.z;
      if (dx * dx + dz * dz <= (b.r + 0.5) * (b.r + 0.5)) return true;
    }
    return false;
  }

  entity(id) { return this.entities.get(id) || null; }
  sideFog(side) { return { w: FOG_W, h: FOG_H, cell: MAP.cell, grid: this.fogGrid[side] }; }

  // ─── Main tick ──────────────────────────────────────────────────────────────
  tick(dt = TICK) {
    if (this.state && this.state.over) { this._flushSpawnEvents(); return; }
    this.time += dt;

    // Rebuild spatial hash.
    this.spatial.clear();
    for (const e of this.entities.values()) {
      if (e.kind === 'unit' && !e.garrisonedIn) this.spatial.insert(e);
      else if (e.kind === 'structure') this.spatial.insert(e);
    }

    this._tickEconomy(dt);
    this._tickPowerCooldowns(dt);
    this._tickStructures(dt);
    this._tickCollectors(dt);
    this._tickUnits(dt);
    this._processGarrisonIntents();
    this._applySeparation(dt);
    this._tickCombat(dt);
    this._tickProjectiles(dt);
    this._tickEffects(dt);
    this._tickMines(dt);
    this._tickSupers(dt);
    this._tickCaptures(dt);
    this._tickHusks(dt);
    this._tickStealth(dt);
    this._tickCrates(dt);
    this._tickTemporary(dt);
    this._runScheduled(dt);
    this._computeFog();
    this._checkWinLose();

    this._rebuildState();
    this._flushSpawnEvents();
  }

  // ─── Economy ─────────────────────────────────────────────────────────────────
  _tickEconomy(dt) {
    for (const side of [PLAYER, ENEMY]) {
      const s = this.sides[side];
      s.incomeWindow += dt;
      if (s.incomeWindow >= 1) {
        s.incomeRecent = s.incomeAccum;
        s.incomeAccum = 0; s.incomeWindow -= 1;
      }
    }
  }

  _addMoney(side, amount) {
    const s = this.sides[side];
    s.money += amount;
    if (amount > 0) { s.incomeAccum += amount; s.stats.moneyEarned += amount; }
  }

  // ─── Power ───────────────────────────────────────────────────────────────────
  _recomputePower(side) {
    const s = this.sides[side];
    if (!FACTIONS[s.faction].powerUser) {
      s.powerOut = 0; s.powerUse = 0; s.lowPower = false; s.radar = true;
      this._setStructurePowered(side, true);
      return;
    }
    let out = 0, use = 0, hasCC = false;
    for (const e of this.entities.values()) {
      if (e.side !== side || e.kind !== 'structure' || e.building != null || !e.def) continue;
      const p = e.def.power || 0;
      if (e.key === 'commandCenter') hasCC = true;
      if (p > 0) {
        let prod = p;
        if (e.key === 'fusionReactor' && s.upgrades.controlRods) prod += 5;
        out += prod;
      } else use += -p;
    }
    const wasLow = s.lowPower;
    s.powerOut = out; s.powerUse = use;
    s.lowPower = use > out;
    s.radar = hasCC && !s.lowPower;
    this._setStructurePowered(side, !s.lowPower);
    if (s.lowPower !== wasLow) {
      this._emit('powerChanged', { side, lowPower: s.lowPower });
      if (s.lowPower && side === PLAYER) this._eva('lowPower');
    }
  }

  _setStructurePowered(side, powered) {
    for (const e of this.entities.values()) {
      if (e.side === side && e.kind === 'structure') e.powered = powered;
    }
  }

  // ─── Structures: build progress, production queues, secondary income, defense ─
  _tickStructures(dt) {
    for (const e of this.entities.values()) {
      if (e.kind !== 'structure' || e.side === NEUTRAL) continue;
      if (e.disabled > 0) { e.disabled -= dt; continue; }
      if (!e.def) continue; // captured neutral world object (oil derrick / civ building)

      const s = this.sides[e.side];
      const speed = (s.lowPower && FACTIONS[s.faction].powerUser) ? 0.5 : 1;

      // Construction by dozer handled in _tickUnits; but if building w/o builder, still progress slowly?
      // We progress building when a builder is assigned (build field). Self-completion fallback:
      if (e.building != null) {
        // progress advanced by assigned dozer in unit tick; if none assigned, trickle.
        if (e._buildAssigned !== this.time) {
          e.building += dt / e.buildRate * 0.0; // require a builder; no auto-progress
        }
        if (e.building >= 1) this._completeStructure(e);
        continue;
      }

      // Secondary income structures
      if (e.def.income) {
        if (!(FACTIONS[s.faction].powerUser && s.lowPower)) {
          e.secTimer -= dt;
          if (e.secTimer <= 0) {
            e.secTimer += e.def.income.interval;
            let amt = e.def.income.amount;
            if (e.key === 'dropZone' && s.upgrades.supplyLines) amt = Math.round(amt * 1.1);
            this._addMoney(e.side, amt);
          }
        }
      }

      // Production queue
      if (e.queue.length) {
        const job = e.queue[0];
        const def = FACTIONS[s.faction].units[job.key];
        job.progress = (job.progress || 0) + (dt / def.build) * speed;
        if (job.progress >= 1) {
          // Pop cap check at completion
          if (s.pop + def.pop <= s.popCap || def.harvester || def.builder) {
            e.queue.shift();
            this._produceUnit(e, job.key);
          } else {
            job.progress = 1; // wait at cap
          }
        }
      }

      // Defensive structure firing
      if (e.def.defense && e.powered && !e.disabled > 0) {
        this._tickDefense(e, dt);
      }
      // Tunnel network gun
      if (e.key === 'tunnel') this._tickTunnelGun(e, dt);
      // Demo trap trigger
      if (e.key === 'demoTrap') this._tickDemoTrap(e);
      // Self-repair: junkRepair upgrade (vehicles), handled in unit tick
    }
  }

  _completeStructure(e) {
    e.building = null;
    e.complete = true;
    e.hp = e.maxHp;
    this._emit('constructionComplete', { id: e.id });
    if (e.side === PLAYER) this._eva('constructionComplete', e.x, e.z);
    this._recomputePower(e.side);
    if (e.def.super) {
      this._initSuper(e);
    }
  }

  _produceUnit(struct, key) {
    const side = struct.side;
    const def = FACTIONS[this.faction[side]].units[key];
    // spawn at rally or near structure
    const ang = this.rng() * Math.PI * 2;
    let sx = struct.x + Math.cos(ang) * (struct.radius + 1.5);
    let sz = struct.z + Math.sin(ang) * (struct.radius + 1.5);
    sx = clamp(sx, -PLAYABLE, PLAYABLE); sz = clamp(sz, -PLAYABLE, PLAYABLE);

    const spawnOne = () => {
      const u = this._spawnUnit(side, key, sx, sz);
      this.sides[side].stats.unitsBuilt++;
      if (struct.rally) this._orderMove([u.id], struct.rally.x, struct.rally.z, side);
      else if (def.harvester) this._autoHarvest(u);
      return u;
    };
    spawnOne();
    if (def.pair) { // conscripts train as a pair
      sx += 1; spawnOne();
    }
    if (side === PLAYER) this._eva('unitReady');
  }

  // Cluster-mine / sneak temporary tickers.
  _tickMines(dt) {
    for (let i = this._effects.length - 1; i >= 0; i--) {
      const e = this._effects[i];
      if (e.kind !== 'mine') continue;
      const cands = this.spatial.query(e.x, e.z, e.r + 1);
      for (const o of cands) {
        if (o.kind === 'unit' && o.side !== e.side && o.side !== NEUTRAL && !o.husk && dist(e.x, e.z, o.x, o.z) <= e.r) {
          this._explode(e.x, e.z, e.dmg, 'explosion', e.r, e.side);
          this._emit('hit', { x: e.x, z: e.z, weapon: 'explosion', radius: e.r });
          this._effects.splice(i, 1);
          break;
        }
      }
    }
  }

  _tickTemporary(dt) {
    for (const e of this.entities.values()) {
      if (e.temporary != null) {
        e.temporary -= dt;
        if (e.temporary <= 0) this._destroy(e);
      }
    }
  }

  _tickDefense(e, dt) {
    if (e.fireCd > 0) e.fireCd -= dt;
    const def = e.def.defense;
    // find best target in range
    const tgt = this._acquireDefenseTarget(e, def);
    if (!tgt) { e.spinup = Math.max(0, (e.spinup || 0) - dt * 2); return; }
    e.angle = Math.atan2(tgt.z - e.z, tgt.x - e.x);
    if (def.spinup) e.spinup = Math.min(1, (e.spinup || 0) + dt);
    if (e.fireCd <= 0) {
      const interval = 0.5;
      e.fireCd = interval;
      let dps = def.dps;
      if (def.spinup) dps = 25 + (def.dps - 25) * (e.spinup || 0); // gatling spinup ramp
      if (e.side && this.sides[e.side].upgrades.laserWarheads && def.type === 'missile') dps *= 1.25;
      const dmg = dps * interval;
      this._fireWeapon(e, tgt, { type: def.type, range: def.range, splash: SPLASH_RADIUS[def.type] }, dmg);
    }
  }

  _acquireDefenseTarget(e, def) {
    let best = null, bestD = Infinity;
    const cands = this.spatial.query(e.x, e.z, def.range + 2);
    for (const o of cands) {
      if (o.kind !== 'unit' || o.side === e.side || o.side === NEUTRAL) continue;
      if (o.garrisonedIn || o.husk) continue;
      if (o.def.armor === 'aircraft' && !def.air) continue;
      if (!this._isVisibleTo(o, e.side)) continue;
      const d = dist(e.x, e.z, o.x, o.z);
      if (d <= def.range && d < bestD) { best = o; bestD = d; }
    }
    return best;
  }

  _tickTunnelGun(e, dt) {
    if (e.building != null) return;
    e.fireCd = (e.fireCd || 0) - dt;
    // heal garrisoned units
    for (const id of e.garrisonList) {
      const u = this.entities.get(id);
      if (u) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.02 * dt);
    }
    const tgt = this._acquireDefenseTarget(e, { type: 'smallArms', range: 10, air: false });
    if (tgt && e.fireCd <= 0) {
      e.fireCd = 0.5;
      this._fireWeapon(e, tgt, { type: 'smallArms', range: 10 }, 10 * 0.5);
    }
  }

  _tickDemoTrap(e) {
    if (e.building != null) return;
    const cands = this.spatial.query(e.x, e.z, e.def.demoTrap.trigger + 1);
    for (const o of cands) {
      if (o.kind === 'unit' && o.side !== e.side && o.side !== NEUTRAL && !o.husk) {
        if (dist(e.x, e.z, o.x, o.z) <= e.def.demoTrap.trigger) {
          this._explode(e.x, e.z, e.def.demoTrap.dmg, e.def.demoTrap.type, e.def.demoTrap.radius, e.side);
          this._emit('hit', { x: e.x, z: e.z, weapon: 'explosion', radius: e.def.demoTrap.radius });
          this._destroy(e);
          return;
        }
      }
    }
  }

  // ─── Collectors (supply economy state machine) ───────────────────────────────
  _autoHarvest(u) {
    // find nearest dock with supply and nearest deposit
    const dock = this._nearestDock(u.side, u.x, u.z);
    if (dock) { u.collector.dockId = dock.id; u.collector.phase = 'toDock'; this._orderMove([u.id], dock.x, dock.z, u.side); }
  }

  _nearestDock(side, x, z) {
    let best = null, bd = Infinity;
    for (const e of this.entities.values()) {
      if (e.kind === 'structure' && (e.key === 'supplyDock' || e.key === 'supplyPile') && e.amount > 0) {
        const d = dist2(x, z, e.x, e.z);
        if (d < bd) { bd = d; best = e; }
      }
    }
    return best;
  }

  _nearestDeposit(side, x, z) {
    let best = null, bd = Infinity;
    for (const e of this.entities.values()) {
      if (e.side === side && e.kind === 'structure' && e.building == null && e.def &&
          (e.def.deposit || e.key === 'commandCenter')) {
        const d = dist2(x, z, e.x, e.z);
        if (d < bd) { bd = d; best = e; }
      }
    }
    return best;
  }

  _tickCollectors(dt) {
    for (const u of this.entities.values()) {
      if (!u.collector || u.kind !== 'unit' || u.husk) continue;
      if (u.build || u.repairTarget) continue; // syndicate worker building
      const c = u.collector;
      const isHeli = u.def.heli;

      if (c.phase === 'idle') { this._autoHarvest(u); continue; }

      if (c.phase === 'toDock') {
        const dock = this.entities.get(c.dockId);
        if (!dock || dock.amount <= 0) { c.dockId = null; c.phase = 'idle'; continue; }
        if (dist(u.x, u.z, dock.x, dock.z) < 2.5) {
          c.phase = 'loading'; c.cycleT = isHeli ? u.def.cycle : 1.5;
          if (!isHeli) { u.path = null; u.moveGoal = null; u.state = 'idle'; }
        } else if (u.state === 'idle' && !u.path) {
          this._orderMove([u.id], dock.x, dock.z, u.side);
        }
      } else if (c.phase === 'loading') {
        c.cycleT -= dt;
        if (c.cycleT <= 0) {
          const dock = this.entities.get(c.dockId);
          const trip = Math.min(u.def.trip, dock ? dock.amount : 0);
          if (dock) dock.amount -= trip;
          u.carrying = trip;
          if (trip <= 0) { c.phase = 'idle'; c.dockId = null; continue; }
          c.phase = 'toBase';
        }
      } else if (c.phase === 'toBase') {
        const dep = this._nearestDeposit(u.side, u.x, u.z);
        if (!dep) { c.phase = 'idle'; continue; }
        c.depId = dep.id;
        if (dist(u.x, u.z, dep.x, dep.z) < 3) {
          c.phase = 'depositing'; c.cycleT = isHeli ? u.def.cycle : 1;
          if (!isHeli) { u.path = null; u.moveGoal = null; u.state = 'idle'; }
        } else if (u.state === 'idle' && !u.path) {
          this._orderMove([u.id], dep.x, dep.z, u.side);
        }
      } else if (c.phase === 'depositing') {
        c.cycleT -= dt;
        if (c.cycleT <= 0) {
          let amt = u.carrying;
          if (this.sides[u.side].upgrades.supplyLines) amt = Math.round(amt * 1.1);
          if (u.salvage >= 2) amt += 100; // fully-upgraded collector bonus
          this._addMoney(u.side, amt);
          u.carrying = 0;
          c.phase = 'toDock';
          // refresh dock target
          const dock = this._nearestDock(u.side, u.x, u.z);
          if (dock) { c.dockId = dock.id; this._orderMove([u.id], dock.x, dock.z, u.side); }
          else { c.phase = 'idle'; }
        }
      }
    }
  }

  // ─── Units: movement, steering, building, deploy, abilities upkeep ────────────
  _tickUnits(dt) {
    for (const u of this.entities.values()) {
      if (u.kind !== 'unit' || u.garrisonedIn) continue;
      if (u.disabled > 0) { u.disabled -= dt; continue; }

      // self-heal: veterancy + junk repair
      const vh = VET_LEVELS[u.vet].heal;
      if (vh > 0) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * vh * dt);
      if (u.def.salvage && this.sides[u.side].upgrades.junkRepair && u.armor !== 'aircraft') {
        u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.01 * dt);
      }

      if (u.abilityCd) for (const k in u.abilityCd) if (u.abilityCd[k] > 0) u.abilityCd[k] -= dt;

      // Hacker deploy income
      if (u.def.deployIncome && u.deployed) {
        this._addMoney(u.side, u.def.deployIncome * dt);
      }
      if (u.def.deployIncome && u.deployTimer > 0) {
        u.deployTimer -= dt;
        if (u.deployTimer <= 0) u.deployed = true;
      }

      // Builder constructing a structure
      if (u.build) { this._tickBuilder(u, dt); continue; }
      if (u.repairTarget) { this._tickRepair(u, dt); continue; }

      // Aircraft rearm cycle
      if (u.rearming > 0) { u.rearming -= dt; if (u.rearming <= 0) u.burst = 0; }

      this._moveUnit(u, dt);
    }
  }

  _tickBuilder(u, dt) {
    const st = u.build;
    const struct = this.entities.get(st);
    if (!struct || struct.building == null) { u.build = null; u.state = 'idle'; return; }
    const d = dist(u.x, u.z, struct.x, struct.z);
    if (d > struct.radius + 1.5) {
      // drive to build site
      u.state = 'moving';
      this._stepToward(u, struct.x, struct.z, dt, struct.radius + 1.2);
    } else {
      u.state = 'building';
      u.path = null; u.moveGoal = null;
      const s = this.sides[u.side];
      const speed = (s.lowPower && FACTIONS[s.faction].powerUser) ? 0.5 : 1;
      struct.building += (dt / struct.buildRate) * speed;
      struct._buildAssigned = this.time;
      struct.hp = Math.min(struct.maxHp, struct.maxHp * (0.1 + 0.9 * struct.building));
      if (struct.building >= 1) {
        this._completeStructure(struct);
        u.build = null; u.state = 'idle';
      }
    }
  }

  _tickRepair(u, dt) {
    const t = this.entities.get(u.repairTarget);
    if (!t || t.hp >= t.maxHp || t.side !== u.side) { u.repairTarget = null; u.state = 'idle'; return; }
    const d = dist(u.x, u.z, t.x, t.z);
    if (d > t.radius + 1.5) { u.state = 'moving'; this._stepToward(u, t.x, t.z, dt, t.radius + 1.2); }
    else {
      u.state = 'repairing'; u.path = null; u.moveGoal = null;
      const heal = t.maxHp * 0.08 * dt; // ~12.5s full repair
      const cost = heal / 4; // $1 per 4 hp
      const s = this.sides[u.side];
      if (s.money >= cost) { s.money -= cost; t.hp = Math.min(t.maxHp, t.hp + heal); }
      if (t.hp >= t.maxHp) { u.repairTarget = null; u.state = 'idle'; }
    }
  }

  _moveUnit(u, dt) {
    // Attack-target handling is in combat; here we resolve movement intents.
    if (u.captureTarget) { this._driveToCapture(u, dt); return; }

    if (u.attackTarget != null) {
      const t = this.entities.get(u.attackTarget);
      if (!t || t.hp <= 0) { u.attackTarget = null; if (!u.attackMove) u.state = 'idle'; }
      else {
        const rng = this._weaponRange(u);
        const d = dist(u.x, u.z, t.x, t.z);
        if (d > rng * 0.92) { u.state = 'moving'; this._stepToward(u, t.x, t.z, dt, rng * 0.85); }
        else { u.state = 'attacking'; u.path = null; u.angle = Math.atan2(t.z - u.z, t.x - u.x); }
        return;
      }
    }

    if (u.attackMove) {
      // look for enemy in vision; if found, engage
      const enemy = this._findEnemyInVision(u);
      if (enemy) { u.attackTarget = enemy.id; return; }
      // else continue moving to goal
      if (u.moveGoal) {
        if (dist(u.x, u.z, u.moveGoal.x, u.moveGoal.z) < 1.2) { u.attackMove = null; u.moveGoal = null; u.state = 'idle'; }
        else this._followPath(u, dt);
      } else u.state = 'idle';
      return;
    }

    if (u.guardPos) {
      const enemy = this._findEnemyInVision(u);
      if (enemy && dist(u.x, u.z, u.guardPos.x, u.guardPos.z) < 6) { u.attackTarget = enemy.id; return; }
      // return to guard pos if displaced
      if (dist(u.x, u.z, u.guardPos.x, u.guardPos.z) > 1) this._stepToward(u, u.guardPos.x, u.guardPos.z, dt, 0.5);
      else u.state = 'idle';
      return;
    }

    if (u.moveGoal) {
      if (dist(u.x, u.z, u.moveGoal.x, u.moveGoal.z) < 1.0) {
        u.moveGoal = null; u.path = null; u.state = 'idle';
        // collectors handle their own phase transitions
      } else {
        this._followPath(u, dt);
      }
      return;
    }

    // Idle: auto-acquire if has weapon and enemy adjacent (defensive)
    if (this._hasWeapon(u) && u.state === 'idle') {
      const enemy = this._findEnemyInVision(u, this._weaponRange(u) + 1);
      if (enemy) u.attackTarget = enemy.id;
    }
  }

  _followPath(u, dt) {
    if (u.def.armor === 'aircraft') { // aircraft skip pathfinding
      this._stepToward(u, u.moveGoal.x, u.moveGoal.z, dt, 0.4, true);
      return;
    }
    // (re)compute path if needed
    if (!u.path || u.pathGoal == null || dist2(u.pathGoal.x, u.pathGoal.z, u.moveGoal.x, u.moveGoal.z) > 4) {
      u.path = findPath(this.passGrid, u.x, u.z, u.moveGoal.x, u.moveGoal.z);
      u.pathGoal = { x: u.moveGoal.x, z: u.moveGoal.z };
      u.pathIdx = 0;
      if (!u.path || !u.path.length) { u.path = [{ x: u.moveGoal.x, z: u.moveGoal.z }]; }
    }
    u.state = 'moving';
    const wp = u.path[u.pathIdx];
    if (!wp) { u.moveGoal = null; u.state = 'idle'; return; }
    if (dist(u.x, u.z, wp.x, wp.z) < 1.0) {
      u.pathIdx++;
      if (u.pathIdx >= u.path.length) { u.path = null; return; }
    }
    const w = u.path[u.pathIdx] || u.moveGoal;
    this._stepToward(u, w.x, w.z, dt, 0);
  }

  _stepToward(u, tx, tz, dt, stopDist = 0, ignoreTerrain = false) {
    const dx = tx - u.x, dz = tz - u.z;
    const d = Math.hypot(dx, dz);
    if (d <= stopDist || d < 0.001) { u.state = (u.attackTarget ? 'attacking' : u.state); return; }
    let spd = u.def.spd * (this.sides[u.side] && this.sides[u.side].lowPower && false ? 1 : 1);
    if (u.deployed) return; // deployed hacker won't move
    const step = Math.min(d - stopDist, spd * dt);
    const nx = u.x + (dx / d) * step;
    const nz = u.z + (dz / d) * step;
    u.angle = Math.atan2(dz, dx);
    if (ignoreTerrain || !this._terrainBlocked(nx, nz)) {
      u.x = clamp(nx, -PLAYABLE, PLAYABLE);
      u.z = clamp(nz, -PLAYABLE, PLAYABLE);
    } else {
      // nudge around: try perpendicular
      const px = -(dz / d), pz = (dx / d);
      const ax = u.x + px * step, az = u.z + pz * step;
      if (!this._terrainBlocked(ax, az)) { u.x = clamp(ax, -PLAYABLE, PLAYABLE); u.z = clamp(az, -PLAYABLE, PLAYABLE); }
      else { const bx = u.x - px * step, bz = u.z - pz * step; if (!this._terrainBlocked(bx, bz)) { u.x = clamp(bx, -PLAYABLE, PLAYABLE); u.z = clamp(bz, -PLAYABLE, PLAYABLE); } }
      u.path = null; // force repath
    }
  }

  // ─── Separation (spatial-hash based pairwise push) ───────────────────────────
  _applySeparation(dt) {
    const minD = 0.8;
    for (const a of this.entities.values()) {
      if (a.kind !== 'unit' || a.garrisonedIn || a.def.armor === 'aircraft' || a.husk) continue;
      const near = this.spatial.query(a.x, a.z, minD);
      for (const b of near) {
        if (b === a || b.kind !== 'unit' || b.garrisonedIn || b.def.armor === 'aircraft' || b.husk) continue;
        if (b.id < a.id) continue; // each pair once
        const dx = a.x - b.x, dz = a.z - b.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < minD * minD && d2 > 1e-5) {
          const d = Math.sqrt(d2);
          const push = (minD - d) * 0.5;
          const nx = dx / d, nz = dz / d;
          if (!this._terrainBlocked(a.x + nx * push, a.z + nz * push)) { a.x += nx * push; a.z += nz * push; }
          if (!this._terrainBlocked(b.x - nx * push, b.z - nz * push)) { b.x -= nx * push; b.z -= nz * push; }
          a.x = clamp(a.x, -PLAYABLE, PLAYABLE); a.z = clamp(a.z, -PLAYABLE, PLAYABLE);
          b.x = clamp(b.x, -PLAYABLE, PLAYABLE); b.z = clamp(b.z, -PLAYABLE, PLAYABLE);
        }
      }
    }
  }

  // ─── Combat ──────────────────────────────────────────────────────────────────
  _hasWeapon(u) { return !!u.def.weapon || !!u.def.suicide; }
  _weaponRange(u) {
    let r = u.def.weapon ? u.def.weapon.range : 1.5;
    // garrison +2 range handled when garrisoned (units inside fire out)
    return r;
  }

  _findEnemyInVision(u, range) {
    const vr = range != null ? range : u.def.vision;
    const cands = this.spatial.query(u.x, u.z, vr + 1);
    let best = null, bd = Infinity;
    for (const o of cands) {
      if (o.side === u.side || o.side === NEUTRAL) continue;
      if (o.husk) continue;
      if (o.kind === 'unit' && o.garrisonedIn) continue;
      if (o.def && o.def.armor === 'aircraft' && u.def.weapon && !u.def.weapon.air) continue;
      if (!this._isVisibleTo(o, u.side) && o.stealthed) continue;
      const d = dist(u.x, u.z, o.x, o.z);
      if (d <= vr && d < bd) {
        // prefer attackable (has weapon vs aircraft)
        bd = d; best = o;
      }
    }
    return best;
  }

  _tickCombat(dt) {
    for (const u of this.entities.values()) {
      if (u.kind !== 'unit' || u.husk || u.disabled > 0) continue;
      if (!this._hasWeapon(u)) continue;
      if (u.fireCd > 0) u.fireCd -= dt;

      // Suicide units
      if (u.def.suicide) { this._tickSuicide(u, dt); continue; }

      let t = u.attackTarget != null ? this.entities.get(u.attackTarget) : null;
      if ((!t || t.hp <= 0) && (u.state === 'attacking')) { u.attackTarget = null; t = null; }
      if (!t && (u.guardPos || u.attackMove || u.state === 'idle')) {
        const e = this._findEnemyInVision(u, this._weaponRange(u));
        if (e) { t = e; u.attackTarget = e.id; }
      }
      if (!t || t.hp <= 0) continue;
      if (t.garrisonedIn) { u.attackTarget = null; continue; }

      const rng = this._weaponRange(u);
      const w = u.def.weapon;
      const d = dist(u.x, u.z, t.x, t.z);
      if (w.min && d < w.min) continue; // artillery min range
      if (d > rng) continue;
      if (w.air === false && t.def && t.def.armor === 'aircraft') continue;
      if (w.air !== true && t.def && t.def.armor === 'aircraft' && !w.air) { /* can't hit air */ continue; }

      // aircraft jets with burst+rearm
      if (u.def.rearm) {
        if (u.rearming > 0) continue;
        if (u.burst >= (w.burst || 1)) { this._sendToRearm(u); continue; }
      }

      if (u.fireCd <= 0) {
        const interval = this._fireInterval(u);
        u.fireCd = interval;
        u.lastFire = this.time;
        if (u.def.stealthWhenStill) u.revealUntil = this.time + REVEAL_AFTER_FIRE;
        let dmg = this._shotDamage(u, interval);
        this._fireWeapon(u, t, w, dmg);
        u.angle = Math.atan2(t.z - u.z, t.x - u.x);
        if (u.def.rearm) { u.burst++; if (u.burst >= (w.burst || 1)) this._sendToRearm(u); }
        this._emit('attack', { id: u.id, targetId: t.id, weapon: w.type });
      }
    }
  }

  _fireInterval(u) {
    const w = u.def.weapon;
    let base = w.interval || 0.5; // artillery uses interval; others fire 2/sec baseline
    // veterancy RoF and horde
    let rof = VET_LEVELS[u.vet].rof;
    if (u.def.horde && this._inHorde(u)) rof *= this.sides[u.side].upgrades.nationalism ? 1.5 : 1.25;
    return base / rof;
  }

  _shotDamage(u, interval) {
    const w = u.def.weapon;
    // dps × interval, with vet dmg and upgrades and salvage
    let dps = w.dps;
    const up = this.sides[u.side].upgrades;
    if (w.type === 'cannon' && up.uraniumShells) dps *= 1.25;
    if (w.type === 'flame' && up.blackNapalm) dps *= 1.3;
    if (w.type === 'missile' && (up.laserWarheads || up.apRockets)) dps *= 1.25;
    dps *= VET_LEVELS[u.vet].dmg;
    if (u.def.salvage) dps *= (1 + 0.25 * u.salvage);
    return dps * interval;
  }

  _fireWeapon(attacker, target, w, dmg) {
    const type = w.type;
    if (INSTANT_WEAPONS.has(type)) {
      // instant hit
      if (type === 'flame' || type === 'toxin') {
        // cone/spray: hit target + leave patch/pool
        this._applyDamage(attacker, target, type, dmg);
        if (w.cone || w.spray) {
          // small splash to nearby in cone
          const near = this.spatial.query(target.x, target.z, 2);
          for (const o of near) {
            if (o !== target && o.kind === 'unit' && o.side !== attacker.side && o.side !== NEUTRAL && !o.husk) {
              if (dist(target.x, target.z, o.x, o.z) <= 2) this._applyDamage(attacker, o, type, dmg * 0.5);
            }
          }
        }
        if (w.firePatch) this._addEffect({ kind: 'fire', x: target.x, z: target.z, r: 3, dps: 20, life: w.firePatch, side: attacker.side });
        if (w.pool) this._addEffect({ kind: 'toxin', x: target.x, z: target.z, r: 3, dps: 15, life: w.pool, side: attacker.side });
      } else {
        this._applyDamage(attacker, target, type, dmg);
      }
      this._emit('hit', { x: target.x, z: target.z, weapon: type, radius: 0 });
    } else {
      // travel-time projectile
      const speed = PROJ_SPEED[type] || 30;
      const d = dist(attacker.x, attacker.z, target.x, target.z);
      const flightTime = Math.max(0.05, d / speed);
      const splash = w.splash || SPLASH_RADIUS[type] || 0;
      this._projectiles.push({
        fromX: attacker.x, fromZ: attacker.z, toX: target.x, toZ: target.z,
        attackerSide: attacker.side, attackerId: attacker.id, vet: attacker.vet,
        type, dmg, splash, elapsed: 0, flightTime, arc: !!w.arc,
        targetId: target.id, napalm: !!w.napalm, pool: w.pool || 0,
        upgrades: { ...this.sides[attacker.side].upgrades }, salvage: attacker.def.salvage ? attacker.salvage : 0,
      });
      this._emit('projectile', { fromX: attacker.x, fromZ: attacker.z, toX: target.x, toZ: target.z, weapon: type, flightTime, arc: !!w.arc });
    }
  }

  _applyDamage(attacker, target, dmgType, dmg, fromSide) {
    if (!target || target.hp <= 0 || target.husk) return;
    const side = fromSide || (attacker ? attacker.side : null);
    let armor = target.def ? (target.def.armor || (target.kind === 'structure' ? 'structure' : 'infantry')) : 'structure';
    if (target.kind === 'structure') {
      armor = target.def && target.def.defense ? 'baseDefense' : 'structure';
    }
    // flame/dragon immune
    if (dmgType === 'flame' && target.def && target.def.flameImmune) return;
    const mult = dmgMultiplier(dmgType, armor);
    let final = dmg * mult;
    if (final <= 0) return;

    // garrisoned building: flame/toxin hits occupants ×2
    target.hp -= final;
    if (target.kind === 'structure' && target.garrisonList && target.garrisonList.length &&
        (dmgType === 'flame' || dmgType === 'toxin')) {
      // damage occupants
      for (const id of [...target.garrisonList]) {
        const occ = this.entities.get(id);
        if (occ) { occ.hp -= final * 0.5; if (occ.hp <= 0) this._evictOccupant(target, occ); }
      }
    }

    // under-attack EVA
    if (target.side === PLAYER && side === ENEMY) this._underAttackEva(target);

    if (target.hp <= 0) this._onKill(attacker, target);
  }

  _underAttackEva(target) {
    const s = this.sides[PLAYER];
    if (target.kind === 'structure') {
      if (this.time - s.lastUnderAttack.base > UNDER_ATTACK_THROTTLE) {
        s.lastUnderAttack.base = this.time; this._eva('baseUnderAttack', target.x, target.z);
      }
    } else if (target.collector) {
      if (this.time - s.lastUnderAttack.harvester > UNDER_ATTACK_THROTTLE) {
        s.lastUnderAttack.harvester = this.time; this._eva('harvesterUnderAttack', target.x, target.z);
      }
    } else {
      if (this.time - s.lastUnderAttack.units > UNDER_ATTACK_THROTTLE) {
        s.lastUnderAttack.units = this.time; this._eva('unitsUnderAttack', target.x, target.z);
      }
    }
  }

  _onKill(attacker, target) {
    const victimCost = this._entityCost(target);
    const killerSide = attacker ? attacker.side : null;

    // veterancy XP to killer unit
    if (attacker && attacker.kind === 'unit') {
      attacker.xp = (attacker.xp || 0) + victimCost / 10;
      this._checkVet(attacker);
    }
    // general's rank XP
    if (killerSide && killerSide !== target.side && target.side !== NEUTRAL) {
      const s = this.sides[killerSide];
      s.stats.kills++;
      const gain = (target.kind === 'structure') ? 50 : victimCost / 4;
      this._addRankXp(killerSide, gain);
      // cash bounty (syndicate passive)
      if (s.cashBounty > 0 && target.kind === 'unit') this._addMoney(killerSide, Math.round(victimCost * s.cashBounty));
    }

    // salvage crate drop
    if (target.kind === 'unit' && (target.def.armor === 'lightVehicle' || target.def.armor === 'tank')) {
      const synKilled = attacker && this.faction[attacker.side] === 'syndicate';
      let nearSyn = synKilled;
      if (!nearSyn) {
        const near = this.spatial.query(target.x, target.z, 6);
        nearSyn = near.some(o => o.kind === 'unit' && o.def.salvage && o.side !== target.side);
      }
      if (nearSyn) this._spawnCrate(target.x, target.z);
    }

    this._destroy(target);
  }

  _entityCost(e) {
    if (e.kind === 'structure') return e.def ? (e.def.cost || 500) : 500;
    return e.def ? (e.def.cost || 100) : 100;
  }

  _checkVet(u) {
    const cost = u.def.cost || 100;
    const thresholds = [cost / 3, cost, cost * 2];
    let newVet = 0;
    for (let i = 0; i < 3; i++) if (u.xp >= thresholds[i]) newVet = i + 1;
    if (newVet > u.vet) {
      const pct = u.hp / u.maxHp;
      u.vet = newVet;
      u.maxHp = u.def.hp * VET_LEVELS[newVet].hp;
      u.hp = u.maxHp * pct;
    }
  }

  _addRankXp(side, amount) {
    const s = this.sides[side];
    s.rankXp += amount;
    let newRank = 0;
    for (let i = 0; i < RANK_THRESHOLDS.length; i++) if (s.rankXp >= RANK_THRESHOLDS[i]) newRank = i;
    if (newRank > s.rank) {
      let gained = 0;
      for (let r = s.rank + 1; r <= newRank; r++) gained += RANK_POINTS[r];
      s.rank = newRank;
      s.points += gained;
      this._emit('rankUp', { side, rank: s.rank, points: s.points });
      if (side === PLAYER) this._eva('promotion');
    }
  }

  _tickSuicide(u, dt) {
    const t = u.attackTarget != null ? this.entities.get(u.attackTarget) : this._findEnemyInVision(u, 2);
    if (t && t.hp > 0 && dist(u.x, u.z, t.x, t.z) <= 1.5) {
      this._detonateFanatic(u);
    }
  }
  _detonateFanatic(u) {
    const s = u.def.suicide;
    this._explode(u.x, u.z, s.dmg, s.type, s.radius, u.side);
    this._emit('hit', { x: u.x, z: u.z, weapon: 'explosion', radius: s.radius });
    this._destroy(u, true);
  }

  // ─── Projectiles ─────────────────────────────────────────────────────────────
  _tickProjectiles(dt) {
    for (let i = this._projectiles.length - 1; i >= 0; i--) {
      const p = this._projectiles[i];
      p.elapsed += dt;
      if (p.elapsed >= p.flightTime) {
        this._projectiles.splice(i, 1);
        this._landProjectile(p);
      }
    }
  }

  _landProjectile(p) {
    // re-aim at moving target's current position if still alive
    let tx = p.toX, tz = p.toZ;
    const t = this.entities.get(p.targetId);
    if (t && t.hp > 0) { tx = t.x; tz = t.z; }
    if (p.splash > 0) {
      this._explode(tx, tz, p.dmg, p.type, p.splash, p.attackerSide, p);
    } else if (t && t.hp > 0) {
      this._applyDamage(this.entities.get(p.attackerId), t, p.type, p.dmg, p.attackerSide);
    }
    if (p.pool) this._addEffect({ kind: 'toxin', x: tx, z: tz, r: 3, dps: 15, life: p.pool, side: p.attackerSide });
    this._emit('hit', { x: tx, z: tz, weapon: p.type, radius: p.splash });
  }

  _explode(x, z, dmg, type, radius, side, proj) {
    const cands = this.spatial.query(x, z, radius + 2);
    const attacker = proj ? this.entities.get(proj.attackerId) : null;
    for (const o of cands) {
      if (o.side === NEUTRAL && o.kind !== 'structure') continue;
      if (o.husk) continue;
      if (o.kind === 'unit' && o.garrisonedIn) continue;
      const d = dist(x, z, o.x, o.z);
      if (d <= radius) {
        const falloff = 1 - (d / radius) * 0.5;
        this._applyDamage(attacker, o, type, dmg * falloff, side);
      }
    }
  }

  // ─── Area effects (fire / toxin / radiation) ─────────────────────────────────
  _addEffect(e) { e.t = 0; this._effects.push(e); }
  _tickEffects(dt) {
    for (let i = this._effects.length - 1; i >= 0; i--) {
      const e = this._effects[i];
      e.t += dt;
      // tick damage at ~3/sec
      e.tickAccum = (e.tickAccum || 0) + dt;
      if (e.tickAccum >= 0.33) {
        const cands = this.spatial.query(e.x, e.z, e.r + 1);
        for (const o of cands) {
          if (o.kind !== 'unit' || o.husk || o.garrisonedIn) continue;
          if (e.side && o.side === e.side) continue;
          if (o.side === NEUTRAL) continue;
          if (dist(e.x, e.z, o.x, o.z) <= e.r) {
            this._applyDamage(null, o, e.kind === 'toxin' ? 'toxin' : (e.kind === 'radiation' ? 'explosion' : 'flame'), e.dps * e.tickAccum, e.side);
          }
        }
        e.tickAccum = 0;
      }
      if (e.t >= e.life) this._effects.splice(i, 1);
    }
  }

  // ─── Stealth / detection ─────────────────────────────────────────────────────
  _tickStealth(dt) {
    for (const u of this.entities.values()) {
      const canStealth = (u.kind === 'unit' && u.def.stealthWhenStill) ||
                         (u.kind === 'structure' && u.def && u.def.stealthWhenStill);
      if (!canStealth) { u.stealthed = false; continue; }
      const moving = u.kind === 'unit' && (u.state === 'moving');
      const firedRecently = this.time < u.revealUntil;
      u.stealthed = !moving && !firedRecently;
    }
  }

  // Is target visible to `side`? Non-stealth always visible if in fog visible; stealth needs detector/proximity.
  _isVisibleTo(target, side) {
    if (target.side === side) return true;
    if (!target.stealthed) return true;
    // detector structures within 4
    for (const e of this.entities.values()) {
      if (e.side !== side) continue;
      if (e.kind === 'structure' && e.def && (e.key === 'commandCenter' || e.def.defense || e.def.radar)) {
        if (dist(e.x, e.z, target.x, target.z) <= DETECT_RADIUS && e.building == null) return true;
      }
      if (e.kind === 'unit' && !e.garrisonedIn && dist(e.x, e.z, target.x, target.z) <= VISION_REVEAL) return true;
    }
    return false;
  }

  // ─── Fog of war ──────────────────────────────────────────────────────────────
  _computeFog() {
    for (const side of [PLAYER, ENEMY]) {
      const grid = this.fogGrid[side];
      // downgrade visible→explored
      for (let i = 0; i < grid.length; i++) if (grid[i] === 2) grid[i] = 1;
      for (const e of this.entities.values()) {
        if (e.side !== side) continue;
        if (e.garrisonedIn) continue;
        const vr = e.kind === 'unit' ? (e.def ? e.def.vision : 8) : (e.def && e.def.radar ? 18 : 8);
        this._revealFog(grid, e.x, e.z, vr);
      }
    }
    this.fog.grid = this.fogGrid.player;
  }
  _revealFog(grid, x, z, r) {
    const c = worldToCell(x, z);
    const span = Math.ceil(r / MAP.cell);
    for (let dz = -span; dz <= span; dz++) {
      for (let dx = -span; dx <= span; dx++) {
        const nx = c.cx + dx, nz = c.cz + dz;
        if (nx < 0 || nz < 0 || nx >= FOG_W || nz >= FOG_H) continue;
        const w = cellToWorld(nx, nz);
        if (dist(w.x, w.z, x, z) <= r) grid[nz * FOG_W + nx] = 2;
      }
    }
  }
  _isInFog(x, z, side) {
    const c = worldToCell(x, z);
    return this.fogGrid[side][c.cz * FOG_W + c.cx] === 2;
  }

  // ─── Captures ────────────────────────────────────────────────────────────────
  _tickCaptures(dt) {
    for (const u of this.entities.values()) {
      if (u.kind !== 'unit' || !u.captureTarget) continue;
      const t = this.entities.get(u.captureTarget);
      if (!t || t.hp <= 0) { u.captureTarget = null; u.state = 'idle'; continue; }
      // handled by _driveToCapture for movement; progress here when adjacent
      if (dist(u.x, u.z, t.x, t.z) <= t.radius + 1.6 && u.state === 'capturing') {
        if (!t.capture || t.capture.by !== u.side) t.capture = { by: u.side, progress: 0, capturerId: u.id };
        t.capture.progress += dt / CAPTURE_TIME;
        if (t.capture.progress >= 1) this._completeCapture(t, u.side);
      }
    }
  }

  _driveToCapture(u, dt) {
    const t = this.entities.get(u.captureTarget);
    if (!t || t.hp <= 0) { u.captureTarget = null; u.state = 'idle'; return; }
    const d = dist(u.x, u.z, t.x, t.z);
    if (d > t.radius + 1.5) { u.state = 'moving'; this._stepToward(u, t.x, t.z, dt, t.radius + 1.2); }
    else { u.state = 'capturing'; u.path = null; u.moveGoal = null; }
  }

  _completeCapture(t, side) {
    if (t.key === 'oilDerrick') {
      t.side = side; t.faction = this.faction[side]; t.capture = null;
      t.oilTimer = 3;
      this._addMoney(side, 1000);
      this._emit('captureComplete', { id: t.id, newSide: side });
      if (side === PLAYER) this._eva('capturedDerrick', t.x, t.z);
    } else if (t.kind === 'structure') {
      // capture enemy production structure
      const oldSide = t.side;
      t.side = side; t.faction = this.faction[side]; t.capture = null;
      this._recomputePower(side); if (oldSide !== NEUTRAL) this._recomputePower(oldSide);
      this._emit('captureComplete', { id: t.id, newSide: side });
    }
  }

  // Oil derrick passive income tick (folded into structures? do here)
  _tickOilDerricks(dt) {}

  // ─── Crates (salvage) ────────────────────────────────────────────────────────
  _spawnCrate(x, z) {
    const e = { id: NEXT_ID++, side: NEUTRAL, kind: 'crate', key: 'crate', x, z, angle: 0, hp: 1, maxHp: 1, vet: 0, radius: 0.5, life: SALVAGE_LIFETIME };
    this.entities.set(e.id, e);
    this._queueSpawnEvent(e);
    this._emit('crateSpawn', { id: e.id, x, z });
  }
  _tickCrates(dt) {
    for (const c of this.entities.values()) {
      if (c.kind !== 'crate') continue;
      c.life -= dt;
      if (c.life <= 0) { this._emit('death', { id: c.id, x: c.x, z: c.z, key: 'crate', kind: 'crate', side: NEUTRAL }); this.entities.delete(c.id); continue; }
      // pickup by syndicate vehicle
      const near = this.spatial.query(c.x, c.z, 1.5);
      for (const o of near) {
        if (o.kind === 'unit' && o.def.salvage && dist(c.x, c.z, o.x, o.z) <= 1.2) {
          if (o.salvage < 2) o.salvage++;
          else this._addMoney(o.side, 100);
          this._emit('cratePickup', { id: c.id, x: c.x, z: c.z });
          this.entities.delete(c.id);
          break;
        }
      }
    }
  }

  // ─── Horde ───────────────────────────────────────────────────────────────────
  _inHorde(u) {
    if (!u.def.horde) return false;
    let count = 0;
    const near = this.spatial.query(u.x, u.z, HORDE_RADIUS);
    for (const o of near) {
      if (o.side === u.side && o.kind === 'unit' && o.def.horde && dist(u.x, u.z, o.x, o.z) <= HORDE_RADIUS) count++;
    }
    return count >= HORDE_MIN;
  }

  // ─── Aircraft rearm ──────────────────────────────────────────────────────────
  _sendToRearm(u) {
    // fly to airfield, rearm 8s
    const af = this._nearestStructure(u.side, u.x, u.z, k => k === 'airfield');
    if (af) { u.rearming = 8; this._orderMove([u.id], af.x, af.z, u.side); u.attackTarget = null; }
    else { u.rearming = 8; } // no airfield: circle
  }
  _nearestStructure(side, x, z, pred) {
    let best = null, bd = Infinity;
    for (const e of this.entities.values()) {
      if (e.side === side && e.kind === 'structure' && e.building == null && pred(e.key)) {
        const d = dist2(x, z, e.x, e.z); if (d < bd) { bd = d; best = e; }
      }
    }
    return best;
  }

  // ─── Superweapons ────────────────────────────────────────────────────────────
  _initSuper(struct) {
    const sw = SUPERWEAPONS[struct.key];
    const s = this.sides[struct.side];
    s.super = { id: struct.id, key: struct.key, charge: 0, total: sw.charge, ready: false };
    this._emit('superBuilt', { side: struct.side, key: struct.key, x: struct.x, z: struct.z });
    this._eva('enemySuperDetected', struct.x, struct.z);
  }
  _tickSupers(dt) {
    for (const side of [PLAYER, ENEMY]) {
      const s = this.sides[side];
      if (!s.super) continue;
      const struct = this.entities.get(s.super.id);
      if (!struct || struct.hp <= 0) { s.super = null; continue; }
      if (s.super.ready) continue;
      // pause at low power
      if (FACTIONS[s.faction].powerUser && s.lowPower) continue;
      s.super.charge += dt;
      if (s.super.charge >= s.super.total) {
        s.super.charge = s.super.total; s.super.ready = true;
        this._emit('superReady', { side, key: s.super.key, x: struct.x, z: struct.z });
        if (side === PLAYER) this._eva('ourSuperReady');
        else this._eva('enemySuperReady');
      }
    }
  }

  _fireSuper(side, x, z) {
    const s = this.sides[side];
    if (!s.super || !s.super.ready) return { ok: false, reason: 'not ready' };
    const struct = this.entities.get(s.super.id);
    s.super.ready = false; s.super.charge = 0;
    s.stats.supersFired++;
    const key = s.super.key;
    this._emit('superLaunch', { side, key, x, z });
    this._eva('superLaunchDetected', x, z);
    const sw = SUPERWEAPONS[key];
    if (sw.behavior === 'lance') this._superLance(side, x, z);
    else if (sw.behavior === 'nuke') this._superNuke(side, x, z);
    else if (sw.behavior === 'viper') this._superViper(side, x, z);
    return { ok: true };
  }

  _superLance(side, x, z) {
    // beam strikes then sweeps 12 units over 6s, 200 beam dps in r2.5
    this._addEffect({ kind: 'beam', x, z, r: 2.5, dps: 200, life: 6, side, sweep: { from: { x, z }, dir: this.rng() * Math.PI * 2, dist: 12 }, special: 'lance' });
    // immediate impact event
    this._emit('superImpact', { side, key: 'orbitalLance', x, z });
    // apply continuous via a beam effect variant
    this._effects[this._effects.length - 1].onTick = (e, dtv) => {
      const prog = e.t / e.life;
      const bx = e.sweep.from.x + Math.cos(e.sweep.dir) * e.sweep.dist * prog;
      const bz = e.sweep.from.z + Math.sin(e.sweep.dir) * e.sweep.dist * prog;
      e.x = bx; e.z = bz;
      const cands = this.spatial.query(bx, bz, e.r + 1);
      for (const o of cands) {
        if (o.husk || (o.side === side) || o.side === NEUTRAL) continue;
        if (o.kind === 'unit' && o.garrisonedIn) continue;
        if (dist(bx, bz, o.x, o.z) <= e.r) this._applyDamage(null, o, 'beam', e.dps * dtv, side);
      }
    };
  }
  _superNuke(side, x, z) {
    // 3s flight; 600 explosion r10 + radiation r10 20dps 30s
    setTimeoutSim(this, 3, () => {
      this._explodeRadius(x, z, 600, 'explosion', 10, 16, side);
      this._addEffect({ kind: 'radiation', x, z, r: 10, dps: 20, life: 30, side });
      this._emit('superImpact', { side, key: 'nuclearMissile', x, z });
      this._emit('hit', { x, z, weapon: 'explosion', radius: 16 });
    });
  }
  _superViper(side, x, z) {
    // 9 rockets over 8s scattered r8, 120 explosion each + toxin pools
    for (let i = 0; i < 9; i++) {
      const delay = (i / 9) * 8;
      const ox = x + (this.rng() * 2 - 1) * 8;
      const oz = z + (this.rng() * 2 - 1) * 8;
      setTimeoutSim(this, delay, () => {
        this._explode(ox, oz, 120, 'explosion', 4, side);
        this._addEffect({ kind: 'toxin', x: ox, z: oz, r: 3, dps: 15, life: 8, side });
        this._emit('hit', { x: ox, z: oz, weapon: 'explosion', radius: 4 });
        if (i === 8) this._emit('superImpact', { side, key: 'viperStorm', x, z });
      });
    }
    this._emit('superImpact', { side, key: 'viperStorm', x, z });
  }
  _explodeRadius(x, z, dmg, type, core, falloffR, side) {
    const cands = this.spatial.query(x, z, falloffR + 2);
    for (const o of cands) {
      if (o.husk || o.side === side || o.side === NEUTRAL) continue;
      if (o.kind === 'unit' && o.garrisonedIn) continue;
      const d = dist(x, z, o.x, o.z);
      if (d <= falloffR) {
        const m = d <= core ? 1 : 1 - ((d - core) / (falloffR - core)) * 0.6;
        this._applyDamage(null, o, type, dmg * m, side);
      }
    }
  }

  // ─── Win / lose ──────────────────────────────────────────────────────────────
  _checkWinLose() {
    if (this.state && this.state.over) return;
    const structs = { player: 0, enemy: 0 };
    for (const e of this.entities.values()) {
      if (e.kind === 'structure' && (e.side === PLAYER || e.side === ENEMY) && e.hp > 0) structs[e.side]++;
    }
    let winner = null;
    if (structs.player === 0 && structs.enemy > 0) winner = ENEMY;
    else if (structs.enemy === 0 && structs.player > 0) winner = PLAYER;
    else if (structs.player === 0 && structs.enemy === 0) winner = PLAYER; // tie → player (shouldn't happen)
    // only declare once both sides have had structures (avoid frame-0)
    if (winner && this.time > 0.1) {
      const ps = this.sides[PLAYER];
      const stats = {
        ...ps.stats,
        moneyEarned: Math.round(ps.stats.moneyEarned),
        time: this.time,
        rank: Math.max(1, ps.rank),
      };
      this._over = { winner, stats };
      this._emit('gameOver', { winner, stats });
      this._eva(winner === PLAYER ? 'victory' : 'defeat');
      if (this.state) this.state.over = { winner, stats };
    }
  }

  // ─── Destruction ─────────────────────────────────────────────────────────────
  _destroy(e, suppressHusk = false) {
    if (!this.entities.has(e.id)) return;
    if (e.hp > 0 && e.kind !== 'crate') e.hp = 0;
    // evict garrison
    if (e.garrisonList && e.garrisonList.length) {
      for (const id of [...e.garrisonList]) { const o = this.entities.get(id); if (o) this._evictOccupant(e, o, true); }
    }
    if (e.kind === 'unit') {
      if (this.sides[e.side]) { this.sides[e.side].pop -= e.def.pop; this.sides[e.side].stats.unitsLost++; }
      if (e.def.hero) this.sides[e.side].heroAlive = false;
      // remove from any garrison it was in
      if (e.garrisonedIn) { const host = this.entities.get(e.garrisonedIn); if (host) host.garrisonList = host.garrisonList.filter(i => i !== e.id); }
    }
    if (e.kind === 'structure' && e.side !== NEUTRAL) {
      this._markCellsBlocked(e, false);
    }
    this._emit('death', { id: e.id, x: e.x, z: e.z, key: e.key, kind: e.kind, side: e.side });
    this.entities.delete(e.id);
    if (e.kind === 'structure' && e.side !== NEUTRAL) this._recomputePower(e.side);
  }

  // ─── Garrison helpers ────────────────────────────────────────────────────────
  _evictOccupant(host, occ, killed = false) {
    host.garrisonList = host.garrisonList.filter(i => i !== occ.id);
    occ.garrisonedIn = null;
    if (killed || occ.hp <= 0) { this.sides[occ.side] && (this.sides[occ.side].pop -= occ.def.pop); this.entities.delete(occ.id); this._emit('death', { id: occ.id, x: occ.x, z: occ.z, key: occ.key, kind: 'unit', side: occ.side }); }
    else { occ.x = host.x + (this.rng() * 2 - 1) * 2; occ.z = host.z + (this.rng() * 2 - 1) * 2; }
    this._emit('garrisonChange', { id: host.id });
  }

  // ─── Power cooldowns ─────────────────────────────────────────────────────────
  _tickPowerCooldowns(dt) {
    for (const side of [PLAYER, ENEMY]) {
      const cd = this.sides[side].powerCd;
      for (const k in cd) if (cd[k] > 0) cd[k] = Math.max(0, cd[k] - dt);
    }
    // oil derrick income
    for (const e of this.entities.values()) {
      if (e.key === 'oilDerrick' && (e.side === PLAYER || e.side === ENEMY)) {
        e.oilTimer = (e.oilTimer || 3) - dt;
        if (e.oilTimer <= 0) { e.oilTimer += 3; this._addMoney(e.side, 20); }
      }
    }
  }

  // ─── COMMAND DISPATCH ────────────────────────────────────────────────────────
  issue(side, cmd) {
    if (!cmd || !cmd.type) return { ok: false, reason: 'no command' };
    if (this.state && this.state.over) return { ok: false, reason: 'game over' };
    try {
      switch (cmd.type) {
        case 'build': return this._cmdBuild(side, cmd);
        case 'queueUnit': return this._cmdQueueUnit(side, cmd);
        case 'cancelQueue': return this._cmdCancelQueue(side, cmd);
        case 'setRally': return this._cmdSetRally(side, cmd);
        case 'move': return this._cmdMove(side, cmd);
        case 'attack': return this._cmdAttack(side, cmd);
        case 'attackMove': return this._cmdAttackMove(side, cmd);
        case 'stop': return this._cmdStop(side, cmd);
        case 'guard': return this._cmdGuard(side, cmd);
        case 'capture': return this._cmdCapture(side, cmd);
        case 'garrison': return this._cmdGarrison(side, cmd);
        case 'evacuate': return this._cmdEvacuate(side, cmd);
        case 'harvest': return this._cmdHarvest(side, cmd);
        case 'repairTarget': return this._cmdRepair(side, cmd);
        case 'sell': return this._cmdSell(side, cmd);
        case 'upgrade': return this._cmdUpgrade(side, cmd);
        case 'ability': return this._cmdAbility(side, cmd);
        case 'choosePower': return this._cmdChoosePower(side, cmd);
        case 'usePower': return this._cmdUsePower(side, cmd);
        case 'fireSuper': return this._fireSuper(side, cmd.x, cmd.z);
        default: return { ok: false, reason: 'unknown command' };
      }
    } catch (e) {
      return { ok: false, reason: 'exception: ' + e.message };
    }
  }

  // placement / prereq validation — exposed for ghost validation
  canPlace(side, key, x, z) {
    const f = this.faction[side];
    const def = FACTIONS[f].structures[key];
    if (!def) return { ok: false, reason: 'unknown structure' };
    // prereq
    const preq = this._checkPrereq(side, def);
    if (!preq.ok) return preq;
    // border
    if (Math.abs(x) > PLAYABLE || Math.abs(z) > PLAYABLE) return { ok: false, reason: 'too close to border' };
    const r = this._structRadius(key);
    // blocked terrain
    if (this._terrainBlocked(x, z)) return { ok: false, reason: 'blocked terrain' };
    // overlap with entities
    for (const e of this.entities.values()) {
      if (e.kind === 'structure' || (e.kind === 'unit' && e.def && e.def.builder)) {
        const minSep = (e.radius || 1) + r;
        if (e.kind === 'structure' && dist(e.x, e.z, x, z) < minSep) return { ok: false, reason: 'overlaps structure' };
      }
    }
    return { ok: true };
  }

  _checkPrereq(side, def) {
    if (!def.requires) return { ok: true };
    const have = (k) => {
      for (const e of this.entities.values())
        if (e.side === side && e.kind === 'structure' && e.key === k && e.building == null) return true;
      return false;
    };
    if (typeof def.requires === 'string') {
      if (!have(def.requires)) return { ok: false, reason: 'requires ' + def.requires };
    } else if (def.requires.any) {
      if (!def.requires.any.some(have)) return { ok: false, reason: 'requires one of ' + def.requires.any.join('/') };
    }
    return { ok: true };
  }

  _cmdBuild(side, { builderId, key, x, z }) {
    const builder = this.entities.get(builderId);
    if (!builder || builder.side !== side || !builder.def.builder) return { ok: false, reason: 'no builder' };
    const can = this.canPlace(side, key, x, z);
    if (!can.ok) return can;
    const def = FACTIONS[this.faction[side]].structures[key];
    const s = this.sides[side];
    if (s.money < def.cost) return { ok: false, reason: 'insufficient funds' };
    s.money -= def.cost;
    const struct = this._spawnStructure(side, key, x, z, false);
    builder.build = struct.id;
    builder.repairTarget = null; builder.captureTarget = null; builder.attackTarget = null;
    builder.collector && (builder.collector.phase = 'building');
    this._emit('constructionStart', { id: struct.id });
    return { ok: true, id: struct.id };
  }

  _cmdQueueUnit(side, { structureId, key }) {
    const st = this.entities.get(structureId);
    if (!st || st.side !== side || st.building != null) return { ok: false, reason: 'no structure' };
    if (!st.def.builds || !st.def.builds.includes(key)) return { ok: false, reason: 'cannot build here' };
    const def = FACTIONS[this.faction[side]].units[key];
    // tech prereq for unit
    if (def.requires) {
      const pr = this._checkPrereq(side, def);
      if (!pr.ok) return pr;
    }
    const s = this.sides[side];
    if (def.hero && s.heroAlive) return { ok: false, reason: 'hero already alive' };
    if (s.money < def.cost) return { ok: false, reason: 'insufficient funds' };
    if (st.queue.length >= 9) return { ok: false, reason: 'queue full' };
    s.money -= def.cost;
    st.queue.push({ key, progress: 0 });
    return { ok: true };
  }

  _cmdCancelQueue(side, { structureId, index }) {
    const st = this.entities.get(structureId);
    if (!st || st.side !== side) return { ok: false, reason: 'no structure' };
    const idx = index == null ? st.queue.length - 1 : index;
    if (idx < 0 || idx >= st.queue.length) return { ok: false, reason: 'bad index' };
    const job = st.queue.splice(idx, 1)[0];
    const def = FACTIONS[this.faction[side]].units[job.key];
    this.sides[side].money += def.cost; // refund
    return { ok: true };
  }

  _cmdSetRally(side, { structureId, x, z }) {
    const st = this.entities.get(structureId);
    if (!st || st.side !== side) return { ok: false, reason: 'no structure' };
    st.rally = { x, z };
    return { ok: true };
  }

  _selOwn(side, ids) {
    const out = [];
    for (const id of ids || []) { const e = this.entities.get(id); if (e && e.side === side && e.kind === 'unit') out.push(e); }
    return out;
  }

  _cmdMove(side, { ids, x, z }) {
    const us = this._selOwn(side, ids);
    if (!us.length) return { ok: false, reason: 'no units' };
    this._orderMove(ids, x, z, side);
    return { ok: true };
  }
  _orderMove(ids, x, z, side) {
    const us = this._selOwn(side, ids);
    let i = 0;
    for (const u of us) {
      if (u.deployed) { u.deployed = false; u.deployTimer = 0; } // un-deploy hacker
      // spread destinations slightly to reduce clumping
      const ox = x + (i % 3 - 1) * 1.2, oz = z + (Math.floor(i / 3) % 3 - 1) * 1.2;
      u.moveGoal = { x: clamp(ox, -PLAYABLE, PLAYABLE), z: clamp(oz, -PLAYABLE, PLAYABLE) };
      u.path = null; u.pathGoal = null; u.attackTarget = null; u.attackMove = null; u.guardPos = null; u.captureTarget = null;
      u.state = 'moving';
      i++;
    }
  }

  _cmdAttack(side, { ids, targetId }) {
    const us = this._selOwn(side, ids);
    const t = this.entities.get(targetId);
    if (!us.length) return { ok: false, reason: 'no units' };
    if (!t) return { ok: false, reason: 'no target' };
    for (const u of us) {
      if (!this._hasWeapon(u)) continue;
      u.attackTarget = targetId; u.moveGoal = null; u.attackMove = null; u.guardPos = null; u.deployed = false;
      u.state = 'attacking';
    }
    return { ok: true };
  }

  _cmdAttackMove(side, { ids, x, z }) {
    const us = this._selOwn(side, ids);
    if (!us.length) return { ok: false, reason: 'no units' };
    for (const u of us) {
      u.attackMove = { x, z }; u.moveGoal = { x, z }; u.path = null; u.attackTarget = null; u.guardPos = null;
      u.state = 'moving';
    }
    return { ok: true };
  }

  _cmdStop(side, { ids }) {
    for (const u of this._selOwn(side, ids)) {
      u.moveGoal = null; u.path = null; u.attackTarget = null; u.attackMove = null; u.guardPos = null; u.captureTarget = null;
      u.state = 'idle';
    }
    return { ok: true };
  }

  _cmdGuard(side, { ids }) {
    for (const u of this._selOwn(side, ids)) {
      u.guardPos = { x: u.x, z: u.z }; u.moveGoal = null; u.path = null; u.attackTarget = null; u.attackMove = null;
      u.state = 'idle';
    }
    return { ok: true };
  }

  _cmdCapture(side, { id, targetId }) {
    const u = this.entities.get(id);
    const t = this.entities.get(targetId);
    if (!u || u.side !== side || !u.def.capture) return { ok: false, reason: 'cannot capture' };
    if (!t) return { ok: false, reason: 'no target' };
    const capturable = t.key === 'oilDerrick' || (t.kind === 'structure' && t.side !== side && t.side !== NEUTRAL && t.def && t.def.builds);
    if (!capturable) return { ok: false, reason: 'not capturable' };
    u.captureTarget = targetId; u.moveGoal = null; u.attackTarget = null; u.state = 'moving';
    return { ok: true };
  }

  _cmdGarrison(side, { ids, targetId }) {
    const t = this.entities.get(targetId);
    if (!t || (t.garrisonSlots || 0) <= 0) return { ok: false, reason: 'not garrisonable' };
    if (t.side !== side && t.side !== NEUTRAL) return { ok: false, reason: 'enemy building' };
    const us = this._selOwn(side, ids).filter(u => u.def.armor === 'infantry' && !u.def.builder);
    if (!us.length) return { ok: false, reason: 'no infantry' };
    for (const u of us) {
      if (t.garrisonList.length >= t.garrisonSlots) break;
      // must be near; for simplicity move then enter when adjacent — do immediate if close, else set intent
      u.garrisonIntent = targetId; u.moveGoal = { x: t.x, z: t.z }; u.path = null; u.state = 'moving';
    }
    return { ok: true };
  }

  _processGarrisonIntents() {
    for (const u of this.entities.values()) {
      if (u.kind !== 'unit' || !u.garrisonIntent || u.garrisonedIn) continue;
      const t = this.entities.get(u.garrisonIntent);
      if (!t || (t.side !== u.side && t.side !== NEUTRAL)) { u.garrisonIntent = null; continue; }
      if (dist(u.x, u.z, t.x, t.z) <= t.radius + 1.8) {
        if (t.garrisonList.length < t.garrisonSlots) {
          // neutral civ building becomes owned by garrisoner
          if (t.side === NEUTRAL && t.key === 'civBuilding') { t.side = u.side; t.faction = this.faction[u.side]; }
          t.garrisonList.push(u.id);
          u.garrisonedIn = t.id; u.garrisonIntent = null; u.moveGoal = null; u.state = 'garrisoned';
          this._emit('garrisonChange', { id: t.id });
        } else u.garrisonIntent = null;
      }
    }
  }

  _cmdEvacuate(side, { id }) {
    const t = this.entities.get(id);
    if (!t || t.side !== side || !t.garrisonList || !t.garrisonList.length) return { ok: false, reason: 'nothing to evac' };
    for (const oid of [...t.garrisonList]) {
      const o = this.entities.get(oid);
      if (o) { o.garrisonedIn = null; o.x = t.x + (this.rng() * 2 - 1) * 2; o.z = t.z + (this.rng() * 2 - 1) * 2; o.state = 'idle'; }
    }
    t.garrisonList = [];
    if (t.key === 'civBuilding') { t.side = NEUTRAL; t.faction = null; }
    this._emit('garrisonChange', { id: t.id });
    return { ok: true };
  }

  _cmdHarvest(side, { ids, dockId }) {
    const us = this._selOwn(side, ids).filter(u => u.collector);
    if (!us.length) return { ok: false, reason: 'no collector' };
    const dock = this.entities.get(dockId);
    for (const u of us) {
      if (dock) { u.collector.dockId = dockId; u.collector.phase = 'toDock'; u.build = null; this._orderMove([u.id], dock.x, dock.z, side); }
      else this._autoHarvest(u);
    }
    return { ok: true };
  }

  _cmdRepair(side, { id, targetId }) {
    const u = this.entities.get(id);
    const t = this.entities.get(targetId);
    if (!u || u.side !== side || !u.def.builder) return { ok: false, reason: 'not a dozer' };
    if (!t || t.side !== side || t.kind !== 'structure') return { ok: false, reason: 'bad target' };
    u.repairTarget = targetId; u.build = null; u.moveGoal = null; u.state = 'moving';
    return { ok: true };
  }

  _cmdSell(side, { id }) {
    const e = this.entities.get(id);
    if (!e || e.side !== side || e.kind !== 'structure') return { ok: false, reason: 'cannot sell' };
    const refund = Math.round((e.def.cost || 0) * 0.5 * (e.building != null ? (e.building || 0) : 1));
    this._addMoney(side, refund);
    this._emit('sold', { id });
    this._destroy(e);
    return { ok: true, refund };
  }

  _cmdUpgrade(side, { structureId, key }) {
    const st = this.entities.get(structureId);
    const upg = FACTIONS[this.faction[side]].upgrades[key];
    if (!upg) return { ok: false, reason: 'unknown upgrade' };
    if (!st || st.side !== side || st.key !== upg.at || st.building != null) return { ok: false, reason: 'wrong structure' };
    const s = this.sides[side];
    if (s.upgrades[key]) return { ok: false, reason: 'already researched' };
    if (s.money < upg.cost) return { ok: false, reason: 'insufficient funds' };
    s.money -= upg.cost;
    s.upgrades[key] = true;
    if (key === 'controlRods') this._recomputePower(side);
    this._emit('upgradeComplete', { side, key });
    return { ok: true };
  }

  _cmdAbility(side, { id, abilityKey, x, z, targetId }) {
    const u = this.entities.get(id);
    if (!u || u.side !== side) return { ok: false, reason: 'no unit' };
    if (!u.def.abilities || !u.def.abilities.includes(abilityKey)) return { ok: false, reason: 'no such ability' };
    if ((u.abilityCd[abilityKey] || 0) > 0) return { ok: false, reason: 'on cooldown' };
    switch (abilityKey) {
      case 'flashbang': {
        u.abilityCd.flashbang = 15;
        const near = this.spatial.query(x ?? u.x, z ?? u.z, 4);
        for (const o of near) if (o.kind === 'structure' && o.garrisonList && o.garrisonList.length && dist(x ?? u.x, z ?? u.z, o.x, o.z) <= 3) this._cmdEvacuate(o.side, { id: o.id });
        this._emit('hit', { x: x ?? u.x, z: z ?? u.z, weapon: 'flashbang', radius: 3 });
        return { ok: true };
      }
      case 'c4': {
        u.abilityCd.c4 = 20;
        const t = this.entities.get(targetId);
        if (!t || t.kind !== 'structure') return { ok: false, reason: 'need structure target' };
        // 10s plant+fuse
        setTimeoutSim(this, 10, () => { if (this.entities.has(t.id)) this._applyDamage(u, t, 'explosion', 1200 / 1.1, u.side); this._emit('hit', { x: t.x, z: t.z, weapon: 'explosion', radius: 3 }); });
        return { ok: true };
      }
      case 'knife': {
        u.abilityCd.knife = 1;
        const t = this.entities.get(targetId);
        if (t && t.kind === 'unit' && t.def.armor === 'infantry' && dist(u.x, u.z, t.x, t.z) <= 2) this._destroy(t);
        return { ok: true };
      }
      case 'deploy': {
        u.deployed = false; u.deployTimer = 3; u.moveGoal = null; u.path = null; u.state = 'idle';
        return { ok: true };
      }
      case 'disable': {
        u.abilityCd.disable = 20;
        const cands = this.spatial.query(x ?? u.x, z ?? u.z, 10);
        for (const o of cands) if (o.side !== side && o.side !== NEUTRAL && (o.kind === 'structure' || o.def.armor !== 'infantry') && dist(x ?? u.x, z ?? u.z, o.x, o.z) <= 10) { o.disabled = Math.max(o.disabled || 0, 15); }
        return { ok: true };
      }
      case 'cashHack': {
        u.abilityCd.cashHack = 45;
        const t = this.entities.get(targetId);
        if (t && t.def && t.def.deposit && t.side !== side && dist(u.x, u.z, t.x, t.z) <= 8) {
          this._addMoney(side, 1000);
          return { ok: true };
        }
        return { ok: false, reason: 'no enemy supply center in range' };
      }
      case 'crewSnipe': {
        u.abilityCd.crewSnipe = 20;
        const t = this.entities.get(targetId);
        if (t && t.kind === 'unit' && (t.def.armor === 'lightVehicle' || t.def.armor === 'tank') && dist(u.x, u.z, t.x, t.z) <= u.def.weapon.range) {
          this._makeHusk(t);
          return { ok: true };
        }
        return { ok: false, reason: 'no vehicle target' };
      }
    }
    return { ok: false, reason: 'unhandled ability' };
  }

  _makeHusk(t) {
    this.sides[t.side] && (this.sides[t.side].pop -= t.def.pop);
    t.side = NEUTRAL; t.husk = true; t.kind = 'husk'; t.attackTarget = null; t.moveGoal = null; t.path = null;
    t.state = 'idle'; t.hp = Math.max(1, t.hp * 0.5);
    this._emit('husk', { id: t.id });
  }

  // claiming husks: infantry adjacent for 2s → vehicle joins their side
  _tickHusks(dt) {
    for (const h of this.entities.values()) {
      if (h.kind !== 'husk') continue;
      const near = this.spatial.query(h.x, h.z, 2);
      const claimer = near.find(o => o.kind === 'unit' && o.def.armor === 'infantry' && !o.def.builder && o.side !== NEUTRAL && dist(h.x, h.z, o.x, o.z) <= 1.8);
      if (claimer) {
        h.claimT = (h.claimT || 0) + dt;
        if (h.claimT >= 2) {
          h.husk = false; h.kind = 'unit'; h.side = claimer.side; h.faction = this.faction[claimer.side];
          h.hp = h.maxHp; this.sides[h.side].pop += h.def.pop;
          h.claimT = 0;
          // consume claimer
          this._destroy(claimer);
          this._emit('captureComplete', { id: h.id, newSide: h.side });
        }
      } else h.claimT = 0;
    }
  }

  _cmdChoosePower(side, { key }) {
    const s = this.sides[side];
    const pdef = FACTIONS[s.faction].powers[key];
    if (!pdef) return { ok: false, reason: 'unknown power' };
    const cur = s.powers[key] || 0;
    const maxLevel = pdef.levels || 1;
    if (cur >= maxLevel) return { ok: false, reason: 'maxed' };
    const cost = pdef.points || 1;
    if (pdef.rank && s.rank < pdef.rank) return { ok: false, reason: 'rank too low' };
    if (s.points - s.pointsSpent < cost) return { ok: false, reason: 'not enough points' };
    s.pointsSpent += cost;
    s.powers[key] = cur + 1;
    // passive powers apply immediately
    if (key === 'cashBounty') s.cashBounty = [0, 0.05, 0.10, 0.20][s.powers[key]];
    return { ok: true };
  }

  _cmdUsePower(side, { key, x, z }) {
    const s = this.sides[side];
    const pdef = FACTIONS[s.faction].powers[key];
    if (!pdef) return { ok: false, reason: 'unknown power' };
    const level = s.powers[key] || 0;
    if (level <= 0) return { ok: false, reason: 'power not chosen' };
    if (pdef.passive) return { ok: false, reason: 'passive power' };
    if ((s.powerCd[key] || 0) > 0) return { ok: false, reason: 'on cooldown' };
    s.powerCd[key] = pdef.cd;
    this._emit('powerUsed', { side, key, x, z, level });
    this._applyPower(side, key, level, x, z);
    return { ok: true };
  }

  _applyPower(side, key, level, x, z) {
    const enemySide = side === PLAYER ? ENEMY : PLAYER;
    switch (key) {
      case 'spyDrone': this._revealFog(this.fogGrid[side], x, z, 12); break;
      case 'paradrop': {
        const n = [4, 8, 14][level - 1];
        for (let i = 0; i < n; i++) this._spawnUnit(side, 'trooper', x + (this.rng() * 2 - 1) * 4, z + (this.rng() * 2 - 1) * 4);
        break;
      }
      case 'strikeWing': {
        const n = level;
        for (let i = 0; i < n; i++) {
          const ox = x + (i - n / 2) * 3;
          setTimeoutSim(this, i * 0.3, () => { this._explode(ox, z, 150, 'missile', 3, side); this._emit('hit', { x: ox, z, weapon: 'missile', radius: 3 }); });
        }
        break;
      }
      case 'fuelAir': setTimeoutSim(this, 0.5, () => { this._explode(x, z, 600, 'bomb', 10, side); this._addEffect({ kind: 'fire', x, z, r: 10, dps: 20, life: 6, side }); this._emit('hit', { x, z, weapon: 'bomb', radius: 10 }); }); break;
      case 'artilleryBarrage': {
        const n = [12, 24, 36][level - 1];
        for (let i = 0; i < n; i++) {
          const ox = x + (this.rng() * 2 - 1) * 8, oz = z + (this.rng() * 2 - 1) * 8;
          setTimeoutSim(this, (i / n) * 4, () => { this._explode(ox, oz, 40, 'explosion', 3, side); this._emit('hit', { x: ox, z: oz, weapon: 'explosion', radius: 3 }); });
        }
        break;
      }
      case 'cashHack': {
        const amt = [1000, 2000, 4000][level - 1];
        // target enemy supply center
        const sc = this._nearestStructure(enemySide, x, z, k => k === 'supplyCenter' || k === 'supplyStash');
        if (sc && dist(sc.x, sc.z, x, z) < 10) { this._addMoney(side, amt); }
        else this._addMoney(side, Math.round(amt / 2));
        break;
      }
      case 'clusterMines': {
        for (let i = 0; i < 12; i++) {
          const ox = x + (this.rng() * 2 - 1) * 8, oz = z + (this.rng() * 2 - 1) * 8;
          this._addEffect({ kind: 'mine', x: ox, z: oz, r: 2, dps: 0, life: 9999, side, dmg: 100 });
        }
        break;
      }
      case 'empBomb': {
        const cands = this.spatial.query(x, z, 12);
        for (const o of cands) if (o.side === enemySide && (o.kind === 'structure' || o.def.armor !== 'infantry') && dist(x, z, o.x, o.z) <= 12) o.disabled = 20;
        break;
      }
      case 'ambush': {
        const n = [4, 8, 16][level - 1];
        for (let i = 0; i < n; i++) this._spawnUnit(side, 'militant', x + (this.rng() * 2 - 1) * 4, z + (this.rng() * 2 - 1) * 4);
        break;
      }
      case 'sneakAttack': {
        // temporary tunnel exit — spawn a short-lived tunnel structure
        const t = this._spawnStructure(side, 'tunnel', x, z, true);
        t.temporary = 60;
        break;
      }
      case 'anthraxBomb': setTimeoutSim(this, 0.5, () => { this._explode(x, z, 350, 'toxin', 10, side); this._addEffect({ kind: 'toxin', x, z, r: 10, dps: 20, life: 15, side }); this._emit('hit', { x, z, weapon: 'toxin', radius: 10 }); }); break;
    }
  }

  // ─── State snapshot ──────────────────────────────────────────────────────────
  _entitySnapshot(e) {
    const snap = {
      id: e.id, side: e.side, kind: e.kind, key: e.key, faction: e.faction,
      x: e.x, z: e.z, angle: e.angle, hp: e.hp, maxHp: e.maxHp,
      vet: e.vet || 0, sel: e.radius || 0.6,
      visible: e.side === PLAYER || this._snapVisible(e),
    };
    if (e.kind === 'structure') {
      if (e.building != null) snap.building = e.building;
      if (e.queue && e.queue.length) snap.queue = e.queue.map(j => ({ key: j.key, progress: j.progress || 0 }));
      if (e.rally) snap.rally = e.rally;
      if (e.garrisonList && e.garrisonList.length) snap.garrison = [...e.garrisonList];
      snap.powered = e.powered !== false;
      if (e.disabled > 0) snap.disabled = e.disabled;
      if (e.capture) snap.capture = { by: e.capture.by, progress: e.capture.progress };
      if (e.amount != null) snap.amount = e.amount;
    } else if (e.kind === 'unit' || e.kind === 'husk') {
      snap.state = e.state;
      if (e.carrying) snap.carrying = e.carrying;
      if (e.cargo && e.cargo.length) snap.cargo = [...e.cargo];
      if (e.stealthed) snap.stealthed = true;
      if (e.salvage) snap.salvage = e.salvage;
      if (e.disabled > 0) snap.disabled = e.disabled;
    }
    return snap;
  }

  _snapVisible(e) {
    if (e.side === PLAYER) return true;
    if (e.side === NEUTRAL) return this._isInFog(e.x, e.z, PLAYER) || e.kind === 'structure';
    // enemy/AI units: visible if in player fog AND (not stealthed OR detected)
    if (!this._isInFog(e.x, e.z, PLAYER)) return false;
    if (e.stealthed && !this._isVisibleTo(e, PLAYER)) return false;
    return true;
  }

  _sideSnapshot(side, publicOnly) {
    const s = this.sides[side];
    if (publicOnly) {
      return {
        faction: s.faction, rank: s.rank,
        super: s.super ? { charge: s.super.charge, total: s.super.total, ready: s.super.ready } : null,
      };
    }
    return {
      faction: s.faction, money: Math.floor(s.money),
      powerOut: s.powerOut, powerUse: s.powerUse, lowPower: s.lowPower, radar: s.radar,
      pop: s.pop, popCap: s.popCap,
      rank: s.rank, xp: s.rankXp, nextXp: RANK_THRESHOLDS[Math.min(s.rank + 1, RANK_THRESHOLDS.length - 1)],
      points: s.points - s.pointsSpent, powers: { ...s.powers }, powerCd: { ...s.powerCd },
      super: s.super ? { id: s.super.id, charge: s.super.charge, total: s.super.total, ready: s.super.ready } : null,
      upgrades: { ...s.upgrades }, income: s.incomeRecent,
    };
  }

  _rebuildState() {
    const entities = [];
    for (const e of this.entities.values()) entities.push(this._entitySnapshot(e));
    this.state = {
      time: this.time,
      over: this._over || null,
      player: this._sideSnapshot(PLAYER, false),
      enemy: this._sideSnapshot(ENEMY, true),
      entities,
    };
  }

  // Internal scheduled callbacks (sim-time, deterministic). Stored on game.
  _runScheduled(dt) {
    if (!this._scheduled) return;
    for (let i = this._scheduled.length - 1; i >= 0; i--) {
      const s = this._scheduled[i];
      s.t -= dt;
      if (s.t <= 0) { this._scheduled.splice(i, 1); try { s.fn(); } catch (e) {} }
    }
  }
}

// Sim-time scheduler helper (deterministic; ticked inside Game.tick via _runScheduled).
function setTimeoutSim(game, delay, fn) {
  if (!game._scheduled) game._scheduled = [];
  game._scheduled.push({ t: delay, fn });
}

// ─── IRON COMMAND — Game Simulation Core ────────────────────────────────────
// Pure ES module. Zero imports from three/gfx/ui. Runs under plain node.

import {
  BOARD_HALF_X, BOARD_HALF_Z,
  PLAYER, ENEMY,
  DEPLOY_Z_MIN, DEPLOY_Z_MAX,
  BASE_HP, BASE_TURRET_RANGE, BASE_TURRET_DPS, BASE_Z,
  TIBERIUM_FIELDS, TIBERIUM_HARVEST_RADIUS, TIBERIUM_HARVEST_INCOME,
  STARTING_CREDITS, PASSIVE_INCOME_RATE,
  PAD_POSITIONS, PAD_CAPTURE_RADIUS, PAD_CAPTURE_TIME,
  NUKE_CHARGE_2_PADS, NUKE_CHARGE_3_PADS, NUKE_DAMAGE, NUKE_FLIGHT_TIME,
  SIGHT_RANGE, SEPARATION_RADIUS, STEALTH_DETECT_RADIUS, HOLD_CHASE_LIMIT,
  PROJ_SPEED, PROJ_SPLASH_RADIUS,
  DMG_TABLE,
} from './constants.js';
import { GENERALS } from './units.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _nextId = 1;
function uid() { return _nextId++; }

function dist2(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return dx * dx + dz * dz;
}
function dist(ax, az, bx, bz) { return Math.sqrt(dist2(ax, az, bx, bz)); }

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/** Return the damage multiplier from the table (0 if invalid). */
function dmgMult(dmgType, armorClass) {
  return DMG_TABLE[dmgType]?.[armorClass] ?? 0;
}

// ─── Game ─────────────────────────────────────────────────────────────────────

export class Game {
  /**
   * @param {{ playerGeneral: string, aiGeneral: string, difficulty: string }} cfg
   */
  constructor({ playerGeneral, aiGeneral, difficulty = 'hard' }) {
    _nextId = 1; // reset for determinism per game

    this._listeners = {};  // event → [fn]

    // Generals
    this._genDef  = {
      player: GENERALS[playerGeneral],
      enemy:  GENERALS[aiGeneral],
    };
    this._genKey = { player: playerGeneral, enemy: aiGeneral };

    // State
    this.state = {
      time: 0,
      credits: { player: STARTING_CREDITS, enemy: STARTING_CREDITS },
      baseHp:  { player: BASE_HP, enemy: BASE_HP },
      nuke:    { player: 0, enemy: 0 },
      pads: PAD_POSITIONS.map((p, i) => ({
        id: i, x: p.x, z: p.z,
        owner: null,
        progress: 0,          // 0..1 capture progress (contract field for UI)
        captureTimer: 0,      // seconds toward capture (for current contester)
        contesting: null,     // 'player'|'enemy'|null (who is currently advancing)
      })),
      cooldowns: {
        player: this._zeroCooldowns(playerGeneral),
        enemy:  this._zeroCooldowns(aiGeneral),
      },
      powerCd: { player: 0, enemy: 0 },
      units: [],
      over: null,
    };

    // Internal bookkeeping
    this._units      = new Map();   // id → unit (same objects as state.units)
    this._projectiles = [];          // in-flight
    this._burnZones  = [];           // { x, z, radius, dps, timeLeft }
    this._nukeInFlight = { player: false, enemy: false };
    this._turretFire = { player: 0, enemy: 0 }; // cooldown accumulator

    // Warlord aura cache
    this._auraActive = { player: false, enemy: false };
  }

  // ─── Event emitter ──────────────────────────────────────────────────────────

  on(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
    return this;
  }

  _emit(event, payload) {
    const fns = this._listeners[event];
    if (!fns) return;
    for (const fn of fns) fn(payload);
  }

  // ─── Cooldown helpers ───────────────────────────────────────────────────────

  _zeroCooldowns(genKey) {
    const out = {};
    const g = GENERALS[genKey];
    for (const k of g.units) out[k] = 0;
    return out;
  }

  _genUnitDef(genKey, unitKey) {
    return GENERALS[genKey].unitDefs[unitKey] ?? null;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Deploy a unit. Returns the created unit object or null on failure.
   * side: 'player'|'enemy'
   * unitKey: string
   * x, z: world position
   */
  deploy(side, unitKey, x, z) {
    if (this.state.over) return null;

    const genKey = this._genKey[side];
    const unitDef = this._genUnitDef(genKey, unitKey);
    if (!unitDef) return null;

    // Zone validation
    const zSign = side === PLAYER ? 1 : -1;
    const absZ  = z * zSign;
    if (absZ < DEPLOY_Z_MIN || absZ > DEPLOY_Z_MAX) return null;
    if (Math.abs(x) > BOARD_HALF_X) return null;

    // Credits check
    if (this.state.credits[side] < unitDef.cost) return null;

    // Cooldown check
    const cdLeft = this.state.cooldowns[side][unitKey] ?? 0;
    if (cdLeft > 0) return null;

    // Hero: only one alive at a time
    if (unitDef.hero) {
      const alive = this.state.units.find(u => u.side === side && u.def.hero);
      if (alive) return null;
    }

    // Deduct cost and reset cooldown
    this.state.credits[side] -= unitDef.cost;
    this.state.cooldowns[side][unitKey] = unitDef.buildCooldown;

    // Create unit
    const unit = {
      id:        uid(),
      side,
      key:       unitKey,
      def:       unitDef,
      x:         clamp(x, -BOARD_HALF_X + 0.5, BOARD_HALF_X - 0.5),
      z:         clamp(z, -BOARD_HALF_Z + 0.5, BOARD_HALF_Z - 0.5),
      hp:        unitDef.hp,
      maxHp:     unitDef.hp,
      facing:    side === PLAYER ? Math.PI : 0,  // player faces enemy side
      state:     'idle',
      targetId:  null,
      stunned:   false,
      stealthed: unitDef.stealth,
      // Internal
      _stunTimer:    0,
      _attackTimer:  0,   // time until next shot
      _moveOrder:    null, // { x, z } or null
      _harvesting:   false,
      _harvestField: null,
    };

    this._units.set(unit.id, unit);
    this.state.units.push(unit);
    this._emit('spawn', { unit });

    return unit;
  }

  /**
   * Issue a move-and-hold order. Works for any side (player UI calls this;
   * AI calls _orderMoveInternal directly to bypass the player-only guard).
   * The public-facing API is player-only per contract.
   */
  orderMove(unitId, x, z) {
    const unit = this._units.get(unitId);
    if (!unit || unit.side !== PLAYER) return;
    this._orderMoveInternal(unit, x, z);
  }

  /** Internal: set move-and-hold on any unit regardless of side. */
  _orderMoveInternal(unit, x, z) {
    unit._moveOrder = { x: clamp(x, -BOARD_HALF_X, BOARD_HALF_X), z: clamp(z, -BOARD_HALF_Z, BOARD_HALF_Z) };
    unit.state = 'moving';
    unit.targetId = null;
  }

  /**
   * Use general power. Returns true on success.
   */
  usePower(side, x, z) {
    if (this.state.over) return false;
    if (this.state.powerCd[side] > 0) return false;

    const genKey = this._genKey[side];
    const power  = GENERALS[genKey].power;
    this.state.powerCd[side] = power.cd;

    this._applyPower(side, genKey, power, x, z);
    this._emit('powerUsed', { side, key: power.key, x, z });
    return true;
  }

  // ─── Main tick ──────────────────────────────────────────────────────────────

  tick(dt) {
    if (this.state.over) return;
    this.state.time += dt;

    this._tickCooldowns(dt);
    this._tickEconomy(dt);
    this._tickPads(dt);
    this._tickNuke(dt);
    this._tickUnits(dt);
    this._tickProjectiles(dt);
    this._tickBurnZones(dt);
    this._tickBaseTurrets(dt);
  }

  // ─── Cooldowns ──────────────────────────────────────────────────────────────

  _tickCooldowns(dt) {
    for (const side of [PLAYER, ENEMY]) {
      const cds = this.state.cooldowns[side];
      for (const k in cds) {
        if (cds[k] > 0) cds[k] = Math.max(0, cds[k] - dt);
      }
      if (this.state.powerCd[side] > 0)
        this.state.powerCd[side] = Math.max(0, this.state.powerCd[side] - dt);
    }
  }

  // ─── Economy ────────────────────────────────────────────────────────────────

  _tickEconomy(dt) {
    for (const side of [PLAYER, ENEMY]) {
      this.state.credits[side] += PASSIVE_INCOME_RATE * dt;
    }
    // Harvester income
    for (const unit of this.state.units) {
      if (!unit.def.isHarvester) continue;
      const field = this._nearestField(unit.x, unit.z);
      if (field && dist(unit.x, unit.z, field.x, field.z) <= TIBERIUM_HARVEST_RADIUS) {
        // Check only 1 effective harvester per field per side
        if (!this._fieldHarvested(unit.side, field, unit.id)) {
          this.state.credits[unit.side] += TIBERIUM_HARVEST_INCOME * dt;
          unit._harvesting = true;
        }
      } else {
        unit._harvesting = false;
      }
    }
  }

  _nearestField(x, z) {
    let best = null, bd = Infinity;
    for (const f of TIBERIUM_FIELDS) {
      const d = dist2(x, z, f.x, f.z);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }

  _fieldHarvested(side, field, excludeId) {
    // Returns true if another harvester of this side is already harvesting this field
    for (const u of this.state.units) {
      if (u.id === excludeId) continue;
      if (u.side !== side) continue;
      if (!u.def.isHarvester) continue;
      if (u._harvesting && dist(u.x, u.z, field.x, field.z) <= TIBERIUM_HARVEST_RADIUS)
        return true;
    }
    return false;
  }

  // ─── Missile pads ───────────────────────────────────────────────────────────

  _tickPads(dt) {
    for (const pad of this.state.pads) {
      // Count ground units per side within capture radius
      let pc = 0, ec = 0;
      for (const u of this.state.units) {
        if (u.def.armorClass === 'air') continue;
        if (dist(u.x, u.z, pad.x, pad.z) <= PAD_CAPTURE_RADIUS) {
          if (u.side === PLAYER) pc++;
          else ec++;
        }
      }

      const contested  = pc > 0 && ec > 0;
      const playerOnly = pc > 0 && ec === 0;
      const enemyOnly  = ec > 0 && pc === 0;

      if (contested) {
        // Pause timer, keep current state
        continue;
      }

      const contester = playerOnly ? PLAYER : enemyOnly ? ENEMY : null;

      if (!contester) {
        // Nobody here — don't reset, just pause
        continue;
      }

      // If the pad already belongs to this side, no need to capture
      if (pad.owner === contester) continue;

      // Accumulate capture time
      if (pad.contesting !== contester) {
        // New contester resets timer
        pad.captureTimer = 0;
        pad.contesting = contester;
      }
      pad.captureTimer += dt;
      pad.progress = Math.min(1, pad.captureTimer / PAD_CAPTURE_TIME);

      if (pad.captureTimer >= PAD_CAPTURE_TIME) {
        const prev = pad.owner;
        pad.owner = contester;
        pad.captureTimer = 0;
        pad.progress = 0;
        pad.contesting = null;
        if (prev !== contester) {
          this._emit('padCaptured', { pad, owner: contester });
        }
      }
    }
  }

  // ─── Nuke ───────────────────────────────────────────────────────────────────

  _tickNuke(dt) {
    for (const side of [PLAYER, ENEMY]) {
      const ownedPads = this.state.pads.filter(p => p.owner === side).length;
      if (ownedPads >= 3) {
        this.state.nuke[side] = Math.min(100, this.state.nuke[side] + NUKE_CHARGE_3_PADS * dt);
      } else if (ownedPads >= 2) {
        this.state.nuke[side] = Math.min(100, this.state.nuke[side] + NUKE_CHARGE_2_PADS * dt);
      }

      if (this.state.nuke[side] >= 100 && !this._nukeInFlight[side]) {
        this._fireNuke(side);
      }
    }
  }

  _fireNuke(side) {
    this._nukeInFlight[side] = true;
    this.state.nuke[side] = 0;
    const targetSide = side === PLAYER ? ENEMY : PLAYER;
    const impactZ = BASE_Z[targetSide];
    this._emit('nukeLaunch', { side, impactZ });

    // Schedule impact
    this._projectiles.push({
      type:       'nuke',
      side,
      x:          0,
      z:          BASE_Z[side],
      targetX:    0,
      targetZ:    impactZ,
      flightTime: NUKE_FLIGHT_TIME,
      elapsed:    0,
    });
  }

  // ─── Unit AI & movement ─────────────────────────────────────────────────────

  _tickUnits(dt) {
    // Update stun timers
    for (const u of this.state.units) {
      if (u.stunned) {
        u._stunTimer -= dt;
        if (u._stunTimer <= 0) { u.stunned = false; u._stunTimer = 0; }
      }
    }

    // Update Warlord aura
    this._updateAuras();

    // Move & attack
    for (const u of this.state.units) {
      if (u.stunned) { u.state = 'idle'; continue; }

      if (u.def.isHarvester) {
        this._tickHarvester(u, dt);
      } else {
        this._tickCombatUnit(u, dt);
      }
    }

    // Pairwise separation (ground units only)
    this._applySeparation(dt);
  }

  _updateAuras() {
    for (const side of [PLAYER, ENEMY]) {
      const warlord = this.state.units.find(u => u.side === side && u.def.aura?.type === 'warlord' && u.hp > 0);
      this._auraActive[side] = warlord ?? null;
    }
  }

  /** Returns the effective dps of a unit, including Warlord aura buff. */
  _effectiveDps(unit) {
    if (unit.stunned) return 0;
    let dps = unit.def.dps;
    const warlord = this._auraActive[unit.side];
    if (warlord && unit.def.armorClass === 'infantry') {
      const d = dist(unit.x, unit.z, warlord.x, warlord.z);
      if (d <= warlord.def.aura.radius) {
        dps *= warlord.def.aura.mult;
      }
    }
    return dps;
  }

  _tickHarvester(unit, dt) {
    // Navigate to nearest tiberium field on friendly side
    const sideZ = unit.side === PLAYER ? 1 : -1;
    let target = null;
    for (const f of TIBERIUM_FIELDS) {
      if (f.z * sideZ > 0) { target = f; break; }
    }
    if (!target) return;

    const d = dist(unit.x, unit.z, target.x, target.z);
    if (d > TIBERIUM_HARVEST_RADIUS * 0.8) {
      this._moveToward(unit, target.x, target.z, dt);
      unit.state = 'moving';
    } else {
      unit.state = 'idle';
    }
  }

  _tickCombatUnit(unit, dt) {
    // Stealth detection: break stealth if within 2 tiles of any enemy or while attacking
    if (unit.stealthed) {
      let detected = false;
      for (const e of this.state.units) {
        if (e.side === unit.side) continue;
        if (dist(unit.x, unit.z, e.x, e.z) <= STEALTH_DETECT_RADIUS) { detected = true; break; }
      }
      unit.stealthed = !detected;
    }

    // Check if we've arrived at move-and-hold destination
    if (unit._moveOrder) {
      const od = dist(unit.x, unit.z, unit._moveOrder.x, unit._moveOrder.z);
      if (od < 0.2) {
        unit._moveOrder = null;
      }
    }

    // Find a real combat target (enemy unit)
    const combatTarget = this._pickCombatTarget(unit);

    if (combatTarget) {
      // Break stealth while attacking
      if (unit.stealthed) unit.stealthed = false;

      const td = dist(unit.x, unit.z, combatTarget.x, combatTarget.z);
      const inRange = td <= unit.def.range && (!unit.def.minRange || td >= unit.def.minRange);

      // Move-and-hold: don't chase beyond HOLD_CHASE_LIMIT past the order position
      let shouldChase = true;
      if (unit._moveOrder) {
        const distFromOrder = dist(unit.x, unit.z, unit._moveOrder.x, unit._moveOrder.z);
        if (distFromOrder > HOLD_CHASE_LIMIT) shouldChase = false;
      }

      if (inRange) {
        unit.state = 'attacking';
        unit.targetId = combatTarget.id;
        this._tickAttack(unit, combatTarget, dt);
      } else if (shouldChase) {
        unit.state = 'moving';
        unit.targetId = combatTarget.id;
        this._moveToward(unit, combatTarget.x, combatTarget.z, dt);
      } else {
        // Hold: still attack if in range from hold position
        unit.state = 'idle';
        unit.targetId = null;
      }
      return;
    }

    // No combat target — follow move order or advance via navigation target
    if (unit._moveOrder) {
      unit.state = 'moving';
      unit.targetId = null;
      this._moveToward(unit, unit._moveOrder.x, unit._moveOrder.z, dt);
      return;
    }

    // Advance toward nav target: nearest uncaptured pad, then enemy base
    const navTarget = this._pickNavTarget(unit);
    if (navTarget) {
      const td = dist(unit.x, unit.z, navTarget.x, navTarget.z);

      if (navTarget._isBase && td <= unit.def.range && unit.def.dps > 0) {
        // Attack base directly
        unit.state = 'attacking';
        unit.targetId = navTarget.id;
        this._tickAttack(unit, navTarget, dt);
      } else {
        unit.state = 'moving';
        unit.targetId = null;
        this._moveToward(unit, navTarget.x, navTarget.z, dt);
      }
    } else {
      unit.state = 'idle';
      unit.targetId = null;
    }
  }

  /** Pick nearest attackable enemy unit in sight range. Returns unit or null. */
  _pickCombatTarget(unit) {
    let best = null, bd = Infinity;
    for (const e of this.state.units) {
      if (e.side === unit.side) continue;
      if (e.hp <= 0) continue;
      // Air-targeting check
      if (e.def.armorClass === 'air' && !unit.def.canTargetAir) continue;
      // Stealth: can only target stealthed units within STEALTH_DETECT_RADIUS
      if (e.stealthed) {
        const sd = dist(unit.x, unit.z, e.x, e.z);
        if (sd > STEALTH_DETECT_RADIUS) continue;
      }
      const d = dist(unit.x, unit.z, e.x, e.z);
      if (d > SIGHT_RANGE) continue;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  /**
   * Pick a navigation (non-combat) target:
   * 1. Nearest uncaptured/enemy pad (ground only)
   * 2. Enemy base
   */
  _pickNavTarget(unit) {
    const oppSide = unit.side === PLAYER ? ENEMY : PLAYER;

    // Pad priority (ground units only)
    if (unit.def.armorClass !== 'air') {
      let padBest = null, padDist = Infinity;
      for (const pad of this.state.pads) {
        if (pad.owner === unit.side) continue;
        const d = dist(unit.x, unit.z, pad.x, pad.z);
        if (d < padDist) { padDist = d; padBest = pad; }
      }
      if (padBest) {
        return { id: `pad_${padBest.id}`, _isPad: true, x: padBest.x, z: padBest.z };
      }
    }

    // Enemy base
    const bz = BASE_Z[oppSide];
    return {
      id: `base_${oppSide}`,
      _isBase: true,
      side: oppSide,
      x: 0, z: bz,
      hp: this.state.baseHp[oppSide],
      maxHp: BASE_HP,
      def: { armorClass: 'building', damageType: null },
      stealthed: false,
    };
  }

  _moveToward(unit, tx, tz, dt) {
    const dx = tx - unit.x, dz = tz - unit.z;
    const d  = Math.sqrt(dx * dx + dz * dz);
    if (d < 0.01) return;
    const speed = unit.stunned ? 0 : unit.def.speed;
    const step  = Math.min(speed * dt, d);
    unit.x += (dx / d) * step;
    unit.z += (dz / d) * step;
    unit.facing = Math.atan2(dx, dz);
    // Clamp to board
    unit.x = clamp(unit.x, -BOARD_HALF_X + 0.3, BOARD_HALF_X - 0.3);
    unit.z = clamp(unit.z, -BOARD_HALF_Z + 0.3, BOARD_HALF_Z - 0.3);
  }

  _tickAttack(unit, target, dt) {
    if (!unit.def.dps || !unit.def.damageType) return;
    const effectiveDps = this._effectiveDps(unit);
    if (effectiveDps <= 0) return;

    unit._attackTimer -= dt;
    if (unit._attackTimer > 0) return;

    // Reset cadence timer
    unit._attackTimer = unit.def.cadence;

    const dmgPerShot = effectiveDps * unit.def.cadence;
    const dmgType    = unit.def.damageType;
    const projSpeed  = PROJ_SPEED[dmgType];

    // Emit facing update
    if (target.id !== null) {
      unit.facing = Math.atan2(target.x - unit.x, target.z - unit.z);
    }

    if (projSpeed === 0 || dmgType === 'bullet') {
      // Instant hit
      this._applyHit(unit.side, target.id, dmgPerShot, dmgType, unit.x, unit.z, target.x, target.z);
      this._emit('attack', { unit, target: target.id !== null ? target : null });
    } else {
      const d = dist(unit.x, unit.z, target.x, target.z);
      const flightTime = d / projSpeed;
      this._projectiles.push({
        type:       'unit',
        side:       unit.side,
        fromUnit:   unit,
        targetId:   target.id,
        dmgPerShot,
        dmgType,
        x:          unit.x, z: unit.z,
        targetX:    target.x, targetZ: target.z,
        flightTime,
        elapsed:    0,
      });
      this._emit('attack', { unit, target: target.id !== null ? target : null });
      this._emit('projectile', {
        from:       { x: unit.x, z: unit.z },
        to:         { x: target.x, z: target.z },
        dmgType,
        flightTime,
        targetAir:  target.def?.armorClass === 'air',
      });
    }
  }

  _applyHit(attackerSide, targetId, rawDmg, dmgType, fromX, fromZ, atX, atZ) {
    const targetSide = attackerSide === PLAYER ? ENEMY : PLAYER;

    if (!targetId) {
      // Hit at position (e.g. base)
      this._damageBase(targetSide, rawDmg, dmgType, atX, atZ);
      return;
    }

    if (typeof targetId === 'string' && targetId.startsWith('base_')) {
      const side = targetId.replace('base_', '');
      this._damageBase(side, rawDmg, dmgType, atX, atZ);
      return;
    }

    const target = this._units.get(targetId);
    if (!target || target.hp <= 0) return;

    const mult = dmgMult(dmgType, target.def.armorClass);
    const actual = rawDmg * mult;
    if (actual <= 0) return;

    target.hp -= actual;
    this._emit('hit', { x: target.x, z: target.z, dmgType });

    if (target.hp <= 0) {
      this._killUnit(target);
    }
  }

  _damageBase(side, rawDmg, dmgType, x, z) {
    const mult = dmgMult(dmgType, 'building');
    const actual = rawDmg * mult;
    if (actual <= 0) return;
    this.state.baseHp[side] = Math.max(0, this.state.baseHp[side] - actual);
    this._emit('baseHit', { side });
    this._emit('hit', { x, z, dmgType });
    if (this.state.baseHp[side] <= 0 && !this.state.over) {
      const winner = side === PLAYER ? ENEMY : PLAYER;
      this.state.over = { winner };
      this._emit('gameOver', { winner });
    }
  }

  _killUnit(unit) {
    unit.hp = 0;
    unit.state = 'idle';
    this._emit('death', { unit });
    this._units.delete(unit.id);
    const idx = this.state.units.indexOf(unit);
    if (idx !== -1) this.state.units.splice(idx, 1);
  }

  // ─── Pairwise separation ─────────────────────────────────────────────────────

  _applySeparation(dt) {
    const ground = this.state.units.filter(u => u.def.armorClass !== 'air');
    for (let i = 0; i < ground.length; i++) {
      for (let j = i + 1; j < ground.length; j++) {
        const a = ground[i], b = ground[j];
        const dx = a.x - b.x, dz = a.z - b.z;
        const d2 = dx * dx + dz * dz;
        const minD = SEPARATION_RADIUS * 2;
        if (d2 < minD * minD && d2 > 0.0001) {
          const d    = Math.sqrt(d2);
          const push = (minD - d) * 0.5;
          const nx = dx / d, nz = dz / d;
          a.x += nx * push; a.z += nz * push;
          b.x -= nx * push; b.z -= nz * push;
          a.x = clamp(a.x, -BOARD_HALF_X + 0.3, BOARD_HALF_X - 0.3);
          a.z = clamp(a.z, -BOARD_HALF_Z + 0.3, BOARD_HALF_Z - 0.3);
          b.x = clamp(b.x, -BOARD_HALF_X + 0.3, BOARD_HALF_X - 0.3);
          b.z = clamp(b.z, -BOARD_HALF_Z + 0.3, BOARD_HALF_Z - 0.3);
        }
      }
    }
  }

  // ─── Projectiles ─────────────────────────────────────────────────────────────

  _tickProjectiles(dt) {
    const done = [];
    for (const p of this._projectiles) {
      p.elapsed += dt;
      if (p.elapsed >= p.flightTime) {
        done.push(p);
      }
    }

    for (const p of done) {
      this._projectiles.splice(this._projectiles.indexOf(p), 1);
      this._landProjectile(p);
    }
  }

  _landProjectile(p) {
    if (p.type === 'nuke') {
      // Nuclear impact
      const side = p.side === PLAYER ? ENEMY : PLAYER;
      this.state.baseHp[side] = Math.max(0, this.state.baseHp[side] - NUKE_DAMAGE);
      this._nukeInFlight[p.side] = false;
      this._emit('nukeImpact', { x: p.targetX, z: p.targetZ });
      this._emit('baseHit', { side });
      if (this.state.baseHp[side] <= 0 && !this.state.over) {
        const winner = p.side;
        this.state.over = { winner };
        this._emit('gameOver', { winner });
      }
      return;
    }

    if (p.type === 'power_shell') {
      // Artillery barrage shell
      this._splashDamage(p.side, p.targetX, p.targetZ, p.dmg, p.dmgType, 0.5);
      this._emit('hit', { x: p.targetX, z: p.targetZ, dmgType: p.dmgType });
      return;
    }

    if (p.type === 'napalm') {
      // Napalm line — apply hit at impact, create burn zone
      this._splashDamage(p.side, p.targetX, p.targetZ, p.dmg, 'flame', 1.2);
      this._burnZones.push({ x: p.targetX, z: p.targetZ, radius: 1.2, dps: 20, timeLeft: 5, side: p.side });
      this._emit('hit', { x: p.targetX, z: p.targetZ, dmgType: 'flame' });
      return;
    }

    // Normal unit projectile
    const targetDead = !p.targetId || !this._units.has(p.targetId);
    if (targetDead) {
      // Redirect to units within splash radius
      let hit = false;
      for (const u of this.state.units) {
        if (u.side === p.side) continue;
        if (dist(u.x, u.z, p.targetX, p.targetZ) <= PROJ_SPLASH_RADIUS) {
          this._applyHit(p.side, u.id, p.dmgPerShot, p.dmgType, p.x, p.z, u.x, u.z);
          hit = true;
          break; // only one
        }
      }
      if (!hit) {
        this._emit('hit', { x: p.targetX, z: p.targetZ, dmgType: p.dmgType });
      }
    } else {
      this._applyHit(p.side, p.targetId, p.dmgPerShot, p.dmgType, p.x, p.z, p.targetX, p.targetZ);
    }
  }

  _splashDamage(attackerSide, cx, cz, dmg, dmgType, radius) {
    const oppSide = attackerSide === PLAYER ? ENEMY : PLAYER;
    for (const u of [...this.state.units]) {
      if (u.side === attackerSide) continue;
      if (dist(u.x, u.z, cx, cz) <= radius) {
        this._applyHit(attackerSide, u.id, dmg, dmgType, cx, cz, u.x, u.z);
      }
    }
    // Also damage base if near
    const bz = BASE_Z[oppSide];
    if (dist(cx, cz, 0, bz) <= radius) {
      this._damageBase(oppSide, dmg, dmgType, cx, cz);
    }
  }

  // ─── Burn zones ──────────────────────────────────────────────────────────────

  _tickBurnZones(dt) {
    for (let i = this._burnZones.length - 1; i >= 0; i--) {
      const bz = this._burnZones[i];
      bz.timeLeft -= dt;
      // Apply burn to enemy units in zone
      for (const u of [...this.state.units]) {
        if (u.side === bz.side) continue;
        if (dist(u.x, u.z, bz.x, bz.z) <= bz.radius) {
          const actual = bz.dps * dt * dmgMult('flame', u.def.armorClass);
          if (actual > 0) {
            u.hp -= actual;
            if (u.hp <= 0) this._killUnit(u);
          }
        }
      }
      if (bz.timeLeft <= 0) this._burnZones.splice(i, 1);
    }
  }

  // ─── Base turrets ────────────────────────────────────────────────────────────

  _tickBaseTurrets(dt) {
    for (const side of [PLAYER, ENEMY]) {
      if (this.state.baseHp[side] <= 0) continue;
      const oppSide = side === PLAYER ? ENEMY : PLAYER;
      const bz = BASE_Z[side];

      // Find nearest enemy unit in range
      let target = null, bd = Infinity;
      for (const u of this.state.units) {
        if (u.side === side) continue;
        const d = dist(u.x, u.z, 0, bz);
        if (d <= BASE_TURRET_RANGE && d < bd) {
          bd = d; target = u;
        }
      }
      if (!target) continue;

      // Accumulate damage
      this._turretFire[side] = (this._turretFire[side] ?? 0) + BASE_TURRET_DPS * dt;
      // Fire in bursts each ~0.75s equivalent
      if (this._turretFire[side] >= BASE_TURRET_DPS * 0.75) {
        const dmg = this._turretFire[side];
        this._turretFire[side] = 0;
        // Turret uses bullet damage
        const mult = dmgMult('bullet', target.def.armorClass);
        target.hp -= dmg * mult;
        this._emit('attack', { unit: { id: `turret_${side}`, side, x: 0, z: bz, def: { damageType: 'bullet' } }, target });
        this._emit('hit', { x: target.x, z: target.z, dmgType: 'bullet' });
        if (target.hp <= 0) this._killUnit(target);
      }
    }
  }

  // ─── General powers ──────────────────────────────────────────────────────────

  _applyPower(side, genKey, power, x, z) {
    if (genKey === 'steel') {
      // Artillery Barrage: 8 shells over 2s in 3-tile radius
      for (let i = 0; i < 8; i++) {
        const angle  = Math.random() * Math.PI * 2;
        const r      = Math.random() * power.radius;
        const sx = x + Math.cos(angle) * r;
        const sz = z + Math.sin(angle) * r;
        this._projectiles.push({
          type:      'power_shell',
          side,
          targetX:   sx, targetZ: sz,
          dmg:       80,
          dmgType:   'cannon',
          flightTime: 2.0 * (i / 8) + 0.5 + Math.random() * 0.3,
          elapsed:   0,
        });
      }
    } else if (genKey === 'phantom') {
      // EMP Strike: stun enemy vehicles & air in 4-tile radius for 6s
      for (const u of this.state.units) {
        if (u.side === side) continue;
        if (u.def.armorClass !== 'vehicle' && u.def.armorClass !== 'air') continue;
        if (dist(u.x, u.z, x, z) <= power.radius) {
          u.stunned = true;
          u._stunTimer = 6;
        }
      }
      this._emit('hit', { x, z, dmgType: 'missile' }); // EMP visual hint
    } else if (genKey === 'hammer') {
      // Napalm Run: strafe a 6×2 tile line; 150 flame dmg + burn 20dps/5s
      // Line runs along x-axis at target z, ±3 tiles
      const segments = 6;
      for (let i = 0; i < segments; i++) {
        const segX = (x - 3) + i + 0.5;
        this._projectiles.push({
          type:      'napalm',
          side,
          targetX:   segX,
          targetZ:   z,
          dmg:       150 / segments,
          flightTime: 0.3 + i * 0.25,
          elapsed:   0,
        });
      }
    }
  }
}

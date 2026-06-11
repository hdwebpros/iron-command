// ─── IRON COMMAND — AI Controller ───────────────────────────────────────────
// Pure ES module. Zero imports from gfx/ui/three.

import {
  PLAYER, ENEMY,
  AI_THINK_INTERVAL, AI_INCOME_MULT,
  PAD_POSITIONS, DEPLOY_Z_MIN, DEPLOY_Z_MAX,
  DMG_TABLE, BOARD_HALF_X,
} from './constants.js';
import { GENERALS } from './units.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dist(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

function rnd(lo, hi) { return lo + Math.random() * (hi - lo); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/**
 * Score how well `attackerDmgType` counters a given armorClass.
 * Higher = better counter.
 */
function counterScore(attackerDmgType, armorClass) {
  return DMG_TABLE[attackerDmgType]?.[armorClass] ?? 0;
}

/**
 * Return the best damage type to deploy against a set of enemy unit armorClasses.
 * Returns the unit key from the general's roster that best counters them.
 */
function bestCounterKey(genKey, enemyArmorClasses, exclude = new Set()) {
  const unitKeys = GENERALS[genKey].units.filter(k => !exclude.has(k));
  if (!unitKeys.length) return null;

  const armorCounts = {};
  for (const ac of enemyArmorClasses) armorCounts[ac] = (armorCounts[ac] ?? 0) + 1;

  let bestKey = null, bestScore = -Infinity;
  for (const k of unitKeys) {
    const def = GENERALS[genKey].unitDefs[k];
    if (!def || def.isHarvester || def.hero) continue;
    let score = 0;
    for (const [ac, cnt] of Object.entries(armorCounts)) {
      score += counterScore(def.damageType, ac) * cnt;
    }
    if (score > bestScore) { bestScore = score; bestKey = k; }
  }
  return bestKey;
}

// ─── AIController ─────────────────────────────────────────────────────────────

export class AIController {
  /**
   * @param {import('./game.js').Game} game
   * @param {'player'|'enemy'} side       - Which side this AI controls
   * @param {'easy'|'hard'|'brutal'} difficulty
   */
  constructor(game, side, difficulty) {
    this._game       = game;
    this._side       = side;
    this._oppSide    = side === PLAYER ? ENEMY : PLAYER;
    this._difficulty = difficulty;
    this._genKey     = game._genKey[side];
    this._genDef     = GENERALS[this._genKey];

    this._thinkInterval = AI_THINK_INTERVAL[difficulty];
    this._incomeMult    = AI_INCOME_MULT[difficulty];
    this._thinkTimer    = 0;

    // Bonus credits simulated by tracking extra injection each tick
    this._bonusAccum    = 0;

    // State
    this._harvesterDeployed = false;
    this._heroSaving        = false;
    this._retreatSet        = new Set();  // unit ids currently retreating
  }

  /**
   * Called every game tick. Must be called externally (from main.js or smoke test).
   */
  tick(dt) {
    if (this._game.state.over) return;

    // Income multiplier bonus: inject extra credits beyond baseline
    if (this._incomeMult !== 1.0) {
      this._bonusAccum += (this._incomeMult - 1.0) * 12 * dt; // 12 = PASSIVE_INCOME_RATE
      if (this._bonusAccum >= 1) {
        const add = Math.floor(this._bonusAccum);
        this._game.state.credits[this._side] += add;
        this._bonusAccum -= add;
      }
    }

    this._thinkTimer -= dt;
    if (this._thinkTimer > 0) {
      // Micro even between think ticks (brutal only)
      if (this._difficulty === 'brutal') {
        this._microRetreat();
      }
      return;
    }
    this._thinkTimer = this._thinkInterval;

    this._think();
  }

  _think() {
    const state    = this._game.state;
    const side     = this._side;
    const credits  = state.credits[side];
    const genKey   = this._genKey;

    // 1. Deploy harvester early
    if (!this._harvesterDeployed) {
      const hv = state.units.find(u => u.side === side && u.def.isHarvester);
      if (!hv) {
        const ok = this._tryDeploy('harvester');
        if (ok) this._harvesterDeployed = true;
      } else {
        this._harvesterDeployed = true;
      }
    }

    // 2. Decide whether to save for hero
    const heroDef = this._genDef.unitDefs[this._heroUnitKey()];
    const heroAlive = state.units.find(u => u.side === side && u.def.hero);
    const heroOnCd  = (state.cooldowns[side][this._heroUnitKey()] ?? 0) > 0;
    const shouldSaveForHero = this._shouldSaveHero(credits, heroDef);

    if (!heroAlive && !heroOnCd && credits >= heroDef.cost && this._difficulty !== 'easy') {
      this._tryDeploy(this._heroUnitKey());
      return;
    }

    // 3. Use power if ≥3 enemy units clustered
    if (state.powerCd[side] <= 0) {
      const target = this._findPowerTarget();
      if (target) {
        this._game.usePower(side, target.x, target.z);
      }
    }

    // 4. Contest pads: if brutal / hard, deploy toward pads
    const shouldContestPads = this._difficulty !== 'easy' || Math.random() > 0.5;

    // 5. Pick a unit to deploy
    if (!shouldSaveForHero || credits > heroDef.cost * 1.5) {
      const unitKey = this._pickUnit();
      if (unitKey) {
        const deployed = this._tryDeploy(unitKey);
        // If we wanted to contest a pad and deployed, issue a move order toward a contested pad
        if (deployed && shouldContestPads) {
          this._orderToPad(deployed);
        }
      }
    }

    // 6. Order units to contest pads
    if (shouldContestPads) {
      this._contestPads();
    }
  }

  _heroUnitKey() {
    // Last unit in the roster is always the hero
    return this._genDef.units[this._genDef.units.length - 1];
  }

  _shouldSaveHero(credits, heroDef) {
    if (this._difficulty === 'easy') return false;
    const heroOnCd = (this._game.state.cooldowns[this._side][this._heroUnitKey()] ?? 0) > 0;
    if (heroOnCd) return false;
    const heroAlive = this._game.state.units.find(u => u.side === this._side && u.def.hero);
    if (heroAlive) return false;
    // Save if within 1.5x hero cost range
    return credits >= heroDef.cost * 0.5;
  }

  _pickUnit() {
    const genKey   = this._genKey;
    const state    = this._game.state;
    const credits  = state.credits[this._side];
    const side     = this._side;

    // Get enemy armor classes on the field
    const enemyArmorClasses = state.units
      .filter(u => u.side === this._oppSide)
      .map(u => u.def.armorClass);

    // Filter affordable, off-cooldown, non-hero units
    const available = this._genDef.units.filter(k => {
      const def = this._genDef.unitDefs[k];
      if (!def || def.isHarvester || def.hero) return false;
      if (credits < def.cost) return false;
      if ((state.cooldowns[side][k] ?? 0) > 0) return false;
      return true;
    });
    if (!available.length) return null;

    if (this._difficulty === 'easy') {
      // 60% random, 40% counter
      if (Math.random() < 0.6) return pick(available);
      // counter
      const exclude = new Set(this._genDef.units.filter(k => !available.includes(k)));
      return bestCounterKey(genKey, enemyArmorClasses, exclude) ?? pick(available);
    }

    if (this._difficulty === 'hard') {
      const exclude = new Set(this._genDef.units.filter(k => !available.includes(k)));
      return bestCounterKey(genKey, enemyArmorClasses, exclude) ?? pick(available);
    }

    // brutal: perfect counters
    const exclude = new Set(this._genDef.units.filter(k => !available.includes(k)));
    return bestCounterKey(genKey, enemyArmorClasses, exclude) ?? available[0];
  }

  _tryDeploy(unitKey) {
    const def = this._genDef.unitDefs[unitKey];
    if (!def) return null;
    const state = this._game.state;
    if (state.credits[this._side] < def.cost) return null;
    if ((state.cooldowns[this._side][unitKey] ?? 0) > 0) return null;

    // Pick deployment position: enemy side rows
    // enemy side: z in [-9, -5]
    const zSign = this._side === PLAYER ? 1 : -1;
    const z = zSign * rnd(DEPLOY_Z_MIN, DEPLOY_Z_MAX);
    const x = rnd(-BOARD_HALF_X + 1, BOARD_HALF_X - 1);

    return this._game.deploy(this._side, unitKey, x, z);
  }

  _orderToPad(unit) {
    if (!unit) return;
    // Find nearest unowned / enemy pad
    const state = this._game.state;
    const pads  = state.pads.filter(p => p.owner !== this._side);
    if (!pads.length) return;
    let best = pads[0], bd = Infinity;
    for (const p of pads) {
      const d = dist(unit.x, unit.z, p.x, p.z);
      if (d < bd) { bd = d; best = p; }
    }
    this._game._orderMoveInternal(unit, best.x, best.z);
  }

  _contestPads() {
    const state = this._game.state;
    // For each pad not owned by us, order a nearby idle ground unit toward it
    const myUnits = state.units.filter(
      u => u.side === this._side && !u.def.isHarvester && u.def.armorClass !== 'air'
    );
    for (const pad of state.pads) {
      if (pad.owner === this._side) continue;
      const u = myUnits.find(u => u.state === 'idle' || u.state === 'moving');
      if (u) {
        this._game._orderMoveInternal(u, pad.x, pad.z);
      }
    }
  }

  _findPowerTarget() {
    // Find a cluster of ≥3 enemy units
    const enemies = this._game.state.units.filter(u => u.side === this._oppSide);
    if (enemies.length < 3) return null;

    // Try each enemy as a center and count nearby enemies
    const clusterRadius = 3;
    let bestCenter = null, bestCount = 0;
    for (const e of enemies) {
      let cnt = 0;
      for (const e2 of enemies) {
        if (dist(e.x, e.z, e2.x, e2.z) <= clusterRadius) cnt++;
      }
      if (cnt > bestCount) { bestCount = cnt; bestCenter = e; }
    }
    if (bestCount >= 3) return { x: bestCenter.x, z: bestCenter.z };
    return null;
  }

  _microRetreat() {
    // Brutal: pull ranged units below 25% hp back 2 tiles
    const myUnits = this._game.state.units.filter(u => u.side === this._side);
    for (const u of myUnits) {
      if (u.def.range <= 2.5) continue; // short-range units don't retreat
      const hpPct = u.hp / u.maxHp;
      if (hpPct < 0.25 && !this._retreatSet.has(u.id)) {
        this._retreatSet.add(u.id);
        // Move back 2 tiles toward own base
        const zSign  = this._side === PLAYER ? 1 : -1;
        const retreatZ = u.z + zSign * 2;
        this._game.orderMove(u.id, u.x, retreatZ);
      } else if (hpPct >= 0.4 && this._retreatSet.has(u.id)) {
        // Recovered enough — re-engage
        this._retreatSet.delete(u.id);
        u._moveOrder = null; // cancel hold order; let natural AI take over next tick
      }
    }
  }
}

// IRON COMMAND — sim self-test. Runs under plain `node` (proves sim purity:
// any three/DOM import would throw here). Drives a SCRIPTED bot for both sides
// across all 3 faction matchups, asserts the DESIGN §14 verification bar, prints
// a compact summary, exits 0 on success / 1 on failure.
//
// Run: node scripts/simtest.js

import { Game } from '../src/sim/game.js';
import { FACTIONS } from '../src/sim/factions.js';
import { MAP } from '../src/sim/map.js';

const TICK = 1 / 30;

// ─── Scripted driver ─────────────────────────────────────────────────────────
// Not the AI (ai.js is a stub). A deterministic build-order bot per side.
export class Driver {
  constructor(game, side) {
    this.game = game;
    this.side = side;
    this.f = game.faction[side];
    this.fd = FACTIONS[this.f];
    this.spawn = MAP.spawns[side];
    this.builtCount = 0;
    this.researched = false;
    this.powerChosen = false;
    this.powerUsed = false;
    this.superFired = false;
    this.t = 0;
    this.thinkAcc = 0;
    // Ordered build plan (key → relative placement offset from base).
    this.plan = this._buildPlan();
    this.planIdx = 0;
  }

  _buildPlan() {
    const powerKey = this.f === 'coalition' ? 'fusionReactor' : this.f === 'dominion' ? 'fissionReactor' : null;
    const supply = this.f === 'syndicate' ? 'supplyStash' : 'supplyCenter';
    const factory = this.f === 'syndicate' ? 'armsBazaar' : 'warFactory';
    const tech = this.fd.techKey;
    const superKey = this.fd.superKey;
    const def = this.f === 'coalition' ? 'aegis' : this.f === 'dominion' ? 'gatling' : 'stingerNest';
    const plan = [];
    if (this.superFocus) {
      // Rush the superweapon: power, economy, then tech + super ASAP.
      if (powerKey) plan.push(powerKey, powerKey, powerKey);
      plan.push(supply, 'barracks', factory, tech, superKey, def);
      return plan;
    }
    if (powerKey) plan.push(powerKey, powerKey);
    plan.push(supply, 'barracks', factory);
    if (powerKey) plan.push(powerKey);
    plan.push(def, tech, superKey);
    return plan;
  }

  _myStructs(key) {
    const out = [];
    for (const e of this.game.entities.values())
      if (e.side === this.side && e.kind === 'structure' && e.key === key && e.building == null) out.push(e);
    return out;
  }
  _myUnits(pred) {
    const out = [];
    for (const e of this.game.entities.values())
      if (e.side === this.side && e.kind === 'unit' && (!pred || pred(e))) out.push(e);
    return out;
  }
  _has(key) { return this._myStructs(key).length > 0; }

  _idleBuilder() {
    return this._myUnits(u => u.def.builder && !u.build && !u.repairTarget &&
      (!u.collector || u.collector.phase === 'idle' || u.collector.phase === 'building'))[0];
  }

  _placeNear(key, i) {
    // spiral placement around base, biased inward (toward center).
    const base = this.spawn;
    const toCenterX = base.x < 0 ? 1 : -1;
    const toCenterZ = base.z < 0 ? 1 : -1;
    const ring = 7 + (i % 6) * 2.5;
    const ang = (i * 1.3);
    let x = base.x + Math.cos(ang) * ring * 0.4 + toCenterX * (5 + i);
    let z = base.z + Math.sin(ang) * ring * 0.4 + toCenterZ * (5 + i);
    x = Math.max(-58, Math.min(58, x));
    z = Math.max(-58, Math.min(58, z));
    return { x, z };
  }

  tick(dt) {
    this.t += dt;
    this.thinkAcc += dt;
    if (this.thinkAcc < 0.5) return;
    this.thinkAcc = 0;
    const g = this.game;
    const s = g.sides[this.side];

    // 1. Ensure a collector economy.
    const collectorKey = this.fd.collector;
    const collectors = this._myUnits(u => u.collector);
    const deposit = this._myStructs(this.f === 'syndicate' ? 'supplyStash' : 'supplyCenter')[0] ||
                    this._myStructs('commandCenter')[0];
    if (collectors.length < 4 && deposit) {
      const prod = (this.f === 'syndicate')
        ? (this._myStructs('supplyStash')[0] || this._myStructs('commandCenter')[0])
        : this._myStructs('supplyCenter')[0];
      if (prod) g.issue(this.side, { type: 'queueUnit', structureId: prod.id, key: collectorKey });
    }

    // 2. Progress the build plan.
    if (this.planIdx < this.plan.length) {
      const key = this.plan[this.planIdx];
      // How many of this key the plan expects by now (handles duplicate reactors).
      let want = 0;
      for (let k = 0; k <= this.planIdx; k++) if (this.plan[k] === key) want++;
      const haveOrBuilding = [...g.entities.values()].filter(e =>
        e.side === this.side && e.kind === 'structure' && e.key === key).length;
      if (haveOrBuilding >= want) {
        this.planIdx++;
      } else {
        const builder = this._idleBuilder();
        if (builder) {
          const pos = this._placeNear(key, this.planIdx + this.builtCount);
          // search a few candidate spots
          let placed = false;
          for (let a = 0; a < 14 && !placed; a++) {
            const cand = this._placeNear(key, this.planIdx + this.builtCount + a * 3);
            const can = g.canPlace(this.side, key, cand.x, cand.z);
            if (can.ok && s.money >= this.fd.structures[key].cost) {
              const r = g.issue(this.side, { type: 'build', builderId: builder.id, key, x: cand.x, z: cand.z });
              if (r.ok) { placed = true; this.builtCount++; this.planIdx++; }
            }
          }
        }
      }
    }

    // 3. Research an upgrade once tech is up.
    if (!this.researched) {
      const upgKeys = Object.keys(this.fd.upgrades);
      for (const uk of upgKeys) {
        const at = this.fd.upgrades[uk].at;
        const st = this._myStructs(at)[0];
        if (st && s.money >= this.fd.upgrades[uk].cost) {
          const r = g.issue(this.side, { type: 'upgrade', structureId: st.id, key: uk });
          if (r.ok) { this.researched = true; break; }
        }
      }
    }

    // 4. Train army from barracks + factory.
    this._trainArmy();

    // 5. Choose & use a general power when points available.
    this._handlePowers();

    // 6. Capture an oil derrick with a rifle infantry.
    this._captureOil();

    // 7. Garrison a civ building near base.
    this._garrison();

    // 8. Send attack waves at enemy base (unless passive in a super-demo run).
    if (!this.passive) this._attack();

    // 9. Fire superweapon if ready.
    if (s.super && s.super.ready) {
      const target = this._enemyBaseCenter();
      const r = g.issue(this.side, { type: 'fireSuper', x: target.x, z: target.z });
      if (r.ok) this.superFired = true;
    }
  }

  _armyKeys() {
    // pick fighting units (have weapon, not hero by default, not collector/builder)
    const out = { barracks: [], factory: [] };
    const barK = this.fd.structures.barracks.builds;
    out.barracks = barK.filter(k => { const d = this.fd.units[k]; return d.weapon && !d.requires; });
    const facKey = this.f === 'syndicate' ? 'armsBazaar' : 'warFactory';
    const facBuilds = this.fd.structures[facKey].builds;
    out.factory = facBuilds.filter(k => { const d = this.fd.units[k]; return d.weapon && !d.requires; });
    out.facKey = facKey;
    return out;
  }

  _trainArmy() {
    const g = this.game; const s = g.sides[this.side];
    if (s.pop > s.popCap - 6) return;
    const ak = this._armyKeys();
    const bar = this._myStructs('barracks')[0];
    if (bar && ak.barracks.length) {
      const k = ak.barracks[(this.builtCount + Math.floor(this.t)) % ak.barracks.length];
      if (s.money >= this.fd.units[k].cost) g.issue(this.side, { type: 'queueUnit', structureId: bar.id, key: k });
    }
    const fac = this._myStructs(ak.facKey)[0];
    if (fac && ak.factory.length) {
      const k = ak.factory[(this.builtCount + Math.floor(this.t / 2)) % ak.factory.length];
      if (s.money >= this.fd.units[k].cost) g.issue(this.side, { type: 'queueUnit', structureId: fac.id, key: k });
    }
  }

  _handlePowers() {
    const g = this.game; const s = g.sides[this.side];
    const avail = s.points - s.pointsSpent;
    if (avail > 0) {
      // choose cheapest non-passive offensive power we can
      for (const pk of Object.keys(this.fd.powers)) {
        const pd = this.fd.powers[pk];
        if (pd.passive) continue;
        if (pd.rank && s.rank < pd.rank) continue;
        const cur = s.powers[pk] || 0;
        const maxL = pd.levels || 1;
        if (cur < maxL && avail >= (pd.points || 1)) {
          g.issue(this.side, { type: 'choosePower', key: pk });
          break;
        }
      }
    }
    // use a chosen offensive power on cooldown at enemy base
    for (const pk of Object.keys(s.powers)) {
      const pd = this.fd.powers[pk];
      if (pd.passive) continue;
      if ((s.powers[pk] || 0) <= 0) continue;
      if ((s.powerCd[pk] || 0) > 0) continue;
      const tgt = this._enemyBaseCenter();
      const r = g.issue(this.side, { type: 'usePower', key: pk, x: tgt.x, z: tgt.z });
      if (r.ok) { this.powerUsed = true; break; }
    }
  }

  _captureOil() {
    if (this._capturing) {
      const u = this.game.entities.get(this._capturing);
      if (u && u.captureTarget) return; // in progress
    }
    const g = this.game;
    let derrick = null, bd = Infinity;
    for (const e of g.entities.values()) {
      if (e.key === 'oilDerrick' && e.side === 'neutral') {
        const d = (e.x - this.spawn.x) ** 2 + (e.z - this.spawn.z) ** 2;
        if (d < bd) { bd = d; derrick = e; }
      }
    }
    if (!derrick) return;
    const rifle = this._myUnits(u => u.def.capture && !u.captureTarget && u.state !== 'capturing')[0];
    if (rifle) { g.issue(this.side, { type: 'capture', id: rifle.id, targetId: derrick.id }); this._capturing = rifle.id; }
  }

  _garrison() {
    if (this._garrisoned) return;
    const g = this.game;
    let civ = null, bd = Infinity;
    for (const e of g.entities.values()) {
      if (e.key === 'civBuilding' && (e.garrisonList ? e.garrisonList.length === 0 : true)) {
        const d = (e.x - this.spawn.x) ** 2 + (e.z - this.spawn.z) ** 2;
        if (d < bd) { bd = d; civ = e; }
      }
    }
    if (!civ) return;
    const inf = this._myUnits(u => u.def.armor === 'infantry' && u.def.weapon && !u.def.builder && !u.captureTarget && !u.garrisonedIn && !u.garrisonIntent);
    if (inf.length >= 1) {
      g.issue(this.side, { type: 'garrison', ids: inf.slice(0, 2).map(u => u.id), targetId: civ.id });
      this._garrisoned = true;
    }
  }

  _enemyBaseCenter() {
    const enemySide = this.side === 'player' ? 'enemy' : 'player';
    let sx = 0, sz = 0, n = 0;
    for (const e of this.game.entities.values()) {
      if (e.side === enemySide && e.kind === 'structure') { sx += e.x; sz += e.z; n++; }
    }
    if (n === 0) { const sp = MAP.spawns[enemySide]; return { x: sp.x, z: sp.z }; }
    return { x: sx / n, z: sz / n };
  }

  _attack() {
    const g = this.game;
    const army = this._myUnits(u => u.def.weapon && !u.def.builder && !u.collector && !u.def.hero &&
      !u.captureTarget && !u.garrisonedIn && !u.garrisonIntent &&
      (u.state === 'idle' || u.state === 'guard'));
    if (army.length >= 6) {
      const tgt = this._enemyBaseCenter();
      g.issue(this.side, { type: 'attackMove', ids: army.map(u => u.id), x: tgt.x, z: tgt.z });
    }
  }
}

// ─── Single matchup runner ───────────────────────────────────────────────────
export function runMatchup(pf, af, { maxSeconds = 600, overwhelm = false, seed = 1234, superDemo = false }) {
  const game = new Game({ playerFaction: pf, aiFaction: af, difficulty: 'hard', seed });
  const events = {
    spawn: 0, death: 0, attack: 0, projectile: 0, hit: 0,
    superBuilt: 0, superLaunch: 0, superImpact: 0, rankUp: 0,
    powerUsed: 0, captureComplete: 0, garrisonChange: 0, upgradeComplete: 0,
    constructionComplete: 0, gameOver: 0,
  };
  let gameOverWinner = null;
  let exception = null;
  for (const ev of Object.keys(events)) game.on(ev, () => { events[ev]++; });
  game.on('gameOver', (p) => { gameOverWinner = p.winner; });

  const dP = new Driver(game, 'player');
  const dE = new Driver(game, 'enemy');
  if (superDemo) {
    // Player rushes & fires its superweapon; enemy is passive and protected so
    // the match doesn't end before the super charges (240-300s).
    dP.superFocus = true;
    dP.passive = true;
    dE.passive = true;
  }

  // Track veterancy + money flow.
  let maxVet = 0;
  let moneyEverSpent = false;
  let moneyEverEarned = false;
  const startMoney = game.sides.player.money;
  let prevMoney = startMoney;

  // Overwhelm: give one side a big income + army boost so a winner is forced.
  const totalTicks = Math.ceil(maxSeconds / TICK);
  try {
    for (let i = 0; i < totalTicks; i++) {
      dP.tick(TICK);
      dE.tick(TICK);
      if (superDemo) {
        // Accelerate the player's economy so the $5000 super is affordable quickly
        // (sim-time, not wall-time — DESIGN allows running the loop as fast as node).
        game.sides.player.money += 80 * TICK;
        // Keep one enemy structure topped up so the game can't end early.
        for (const e of game.entities.values()) {
          if (e.kind === 'structure' && e.side === 'enemy' && e.def) { e.hp = e.maxHp; }
        }
      }
      if (overwhelm) {
        // Player side gets cash injection + extra production to break enemy.
        game.sides.player.money += 40 * TICK; // bonus income
        // late-game: free-spawn an attack force toward enemy base periodically
        if (i % Math.round(8 / TICK) === 0 && i > Math.round(60 / TICK)) {
          const sp = MAP.spawns.player;
          for (let k = 0; k < 6; k++) {
            const key = pf === 'coalition' ? 'paladin' : pf === 'dominion' ? 'warmaster' : 'scorpion';
            const u = game._spawnUnit('player', key, sp.x + (k - 3) * 2, sp.z + 4);
          }
        }
      }
      game.tick(TICK);

      // sample veterancy
      if (i % 30 === 0) {
        for (const e of game.entities.values()) if (e.kind === 'unit' && e.vet > maxVet) maxVet = e.vet;
        const m = game.sides.player.money;
        if (m < prevMoney) moneyEverSpent = true;
        if (m > prevMoney) moneyEverEarned = true;
        prevMoney = m;
      }
      if (game.state.over) { events.gameOver = events.gameOver || 1; break; }
    }
  } catch (e) {
    exception = e;
  }

  // count structures built per side (peak — count constructionComplete-ish via current+dead)
  const structNow = { player: 0, enemy: 0 };
  for (const e of game.entities.values())
    if (e.kind === 'structure' && (e.side === 'player' || e.side === 'enemy')) structNow[e.side]++;

  // final veterancy sweep
  for (const e of game.entities.values()) if (e.kind === 'unit' && e.vet > maxVet) maxVet = e.vet;

  return {
    game, events, exception, gameOverWinner, maxVet,
    moneyEverSpent, moneyEverEarned,
    structNow,
    builtPlayer: dP.builtCount, builtEnemy: dE.builtCount,
    powerUsedPlayer: dP.powerUsed || dE.powerUsed,
    capturePlayer: events.captureComplete,
    finalTime: game.time,
    drivers: { dP, dE },
  };
}

// ─── Assertions harness ──────────────────────────────────────────────────────
function main() {
const results = [];
let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; results.push('  FAIL: ' + msg); return false; }
  results.push('  ok:   ' + msg);
  return true;
}

console.log('IRON COMMAND — sim self-test\n');

const matchups = [
  ['coalition', 'dominion'],
  ['dominion', 'syndicate'],
  ['syndicate', 'coalition'],
];

let combatSeen = false, superSeen = false, vetSeen = false, captureSeen = false,
    garrisonSeen = false, powerSeen = false, winnerSeen = false, superImpactSeen = false;

// Run each matchup for a moderate window to exercise systems.
matchups.forEach(([pf, af], idx) => {
  results.push(`\n[matchup ${idx + 1}] ${pf} vs ${af}`);
  // First matchup runs long enough to charge+fire a superweapon (240s charge),
  // and is the "overwhelm" run that forces a winner.
  const long = idx === 0;
  const r = runMatchup(pf, af, {
    maxSeconds: long ? 600 : 240,
    overwhelm: long,
    seed: 1000 + idx,
  });

  assert(!r.exception, `no exceptions thrown${r.exception ? ' — ' + r.exception.stack : ''}`);
  assert(r.events.spawn > 0, `spawn events fired (${r.events.spawn})`);
  assert(r.events.constructionComplete >= 8 || r.structNow.player + r.structNow.enemy >= 8,
    `structures built (player now ${r.structNow.player}, enemy now ${r.structNow.enemy}, completes ${r.events.constructionComplete})`);
  assert(r.builtPlayer >= 8 || r.builtEnemy >= 8 || r.structNow.player >= 8 || r.structNow.enemy >= 8,
    `>=8 structures one side (built P${r.builtPlayer}/E${r.builtEnemy})`);
  assert(r.events.attack > 0 && r.events.hit > 0, `combat events (attack ${r.events.attack}, hit ${r.events.hit})`);
  assert(r.events.projectile > 0, `projectile events (${r.events.projectile})`);
  assert(r.events.death > 0, `death events (${r.events.death})`);
  assert(r.moneyEverSpent, 'money decreased (spending)');
  assert(r.moneyEverEarned, 'money increased (income)');

  if (r.events.attack > 0 && r.events.hit > 0 && r.events.death > 0) combatSeen = true;
  if (r.maxVet >= 1) vetSeen = true;
  if (r.events.captureComplete > 0) captureSeen = true;
  if (r.events.garrisonChange > 0) garrisonSeen = true;
  if (r.powerUsedPlayer || r.events.powerUsed > 0) powerSeen = true;
  if (r.events.superLaunch > 0) superSeen = true;
  if (r.events.superImpact > 0) superImpactSeen = true;
  if (r.gameOverWinner) winnerSeen = true;

  results.push(`  · maxVet=${r.maxVet} powerUsed=${r.events.powerUsed} captures=${r.events.captureComplete} garrisonChg=${r.events.garrisonChange} superBuilt=${r.events.superBuilt} superLaunch=${r.events.superLaunch} superImpact=${r.events.superImpact} winner=${r.gameOverWinner || 'none'} t=${r.finalTime.toFixed(0)}s`);
});

// Dedicated superweapon run: long, passive, protected enemy → super charges & fires.
results.push('\n[superweapon demo] coalition rushes Orbital Lance vs passive dominion');
{
  const r = runMatchup('coalition', 'dominion', { maxSeconds: 600, superDemo: true, seed: 5150 });
  assert(!r.exception, `no exceptions${r.exception ? ' — ' + r.exception.stack : ''}`);
  assert(r.events.superBuilt > 0, `superweapon built (${r.events.superBuilt})`);
  assert(r.events.superLaunch > 0, `superweapon launched (${r.events.superLaunch})`);
  assert(r.events.superImpact > 0, `superweapon impacted (${r.events.superImpact})`);
  if (r.events.superLaunch > 0) superSeen = true;
  if (r.events.superImpact > 0) superImpactSeen = true;
  results.push(`  · superBuilt=${r.events.superBuilt} superLaunch=${r.events.superLaunch} superImpact=${r.events.superImpact} t=${r.finalTime.toFixed(0)}s`);
}

results.push('\n[global assertions]');
assert(combatSeen, 'combat (attack/projectile/hit/death) fired in >=1 matchup');
assert(vetSeen, 'veterancy reached by some unit in >=1 matchup');
assert(captureSeen, 'capture worked (oil derrick taken) in >=1 matchup');
assert(garrisonSeen, 'garrison worked in >=1 matchup');
assert(powerSeen, 'at least one general power used');
assert(superSeen, 'superweapon launched in >=1 matchup');
assert(superImpactSeen, 'superweapon impacted in >=1 matchup');
assert(winnerSeen, 'a winner declared (gameOver) in >=1 matchup');

console.log(results.join('\n'));
console.log('\n' + (failures === 0 ? `PASS — all checks green` : `FAIL — ${failures} check(s) failed`));
process.exit(failures === 0 ? 0 : 1);
}

// Run only when invoked directly (allows importing Driver/runMatchup for diagnosis).
if (process.argv[1] && process.argv[1].endsWith('simtest.js')) main();

// IRON COMMAND — AI Controller (skirmish opponent). DESIGN §11.
//
// Construction:  new AIController(game, side, difficulty)   difficulty ∈ easy|hard|brutal
// Per frame:     ai.tick(dt)
//
// Contract (strict): reads game internals freely (game.sides[side], game.entity,
// game.entities, game.sideFog, game.faction) but issues ALL orders via game.issue(side, cmd).
// It respects {ok,reason} results and gates real decision work to a difficulty cadence
// (3s / 1.5s / 0.75s) so tick() is cheap between decisions.
//
// SANCTIONED CHEAT (DESIGN §11 income multiplier ×0.8/×1.0/×1.4): the sim has no income
// hook, so this controller writes game.sides[side].money DIRECTLY — and ONLY that field —
// to model the multiplier. Each decision it measures money gained since the last decision
// (income) and grants the bonus fraction (hard grants 0 so it's a no-op). For easy it taxes
// 20% of recent income. This is the only internal it mutates; everything else goes through
// game.issue(). Documented again at _applyIncomeCheat().

import { FACTIONS, SUPERWEAPONS } from './factions.js';
import { MAP } from './map.js';

const NEUTRAL = 'neutral';

// Per-difficulty tuning.
const DIFF = {
  easy:   { cadence: 3.0,   incomeMult: 0.8, useHero: false, usePowers: false, maphack: false,
            waveInterval: 150, waveSize: 6,  maxCollectors: 3, expand: false, superDelay: 240, retreat: false,
            counter: false },
  hard:   { cadence: 1.5,   incomeMult: 1.0, useHero: true,  usePowers: true,  maphack: false,
            waveInterval: 100, waveSize: 10, maxCollectors: 4, expand: true,  superDelay: 0,   retreat: false,
            counter: true },
  brutal: { cadence: 0.75,  incomeMult: 1.4, useHero: true,  usePowers: true,  maphack: true,
            waveInterval: 70,  waveSize: 12, maxCollectors: 5, expand: true,  superDelay: 0,   retreat: true,
            counter: true },
};

export class AIController {
  constructor(game, side, difficulty = 'hard') {
    this.game = game;
    this.side = side;
    this.enemySide = side === 'player' ? 'enemy' : 'player';
    this.difficulty = DIFF[difficulty] ? difficulty : 'hard';
    this.cfg = DIFF[this.difficulty];

    this.f = game.faction[side];
    this.fd = FACTIONS[this.f];
    this.spawn = MAP.spawns[side];

    // Direction from base toward map center / enemy (used for defense facing & scouting).
    const toCx = -this.spawn.x, toCz = -this.spawn.z;
    const tl = Math.hypot(toCx, toCz) || 1;
    this.toCenter = { x: toCx / tl, z: toCz / tl };

    // Timers / state.
    this.t = 0;
    this.acc = this.cfg.cadence; // think on first tick
    this.lastIncomeMoney = game.sides[side].money;
    this.lastWaveT = 0;
    this.scoutId = null;
    this.scouted = false;
    this.expandedCenter = false;
    this.attackForce = null;   // {ids:Set, target:{x,z}, committed:bool}
    this.harvestRaidId = null;
    this.garrisonedCivs = new Set();

    // Cached scans (refreshed each decision).
    this._cache = { time: -1 };

    // Build plan (ordered structure keys). Reactor count tuned for power budget.
    this.plan = this._buildPlan();
    this.planIdx = 0;
  }

  // ─── Build order per faction (DESIGN §11) ────────────────────────────────────
  _buildPlan() {
    const f = this.f;
    const powerUser = this.fd.powerUser;
    const powerKey = f === 'coalition' ? 'fusionReactor' : f === 'dominion' ? 'fissionReactor' : null;
    const supply = f === 'syndicate' ? 'supplyStash' : 'supplyCenter';
    const factory = f === 'syndicate' ? 'armsBazaar' : 'warFactory';
    const tech = this.fd.techKey;
    const superKey = this.fd.superKey;
    const def = f === 'coalition' ? 'aegis' : f === 'dominion' ? 'gatling' : 'stingerNest';

    // CRITICAL path — must never be blocked. The 2nd-supply expansion is handled
    // separately (opportunistically, only when safe) so it can't stall the tech tree.
    // Front-loaded with cheap defensive structures so even a hard-pressed side reaches a
    // solid base (10+ structures) well before mid-game.
    const plan = [];
    // power → supply + collectors (collectors handled separately) → barracks → factory
    if (powerUser) plan.push(powerKey);
    plan.push(supply, 'barracks');
    plan.push(def);                         // early defense at the perimeter facing enemy
    if (powerUser) plan.push(powerKey);     // 2nd reactor to cover factory/defense draw
    plan.push(factory);
    // Dominion bunker / Syndicate tunnel — cheap, useful front structures.
    if (f === 'dominion') plan.push('bunker');
    else if (f === 'syndicate') plan.push('tunnel');
    else plan.push(def);                    // coalition: a 2nd aegis
    plan.push(tech);
    plan.push(def);                         // another perimeter defense
    if (powerUser) plan.push(powerKey);     // power for defenses + super
    // secondary income structure
    if (f === 'coalition') plan.push('dropZone');
    else if (f === 'syndicate') plan.push('blackMarket');
    plan.push(superKey);
    plan.push(def);                         // more perimeter defense late
    return plan;
  }

  // ─── Entity scans (cached per decision) ──────────────────────────────────────
  _refreshCache() {
    if (this._cache.time === this.t) return this._cache;
    const g = this.game;
    const c = { time: this.t, structs: [], units: [], builders: [], collectors: [],
                army: [], byKey: {}, hero: null, derricks: [], myDeposit: null };
    for (const e of g.entities.values()) {
      if (e.side === this.side) {
        if (e.kind === 'structure') {
          c.structs.push(e);
          if (e.building == null) (c.byKey[e.key] = c.byKey[e.key] || []).push(e);
          if (e.def && (e.def.deposit) && e.building == null && !c.myDeposit) c.myDeposit = e;
        } else if (e.kind === 'unit' && !e.husk) {
          c.units.push(e);
          if (e.def.builder) c.builders.push(e);
          if (e.collector) c.collectors.push(e);
          if (e.def.hero) c.hero = e;
          if (e.def.weapon && !e.def.builder && !e.collector && !e.def.suicide) c.army.push(e);
          if (e.def.suicide) c.army.push(e);
        }
      } else if (e.key === 'oilDerrick' && e.side === NEUTRAL) {
        c.derricks.push(e);
      }
    }
    this._cache = c;
    return c;
  }

  _completedKey(key) { return (this._cache.byKey[key] || []).length; }
  _has(key) { return this._completedKey(key) > 0; }
  // count including under-construction
  _countAll(key) {
    let n = 0;
    for (const e of this.game.entities.values())
      if (e.side === this.side && e.kind === 'structure' && e.key === key) n++;
    return n;
  }

  _idleBuilder() {
    const c = this._cache;
    return c.builders.find(u =>
      !u.build && !u.repairTarget && !u.captureTarget &&
      (!u.collector || u.collector.phase === 'idle' || u.collector.phase === 'building')) || null;
  }

  // Pick a harvesting builder to repurpose for construction (syndicate workers both harvest
  // and build). The build command itself repurposes it (game._cmdBuild sets collector phase),
  // so we just choose a sensible candidate and keep at least one worker harvesting.
  _freeABuilder() {
    const c = this._cache;
    const builders = c.builders.filter(u => !u.build && !u.repairTarget && !u.captureTarget && !u.def.hero);
    if (builders.length <= 1) return null; // never strip the last worker
    // prefer one not currently carrying cash (minimise lost trips)
    return builders.find(u => !u.carrying) || builders[0];
  }

  // ─── Main tick (cheap; real work gated to cadence) ───────────────────────────
  tick(dt) {
    const g = this.game;
    if (g.state && g.state.over) return;
    this.t += dt;
    this.acc += dt;
    if (this.acc < this.cfg.cadence) return;
    this.acc = 0;

    this._refreshCache();
    this._applyIncomeCheat();
    this._planHungry = false;    // set true by _progressPlan when it's waiting on funds

    this._manageBuilders();      // build plan + rebuild + repair (sets _planHungry)
    this._manageEconomy();       // collectors, expansion, secondary income, derricks
    this._manageProduction();    // train army + collectors
    this._manageUpgrades();
    this._managePowers();        // choose + use general powers, superweapon
    this._manageMilitary();      // defense, scout, attack waves
  }

  // ─── SANCTIONED CHEAT: income multiplier via direct money write ───────────────
  // Measures money earned since last decision (delta, clamped to >=0 so we don't
  // count spending) and applies the difficulty multiplier as a bonus/tax. Writes
  // ONLY game.sides[side].money. hard => mult 1.0 => zero-op. easy taxes, brutal boosts.
  _applyIncomeCheat() {
    const s = this.game.sides[this.side];
    const now = s.money;
    const earned = Math.max(0, now - this.lastIncomeMoney);
    const mult = this.cfg.incomeMult;
    if (earned > 0 && mult !== 1.0) {
      const delta = earned * (mult - 1.0); // +40% for brutal, -20% for easy
      s.money = Math.max(0, s.money + delta);
    }
    this.lastIncomeMoney = s.money;
  }

  // ─── Builders: progress plan, rebuild lost critical structures, repair ────────
  _manageBuilders() {
    const g = this.game, s = g.sides[this.side];
    const c = this._cache;

    // Keep 1-2 builders (DESIGN §11) — train from CC ONLY when economy is established
    // (a collector exists) and we have real spare cash. Count queued dozers so we don't
    // stack the CC queue across decisions while the unit hasn't spawned yet.
    if (this.fd.builder !== 'worker') {
      const wantBuilders = this.difficulty === 'easy' ? 1 : 2;
      const cc = (c.byKey.commandCenter || [])[0];
      const queuedDozers = cc ? (cc.queue || []).filter(j => j.key === 'dozer').length : 0;
      const totalBuilders = c.builders.length + queuedDozers;
      if (cc && totalBuilders < wantBuilders && c.collectors.length >= 1 && s.money > 2000) {
        g.issue(this.side, { type: 'queueUnit', structureId: cc.id, key: 'dozer' });
      }
    } else {
      // Syndicate: the Worker is BOTH builder and harvester. We want a couple of dedicated
      // workers free to construct while the rest harvest, so keep the live worker count a
      // bit above the harvester cap. Workers are cheap ($200).
      const cc = (c.byKey.commandCenter || [])[0];
      const stash = (c.byKey.supplyStash || [])[0];
      const prod = stash || cc;
      const wantWorkers = this.cfg.maxCollectors + 2; // +2 dedicated builders
      const queued = prod ? (prod.queue || []).filter(j => j.key === 'worker').length : 0;
      if (prod && c.builders.length + queued < wantWorkers && s.money >= 200) {
        g.issue(this.side, { type: 'queueUnit', structureId: prod.id, key: 'worker' });
      }
    }

    // Repair: assign a free builder to the most-damaged friendly structure.
    const damaged = c.structs.filter(e => e.building == null && e.hp < e.maxHp * 0.6)
      .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0];
    if (damaged && s.money > 400) {
      const repBuilder = c.builders.find(u => u.repairTarget === damaged.id);
      if (!repBuilder) {
        const free = this._idleBuilder();
        if (free && !free.build) g.issue(this.side, { type: 'repairTarget', id: free.id, targetId: damaged.id });
      }
    }

    // Progress build plan.
    this._progressPlan();
  }

  _progressPlan() {
    const g = this.game, s = g.sides[this.side];

    // Opportunistic 2nd-supply expansion to a center dock — only when safe, once factory is
    // up, and at most once. Runs independently so it never blocks the critical plan.
    this._tryExpand();

    if (this.planIdx >= this.plan.length) return;

    const key = this.plan[this.planIdx];
    const sdef = this.fd.structures[key];
    if (!sdef) { this.planIdx++; return; }

    // How many of this key the plan wants up to and including this slot.
    let want = 0;
    for (let k = 0; k <= this.planIdx; k++) if (this.plan[k] === key) want++;
    const haveOrBuilding = this._countAll(key);
    if (haveOrBuilding >= want) { this.planIdx++; return; }

    // We want this structure now. Reserve the economy for it ("hungry") ONLY for
    // affordable core structures — never for the $5000 superweapon, which would otherwise
    // freeze army production for minutes. The super is bought from surplus instead.
    const isSuper = !!sdef.super;
    if (!isSuper) this._planHungry = true;
    if (s.money < sdef.cost) return; // wait for funds (don't spam failing commands)

    // Free up a builder if all are busy harvesting (syndicate) so big structures get placed.
    let builder = this._idleBuilder();
    if (!builder) { builder = this._freeABuilder(); }
    if (!builder) return;

    const spot = this._placementFor(key);
    if (!spot) return;
    const r = g.issue(this.side, { type: 'build', builderId: builder.id, key, x: spot.x, z: spot.z });
    if (r.ok) { this.planIdx++; this._planHungry = false; }
    // if not ok (prereq/overlap/funds) we just wait until next decision.
  }

  // Opportunistic expansion: a 2nd supply center/stash near a contested center dock, once,
  // when the base is safe and the factory is up. Never blocks the critical plan.
  _tryExpand() {
    const g = this.game, s = g.sides[this.side], c = this._cache;
    if (this.expandedCenter || !this.cfg.expand) return;
    const supplyKey = this.f === 'syndicate' ? 'supplyStash' : 'supplyCenter';
    const factoryKey = this.f === 'syndicate' ? 'armsBazaar' : 'warFactory';
    if (!this._has(factoryKey)) return;
    if ((c.byKey[supplyKey] || []).length >= 2) { this.expandedCenter = true; return; }
    if (!this._baseSafe()) return;
    if (s.money < this.fd.structures[supplyKey].cost) return;
    const builder = this._idleBuilder();
    if (!builder) return;
    const spot = this._placementFor(supplyKey);
    if (!spot) return;
    const r = g.issue(this.side, { type: 'build', builderId: builder.id, key: supplyKey, x: spot.x, z: spot.z });
    if (r.ok) this.expandedCenter = true;
  }

  // Decide where to place a structure. Defenses go toward the enemy-facing perimeter;
  // 2nd supply goes near a contested center dock; everything else clusters in base.
  _placementFor(key) {
    const g = this.game;
    const sdef = this.fd.structures[key];
    const isDefense = !!(sdef.defense);
    const isSupply = !!(sdef.deposit);
    const base = this.spawn;

    let cx, cz;
    if (isDefense) {
      // perimeter facing center/enemy
      cx = base.x + this.toCenter.x * 12;
      cz = base.z + this.toCenter.z * 12;
    } else if (isSupply && this._has(this.f === 'syndicate' ? 'supplyStash' : 'supplyCenter')) {
      // 2nd supply → nearest center dock
      const dock = this._nearestCenterDock();
      if (dock) { cx = dock.x - this.toCenter.x * 6; cz = dock.z - this.toCenter.z * 6; }
      else { cx = base.x; cz = base.z; }
    } else if (isSupply) {
      // first supply → toward our base dock
      const dock = this._baseDock();
      if (dock) { cx = (base.x + dock.x) / 2; cz = (base.z + dock.z) / 2; }
      else { cx = base.x + this.toCenter.x * 4; cz = base.z + this.toCenter.z * 4; }
    } else {
      cx = base.x + this.toCenter.x * 6;
      cz = base.z + this.toCenter.z * 6;
    }

    // Spiral search for a legal placement near (cx,cz).
    for (let a = 0; a < 40; a++) {
      const ring = 3 + a * 0.9;
      const ang = a * 2.4 + (this.spawn.x < 0 ? 0 : Math.PI);
      const x = clampPlay(cx + Math.cos(ang) * ring * 0.6);
      const z = clampPlay(cz + Math.sin(ang) * ring * 0.6);
      const can = g.canPlace(this.side, key, x, z);
      if (can.ok) return { x, z };
    }
    return null;
  }

  _baseDock() {
    let best = null, bd = Infinity;
    for (const e of this.game.entities.values()) {
      if (e.key !== 'supplyDock' && e.key !== 'supplyPile') continue;
      const d = (e.x - this.spawn.x) ** 2 + (e.z - this.spawn.z) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  _nearestCenterDock() {
    // center docks are within ~r20 of map origin
    let best = null, bd = Infinity;
    for (const e of this.game.entities.values()) {
      if (e.key !== 'supplyDock' || e.amount <= 0) continue;
      const fromCenter = e.x * e.x + e.z * e.z;
      if (fromCenter > 30 * 30) continue; // skip base docks
      const d = (e.x - this.spawn.x) ** 2 + (e.z - this.spawn.z) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // Is the base reasonably safe to expand? (no visible enemy army near base)
  _baseSafe() {
    const enemies = this._knownEnemies();
    for (const e of enemies) {
      if (e.kind !== 'unit') continue;
      const d = (e.x - this.spawn.x) ** 2 + (e.z - this.spawn.z) ** 2;
      if (d < 28 * 28) return false;
    }
    return true;
  }

  // ─── Economy: collectors, derrick capture, secondary income ───────────────────
  _manageEconomy() {
    const g = this.game, s = g.sides[this.side];
    const c = this._cache;
    const collectorKey = this.fd.collector;
    const collectorCost = this.fd.units[collectorKey].cost;

    // The collector producer: supply center/stash (or CC for syndicate workers early).
    const prod = (this.f === 'syndicate')
      ? ((c.byKey.supplyStash || [])[0] || (c.byKey.commandCenter || [])[0])
      : (c.byKey.supplyCenter || [])[0];

    // Maintain collector count (DESIGN §11: 2-3 per dock, capped by difficulty). Collectors
    // ARE the economy engine, so we keep the producer's queue topped up rather than gating
    // behind a big cash buffer (queueUnit itself enforces funds). Count queued ones to avoid
    // over-stacking across decisions.
    if (prod) {
      const queued = (prod.queue || []).filter(j => j.key === collectorKey).length;
      const total = c.collectors.length + queued;
      if (total < this.cfg.maxCollectors && s.money >= collectorCost) {
        g.issue(this.side, { type: 'queueUnit', structureId: prod.id, key: collectorKey });
      }
    }

    // Capture oil derricks with a spare rifle infantry.
    this._captureDerricks();
  }

  _captureDerricks() {
    const g = this.game, c = this._cache;
    if (!c.derricks.length) return;
    // already capturing?
    if (this._captureId) {
      const u = g.entities.get(this._captureId);
      if (u && u.captureTarget) return;
      this._captureId = null;
    }
    // nearest neutral derrick
    let derrick = null, bd = Infinity;
    for (const d of c.derricks) {
      const dd = (d.x - this.spawn.x) ** 2 + (d.z - this.spawn.z) ** 2;
      if (dd < bd) { bd = dd; derrick = d; }
    }
    if (!derrick) return;
    const rifle = c.units.find(u => u.def.capture && !u.captureTarget && u.state !== 'capturing' &&
      !u.garrisonedIn && !u.garrisonIntent);
    if (rifle) {
      const r = g.issue(this.side, { type: 'capture', id: rifle.id, targetId: derrick.id });
      if (r.ok) this._captureId = rifle.id;
    }
  }

  // ─── Production: train army to a target composition ───────────────────────────
  _manageProduction() {
    const g = this.game, s = g.sides[this.side];
    const c = this._cache;
    if (s.pop > s.popCap - 4) return; // near cap

    // Deploy idle hackers (dominion secondary income).
    if (this.f === 'dominion') {
      for (const u of c.units) {
        if (u.def.deployIncome && !u.deployed && u.deployTimer <= 0 &&
            u.state === 'idle' && this._nearBase(u, 18)) {
          g.issue(this.side, { type: 'ability', id: u.id, abilityKey: 'deploy' });
        }
      }
    }

    // Reserve cash for the critical build plan: if it's waiting on funds for the next
    // structure, only spend on army from the surplus above that structure's cost. This
    // stops cheap-unit spam (esp. syndicate militants) from starving the tech tree.
    let spendCap = s.money;
    if (this._planHungry && this.planIdx < this.plan.length) {
      const nextDef = this.fd.structures[this.plan[this.planIdx]];
      if (nextDef) spendCap = Math.max(0, s.money - nextDef.cost);
    }

    const comp = this._desiredComposition();
    const bar = (c.byKey.barracks || [])[0];
    const facKey = this.f === 'syndicate' ? 'armsBazaar' : 'warFactory';
    const fac = (c.byKey[facKey] || [])[0];
    const air = (c.byKey.airfield || [])[0];

    // Barracks: cheap support infantry + AT/AA + occasional hacker.
    if (bar) this._trainFrom(bar, comp.barracks, spendCap);
    if (fac) this._trainFrom(fac, comp.factory, spendCap);
    if (air) this._trainFrom(air, comp.air, spendCap);

    // Train hero (hard/brutal) once tech is up and none alive.
    if (this.cfg.useHero && !s.heroAlive && bar) {
      const heroKey = this._heroKey();
      const hdef = this.fd.units[heroKey];
      if (hdef && hdef.requires && this._has(hdef.requires) && s.money >= hdef.cost) {
        g.issue(this.side, { type: 'queueUnit', structureId: bar.id, key: heroKey });
      }
    }
  }

  _heroKey() {
    return this.f === 'coalition' ? 'ghost' : this.f === 'dominion' ? 'mantis' : 'cobra';
  }

  // Pick a unit to train from a structure given a weighted wishlist; respects funds, the
  // plan reservation (spendCap) & a short queue cap to avoid hoarding money in queues.
  _trainFrom(struct, wishlist, spendCap) {
    const g = this.game, s = g.sides[this.side];
    if (!wishlist || !wishlist.length) return;
    if (struct.queue && struct.queue.length >= 2) return; // keep queues short, avoid hoarding
    const budget = spendCap != null ? spendCap : s.money;
    // Pick the first affordable, prereq-satisfied unit, rotating by time for variety.
    const order = wishlist.slice();
    const rot = Math.floor(this.t / 5) % order.length;
    for (let i = 0; i < order.length; i++) {
      const key = order[(rot + i) % order.length];
      const def = this.fd.units[key];
      if (!def) continue;
      if (def.requires && !this._has(def.requires)) continue;
      if (def.hero) continue;
      if (def.cost > budget) continue;
      const r = g.issue(this.side, { type: 'queueUnit', structureId: struct.id, key });
      if (r.ok) return;
    }
  }

  // Desired army composition — combined arms, countering scouted player army on hard/brutal.
  _desiredComposition() {
    const f = this.f;
    // Base wishlists per faction (combined arms; cheap → expensive).
    let barracks, factory, air;
    if (f === 'coalition') {
      barracks = ['trooper', 'javelin', 'javelin', 'marksman'];
      factory  = ['paladin', 'paladin', 'outrider', 'tempest'];
      air      = ['falcon', 'specter', 'meteor'];
    } else if (f === 'dominion') {
      barracks = ['conscript', 'hunter', 'hunter', 'hacker'];
      factory  = ['warmaster', 'warmaster', 'shredder', 'dragon', 'hellstorm', 'emperor'];
      air      = ['vulture'];
    } else {
      barracks = ['militant', 'stinger', 'stinger', 'fanatic'];
      factory  = ['scorpion', 'scorpion', 'quad', 'buggy', 'toxinTractor', 'scud'];
      air      = [];
    }

    if (this.cfg.counter) {
      const enemy = this._scoutEnemyComposition();
      // Counter logic: lots of air → more AA; lots of vehicles → more AT/cannon;
      // lots of infantry → more anti-infantry (gatling/flame/cheap mass).
      if (enemy.air > enemy.ground * 0.4 + 2) {
        // boost AA
        if (f === 'coalition') barracks = ['javelin', 'javelin', 'trooper', 'marksman'];
        else if (f === 'dominion') { barracks = ['hunter', 'hunter', 'conscript']; factory = ['shredder', 'shredder', 'warmaster']; }
        else { barracks = ['stinger', 'stinger', 'militant']; factory = ['quad', 'quad', 'scorpion']; }
      } else if (enemy.tanks > enemy.infantry) {
        // boost AT / cannon
        if (f === 'coalition') { factory = ['paladin', 'paladin', 'tempest']; barracks = ['javelin', 'trooper']; }
        else if (f === 'dominion') { factory = ['warmaster', 'warmaster', 'hellstorm', 'emperor']; }
        else { factory = ['scorpion', 'scorpion', 'buggy', 'scud']; }
      } else if (enemy.infantry > enemy.tanks * 2 + 3) {
        // boost anti-infantry
        if (f === 'coalition') { factory = ['paladin', 'tempest']; barracks = ['trooper', 'marksman']; }
        else if (f === 'dominion') { factory = ['dragon', 'dragon', 'shredder', 'warmaster']; }
        else { factory = ['toxinTractor', 'quad', 'scorpion', 'buggy']; }
      }
    }
    return { barracks, factory, air };
  }

  // Count enemy unit types we can see (brutal maphacks: reads all entities).
  _scoutEnemyComposition() {
    const g = this.game;
    let infantry = 0, tanks = 0, light = 0, air = 0;
    for (const e of g.entities.values()) {
      if (e.side !== this.enemySide || e.kind !== 'unit' || e.husk) continue;
      if (!this.cfg.maphack && !this._isKnown(e)) continue;
      const ar = e.def.armor;
      if (ar === 'aircraft') air++;
      else if (ar === 'tank') tanks++;
      else if (ar === 'lightVehicle') light++;
      else infantry++;
    }
    return { infantry, tanks, light, air, ground: infantry + tanks + light };
  }

  // ─── Upgrades ────────────────────────────────────────────────────────────────
  _manageUpgrades() {
    if (this.difficulty === 'easy') return; // easy skips upgrades
    const g = this.game, s = g.sides[this.side], c = this._cache;
    if (s.money < 2500) return; // only when flush
    for (const uk of Object.keys(this.fd.upgrades)) {
      if (s.upgrades[uk]) continue;
      const at = this.fd.upgrades[uk].at;
      const st = (c.byKey[at] || [])[0];
      if (st && s.money >= this.fd.upgrades[uk].cost) {
        const r = g.issue(this.side, { type: 'upgrade', structureId: st.id, key: uk });
        if (r.ok) return; // one per decision
      }
    }
  }

  // ─── General powers + superweapon ─────────────────────────────────────────────
  _managePowers() {
    const g = this.game, s = g.sides[this.side];

    // Superweapon: fire at the player's production core when ready (delayed on easy).
    if (s.super && s.super.ready && this.t >= this.cfg.superDelay) {
      const tgt = this._enemyProductionCore();
      if (tgt) g.issue(this.side, { type: 'fireSuper', x: tgt.x, z: tgt.z });
    }

    if (!this.cfg.usePowers) return;

    // Choose powers when points available. Prefer the rank-5 ultimate, then offensive,
    // then passive (syndicate cashBounty is a fine economy pick).
    const avail = s.points - s.pointsSpent;
    if (avail > 0) this._chooseBestPower(avail);

    // Use offensive powers on cooldown at the best target cluster.
    for (const pk of Object.keys(s.powers)) {
      const pd = this.fd.powers[pk];
      if (!pd || pd.passive) continue;
      if ((s.powers[pk] || 0) <= 0) continue;
      if ((s.powerCd[pk] || 0) > 0) continue;
      const tgt = this._bestPowerTarget(pk);
      if (!tgt) continue;
      g.issue(this.side, { type: 'usePower', key: pk, x: tgt.x, z: tgt.z });
      break; // one power per decision
    }
  }

  _chooseBestPower(avail) {
    const g = this.game, s = g.sides[this.side];
    const powers = this.fd.powers;
    // priority: ultimate (rank-gated, big) > offensive levelers > passive
    const keys = Object.keys(powers);
    // 1) ultimate if rank allows
    for (const pk of keys) {
      const pd = powers[pk];
      if (pd.rank && s.rank >= pd.rank && (s.powers[pk] || 0) < (pd.levels || 1) && avail >= (pd.points || 1)) {
        if (g.issue(this.side, { type: 'choosePower', key: pk }).ok) return;
      }
    }
    // 2) offensive (non-passive, non-rank) leveling
    for (const pk of keys) {
      const pd = powers[pk];
      if (pd.passive || pd.rank) continue;
      if ((s.powers[pk] || 0) < (pd.levels || 1) && avail >= (pd.points || 1)) {
        if (g.issue(this.side, { type: 'choosePower', key: pk }).ok) return;
      }
    }
    // 3) passive (cash bounty etc.)
    for (const pk of keys) {
      const pd = powers[pk];
      if (!pd.passive) continue;
      if ((s.powers[pk] || 0) < (pd.levels || 1) && avail >= (pd.points || 1)) {
        if (g.issue(this.side, { type: 'choosePower', key: pk }).ok) return;
      }
    }
  }

  // Pick a target for an offensive power: densest cluster of enemy units, else production.
  _bestPowerTarget(pk) {
    const cluster = this._bestEnemyCluster(8);
    if (cluster && cluster.count >= 3) return { x: cluster.x, z: cluster.z };
    // cashHack wants enemy supply center; otherwise hit production core
    if (pk === 'cashHack') {
      const sc = this._enemyStructure(k => k === 'supplyCenter' || k === 'supplyStash');
      if (sc) return { x: sc.x, z: sc.z };
    }
    return this._enemyProductionCore();
  }

  // ─── Military: defense, scouting, attack waves, retreat ───────────────────────
  _manageMilitary() {
    const g = this.game, c = this._cache;

    this._scout();
    this._garrisonFront();

    // Defense: hold a portion of the army near base; engage intruders.
    const intruder = this._intruderNearBase();
    if (intruder) {
      // pull idle army to defend
      const defenders = c.army.filter(u => !u.attackTarget && u.state !== 'attacking' &&
        (!this.attackForce || !this.attackForce.ids.has(u.id)));
      if (defenders.length) {
        g.issue(this.side, { type: 'attackMove', ids: defenders.map(u => u.id), x: intruder.x, z: intruder.z });
      }
    }

    this._runAttackWaves();
    this._microHero();
    this._microRaid();
  }

  // Scout early with a cheap fast unit toward enemy + center.
  _scout() {
    if (this.scouted) return;
    if (this.t < 8) return;
    const g = this.game, c = this._cache;
    // reuse an existing scout if alive
    if (this.scoutId) {
      const u = g.entities.get(this.scoutId);
      if (u) {
        if (u.state === 'idle') {
          const sp = MAP.spawns[this.enemySide];
          g.issue(this.side, { type: 'attackMove', ids: [u.id], x: sp.x, z: sp.z });
        }
        return;
      }
      this.scoutId = null;
    }
    // pick a fast cheap unit
    const scout = c.army.find(u => u.def.spd >= 3.2 && !u.def.hero) ||
                  c.army.find(u => !u.def.hero);
    if (scout) {
      const sp = MAP.spawns[this.enemySide];
      const midX = (this.spawn.x + sp.x) / 2, midZ = (this.spawn.z + sp.z) / 2;
      g.issue(this.side, { type: 'attackMove', ids: [scout.id], x: midX, z: midZ });
      this.scoutId = scout.id;
      this.scouted = true;
    }
  }

  // Garrison bunkers / civ buildings near the front (hard/brutal).
  _garrisonFront() {
    if (this.difficulty === 'easy') return;
    const g = this.game, c = this._cache;
    // find a nearby civ building (toward center) not yet garrisoned by us
    let civ = null, bd = Infinity;
    for (const e of g.entities.values()) {
      if (e.key !== 'civBuilding') continue;
      if (this.garrisonedCivs.has(e.id)) continue;
      if (e.garrisonList && e.garrisonList.length) continue;
      // only ones on our side of center-ish / between base and center
      const d = (e.x - this.spawn.x) ** 2 + (e.z - this.spawn.z) ** 2;
      if (d > 40 * 40) continue;
      if (d < bd) { bd = d; civ = e; }
    }
    if (!civ) return;
    const inf = c.units.filter(u => u.def.armor === 'infantry' && u.def.weapon && !u.def.builder &&
      !u.def.hero && !u.captureTarget && !u.garrisonedIn && !u.garrisonIntent);
    if (inf.length >= 4) { // only spare infantry
      g.issue(this.side, { type: 'garrison', ids: inf.slice(0, 3).map(u => u.id), targetId: civ.id });
      this.garrisonedCivs.add(civ.id);
    }
  }

  // Attack waves per §11 cadence/size.
  _runAttackWaves() {
    const g = this.game, c = this._cache;

    // Manage an in-flight wave: retreat if losing badly (brutal), else keep pushing.
    if (this.attackForce) {
      const alive = [...this.attackForce.ids].filter(id => g.entities.get(id));
      this.attackForce.ids = new Set(alive);
      if (!alive.length) { this.attackForce = null; }
      else {
        if (this.cfg.retreat && alive.length <= this.attackForce.initial * 0.35) {
          // retreat survivors home
          g.issue(this.side, { type: 'attackMove', ids: alive, x: this.spawn.x + this.toCenter.x * 8, z: this.spawn.z + this.toCenter.z * 8 });
          this.attackForce = null;
        } else {
          // re-target onto best objective periodically
          const tgt = this._waveTarget();
          if (tgt) g.issue(this.side, { type: 'attackMove', ids: alive, x: tgt.x, z: tgt.z });
        }
        return;
      }
    }

    // Form a new wave on cadence once we have enough army. Late game, shorten the interval
    // and lower the threshold so matches stay decisive rather than stalemating.
    const elapsed = this.t;
    const interval = elapsed > 360 ? this.cfg.waveInterval * 0.6 : this.cfg.waveInterval;
    const sizeReq = elapsed > 360 ? Math.max(5, Math.floor(this.cfg.waveSize * 0.7)) : this.cfg.waveSize;
    if (this.t - this.lastWaveT < interval) return;
    // available fighters not tasked with defense/garrison/capture
    const fighters = c.army.filter(u => !u.def.hero && !u.garrisonedIn && !u.garrisonIntent &&
      !u.captureTarget && u.id !== this.scoutId && u.id !== this.harvestRaidId);
    if (fighters.length < sizeReq) return;

    const tgt = this._waveTarget();
    if (!tgt) return;
    const ids = fighters.map(u => u.id);
    g.issue(this.side, { type: 'attackMove', ids, x: tgt.x, z: tgt.z });
    this.attackForce = { ids: new Set(ids), initial: ids.length, target: tgt };
    this.lastWaveT = this.t;

    // Brutal multi-prong: send hero / raiders simultaneously (handled in _microHero/_microRaid).
  }

  // Target priority for a wave: enemy production/economy core. Brutal maphacks the base.
  _waveTarget() {
    // densest cluster first if known and big, else production core
    const core = this._enemyProductionCore();
    return core || MAP.spawns[this.enemySide];
  }

  // Hero micro (hard/brutal): send hero with the wave / at production; use C4/abilities.
  _microHero() {
    if (!this.cfg.useHero) return;
    const g = this.game, c = this._cache;
    const hero = c.hero;
    if (!hero) return;
    // Coalition Ghost: plant C4 on a known enemy structure when adjacent.
    if (this.f === 'coalition' && hero.abilityCd && (hero.abilityCd.c4 || 0) <= 0) {
      const st = this._enemyStructure(() => true, hero.x, hero.z);
      if (st && dist(hero.x, hero.z, st.x, st.z) < 4) {
        g.issue(this.side, { type: 'ability', id: hero.id, abilityKey: 'c4', targetId: st.id });
        return;
      }
    }
    // Mantis: cash hack enemy supply center / disable a cluster.
    if (this.f === 'dominion' && hero.abilityCd) {
      const sc = this._enemyStructure(k => k === 'supplyCenter' || k === 'supplyStash', hero.x, hero.z);
      if (sc && dist(hero.x, hero.z, sc.x, sc.z) < 8 && (hero.abilityCd.cashHack || 0) <= 0) {
        g.issue(this.side, { type: 'ability', id: hero.id, abilityKey: 'cashHack', targetId: sc.id });
        return;
      }
      const cluster = this._bestEnemyCluster(10);
      if (cluster && cluster.count >= 3 && (hero.abilityCd.disable || 0) <= 0 &&
          dist(hero.x, hero.z, cluster.x, cluster.z) < 10) {
        g.issue(this.side, { type: 'ability', id: hero.id, abilityKey: 'disable', x: cluster.x, z: cluster.z });
        return;
      }
    }
    // Otherwise move hero toward the enemy production core (attackMove so it engages).
    if (hero.state === 'idle') {
      const core = this._enemyProductionCore();
      if (core) g.issue(this.side, { type: 'attackMove', ids: [hero.id], x: core.x, z: core.z });
    }
  }

  // Harvester raid (brutal): send a couple fast units to hit enemy collectors.
  _microRaid() {
    if (this.difficulty !== 'brutal') return;
    const g = this.game, c = this._cache;
    if (this.harvestRaidId) {
      const u = g.entities.get(this.harvestRaidId);
      if (u && (u.attackTarget || u.state === 'moving' || u.state === 'attacking')) return;
      this.harvestRaidId = null;
    }
    // find a known enemy collector
    let target = null, bd = Infinity;
    for (const e of g.entities.values()) {
      if (e.side !== this.enemySide || e.kind !== 'unit' || !e.collector) continue;
      if (!this.cfg.maphack && !this._isKnown(e)) continue;
      const d = (e.x - this.spawn.x) ** 2 + (e.z - this.spawn.z) ** 2;
      if (d < bd) { bd = d; target = e; }
    }
    if (!target) return;
    const raider = c.army.find(u => u.def.spd >= 3.8 && !u.def.hero &&
      (!this.attackForce || !this.attackForce.ids.has(u.id)) && u.id !== this.scoutId);
    if (raider) {
      g.issue(this.side, { type: 'attack', ids: [raider.id], targetId: target.id });
      this.harvestRaidId = raider.id;
    }
  }

  // ─── Targeting helpers ────────────────────────────────────────────────────────
  _enemyProductionCore() {
    // centroid of enemy production/tech structures (or any structure / spawn fallback).
    const g = this.game;
    let sx = 0, sz = 0, n = 0, anyX = 0, anyZ = 0, anyN = 0;
    for (const e of g.entities.values()) {
      if (e.side !== this.enemySide || e.kind !== 'structure') continue;
      if (!this.cfg.maphack && !this._isKnown(e)) continue;
      anyX += e.x; anyZ += e.z; anyN++;
      const prod = e.def && (e.def.builds || e.def.tech || e.def.super || e.key === 'commandCenter');
      if (prod) { sx += e.x; sz += e.z; n++; }
    }
    if (n) return { x: sx / n, z: sz / n };
    if (anyN) return { x: anyX / anyN, z: anyZ / anyN };
    return null; // unknown — fall back handled by caller
  }

  _enemyStructure(pred, fromX, fromZ) {
    const g = this.game;
    let best = null, bd = Infinity;
    const ox = fromX != null ? fromX : this.spawn.x, oz = fromZ != null ? fromZ : this.spawn.z;
    for (const e of g.entities.values()) {
      if (e.side !== this.enemySide || e.kind !== 'structure') continue;
      if (!pred(e.key)) continue;
      if (!this.cfg.maphack && !this._isKnown(e)) continue;
      const d = (e.x - ox) ** 2 + (e.z - oz) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // Densest cluster of known enemy units within radius r (grid-bucket approximation).
  _bestEnemyCluster(r) {
    const enemies = this._knownEnemies().filter(e => e.kind === 'unit');
    if (!enemies.length) return null;
    let best = null, bestCount = 0;
    for (const a of enemies) {
      let count = 0, sx = 0, sz = 0;
      for (const b of enemies) {
        if ((a.x - b.x) ** 2 + (a.z - b.z) ** 2 <= r * r) { count++; sx += b.x; sz += b.z; }
      }
      if (count > bestCount) { bestCount = count; best = { x: sx / count, z: sz / count, count }; }
    }
    return best;
  }

  // Known enemies: brutal maphacks (all), others only those visible in our fog/detection.
  _knownEnemies() {
    const g = this.game, out = [];
    for (const e of g.entities.values()) {
      if (e.side !== this.enemySide || e.husk) continue;
      if (this.cfg.maphack || this._isKnown(e)) out.push(e);
    }
    return out;
  }

  // Is an enemy entity known to us via fog of war (DESIGN §11: easy/hard obey fog)?
  _isKnown(e) {
    const fog = this.game.sideFog(this.side);
    const cx = Math.floor((e.x + 64) / fog.cell);
    const cz = Math.floor((e.z + 64) / fog.cell);
    if (cx < 0 || cz < 0 || cx >= fog.w || cz >= fog.h) return false;
    return fog.grid[cz * fog.w + cx] === 2;
  }

  _intruderNearBase() {
    const enemies = this._knownEnemies();
    let best = null, bd = 26 * 26;
    for (const e of enemies) {
      if (e.kind !== 'unit') continue;
      const d = (e.x - this.spawn.x) ** 2 + (e.z - this.spawn.z) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  _nearBase(u, r) {
    return (u.x - this.spawn.x) ** 2 + (u.z - this.spawn.z) ** 2 <= r * r;
  }
}

// ─── local helpers ─────────────────────────────────────────────────────────────
function clampPlay(v) { return v < -58 ? -58 : v > 58 ? 58 : v; }
function dist(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }

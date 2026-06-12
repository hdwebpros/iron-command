// IRON COMMAND — faction data. Pure data, zero imports.
// Keys are the canonical entity keys from DESIGN §13.5 — must match exactly.
//
// Unit fields: cost, build (s), hp, armor, pop, spd, vision; weapon {type,dps,range,...}.
// Weapon optional fields: air(bool can hit air), min(min range), arc(arcing/artillery),
//   splash(radius), firePatch/pool(sec area-denial), burst(n shots), cone, spray.
// Flags: capture, stealthWhenStill, horde, salvage, hero, builder, harvester (collector),
//   suicide, transport(n), rearm(needs airfield), heli, requires (tech struct key).
//
// Structure fields: cost, build, hp, power(+/-), requires (key or [keys]/{any}), builds[],
//   produces, defense {type,dps,range,air}, garrison(slots), powerProducer, super, tech.

export const FACTIONS = {
  coalition: {
    name: 'Coalition',
    general: 'Kira "Phantom" Voss',
    color: '#2e7bff',
    blurb: 'Expensive high-tech. Air power, lasers, stealth aircraft.',
    powerUser: true,
    collector: 'pelican',
    builder: 'dozer',
    superKey: 'orbitalLance',
    techKey: 'uplink',
    units: {
      trooper:  { cost: 225, build: 5, hp: 180, armor: 'infantry', pop: 1, spd: 2.2, vision: 11, weapon: { type: 'smallArms', dps: 12, range: 9 }, capture: true, abilities: ['flashbang'] },
      javelin:  { cost: 300, build: 5, hp: 100, armor: 'infantry', pop: 1, spd: 2.0, vision: 11, weapon: { type: 'missile', dps: 22, range: 11, air: true } },
      marksman: { cost: 600, build: 10, hp: 120, armor: 'infantry', pop: 1, spd: 2.2, vision: 14, weapon: { type: 'sniper', dps: 35, range: 14 }, stealthWhenStill: true, killGarrison: true },
      ghost:    { cost: 1500, build: 20, hp: 300, armor: 'infantry', pop: 3, spd: 2.6, vision: 14, weapon: { type: 'sniper', dps: 40, range: 12 }, stealthWhenStill: true, hero: true, requires: 'uplink', abilities: ['c4', 'knife'] },
      dozer:    { cost: 1000, build: 8, hp: 250, armor: 'lightVehicle', pop: 1, spd: 2.4, vision: 9, builder: true },
      pelican:  { cost: 1200, build: 10, hp: 300, armor: 'aircraft', pop: 1, spd: 4.5, vision: 10, harvester: true, heli: true, trip: 600, cycle: 7 },
      outrider: { cost: 700, build: 8, hp: 240, armor: 'lightVehicle', pop: 2, spd: 4.2, vision: 12, weapon: { type: 'missile', dps: 18, range: 10, air: true }, transport: 3 },
      paladin:  { cost: 900, build: 10, hp: 480, armor: 'tank', pop: 3, spd: 3.0, vision: 10, weapon: { type: 'cannon', dps: 34, range: 10 } },
      tempest:  { cost: 1200, build: 14, hp: 200, armor: 'lightVehicle', pop: 3, spd: 2.4, vision: 10, weapon: { type: 'missile', dps: 50, range: 24, min: 6, arc: true, interval: 3, splash: 3 } },
      specter:  { cost: 1500, build: 18, hp: 260, armor: 'aircraft', pop: 3, spd: 4.0, vision: 13, weapon: { type: 'gatling', dps: 38, range: 10 }, stealthWhenStill: true, heli: true },
      falcon:   { cost: 1400, build: 18, hp: 180, armor: 'aircraft', pop: 3, spd: 7.0, vision: 13, weapon: { type: 'missile', dps: 60, range: 10, air: true, burst: 4 }, rearm: true },
      meteor:   { cost: 2500, build: 25, hp: 140, armor: 'aircraft', pop: 4, spd: 8.0, vision: 12, weapon: { type: 'bomb', dps: 400, range: 8, splash: 5, single: true }, rearm: true, requires: 'uplink' },
    },
    structures: {
      commandCenter: { cost: 2000, build: 30, hp: 4000, power: 0, builds: ['dozer'], radar: true },
      fusionReactor: { cost: 800, build: 10, hp: 800, power: 5, powerProducer: true },
      barracks:      { cost: 600, build: 10, hp: 1000, power: 0, builds: ['trooper', 'javelin', 'marksman', 'ghost'] },
      supplyCenter:  { cost: 2000, build: 15, hp: 1400, power: -1, builds: ['pelican'], deposit: true },
      warFactory:    { cost: 2000, build: 20, hp: 2000, power: -1, requires: 'supplyCenter', builds: ['outrider', 'paladin', 'tempest'] },
      airfield:      { cost: 1000, build: 15, hp: 1200, power: -1, requires: 'supplyCenter', builds: ['specter', 'falcon', 'meteor'], pads: 4 },
      aegis:         { cost: 1000, build: 12, hp: 900, power: -3, requires: 'fusionReactor', defense: { type: 'missile', dps: 40, range: 16, air: true } },
      uplink:        { cost: 2500, build: 20, hp: 1500, power: -2, requires: { any: ['warFactory', 'airfield'] }, tech: true },
      dropZone:      { cost: 2500, build: 15, hp: 1000, power: -4, requires: 'uplink', income: { amount: 1500, interval: 120 } },
      orbitalLance:  { cost: 5000, build: 45, hp: 2000, power: -10, requires: 'uplink', super: true },
    },
    upgrades: {
      controlRods:   { cost: 500, at: 'fusionReactor', label: 'Control Rods' },
      supplyLines:   { cost: 800, at: 'supplyCenter', label: 'Supply Lines' },
      laserWarheads: { cost: 1500, at: 'uplink', label: 'Laser Warheads' },
    },
    powers: {
      spyDrone:   { points: 1, cd: 90, label: 'Spy Drone' },
      paradrop:   { points: 1, levels: 3, cd: 240, label: 'Paradrop' },
      strikeWing: { points: 1, levels: 3, cd: 240, label: 'Strike Wing' },
      fuelAir:    { points: 3, rank: 5, cd: 360, label: 'Fuel-Air Bomb' },
    },
  },

  dominion: {
    name: 'Dominion',
    general: 'Vance "Steel" Karov',
    color: '#e03c2e',
    blurb: 'Tank and infantry hordes. Napalm, nukes, horde bonus.',
    powerUser: true,
    collector: 'supplyTruck',
    builder: 'dozer',
    superKey: 'nuclearMissile',
    techKey: 'warCouncil',
    units: {
      conscript:  { cost: 300, build: 8, hp: 120, armor: 'infantry', pop: 1, spd: 2.2, vision: 10, weapon: { type: 'smallArms', dps: 10, range: 9 }, capture: true, horde: true, pair: true },
      hunter:     { cost: 300, build: 5, hp: 100, armor: 'infantry', pop: 1, spd: 2.0, vision: 10, weapon: { type: 'missile', dps: 20, range: 11, air: true }, horde: true },
      hacker:     { cost: 625, build: 12, hp: 100, armor: 'infantry', pop: 1, spd: 2.0, vision: 9, abilities: ['deploy'], deployIncome: 6 },
      mantis:     { cost: 1500, build: 20, hp: 280, armor: 'infantry', pop: 3, spd: 2.6, vision: 14, stealthWhenStill: true, hero: true, requires: 'warCouncil', abilities: ['disable', 'cashHack'] },
      dozer:      { cost: 1000, build: 8, hp: 250, armor: 'lightVehicle', pop: 1, spd: 2.4, vision: 9, builder: true },
      supplyTruck:{ cost: 600, build: 8, hp: 300, armor: 'lightVehicle', pop: 1, spd: 3.0, vision: 9, harvester: true, trip: 300, cycle: 0 },
      warmaster:  { cost: 800, build: 10, hp: 400, armor: 'tank', pop: 3, spd: 2.8, vision: 10, weapon: { type: 'cannon', dps: 30, range: 10 }, horde: true },
      shredder:   { cost: 800, build: 10, hp: 300, armor: 'lightVehicle', pop: 2, spd: 3.2, vision: 11, weapon: { type: 'gatling', dps: 40, range: 11, air: true, spinup: 3 } },
      dragon:     { cost: 800, build: 10, hp: 280, armor: 'tank', pop: 3, spd: 3.0, vision: 10, weapon: { type: 'flame', dps: 35, range: 7, cone: true }, flameImmune: true, clearGarrison: true },
      hellstorm:  { cost: 900, build: 14, hp: 160, armor: 'lightVehicle', pop: 3, spd: 2.2, vision: 10, weapon: { type: 'flame', dps: 45, range: 22, min: 6, arc: true, interval: 3, splash: 3, firePatch: 6 } },
      emperor:    { cost: 2000, build: 20, hp: 1100, armor: 'tank', pop: 6, spd: 2.0, vision: 10, weapon: { type: 'cannon', dps: 70, range: 11 }, crush: true, requires: 'warCouncil' },
      vulture:    { cost: 1200, build: 12, hp: 170, armor: 'aircraft', pop: 3, spd: 7.0, vision: 12, weapon: { type: 'missile', dps: 55, range: 10, air: false, burst: 3, splash: 2, napalm: true }, rearm: true },
    },
    structures: {
      commandCenter:  { cost: 2000, build: 30, hp: 4000, power: 0, builds: ['dozer'], radar: true },
      fissionReactor: { cost: 1000, build: 10, hp: 1000, power: 10, powerProducer: true },
      barracks:       { cost: 500, build: 10, hp: 1000, power: 0, builds: ['conscript', 'hunter', 'hacker', 'mantis'] },
      supplyCenter:   { cost: 1500, build: 15, hp: 1400, power: -1, builds: ['supplyTruck'], deposit: true },
      warFactory:     { cost: 2000, build: 20, hp: 2000, power: -1, requires: 'supplyCenter', builds: ['warmaster', 'shredder', 'dragon', 'hellstorm', 'emperor'] },
      airfield:       { cost: 1000, build: 15, hp: 1200, power: -1, requires: 'supplyCenter', builds: ['vulture'], pads: 4 },
      gatling:        { cost: 1200, build: 12, hp: 1100, power: -3, requires: 'fissionReactor', defense: { type: 'gatling', dps: 55, range: 14, air: true, spinup: true } },
      bunker:         { cost: 500, build: 8, hp: 1200, power: 0, requires: 'barracks', garrison: 5 },
      warCouncil:     { cost: 2000, build: 20, hp: 1500, power: -2, requires: 'warFactory', tech: true },
      nuclearMissile: { cost: 5000, build: 45, hp: 2000, power: -10, requires: 'warCouncil', super: true },
    },
    upgrades: {
      nationalism:  { cost: 2000, at: 'warCouncil', label: 'Nationalism' },
      uraniumShells:{ cost: 2500, at: 'warCouncil', label: 'Uranium Shells' },
      blackNapalm:  { cost: 2000, at: 'warCouncil', label: 'Black Napalm' },
    },
    powers: {
      artilleryBarrage: { points: 1, levels: 3, cd: 300, label: 'Artillery Barrage' },
      cashHack:         { points: 1, levels: 3, cd: 240, label: 'Cash Hack' },
      clusterMines:     { points: 1, cd: 240, label: 'Cluster Mines' },
      empBomb:          { points: 3, rank: 5, cd: 360, label: 'EMP Bomb' },
    },
  },

  syndicate: {
    name: 'Syndicate',
    general: 'Marcus "Hammer" Drago',
    color: '#3da64b',
    blurb: 'Cheap swarm. Stealth, suicide, salvage scrap. Needs no power.',
    powerUser: false,
    collector: 'worker',
    builder: 'worker',
    superKey: 'viperStorm',
    techKey: 'citadel',
    units: {
      worker:      { cost: 200, build: 5, hp: 100, armor: 'infantry', pop: 1, spd: 1.8, vision: 8, builder: true, harvester: true, trip: 75, cycle: 0 },
      militant:    { cost: 150, build: 4, hp: 120, armor: 'infantry', pop: 1, spd: 2.2, vision: 10, weapon: { type: 'smallArms', dps: 10, range: 9 }, capture: true },
      stinger:     { cost: 300, build: 5, hp: 100, armor: 'infantry', pop: 1, spd: 2.0, vision: 10, weapon: { type: 'missile', dps: 20, range: 11, air: true } },
      fanatic:     { cost: 200, build: 4, hp: 120, armor: 'infantry', pop: 1, spd: 3.0, vision: 9, suicide: { dmg: 250, type: 'explosion', radius: 4 } },
      cobra:       { cost: 1500, build: 20, hp: 280, armor: 'infantry', pop: 3, spd: 2.4, vision: 14, weapon: { type: 'sniper', dps: 45, range: 14 }, stealthWhenStill: true, hero: true, requires: 'citadel', abilities: ['crewSnipe'] },
      technical:   { cost: 500, build: 6, hp: 180, armor: 'lightVehicle', pop: 2, spd: 4.5, vision: 11, weapon: { type: 'smallArms', dps: 16, range: 9 }, transport: 4, salvage: true },
      scorpion:    { cost: 600, build: 7, hp: 370, armor: 'tank', pop: 3, spd: 3.0, vision: 10, weapon: { type: 'cannon', dps: 24, range: 10 }, salvage: true },
      quad:        { cost: 700, build: 8, hp: 220, armor: 'lightVehicle', pop: 2, spd: 3.4, vision: 11, weapon: { type: 'gatling', dps: 22, range: 11, air: true }, salvage: true },
      toxinTractor:{ cost: 600, build: 8, hp: 220, armor: 'lightVehicle', pop: 2, spd: 3.0, vision: 10, weapon: { type: 'toxin', dps: 25, range: 7, spray: true, pool: 5 }, clearGarrison: true, salvage: true },
      buggy:       { cost: 900, build: 10, hp: 120, armor: 'lightVehicle', pop: 2, spd: 4.8, vision: 11, weapon: { type: 'missile', dps: 55, range: 20, min: 5, arc: true, interval: 4, splash: 3 } },
      scud:        { cost: 1200, build: 16, hp: 260, armor: 'lightVehicle', pop: 4, spd: 2.2, vision: 10, weapon: { type: 'explosion', dps: 90, range: 26, min: 8, arc: true, interval: 6, splash: 4, pool: 5 }, requires: 'citadel', salvage: true },
    },
    structures: {
      commandCenter: { cost: 2000, build: 30, hp: 4000, power: 0, builds: ['worker'], radar: true },
      supplyStash:   { cost: 1500, build: 15, hp: 1200, power: 0, builds: ['worker'], deposit: true },
      barracks:      { cost: 500, build: 10, hp: 1000, power: 0, builds: ['militant', 'stinger', 'fanatic', 'cobra'] },
      armsBazaar:    { cost: 2500, build: 20, hp: 2000, power: 0, requires: 'supplyStash', builds: ['technical', 'scorpion', 'quad', 'toxinTractor', 'buggy', 'scud'] },
      stingerNest:   { cost: 900, build: 10, hp: 900, power: 0, requires: 'barracks', defense: { type: 'missile', dps: 36, range: 15, air: true } },
      tunnel:        { cost: 800, build: 10, hp: 1000, power: 0, requires: 'barracks', tunnel: true, garrison: 10, defense: { type: 'smallArms', dps: 10, range: 10 } },
      demoTrap:      { cost: 400, build: 4, hp: 100, power: 0, demoTrap: { dmg: 300, type: 'explosion', radius: 5, trigger: 2 }, stealthWhenStill: true },
      citadel:       { cost: 2500, build: 20, hp: 2500, power: 0, requires: 'armsBazaar', tech: true },
      blackMarket:   { cost: 2500, build: 15, hp: 1200, power: 0, requires: 'citadel', income: { amount: 20, interval: 2.5 } },
      viperStorm:    { cost: 5000, build: 45, hp: 2000, power: 0, requires: 'citadel', super: true },
    },
    upgrades: {
      apRockets:   { cost: 2000, at: 'blackMarket', label: 'AP Rockets' },
      toxinShells: { cost: 2000, at: 'blackMarket', label: 'Toxin Shells' },
      junkRepair:  { cost: 2000, at: 'blackMarket', label: 'Junk Repair' },
    },
    powers: {
      ambush:      { points: 1, levels: 3, cd: 300, label: 'Ambush' },
      cashBounty:  { points: 1, levels: 3, cd: 0, passive: true, label: 'Cash Bounty' },
      sneakAttack: { points: 1, cd: 300, label: 'Sneak Attack' },
      anthraxBomb: { points: 3, rank: 5, cd: 360, label: 'Anthrax Bomb' },
    },
  },
};

// Superweapon definitions (DESIGN §9).
export const SUPERWEAPONS = {
  orbitalLance:   { charge: 240, label: 'Orbital Lance', behavior: 'lance' },
  nuclearMissile: { charge: 300, label: 'Nuclear Missile', behavior: 'nuke' },
  viperStorm:     { charge: 240, label: 'Viper Storm', behavior: 'viper' },
};

// General rank-XP thresholds → cumulative promotion points available.
export const RANK_THRESHOLDS = [0, 800, 1500, 2500, 5000];
export const RANK_POINTS = [1, 1, 1, 1, 3]; // points granted on reaching each rank

// Veterancy: HP mult, RoF mult, dmg mult, selfHeal (%hp/sec).
export const VET_LEVELS = [
  { hp: 1.0, rof: 1.0, dmg: 1.0, heal: 0 },
  { hp: 1.2, rof: 1.2, dmg: 1.0, heal: 0 },     // vet
  { hp: 1.3, rof: 1.4, dmg: 1.1, heal: 0.01 },  // elite
  { hp: 1.5, rof: 1.6, dmg: 1.3, heal: 0.02 },  // heroic
];

export function unitDef(faction, key) { return FACTIONS[faction].units[key]; }
export function structDef(faction, key) { return FACTIONS[faction].structures[key]; }

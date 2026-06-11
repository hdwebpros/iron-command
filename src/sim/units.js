// ─── IRON COMMAND — Unit & General Definitions ──────────────────────────────
// Pure data. No imports from gfx/ui/three.

import { SHOT_CADENCE_BASE, SHOT_CADENCE_MIN, SHOT_CADENCE_MAX } from './constants.js';

/** Compute fire cadence (seconds between shots) from dps so one shot = dps*cadence. */
function cadence(dps) {
  if (!dps) return 1;
  // Aim for SHOT_CADENCE_BASE; units with very high dps fire faster, lower dps slower.
  // Clamp to [0.5, 1.0].
  return Math.min(SHOT_CADENCE_MAX, Math.max(SHOT_CADENCE_MIN, SHOT_CADENCE_BASE));
}

/**
 * Build a unit definition object.
 * armorClass: 'infantry'|'vehicle'|'air'|'building'
 * damageType: 'bullet'|'cannon'|'missile'|'flame'|null
 */
function def(opts) {
  return {
    name:         opts.name,
    key:          opts.key,
    cost:         opts.cost,
    buildCooldown: opts.buildCooldown,
    armorClass:   opts.armorClass,
    damageType:   opts.damageType ?? null,
    hp:           opts.hp,
    dps:          opts.dps ?? 0,
    range:        opts.range ?? 0,
    minRange:     opts.minRange ?? 0,
    speed:        opts.speed,
    sight:        6,
    canTargetAir: opts.canTargetAir ?? false,
    isHarvester:  opts.isHarvester ?? false,
    stealth:      opts.stealth ?? false,
    hero:         opts.hero ?? false,
    squadSize:    opts.squadSize ?? 1,
    aura:         opts.aura ?? null,       // { type, radius, stat, mult }
    cadence:      cadence(opts.dps ?? 0),
    general:      opts.general,
  };
}

// ─── GENERAL VANCE "STEEL" — Armor Division ──────────────────────────────────
const steel_rifle_squad = def({
  key:'rifle_squad', name:'Rifle Squad', general:'steel',
  cost:100, buildCooldown:5,
  armorClass:'infantry', damageType:'bullet',
  hp:220, dps:30, range:4, speed:1.6,
  canTargetAir:false, squadSize:3,
});

const steel_missile_team = def({
  key:'missile_team', name:'Missile Team', general:'steel',
  cost:175, buildCooldown:8,
  armorClass:'infantry', damageType:'missile',
  hp:180, dps:38, range:5, speed:1.4,
  canTargetAir:true, squadSize:2,
});

const steel_scorpion_tank = def({
  key:'scorpion_tank', name:'Scorpion Tank', general:'steel',
  cost:300, buildCooldown:10,
  armorClass:'vehicle', damageType:'cannon',
  hp:520, dps:55, range:4.5, speed:1.8,
  canTargetAir:false,
});

const steel_gatling_track = def({
  key:'gatling_track', name:'Gatling Track', general:'steel',
  cost:250, buildCooldown:9,
  armorClass:'vehicle', damageType:'bullet',
  hp:380, dps:48, range:4, speed:2.0,
  canTargetAir:true,
});

const steel_siege_howitzer = def({
  key:'siege_howitzer', name:'Siege Howitzer', general:'steel',
  cost:450, buildCooldown:14,
  armorClass:'vehicle', damageType:'cannon',
  hp:300, dps:70, range:8, minRange:3, speed:1.1,
  canTargetAir:false,
});

const steel_harvester = def({
  key:'harvester', name:'Harvester', general:'steel',
  cost:200, buildCooldown:12,
  armorClass:'vehicle', damageType:null,
  hp:600, dps:0, range:0, speed:1.5,
  isHarvester:true,
});

const steel_goliath = def({
  key:'goliath', name:'Goliath Supertank', general:'steel',
  cost:900, buildCooldown:30,
  armorClass:'vehicle', damageType:'cannon',
  hp:1800, dps:110, range:5, speed:1.3,
  canTargetAir:true, hero:true,
});

// ─── GENERAL KIRA "PHANTOM" — Stealth & Air ──────────────────────────────────
const phantom_recon_squad = def({
  key:'recon_squad', name:'Recon Squad', general:'phantom',
  cost:90, buildCooldown:5,
  armorClass:'infantry', damageType:'bullet',
  hp:180, dps:26, range:4, speed:2.2,
  canTargetAir:false, squadSize:2,
});

const phantom_stinger_squad = def({
  key:'stinger_squad', name:'Stinger Squad', general:'phantom',
  cost:175, buildCooldown:8,
  armorClass:'infantry', damageType:'missile',
  hp:170, dps:36, range:5.5, speed:1.5,
  canTargetAir:true, squadSize:2,
});

const phantom_venom_drone = def({
  key:'venom_drone', name:'Venom Drone', general:'phantom',
  cost:220, buildCooldown:8,
  armorClass:'air', damageType:'bullet',
  hp:240, dps:40, range:4, speed:3.0,
  canTargetAir:false,
});

const phantom_razor_jet = def({
  key:'razor_jet', name:'Razor Jet', general:'phantom',
  cost:350, buildCooldown:12,
  armorClass:'air', damageType:'missile',
  hp:320, dps:60, range:5, speed:3.4,
  canTargetAir:true,
});

const phantom_phantom_tank = def({
  key:'phantom_tank', name:'Phantom Tank', general:'phantom',
  cost:380, buildCooldown:12,
  armorClass:'vehicle', damageType:'cannon',
  hp:420, dps:50, range:4.5, speed:2.0,
  canTargetAir:false, stealth:true,
});

const phantom_harvester = def({
  key:'harvester', name:'Harvester', general:'phantom',
  cost:200, buildCooldown:12,
  armorClass:'vehicle', damageType:null,
  hp:600, dps:0, range:0, speed:1.5,
  isHarvester:true,
});

const phantom_spectre = def({
  key:'spectre', name:'Spectre Gunship', general:'phantom',
  cost:950, buildCooldown:30,
  armorClass:'air', damageType:'missile',
  hp:1400, dps:95, range:5.5, speed:2.2,
  canTargetAir:true, hero:true,
});

// ─── GENERAL MARCUS "HAMMER" — Infantry Horde ────────────────────────────────
const hammer_conscript_mob = def({
  key:'conscript_mob', name:'Conscript Mob', general:'hammer',
  cost:70, buildCooldown:4,
  armorClass:'infantry', damageType:'bullet',
  hp:260, dps:34, range:3.5, speed:1.7,
  canTargetAir:false, squadSize:4,
});

const hammer_rpg_brigade = def({
  key:'rpg_brigade', name:'RPG Brigade', general:'hammer',
  cost:160, buildCooldown:7,
  armorClass:'infantry', damageType:'missile',
  hp:200, dps:40, range:5, speed:1.4,
  canTargetAir:true, squadSize:2,
});

const hammer_flame_trooper = def({
  key:'flame_trooper', name:'Flame Trooper', general:'hammer',
  cost:180, buildCooldown:8,
  armorClass:'infantry', damageType:'flame',
  hp:240, dps:55, range:2.5, speed:1.6,
  canTargetAir:false,
});

const hammer_technical = def({
  key:'technical', name:'Technical', general:'hammer',
  cost:200, buildCooldown:7,
  armorClass:'vehicle', damageType:'bullet',
  hp:280, dps:42, range:4, speed:2.6,
  canTargetAir:true,
});

const hammer_mortar_crew = def({
  key:'mortar_crew', name:'Mortar Crew', general:'hammer',
  cost:320, buildCooldown:12,
  armorClass:'infantry', damageType:'cannon',
  hp:220, dps:60, range:7, minRange:2.5, speed:1.2,
  canTargetAir:false, squadSize:2,
});

const hammer_harvester = def({
  key:'harvester', name:'Harvester', general:'hammer',
  cost:200, buildCooldown:12,
  armorClass:'vehicle', damageType:null,
  hp:600, dps:0, range:0, speed:1.5,
  isHarvester:true,
});

const hammer_warlord = def({
  key:'warlord', name:'Warlord Mech', general:'hammer',
  cost:850, buildCooldown:30,
  armorClass:'vehicle', damageType:'flame',
  hp:1500, dps:100, range:3.5, speed:1.5,
  canTargetAir:true, hero:true,
  aura:{ type:'warlord', radius:3, stat:'dps', mult:1.25 },
});

// ─── General catalogue ────────────────────────────────────────────────────────

/** Full unit defs keyed by generalId+unitKey. Use GENERALS[gen].unitDefs[key] */
export const UNIT_DEFS = {
  // steel
  rifle_squad:    steel_rifle_squad,
  missile_team:   steel_missile_team,
  scorpion_tank:  steel_scorpion_tank,
  gatling_track:  steel_gatling_track,
  siege_howitzer: steel_siege_howitzer,
  // phantom
  recon_squad:    phantom_recon_squad,
  stinger_squad:  phantom_stinger_squad,
  venom_drone:    phantom_venom_drone,
  razor_jet:      phantom_razor_jet,
  phantom_tank:   phantom_phantom_tank,
  // hammer
  conscript_mob:  hammer_conscript_mob,
  rpg_brigade:    hammer_rpg_brigade,
  flame_trooper:  hammer_flame_trooper,
  technical:      hammer_technical,
  mortar_crew:    hammer_mortar_crew,
  // heroes
  goliath:        steel_goliath,
  spectre:        phantom_spectre,
  warlord:        hammer_warlord,
  // harvester (shared key; ref any)
  harvester:      steel_harvester,
};

export const GENERALS = {
  steel: {
    name: 'Vance "Steel"',
    title: 'Armor Division',
    desc: 'Heavy armor and long-range artillery dominate the battlefield.',
    color: '#4a8fff',
    power: {
      key: 'artillery_barrage',
      name: 'Artillery Barrage',
      desc: '8 shells over 2 s in a 3-tile radius, 80 dmg each.',
      cd: 90,
      radius: 3,
    },
    units: [
      'rifle_squad',
      'missile_team',
      'scorpion_tank',
      'gatling_track',
      'siege_howitzer',
      'harvester',
      'goliath',
    ],
    unitDefs: {
      rifle_squad:    steel_rifle_squad,
      missile_team:   steel_missile_team,
      scorpion_tank:  steel_scorpion_tank,
      gatling_track:  steel_gatling_track,
      siege_howitzer: steel_siege_howitzer,
      harvester:      steel_harvester,
      goliath:        steel_goliath,
    },
  },

  phantom: {
    name: 'Kira "Phantom"',
    title: 'Stealth & Air',
    desc: 'Fast stealth units and air power strike before the enemy reacts.',
    color: '#00e5ff',
    power: {
      key: 'emp_strike',
      name: 'EMP Strike',
      desc: '4-tile radius — enemy vehicles & air stunned 6 s.',
      cd: 75,
      radius: 4,
    },
    units: [
      'recon_squad',
      'stinger_squad',
      'venom_drone',
      'razor_jet',
      'phantom_tank',
      'harvester',
      'spectre',
    ],
    unitDefs: {
      recon_squad:   phantom_recon_squad,
      stinger_squad: phantom_stinger_squad,
      venom_drone:   phantom_venom_drone,
      razor_jet:     phantom_razor_jet,
      phantom_tank:  phantom_phantom_tank,
      harvester:     phantom_harvester,
      spectre:       phantom_spectre,
    },
  },

  hammer: {
    name: 'Marcus "Hammer"',
    title: 'Infantry Horde',
    desc: 'Cheap overwhelming infantry backed by flame and mortars.',
    color: '#ff6b35',
    power: {
      key: 'napalm_run',
      name: 'Napalm Run',
      desc: 'Strafes a 6×2 tile line: 150 flame dmg + ground burns 20 dps for 5 s.',
      cd: 80,
      radius: 1,  // half-width of the line; targeting is linear
    },
    units: [
      'conscript_mob',
      'rpg_brigade',
      'flame_trooper',
      'technical',
      'mortar_crew',
      'harvester',
      'warlord',
    ],
    unitDefs: {
      conscript_mob:  hammer_conscript_mob,
      rpg_brigade:    hammer_rpg_brigade,
      flame_trooper:  hammer_flame_trooper,
      technical:      hammer_technical,
      mortar_crew:    hammer_mortar_crew,
      harvester:      hammer_harvester,
      warlord:        hammer_warlord,
    },
  },
};

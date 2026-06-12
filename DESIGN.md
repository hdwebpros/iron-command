# IRON COMMAND — Design & Architecture Contract (v2: Zero Hour edition)

A **Command & Conquer Generals: Zero Hour**–style skirmish RTS, 1 player vs AI, in the browser.
Vite + Three.js. Desktop only, mouse + hotkeys. No save games. All art procedural (no image assets).
This document is the BINDING CONTRACT for all build agents. Where your module touches another, the
API written here is law. Internal structure within your module is yours to choose.

This is a full rewrite of the previous Rivals-style sim. You may harvest useful code from the
existing files (particle pools, terrain texture generation, tone-mapped lighting rig, menu shell),
but the gameplay is now classic base-building RTS.

## Tech / layout (STRICT FILE OWNERSHIP — never touch files outside your module)

```
package.json, vite.config.js, index.html      (scaffolded; only INTEGRATION may edit)
src/sim/    constants.js factions.js map.js path.js game.js (+ any helpers)   ← SIM agent
src/sim/ai.js                                                                  ← AI agent (wave 2)
src/gfx/    renderer.js meshes.js effects.js terrain.js (+ helpers)            ← GFX agent
src/ui/     menu.js hud.js styles.css (+ helpers)                              ← UI agent
src/main.js                                                                    ← INTEGRATION agent
scripts/simtest.js                                                             ← SIM agent (node self-test)
```

ES modules everywhere. **sim/ has ZERO imports from three/DOM** — it must run under plain `node`.
gfx/ imports `three` only. ui/ is plain DOM/CSS, no framework, no external fonts/images (inline SVG ok).

---

# 1. GAME OVERVIEW

Skirmish on one map, player vs AI, pick 1 of 3 factions; AI picks a different one (random).
Difficulty: easy / hard / brutal. **Win = destroy every enemy structure. Lose = all your structures destroyed.**

Core loop (faithful Zero Hour): start with a Command Center + 1 builder + $10,000 → build power,
supply center, barracks/factory → harvest finite supply docks → tech up → earn general's XP from
kills → spend promotion points on powers → build a $5,000 superweapon on a public countdown →
break the enemy base.

Sim runs at fixed **30 Hz** (`dt = 1/30`). Render at rAF. Map coordinates: x,z ∈ [-64, +64].

## Factions (renamed; mechanics mirror USA / China / GLA)

| | **COALITION** (USA-like) | **DOMINION** (China-like) | **SYNDICATE** (GLA-like) |
|---|---|---|---|
| General | Kira "Phantom" Voss | Vance "Steel" Karov | Marcus "Hammer" Drago |
| Identity | Expensive high-tech, air power, lasers, stealth aircraft | Tank & infantry hordes, napalm, nukes, horde bonus | Cheap swarm, stealth, suicide, salvage scrap, **needs no power** |
| Superweapon | **Orbital Lance** (sweeping particle beam) | **Nuclear Missile** (blast + lingering radiation) | **Viper Storm** (9-rocket toxin barrage) |
| Hero | **Ghost** (stealth commando, C4, knife) | **Mantis** (infiltrator: disable + cash hack) | **Cobra** (stealth sniper, crew-snipe vehicles) |
| Team color | #2e7bff blue | #e03c2e red | #3da64b green (player is always blue-UI-accented; entity colors by faction) |

Player entity tint: keep faction color but add subtle blue rim/decals for "player", warm/red decals for "enemy" — gfx decides; minimap dots are blue (player) / red (enemy) / yellow (neutral) regardless of faction.

---

# 2. MAP — "Scorched Basin" (the one skirmish map)

128×128 world units. Golden-hour desert, same art direction as current build.
SIM owns the logical map in `map.js` as data (so gfx and sim agree by construction —
gfx imports nothing from sim; instead **map.js exports plain data** `MAP` that BOTH sim and gfx may import:
it has no dependencies and no DOM — this is the single sanctioned cross-import).

```js
export const MAP = {
  size: 128,                       // x,z ∈ [-64,64]
  cell: 2,                         // fog/path grid cell size → 64×64 grid
  spawns: { player: {x:-42,z:-42, angle: π/4}, enemy: {x:42,z:42} },
  supplyDocks: [ {x:-30,z:-48, amount:30000}, {x:48,z:30, amount:30000},   // base docks
                 {x:-8,z:14, amount:30000},  {x:8,z:-14, amount:30000} ],  // contested center
  supplyPiles: [ {x:-52,z:8, amount:6000}, {x:52,z:-8, amount:6000} ],
  oilDerricks: [ {x:-2,z:-34}, {x:2,z:34} ],            // neutral, capturable: $1000 bonus + $20/3s
  civBuildings: [ {x:-14,z:0},{x:14,z:0},{x:0,z:-6},{x:0,z:6},{x:-30,z:24},{x:30,z:-24} ], // garrisonable, 5 slots, 400 HP
  blockers: [ {x,z,r}, ... ]       // ~14 rock outcrops (r 3–6) + impassable 4-unit border ring
}
```
Blockers and the border are impassable to ground units; aircraft ignore them. Layout is rotationally
symmetric (180°) for fairness. SIM agent finalizes exact blocker coordinates (keep lanes ≥8 wide).

---

# 3. ECONOMY

- Start: **$10,000**, 1 Command Center, 1 free builder (Dozer/Worker).
- Supply box = **$75**. Docks hold finite cash (above). Collectors do trips: drive to dock, load, return to a Supply Center, deposit.

| Collector | Cost | Per trip | Trip mechanics |
|---|---|---|---|
| Coalition **Pelican** (heli) | $1200 | $600 | flies, ~7s load/unload cycle ignores terrain |
| Dominion **Supply Truck** | $600 | $300 | ground pathing |
| Syndicate **Worker** | $200 | $75 | also the builder; slow |

- Secondary income: Coalition **Drop Zone** ($2500, −4 power): $1500 air-dropped every 120s. Dominion **Hacker** unit ($625): when deployed (stationary) earns $6/s. Syndicate **Black Market** ($2500): $480/min ($20 every 2.5s). Oil Derricks: capture → $1000 instant + $20/3s.
- Sell any structure for **50%** refund (instant; Command Center sellable too).

---

# 4. POWER (Coalition & Dominion only — Syndicate ignores power entirely)

Each structure lists power produced (+) or consumed (−). When consumption > production (**low power**):
production speed ×0.5, automated defenses offline, superweapon countdown paused, radar/minimap sweep off.
- Coalition **Fusion Reactor**: $800, +5 (upgrade *Control Rods* $500 → +10).
- Dominion **Fission Reactor**: $1000, +10.

---

# 5. CONSTRUCTION & STRUCTURES

Coalition/Dominion: select builder (**Dozer**, $1000, 250 HP) → build menu → placement ghost →
dozer drives over and constructs (progress bar; build times below). Dozers can also repair structures
(target a damaged friendly structure; costs $1/4hp; one dozer per structure at a time is fine).
Syndicate **Worker** ($200, 100 HP) builds the same way and also harvests.
Placement rules: must be ≥4 units from map border, on unblocked cells, not overlapping entities;
supply centers within 16 units of a dock to be useful (not enforced, just advisable). Rebuildable Command Center from any builder.

All structures have armor class `structure` (defenses use `baseDefense`). Each faction's tech tree:

### COALITION
| Structure | Cost | Build s | HP | Power | Requires | Function |
|---|---|---|---|---|---|---|
| Command Center | $2000 | 30 | 4000 | 0 | — | builds Dozers; radar; 1 free Dozer at start |
| Fusion Reactor | $800 | 10 | 800 | +5 | — | power |
| Barracks | $600 | 10 | 1000 | 0 | — | infantry |
| Supply Center | $2000 | 15 | 1400 | −1 | — | deposit point; builds Pelicans |
| War Factory | $2000 | 20 | 2000 | −1 | Supply Center | vehicles |
| Airfield | $1000 | 15 | 1200 | −1 | Supply Center | aircraft (4 landing pads; jets return to rearm 8s) |
| Aegis Battery | $1000 | 12 | 900 | −3 | Reactor | defense: missiles, ground+air, range 16, 40 dps `missile` |
| Command Uplink | $2500 | 20 | 1500 | −2 | War Factory or Airfield | tech: unlocks hero, Meteor, superweapon, upgrades |
| Drop Zone | $2500 | 15 | 1000 | −4 | Command Uplink | $1500/120s |
| **Orbital Lance** | $5000 | 45 | 2000 | −10 | Command Uplink | superweapon |

Upgrades (researched at): Control Rods $500 (Reactor, +5 power each reactor), Supply Lines $800 (Supply Center, +10% per trip/drop), Laser Warheads $1500 (Uplink, +25% missile damage).

### DOMINION
| Structure | Cost | Build s | HP | Power | Requires | Function |
|---|---|---|---|---|---|---|
| Command Center | $2000 | 30 | 4000 | 0 | — | Dozers, radar, free Dozer |
| Fission Reactor | $1000 | 10 | 1000 | +10 | — | power |
| Barracks | $500 | 10 | 1000 | 0 | — | infantry |
| Supply Center | $1500 | 15 | 1400 | −1 | — | deposit; builds Supply Trucks |
| War Factory | $2000 | 20 | 2000 | −1 | Supply Center | vehicles |
| Airfield | $1000 | 15 | 1200 | −1 | Supply Center | Vultures |
| Gatling Cannon | $1200 | 12 | 1100 | −3 | Reactor | defense: spin-up gatling, ground+air, range 14, 25→55 dps `gatling` |
| Bunker | $500 | 8 | 1200 | 0 | Barracks | garrison 5 infantry |
| War Council | $2000 | 20 | 1500 | −2 | War Factory | tech: hero, Emperor, superweapon, upgrades |
| **Nuclear Missile** | $5000 | 45 | 2000 | −10 | War Council | superweapon |

Upgrades: Nationalism $2000 (War Council, horde bonus +25%→+50%), Uranium Shells $2500 (War Council, +25% tank cannon dmg), Black Napalm $2000 (War Council, +30% flame dmg).

### SYNDICATE (no power anywhere)
| Structure | Cost | Build s | HP | Requires | Function |
|---|---|---|---|---|---|
| Command Center | $2000 | 30 | 4000 | — | builds Workers, radar, 1 free Worker |
| Supply Stash | $1500 | 15 | 1200 | — | deposit; builds Workers |
| Barracks | $500 | 10 | 1000 | — | infantry |
| Arms Bazaar | $2500 | 20 | 2000 | Supply Stash | vehicles |
| Stinger Nest | $900 | 10 | 900 | Barracks | defense: 3 rocketeers, ground+air, range 15, 36 dps `missile`; rocketeers respawn free 15s |
| Tunnel Network | $800 | 10 | 1000 | Barracks | cap 10 units; instant transit between any friendly tunnels; units heal 2%/s inside; has own gun (10 dps, range 10) |
| Demo Trap | $400 | 4 | 100 | — | stealth mine: 300 `explosion` dmg r=5 when enemy within 2 |
| Citadel | $2500 | 20 | 2500 | Arms Bazaar | tech: hero, Scud, superweapon, upgrades |
| Black Market | $2500 | 15 | 1200 | Citadel | $20/2.5s; upgrades vendor |
| **Viper Storm** | $5000 | 45 | 2000 | Citadel | superweapon |

Upgrades: AP Rockets $2000 (Black Market, +25% missile dmg), Toxin Shells $2000 (Black Market, scorpion/scud add toxin splash), Junk Repair $2000 (Black Market, all vehicles self-repair 1%/s).

---

# 6. UNITS

Common: veterancy 3 levels (see §7). `pop` = population weight; soft cap **80 pop per side** (UI shows
"FORCES 64/80"; production blocked at cap). Speeds in units/s. Vision in world units (fog reveal radius).
Heroes: limit 1 alive at a time. Basic rifle infantry (Trooper/Conscript/Militant) can **capture**
neutral oil derricks, civilian-garrisons aside, and enemy production structures: channel 12s adjacent, interrupted by damage/move.

### COALITION (Barracks / War Factory / Airfield)
| Unit | Cost | s | HP | Armor | Pop | Spd | Weapon (type, dps, range) | Vision | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Trooper | $225 | 5 | 180 | infantry | 1 | 2.2 | smallArms 12, r9 | 11 | capture; flashbang ability: clears garrison r3, 15s cd |
| Javelin Team | $300 | 5 | 100 | infantry | 1 | 2.0 | missile 22, r11, hits air | 11 | the AT/AA infantry |
| Marksman | $600 | 10 | 120 | infantry | 1 | 2.2 | sniper 35, r14 | 14 | stealthed when still; kills garrisoned infantry one-by-one |
| **Ghost** (hero) | $1500 | 20 | 300 | infantry | 3 | 2.6 | sniper 40 r12; knife instant-kill infantry r1.5; C4: 1200 dmg to structure, 10s plant+fuse, 20s cd | 14 | stealthed when still; requires Uplink |
| Dozer | $1000 | 8 | 250 | lightVehicle | 1 | 2.4 | — | 9 | builds/repairs |
| Pelican | $1200 | 10 | 300 | aircraft | 1 | 4.5 | — | 10 | supply heli |
| Outrider | $700 | 8 | 240 | lightVehicle | 2 | 4.2 | missile 18 r10 air+grnd | 12 | scout; transport 3 infantry |
| Paladin MBT | $900 | 10 | 480 | tank | 3 | 3.0 | cannon 34, r10 | 10 | mainline tank |
| Tempest Launcher | $1200 | 14 | 200 | lightVehicle | 3 | 2.4 | missile 50, r24, min r6, arcing, 3s between shots | 10 | siege artillery; needs vision (fires at last-known otherwise) |
| Specter Gunship | $1500 | 18 | 260 | aircraft | 3 | 4.0 | gatling 20 + missile 18, r10 | 13 | stealth heli (visible when firing +2s) |
| Falcon | $1400 | 18 | 180 | aircraft | 3 | 7.0 | missile 60 burst (4 missiles) then rearm at Airfield | 13 | strike fighter; also air-to-air |
| Meteor Bomber | $2500 | 25 | 140 | aircraft | 4 | 8.0 | bomb 400 single drop, then rearm | 12 | requires Uplink; devastates structures |

### DOMINION
| Unit | Cost | s | HP | Armor | Pop | Spd | Weapon | Vision | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Conscript ×2 | $300 | 8 | 120 ea | infantry | 1 | 2.2 | smallArms 10, r9 | 10 | trains as a pair; capture; **horde** |
| Hunter Team | $300 | 5 | 100 | infantry | 1 | 2.0 | missile 20, r11, air | 10 | **horde** |
| Hacker | $625 | 12 | 100 | infantry | 1 | 2.0 | — | 9 | deploy (stationary 3s) → $6/s |
| **Mantis** (hero) | $1500 | 20 | 280 | infantry | 3 | 2.6 | — | 14 | stealthed when still; abilities: Disable structure/vehicle 15s (r10, 20s cd), Cash Hack $1000 from enemy supply center (r8, 45s cd); requires War Council |
| Dozer | $1000 | 8 | 250 | lightVehicle | 1 | 2.4 | — | 9 | |
| Supply Truck | $600 | 8 | 300 | lightVehicle | 1 | 3.0 | — | 9 | |
| Warmaster | $800 | 10 | 400 | tank | 3 | 2.8 | cannon 30, r10 | 10 | **horde** |
| Shredder AA | $800 | 10 | 300 | lightVehicle | 2 | 3.2 | gatling 18→40 (spin-up 3s), r11, air+grnd | 11 | shreds infantry & air |
| Dragon Tank | $800 | 10 | 280 | tank | 3 | 3.0 | flame 35, r7 cone | 10 | immune to flame; clears garrisons |
| Hellstorm Cannon | $900 | 14 | 160 | lightVehicle | 3 | 2.2 | flame 45, r22, min r6, arcing, leaves fire patch 6s | 10 | siege; area denial |
| Emperor | $2000 | 20 | 1100 | tank | 6 | 2.0 | cannon 70 (twin), r11 | 10 | requires War Council; crushes infantry |
| Vulture | $1200 | 12 | 170 | aircraft | 3 | 7.0 | missile 55 napalm burst then rearm | 12 | 3+ Vultures striking same target: +50% splash |

### SYNDICATE
| Unit | Cost | s | HP | Armor | Pop | Spd | Weapon | Vision | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Worker | $200 | 5 | 100 | infantry | 1 | 1.8 | — | 8 | builds + harvests |
| Militant | $150 | 4 | 120 | infantry | 1 | 2.2 | smallArms 10, r9 | 10 | capture; dirt cheap |
| Stinger Trooper | $300 | 5 | 100 | infantry | 1 | 2.0 | missile 20, r11, air | 10 | |
| Fanatic | $200 | 4 | 120 | infantry | 1 | 3.0 | suicide: 250 explosion r4 | 9 | detonates on contact/death |
| **Cobra** (hero) | $1500 | 20 | 280 | infantry | 3 | 2.4 | sniper 45 r14; vs vehicles: crew-snipe → vehicle becomes neutral **husk** (any side's infantry can enter to claim it), 20s cd | 14 | stealthed when still; requires Citadel |
| Technical | $500 | 6 | 180 | lightVehicle | 2 | 4.5 | smallArms 16, r9 | 11 | transport 4; **salvage** |
| Scorpion | $600 | 7 | 370 | tank | 3 | 3.0 | cannon 24, r10 | 10 | **salvage** (T2: +rocket 100 dmg/12s) |
| Quad Cannon | $700 | 8 | 220 | lightVehicle | 2 | 3.4 | gatling 22, r11, air+grnd | 11 | **salvage** |
| Toxin Tractor | $600 | 8 | 220 | lightVehicle | 2 | 3.0 | toxin 25, r7 spray, leaves pool 5s | 10 | clears garrisons; **salvage** |
| Rocket Buggy | $900 | 10 | 120 | lightVehicle | 2 | 4.8 | missile 55 volley, r20, min r5, 4s | 11 | glass cannon siege |
| Scud Launcher | $1200 | 16 | 260 | lightVehicle | 4 | 2.2 | explosion 90 + toxin pool, r26, min r8, 6s | 10 | requires Citadel; **salvage** |

**Salvage**: when any vehicle dies within 6 of a Syndicate vehicle (or by Syndicate fire), drop a scrap
crate (30s lifetime). Syndicate vehicles drive over: T1 = +25% weapon dmg, T2 = +25% more (and Scorpion
gains rocket). Fully-upgraded collectors get +$100 instead. Visual: chevron-like wrench pips.

**Horde** (Dominion): ≥5 horde-tagged units within r8 of each other → +25% rate of fire each (+50% with Nationalism). Show a red star pip.

**Garrison**: civilian buildings (5 slots) & Bunker: infantry inside gain +2 range, fire out, untargetable individually; building takes damage instead. flame/toxin damage to building hits occupants ×2; Trooper flashbang / Marksman / Dragon / Toxin Tractor clear them. Evacuate command empties.

**Aircraft**: fly over everything at fixed altitude; jets (Falcon, Meteor, Vulture) operate from Airfield pads: launch → strike → auto-return to rearm 8s. Helis (Pelican, Specter) free-fly. If Airfield destroyed, jets circle and can't rearm.

---

# 7. COMBAT MODEL

Damage type × armor class multiplier (%, damage received):

| | infantry | lightVehicle | tank | aircraft | structure | baseDefense |
|---|---|---|---|---|---|---|
| smallArms | 100 | 50 | 25 | 60 | 25 | 25 |
| gatling | 125 | 60 | 20 | 125 | 20 | 25 |
| cannon | 50 | 100 | 100 | 0 | 90 | 90 |
| missile | 30 | 100 | 110 | 120 | 70 | 70 |
| flame | 150 | 90 | 50 | 0 | 80 | 60 |
| toxin | 175 | 50 | 25 | 0 | 25 | 25 |
| sniper | 250 | 10 | 0* | 0 | 5 | 10 |
| explosion | 100 | 110 | 100 | 60 | 110 | 100 |
| bomb | 120 | 120 | 120 | 0 | 250 | 200 |
| beam (superweapons) | 150 | 120 | 110 | 0 | 220 | 220 |

\* Cobra's crew-snipe is a special action, not sniper damage.

Projectiles: instant-hit for smallArms/gatling/sniper/flame/toxin (beam/cone visuals), travel-time
projectiles for cannon/missile/explosion/bomb (sim emits projectile events with flight time; damage on arrival).
Splash: cannon r1.5, explosion/bomb per-weapon r3–6, artillery r3.

**Veterancy**: vet (1 chevron) +20% HP +20% RoF; elite (2) +30%/+40% +10% dmg, self-heal 1%/s; heroic (3)
+50%/+60% +30% dmg, self-heal 2%/s. XP thresholds scale with unit cost: vet = cost/3, elite = cost,
heroic = cost×2 (XP earned = cost of victims killed /10). Heal on HP% preserved when buffed.

**General's XP** (promotion): your side earns rank-XP = victim cost /4 for kills + 50 per structure.
Ranks at 0 / 800 / 1500 / 2500 / 5000 rank-XP → promotion points 1/1/1/1/3 (7 total).

---

# 8. GENERAL'S POWERS (spend points; target with reticle; cooldowns shown on HUD)

### Coalition
| Power | Pts/levels | Effect | CD |
|---|---|---|---|
| Spy Drone | 1 | reveal r12 area 30s | 90s |
| Paradrop L1/2/3 | 1 each | 4/8/14 Troopers parachute to target | 240s |
| Strike Wing L1/2/3 | 1 each | 1/2/3 attack jets strafe line: 150 missile dmg each | 240s |
| **Fuel-Air Bomb** | rank 5, 3 pts | 600 bomb dmg r10 + burn | 360s |

### Dominion
| Power | Pts/levels | Effect | CD |
|---|---|---|---|
| Artillery Barrage L1/2/3 | 1 each | 12/24/36 shells ×40 explosion over r8 | 300s |
| Cash Hack L1/2/3 | 1 each | steal $1000/$2000/$4000 (target enemy supply center, else from thin air at half value) | 240s |
| Cluster Mines | 1 | mines field r8 (12 mines × 100 dmg) | 240s |
| **EMP Bomb** | rank 5, 3 pts | disable vehicles & structures r12 for 20s | 360s |

### Syndicate
| Power | Pts/levels | Effect | CD |
|---|---|---|---|
| Ambush L1/2/3 | 1 each | 4/8/16 Militants appear at target | 300s |
| Cash Bounty L1/2/3 | 1 each | passive: +5/10/20% of victim cost as cash on kills | — |
| Sneak Attack | 1 | spawn a temporary tunnel exit anywhere (60s lifetime) | 300s |
| **Anthrax Bomb** | rank 5, 3 pts | 350 toxin r10 + pool 15s | 360s |

---

# 9. SUPERWEAPONS (public countdown — both players always see both timers)

| | Cost | Charge | Behavior |
|---|---|---|---|
| Orbital Lance | $5000 | 240s | beam strikes target then sweeps 12 units over 6s, 200 beam dps in r2.5 |
| Nuclear Missile | $5000 | 300s | 3s flight; 600 explosion r10 core/r16 falloff + radiation field r10, 20 dps, 30s |
| Viper Storm | $5000 | 240s | 9 rockets over 8s scattered r8, 120 explosion each + toxin pools |

Charging pauses at low power (Coalition/Dominion). EVA announces enemy superweapon at construction,
at ready, and at launch. Player picks target with reticle when ready (it does NOT auto-fire).

---

# 10. EVA ANNOUNCEMENTS (sim emits `eva` events with `key`; UI renders banner queue + minimap ping; audio optional)

keys: constructionComplete, unitReady, lowPower, baseUnderAttack, unitsUnderAttack, harvesterUnderAttack,
enemySuperDetected, enemySuperReady, superLaunchDetected, ourSuperReady, promotion, capturedDerrick,
insufficientFunds (UI-side only), victory, defeat. Throttle underAttack ≥15s apart.

---

# 11. AI (src/sim/ai.js — wave 2; reads game internals freely but issues orders ONLY via game.issue())

`new AIController(game, 'enemy', difficulty)` + `ai.tick(dt)`.
Behavior: scripted-but-reactive build order per faction (power → supply → barracks → factory → 2nd
supply → tech → defense → superweapon), maintains collector count, expands to center docks when safe,
rebuilds lost structures, repairs, attacks in waves (composition counters scouted player army), raids
harvesters with fast units, uses general powers & superweapon on cooldown at best target cluster
(superweapon targets: player's production core), defends base on attack, garrisons bunkers/civ buildings near front.

| | easy | hard | brutal |
|---|---|---|---|
| decision cadence | 3s | 1.5s | 0.75s |
| income multiplier | ×0.8 | ×1.0 | ×1.4 |
| attack waves | small, every ~150s, no hero | combined-arms ~100s, hero, counters | relentless ~70s, multi-prong, perfect counters, harvester raids |
| powers/superweapon | rarely/never | on cooldown | on cooldown, optimal targets |
| fog | obeys (attacks known locations only) | obeys | maphack targeting |

---

# 12. CONTROLS (implemented in main.js + HUD)

- **Left-drag**: box select (player units only). **Left-click**: select single. **Double-click**: select all of type on screen. Shift+click add/remove.
- **Right-click**: context order — move / attack enemy / capture (capturable + capable unit) / garrison (friendly bunker, civ building, tunnel) / enter transport / repair (dozer→structure) / harvest (collector→dock).
- **A+click**: attack-move. **S**: stop. **G**: guard (hold position, auto-engage in range).
- **Ctrl+1–9** assign control group, **1–9** select, double-tap = center camera. **E**: select all of same type visible.
- **H**: jump to Command Center. **Space**: jump to last EVA event. **WASD/edge pan**, wheel zoom.
- **B**: open build menu (selects an idle builder). Build placement: ghost follows mouse, green/red validity, click place, right-click/Esc cancel.
- **Esc/P**: pause menu. **F**: fire ready superweapon (enters targeting). Power buttons on HUD enter targeting reticle mode.
- Production hotkeys: when a production structure is selected, its queue buttons map to 1–9? NO — keep 1–9 for groups; production via clicking command-bar cards (each card shows its structure-context hotkey Q/W/E/R/T/Y on the card).

---

# 13. MODULE CONTRACTS

## 13.1 SIM (`src/sim/`)

```js
import { Game } from './sim/game.js';
import { FACTIONS } from './sim/factions.js';   // {coalition:{name, general, blurb, color, units:{key:stats}, structures:{...}, powers:{...}, upgrades:{...}}, ...}
const game = new Game({ playerFaction, aiFaction, difficulty, seed });
game.tick(dt);                    // dt fixed 1/30
const res = game.issue(side, cmd) // → {ok:boolean, reason?:string}; side 'player'|'enemy'
game.on(event, fn); game.off(event, fn);
game.state                        // snapshot object, rebuilt/updated each tick
game.fog                          // {w:64, h:64, cell:2, grid:Uint8Array}  player view: 0 shroud / 1 explored / 2 visible
game.entity(id)                   // read-only entity lookup
```

Commands (`cmd.type`): `build {builderId, key, x, z}`, `queueUnit {structureId, key}`, `cancelQueue {structureId, index}`,
`setRally {structureId, x, z}`, `move {ids, x, z}`, `attack {ids, targetId}`, `attackMove {ids, x, z}`,
`stop {ids}`, `guard {ids}`, `capture {id, targetId}`, `garrison {ids, targetId}`, `evacuate {id}`,
`harvest {ids, dockId}`, `repairTarget {id, targetId}`, `sell {id}`, `upgrade {structureId, key}`,
`ability {id, abilityKey, x?, z?, targetId?}` (flashbang, C4, deploy, disable, cashHack, crewSnipe),
`choosePower {key}`, `usePower {key, x, z}`, `fireSuper {x, z}`.

`game.state` shape:
```js
{ time, over: null | {winner:'player'|'enemy', stats:{...}},
  player: { faction, money, powerOut, powerUse, lowPower, radar, pop, popCap,
            rank, xp, nextXp, points, powers:{key:level}, powerCd:{key:secLeft},
            super: null | {id, charge, total, ready},
            upgrades:{key:true}, income (recent $/s for HUD) },
  enemy:  { faction, rank, super: null|{charge,total,ready} /* public info only */ },
  entities: [ { id, side, kind:'unit'|'structure'|'husk'|'crate', key, faction?, x, z, angle,
                hp, maxHp, visible /* to player */, vet, sel:radius,
                // structures: building?:progress0-1, queue?:[{key, progress}], rally?:{x,z}, garrison?:[ids], powered?,
                // disabled?:secs, capture?:{by, progress},
                // units: state:'idle'|'moving'|'attacking'|..., carrying?:$, cargo?:[ids], stealthed?, salvage?:0|1|2
              } ],
  evaQueue: [...consumed by UI via events instead] }
```

Events: `spawn {entity}`, `death {id, x, z, key, kind, side}`, `attack {id, targetId, weapon}`,
`projectile {fromX,fromZ,toX,toZ,weapon,flightTime,arc}`, `hit {x,z,weapon,radius}`, `constructionStart/Complete {id}`,
`upgradeComplete {side,key}`, `sold {id}`, `captureComplete {id, newSide}`, `garrisonChange {id}`,
`crateSpawn/cratePickup {id,x,z}`, `husk {id}`, `powerChanged {side,lowPower}`, `rankUp {side,rank,points}`,
`powerUsed {side,key,x,z,level}`, `superBuilt/superReady/superLaunch {side,key,x,z}`, `superImpact {side,key,x,z}`,
`eva {key, x?, z?}`, `radarPing {x,z,kind}`, `gameOver {winner,stats}`.

Determinism: use a seeded RNG (mulberry32) for all sim randomness. NO Date.now/Math.random in sim.
`scripts/simtest.js`: node script — runs Game + 2 AIControllers headless (all 3 faction matchups, hard),
600 sim-seconds or until gameOver; asserts: no exceptions, money flows, structures built ≥8 per side,
combat events fired, at least one superweapon launched in ≥1 matchup, and a winner declared in ≥1 matchup. Exit 0/1.

## 13.2 GFX (`src/gfx/`)

```js
const gfx = new GfxEngine(canvas);
gfx.attach(game);                 // subscribe to events (idempotent re: dispose)
gfx.update(dt, state);            // every rAF; interpolate positions, drive effects, fog overlay from game.fog
gfx.pick(cx, cy) → {x, z, entityId|null}
gfx.pickRect(x1,y1,x2,y2) → [entityIds]          // player's selectable units in screen rect
gfx.setSelected(ids); gfx.setHover(entityId|null);
gfx.showGhost(structureKey, factionKey, x, z, valid) / gfx.hideGhost();
gfx.showReticle(x, z, radius, color?) / gfx.hideReticle();
gfx.flashRally(structureId, x, z);
gfx.panCamera(dx, dz); gfx.zoomCamera(deltaY); gfx.jumpTo(x, z);
gfx.cameraQuad() → [{x,z}×4]      // ground-plane view corners for minimap frustum
gfx.minimapBase() → HTMLCanvasElement   // 256×256 top-down terrain render, generated once
gfx.screenShake(mag); gfx.dispose();
```

Visual bar: keep/extend the golden-hour desert look (ACES, bloom, PCFSoft 2048 shadows, fog).
Buildings are the star now: distinct primitive-composed architecture per faction (Coalition: crisp
white/grey panels, blue glass, radar dishes; Dominion: red/dark steel, stars, smokestacks, sloped armor;
Syndicate: tan scrap-metal, tarps, spikes, junk piles). Construction animation (rise from ground +
scaffold/crane hint + dust). Damage states (smoke >50%, fire >75%). Power-off desaturation/blinking light.
Fog of war: dark shroud (never seen) vs dimmed explored; enemy entities hidden unless visible; use a
64×64 alpha texture on an overlay plane, smooth-interpolated. Selection: circles + faction-colored health bars.
Veterancy chevrons as floating sprites. Stealth: ghosting shader (player's own stealth units 40% opacity).
Garrisoned civ buildings show side color flag. Crates/husks visible meshes. Superweapon structures animate
(open silo, glow charge). Performance: shared geometries/materials, instanced infantry if needed; 60fps with 160 entities.

## 13.3 UI (`src/ui/`)

```js
Menu(rootEl, {onStart(factionKey, difficulty), factions}) → {show, hide, destroy}
HUD(rootEl, cb) → {
  update(state, ctx),   // ctx = {selection:[entities], factionData, minimapBase, cameraQuad, fog}
  showGameOver(result, stats, {onRematch,onMenu}), showPause({onResume,onRestart,onMenu}), hidePause(),
  setMode(mode),        // 'normal'|'placing'|'targeting'  → cursor hints
  eva(key, text),       // banner + (optional) procedural audio blip
  destroy(), el }
```
Callbacks `cb`: `onBuildSelect(structureKey)`, `onQueueUnit(structureId, unitKey)`, `onCancelQueue(structureId, i)`,
`onSell(id)`, `onUpgrade(structureId, key)`, `onAbility(id, abilityKey)`, `onChoosePower(key)`, `onUsePower(key)`,
`onFireSuper()`, `onSetRally(structureId)`, `onEvacuate(id)`, `onPause()`, `onMinimapNav(x, z)` (click/drag to move camera),
`onMinimapTarget(x, z)` (right-click on minimap = move order — main decides).

HUD layout (Generals-style): top-left minimap is NOT classic — use bottom-LEFT minimap (terrain base +
fog dim + entity dots + white camera frustum + radar-offline static when no radar), bottom command bar:
left = selection info (portraits, HP), center = contextual grid (build menu for builders showing cost/
prereq-locked badges; production queue with progress + cancel; upgrades; abilities), right = general's
panel (rank stars, XP bar, points badge, powers grid with cooldown sweeps + "choose power" picker),
top bar: money (animated count), power meter (green/red), pop, superweapon countdowns (yours + enemy's once detected).
EVA banner top-center. All procedural/inline-SVG art. Keyboard hint footer. Menu: faction select cards
(general portrait as stylized SVG emblem, blurb, unit highlights), difficulty, Start.

## 13.4 INTEGRATION (`src/main.js`)

Owns: input state machine (normal/placing/targeting), selection model, control groups, camera keys,
fixed-step 30Hz loop (`ai.tick` then `game.tick`, accumulator, max 5 steps/frame), pause (sim halts,
gfx keeps rendering), rematch/teardown, EVA wiring, **test hooks** (keep pattern):
`window.__ERRS` array + error listeners; `window.__START(faction, difficulty)`;
`?autostart=<difficulty>[&t=N][&pf=<faction>]` → starts game with a player-side AIController too
(AI vs AI), writes `IC_OK t=N errs=0` into `document.title` every second.

---

# 13.5 CANONICAL ENTITY KEYS (sim factions.js and gfx meshes.js MUST use exactly these)

```
coalition units:      trooper javelin marksman ghost dozer pelican outrider paladin tempest specter falcon meteor
coalition structures: commandCenter fusionReactor barracks supplyCenter warFactory airfield aegis uplink dropZone orbitalLance
dominion units:       conscript hunter hacker mantis dozer supplyTruck warmaster shredder dragon hellstorm emperor vulture
dominion structures:  commandCenter fissionReactor barracks supplyCenter warFactory airfield gatling bunker warCouncil nuclearMissile
syndicate units:      worker militant stinger fanatic cobra technical scorpion quad toxinTractor buggy scud
syndicate structures: commandCenter supplyStash barracks armsBazaar stingerNest tunnel demoTrap citadel blackMarket viperStorm
neutral/world:        civBuilding oilDerrick supplyDock supplyPile crate   (husk = kind:'husk' with original unit key)
```
Mesh lookup dispatches on (faction, key); shared keys like commandCenter/barracks get faction-distinct looks.

# 14. QUALITY BAR & VERIFICATION (cheap, no test frameworks)

1. `node scripts/simtest.js` passes (sim agent delivers this green).
2. `npm run build` clean.
3. Headless Chrome (`--headless=new --use-angle=swiftshader`) screenshots vs dev server:
   menu, early game (?autostart), mid-game t=180 — zero console errors, title shows IC_OK.
4. Visual review of screenshots: must read as "modernized Generals" — distinct bases, readable armies,
   working fog, full HUD.

Balance sanity (sim agent): hard-AI mirror match should last 8–20 sim-minutes; collectors pay back in
<90s; superweapon fires before minute 8 in a passive game.

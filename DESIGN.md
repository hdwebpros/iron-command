# IRON COMMAND — Design & Architecture Contract

A Command & Conquer Rivals–style 1v1 RTS vs AI. Browser game: Vite + Three.js (npm). Desktop only, mouse + hotkeys. No save games. Modern, realistic look (PBR, shadows, bloom, particles) — must look far better than C&C Generals: Zero Hour.

## Tech / layout (STRICT FILE OWNERSHIP — do not touch files outside your module)

```
package.json, vite.config.js, index.html   (pre-scaffolded; only integration may edit)
src/sim/   constants.js units.js game.js ai.js     ← SIM agent
src/gfx/   renderer.js meshes.js effects.js terrain.js  ← GFX agent
src/ui/    menu.js hud.js styles.css               ← UI agent
src/main.js                                        ← integration only
```

All modules are ES modules. Sim has ZERO imports from gfx/ui/three. Gfx imports `three` only. UI is plain DOM/CSS (no framework).

## Game rules

Battlefield: rectangular board, world units = "tiles". Board is 14 wide (x: -7..7) × 22 long (z: -11..11). Player base at z=+10, enemy base at z=-10. Bases have 1000 HP. Win = enemy base at 0 HP. Base auto-defense turret: range 4, 30 dps vs ground & air.

**Missile pads (superweapon core):** 3 capture pads at z=0, x = -4.5, 0, 4.5. A pad is captured by a side when only that side has ground units within 1.5 tiles for 3 continuous seconds (contested = paused). Holding ≥2 pads charges your nuke meter at 8%/sec (3 pads: 14%/sec). At 100%, a nuclear missile launches from the center silo at the opposing base: 300 damage + screen-shaking explosion. Meter resets; pads stay captured.

**Economy:** Start 300 credits. Passive +12 credits/sec. Two tiberium fields (x=±5, z=±5, one in each half). A `harvester` unit parked at a field adds +14/sec while alive there (max 1 effective per field per side). Unit costs below.

**Combat:** Armor classes: `infantry`, `vehicle`, `air`, `building`. Damage multiplier table (attacker damageType → target class):

| dmgType \ target | infantry | vehicle | air | building |
|---|---|---|---|---|
| bullet  | 1.5 | 0.5 | 0.75 | 0.5 |
| cannon  | 0.5 | 1.5 | 0   | 1.25 |
| missile | 0.75| 1.25| 1.5 | 1.0 |
| flame   | 1.75| 0.75| 0   | 1.5 |

Units have: hp, dps, range (tiles), speed (tiles/sec), sight 6, armorClass, damageType, canTargetAir(bool), cost, buildCooldown (sec, per-card). Units are deployed onto your half (z sign of your side, |z| ≥ 2 from center... deploy zone: your-side rows |z| between 5 and 9, any x). After deploy, unit AI: advance toward nearest priority target (enemy units in sight > nearest uncaptured/enemy pad > enemy base), attack when in range. Player can order: select own unit (click) then right-click a position → unit moves there and holds (attacks in range, doesn't chase beyond 3 tiles). Float positions, no pathfinding; simple steering + pairwise separation (radius 0.45, push apart). Air units ignore separation with ground.

**Projectiles:** instant-hit for bullets (sim applies damage on attack tick, emits `attack` event); cannon/missile/flame emit `projectile` event with flight time = dist/projSpeed (sim applies damage on arrival).

## Generals (player picks one; AI picks a random other)

Each: 6 regular units + 1 hero (hero: one alive at a time, card disabled while alive). Costs in credits, cooldown sec.

**Gen. Vance "STEEL" — Armor Division.** Power: Artillery Barrage (Q): 8 shells over 2s in a 3-tile radius target circle, 80 dmg each, cooldown 90s.
1. Rifle Squad — 100c, 5cd — inf, bullet, hp 220, dps 30, rng 4, spd 1.6, no-air
2. Missile Team — 175c, 8cd — inf, missile, hp 180, dps 38, rng 5, spd 1.4, AIR-OK
3. Scorpion Tank — 300c, 10cd — veh, cannon, hp 520, dps 55, rng 4.5, spd 1.8, no-air
4. Gatling Track — 250c, 9cd — veh, bullet, hp 380, dps 48, rng 4, spd 2.0, AIR-OK
5. Siege Howitzer — 450c, 14cd — veh, cannon, hp 300, dps 70, rng 8 (min range 3), spd 1.1, no-air
6. Harvester — 200c, 12cd — veh, none (dps 0), hp 600, spd 1.5
H. GOLIATH SUPERTANK (hero) — 900c, 30cd — veh, cannon, hp 1800, dps 110, rng 5, spd 1.3, AIR-OK (twin cannon + AA pod)

**Gen. Kira "PHANTOM" — Stealth & Air.** Power: EMP Strike (Q): 4-tile radius, enemy vehicles & air stunned 6s (speed/dps 0), cd 75s.
1. Recon Squad — 90c, 5cd — inf, bullet, hp 180, dps 26, rng 4, spd 2.2, no-air
2. Stinger Squad — 175c, 8cd — inf, missile, hp 170, dps 36, rng 5.5, spd 1.5, AIR-OK
3. Venom Drone — 220c, 8cd — air, bullet, hp 240, dps 40, rng 4, spd 3.0, no-air
4. Razor Jet — 350c, 12cd — air, missile, hp 320, dps 60, rng 5, spd 3.4, AIR-OK
5. Phantom Tank — 380c, 12cd — veh, cannon, hp 420, dps 50, rng 4.5, spd 2.0, STEALTH (untargetable unless within 2 tiles of an enemy or while attacking), no-air
6. Harvester — 200c, 12cd — (same as Steel's)
H. SPECTRE GUNSHIP (hero) — 950c, 30cd — air, flame+missile (use damageType missile, AIR-OK), hp 1400, dps 95, rng 5.5, spd 2.2

**Gen. Marcus "HAMMER" — Infantry Horde.** Power: Napalm Run (Q): plane strafes a line (6×2 tiles), 150 flame dmg + ground burns 20 dps for 5s, cd 80s.
1. Conscript Mob — 70c, 4cd — inf, bullet, hp 260 (squad of 4 visual), dps 34, rng 3.5, spd 1.7, no-air
2. RPG Brigade — 160c, 7cd — inf, missile, hp 200, dps 40, rng 5, spd 1.4, AIR-OK
3. Flame Trooper — 180c, 8cd — inf, flame, hp 240, dps 55, rng 2.5, spd 1.6, no-air
4. Technical — 200c, 7cd — veh, bullet, hp 280, dps 42, rng 4, spd 2.6, AIR-OK
5. Mortar Crew — 320c, 12cd — inf, cannon, hp 220, dps 60, rng 7 (min 2.5), spd 1.2, no-air
6. Harvester — 200c, 12cd — (same)
H. WARLORD MECH (hero) — 850c, 30cd — veh, flame, hp 1500, dps 100, rng 3.5, spd 1.5, AIR-OK (flame + AA rack), aura: friendly infantry within 3 tiles +25% dps

## AI difficulties (src/sim/ai.js)

AIController(game, side, difficulty). Decision tick every `thinkInterval`. Builds counters to what player fields (check damage table), contests pads, deploys harvester early, saves for hero, uses power when ≥3 enemies clustered. 
- easy: thinkInterval 4s, income ×0.75, never builds hero, random-ish unit choice (60% random / 40% counter), ignores pads 50% of the time.
- hard: 2s, income ×1.0, counters properly, contests pads, hero when affordable.
- brutal: 1s, income ×1.25, perfect counters, focuses pads, leads with harvester, saves power for max-value strikes, micro: pulls units below 25% hp back 2 tiles if ranged.

## Sim API (src/sim/game.js) — THE contract

```js
new Game({ playerGeneral: 'steel'|'phantom'|'hammer', aiGeneral, difficulty })
game.tick(dt)                       // fixed-step capable, dt seconds
game.deploy(side, unitKey, x, z)    // validates zone+cost+cooldown → unit or null
game.orderMove(unitId, x, z)        // player unit move-and-hold order
game.usePower(side, x, z)           // general power at location, false if on cd
game.state = {
  time, credits: {player, enemy}, baseHp: {player, enemy},
  nuke: {player: 0..100, enemy: 0..100}, pads: [{x, z, owner: null|'player'|'enemy', progress}],
  cooldowns: {player: {unitKey: secLeft,...}, enemy: {...}}, powerCd: {player, enemy},
  units: [{id, side, key, def, x, z, hp, maxHp, facing, state:'moving'|'attacking'|'idle', targetId, stunned, stealthed}],
  over: null | {winner: 'player'|'enemy'}
}
game.on(event, fn) // events: 'spawn'{unit} 'death'{unit} 'attack'{unit,target} (every shot/burst, ~2/sec max per unit)
                   // 'projectile'{from:{x,z}, to:{x,z}, dmgType, flightTime, targetAir}
                   // 'hit'{x,z,dmgType} 'nukeLaunch'{side,impactZ} 'nukeImpact'{x,z}
                   // 'padCaptured'{pad,owner} 'powerUsed'{side,key,x,z} 'baseHit'{side} 'gameOver'{winner}
```
Sides are 'player' (z>0) and 'enemy' (z<0). Unit `key` strings: lowercase snake (`rifle_squad`, `goliath`...). `def` includes `name, cost, hero, armorClass, damageType, isHarvester, stealth, minRange, canTargetAir, squadSize` (visual count). GENERALS export in units.js: `{steel:{name,title,desc,color,power:{key,name,desc,cd,radius},units:[unitKeys...7]}, ...}`.

## Gfx API (src/gfx/renderer.js)

```js
const gfx = new GfxEngine(canvasEl)
gfx.attach(game)                 // subscribes to events
gfx.update(dt, game.state)       // interpolate meshes ← unit positions, run particles
gfx.pick(clientX, clientY) → {x, z, unitId|null}   // raycast board/units
gfx.setHover(x, z) / gfx.showDeployZone(side, unitKey|null) / gfx.setSelected(unitId|null)
gfx.screenShake(strength)
gfx.dispose()
```
Visual bar: PBR-ish StandardMaterials, ACES tone mapping, directional sun + shadows (2048 map), hemisphere fill, UnrealBloomPass, dust/sky fog. Terrain: desert/scrubland built in terrain.js — displaced plane, canvas-procedural diffuse+roughness (sand, cracked earth, scorch near center, faint tire tracks), road strips, rocks, crystal tiberium fields (emissive green), concrete missile silo + 3 capture pads (team-colored emissive rings), two bases (command center buildings w/ turret). Units in meshes.js: composed primitives per unit key (tanks w/ turrets that face targets, infantry as small soldier figures ×squadSize, aircraft hovering+banking, hero units big & distinctive w/ team-color trim + idle animation). Team colors: player #2e7bff, enemy #e03c2e. Effects in effects.js: muzzle flashes, tracer lines, shell/missile projectiles w/ smoke trails, flamethrower cone, explosions (light flash + sprite particles + smoke), EMP ring, napalm wall, artillery strikes, nuke (launch from silo, descend, white flash, fireball, mushroom cloud, shockwave ring, screenShake). Health bars: tiny camera-facing quads above damaged units (green→red). Selected unit: ground ring. Camera: perspective ~50° looking down the board from player side at ~35° elevation; subtle idle drift; WASD/edge pan ±4 tiles, wheel zoom 18–34.

## UI (src/ui/) — plain DOM over canvas

menu.js: start screen (full-screen, animated gradient/canvas backdrop with slow-drifting embers + vignette, big metallic title "IRON COMMAND", subtitle "Tactical Warfare"). Buttons: NEW GAME → general select (3 cards: name, title, color, power + roster summary, hover glow) → difficulty (EASY / HARD / BRUTAL with flavor text) → launches game. Military-industrial aesthetic: dark steel panels, amber/cyan accents, chamfered corners, scanline texture, Orbitron-like font (use a bundled @font-face fallback stack: 'Orbitron', 'Rajdhani', sans-serif via Google Fonts link in index.html is NOT allowed — must work offline; use system stack + letter-spacing + weight to fake it).
hud.js: bottom bar of 7 unit cards (icon = inline SVG silhouette per unit, name, cost, hotkey number badge, cooldown radial sweep, disabled when unaffordable — desaturated), credits counter (animated count-up), top: two base HP bars + nuke charge meters with warning flash ≥80%, general power button (Q, radial cooldown), pad ownership pips, game clock. Victory/defeat overlay (MISSION ACCOMPLISHED / MISSION FAILED, stats: units built, units lost, damage dealt, time) + [MAIN MENU] [REMATCH]. Pause menu on Esc (resume / restart / main menu / hotkey reference).
**Hotkeys:** 1–7 select card → cursor enters deploy mode (click board to place, right-click/Esc cancels). Q = power-target mode. Space = re-center camera. P or Esc = pause. H = select hero if alive. Tab = toggle stats overlay (fps, unit counts). UI exposes `Menu(rootEl, {onStart(cfg)})` and `HUD(rootEl, {game, onDeployRequest(unitKey), onPowerRequest(), onPause()})` + `hud.update(state)` per frame; main.js owns pointer logic on canvas, calls into both.

## Integration (src/main.js)

Fixed-step sim (60hz accumulator), rAF render loop, pointer handling (deploy placement w/ zone validation ghost, unit select, right-click orders, power targeting reticle), wires Menu→Game→HUD→Gfx, AI tick inside game loop, handles rematch/menu (dispose & rebuild). Pause stops sim ticks, not rendering.

## Quality bar

No console errors. `npm run build` must pass. 60fps with 60+ units (reuse geometries/materials — build shared geo/mat caches at module load; no per-frame allocation in hot loops). All numbers above are starting points — small balance tweaks fine if something is degenerate.

#!/usr/bin/env node
// ─── FREEDOM FIGHT — bake painted hotbar icon art via Gemini image gen ────────
// Generates one 1024px card portrait per entity/ability/power key into
// assets-raw/icons/<key>.png (resumable: existing files are skipped).
// Downscaling to public/icons/*.webp happens in a separate PIL step.
//
//   node scripts/gen-icons.mjs           # generate all missing
//   node scripts/gen-icons.mjs paladin   # regenerate specific keys (overwrites)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets-raw', 'icons');
mkdirSync(OUT, { recursive: true });

const KEY = readFileSync(join(ROOT, '.env'), 'utf8').match(/AI_STUDIO_KEY=(\S+)/)?.[1];
if (!KEY) { console.error('AI_STUDIO_KEY missing from .env'); process.exit(1); }
const MODEL = 'gemini-3.1-flash-image';
const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`;

const STYLE = (subject) =>
  `Square game icon for a gritty real-time strategy game, in the style of Command & Conquer Generals unit portrait cards. ` +
  `Hand-painted digital art, dramatic warm side lighting, dark smoky olive-steel background, subject centered filling 80% of the frame, ` +
  `slight high 3/4 angle. No text, no watermark, no border, no UI elements. Subject: ${subject}.`;

// Faction flavor: coalition = sleek navy-blue US-style tech, dominion = brutal
// red-accented Soviet-style steel, syndicate = scavenged green desert-militia.
const SUBJECTS = {
  // ── coalition units ──
  trooper:  'a modern assault infantry soldier in navy-blue-accented combat armor aiming a bullpup rifle',
  javelin:  'a kneeling soldier in blue-accented armor shouldering a boxy anti-tank missile launcher',
  marksman: 'a camouflaged military sniper aiming a long scoped anti-personnel rifle, blue accents',
  ghost:    'an elite stealth commando hero in a sleek black-and-blue cloaking suit with silenced carbine and glowing blue visor',
  dozer:    'an armored military construction bulldozer with blue accent panels and heavy plow blade',
  pelican:  'a twin-rotor military cargo VTOL transport aircraft with blue accents, carrying a supply container',
  outrider: 'a fast armored 4x4 military scout vehicle with roof-mounted machine gun, navy-blue accents',
  paladin:  'a modern main battle tank with composite armor and a long 120mm cannon, navy-blue accent panels',
  tempest:  'a tracked multiple-launch rocket artillery vehicle with raised rocket pod, blue accents',
  specter:  'a heavy four-engine stealth gunship aircraft with side-mounted cannons, dark navy paint',
  falcon:   'a sleek air-superiority stealth jet fighter banking through clouds, navy-blue accents',
  meteor:   'a massive flying-wing stealth strategic bomber silhouetted against fire below, dark blue',
  // ── dominion units ──
  conscript:  'a pair of massed conscript riflemen in olive greatcoats with red star helmets',
  hunter:     'a soldier in red-accented gear shouldering a smoking RPG rocket launcher',
  hacker:     'a military cyber-warfare specialist crouched behind a glowing red laptop terminal',
  mantis:     'a sinister female infiltrator hero in a form-fitting red-and-black stealth suit with glowing red devices',
  supplyTruck:'a heavy 8-wheel military supply truck with covered cargo bed, red accents',
  warmaster:  'a brutal heavy battle tank with thick angular welded armor, red accents, soviet style',
  shredder:   'a tracked anti-aircraft vehicle with quad flak autocannons blazing skyward, red accents',
  dragon:     'a flamethrower tank spewing twin jets of fire, red accents, scorched armor',
  hellstorm:  'a long-barreled self-propelled howitzer artillery piece firing at high angle, red accents',
  emperor:    'a colossal twin-cannon super-heavy overlord tank crushing rubble, red banners',
  vulture:    'an angular red-accented strike jet with underwing missile pods diving to attack',
  // ── syndicate units ──
  worker:     'a scrappy desert laborer with a shovel, tool belt and green headband',
  militant:   'a desert militia fighter with an AK rifle and green scarf, bandolier of ammunition',
  stinger:    'a militia soldier aiming a shoulder-fired stinger anti-air missile launcher, green accents',
  fanatic:    'a wild-eyed cultist strapped with an explosive vest holding a detonator, green cloth wraps',
  cobra:      'a deadly mercenary sniper hero with a massive anti-materiel rifle and green-black desert gear, face wrapped',
  technical:  'a battered desert pickup truck with a mounted heavy machine gun in the bed, green accents',
  scorpion:   'a light desert tank with a single cannon and welded scrap armor plates, green accents',
  quad:       'a desert truck with quad-barreled anti-aircraft cannons mounted on the back, green accents',
  toxinTractor:'a rusty armored farm tractor with bubbling green toxin sprayer tanks leaking vapor',
  buggy:      'a fast desert attack buggy with a rack of rocket tubes, green accents, kicking up sand',
  scud:       'a wheeled ballistic missile launcher truck with a raised scud missile, green accents',
  // ── structures ──
  commandCenter:  'a fortified military command center headquarters with satellite dishes and radio masts',
  fusionReactor:  'a high-tech fusion power plant with a glowing blue energy core and cooling vanes',
  fissionReactor: 'a nuclear fission reactor with cooling tower, red warning lights and steam',
  barracks:       'a sandbagged military barracks building with a flag and training yard',
  supplyCenter:   'a military logistics supply depot with a crane unloading cargo containers',
  supplyStash:    'a scrap-built desert warehouse stash with tarps, crates and loot piles, green accents',
  warFactory:     'a heavy war factory with open assembly bay and a tank chassis on the line',
  armsBazaar:     'a desert arms bazaar with weapon crates, hanging rifles and market tents, green accents',
  airfield:       'a military airfield with control tower, hangar and a jet on the runway',
  aegis:          'a high-tech anti-air laser missile defense battery with radar dish, blue accents',
  gatling:        'a defensive gatling cannon turret emplacement with spinning barrels, red accents',
  stingerNest:    'a sandbagged missile nest bunker with three militia soldiers and stinger launchers, green accents',
  bunker:         'a squat concrete defensive bunker with firing slits and barbed wire, red accents',
  tunnel:         'a fortified tunnel network entrance with timber supports dug into desert earth, green accents',
  demoTrap:       'a hidden demolition trap of wired explosive barrels half-buried in sand',
  uplink:         'a satellite uplink command station with a huge dish antenna aimed skyward, blue accents',
  warCouncil:     'an imposing propaganda war council headquarters with red banners and a star emblem',
  citadel:        'a fortified desert citadel palace with high stone walls and watchtowers, green banners',
  dropZone:       'a military paradrop landing zone platform with smoke flares and a descending cargo plane',
  blackMarket:    'a shady black market depot stacked with crates of smuggled weapons under camouflage netting',
  orbitalLance:   'a massive orbital laser cannon array charging with blue energy, aimed at the sky',
  nuclearMissile: 'an open nuclear missile silo with a rising ICBM and red warning lights',
  viperStorm:     'a field of chemical rocket launch tubes venting toxic green gas',
  civBuilding:    'a war-damaged civilian office building with broken windows',
  oilDerrick:     'a pumping oil derrick with storage tank at sunset',
  supplyDock:     'a cargo dock stacked with glowing supply crates and a loading crane',
  supplyPile:     'a pile of glowing salvage crates and scrap metal',
  // ── unit abilities (emblematic) ──
  flashbang: 'a flashbang grenade detonating in a blinding white starburst',
  c4:        'a C4 plastic explosive charge with a red digital timer and wires',
  deploy:    'a rugged military laptop terminal unfolding with glowing green code',
  disable:   'a sparking disabled circuit board pierced by a red kill-switch dagger of electricity',
  cashHack:  'a glowing green digital dollar sign dissolving into streams of code',
  crewSnipe: 'a sniper scope crosshair with a red lens glint over darkness',
  // ── general's powers (emblematic) ──
  spyDrone:   'a small hovering surveillance drone with a glowing camera eye',
  paradrop:   'paratroopers descending under parachutes from a cargo plane at dawn',
  strikeWing: 'a flight of three jets diving in formation firing missiles',
  fuelAir:    'a massive fuel-air explosion mushroom fireball over a battlefield',
  artillery:  'an artillery barrage of shells raining down explosions on a battlefield',
  cashHackP:  'streams of stolen digital cash, green code and dollar signs pouring from a cracked vault screen',
  clusterMines:'scattered spiked land mines half-buried in cracked desert earth',
  empBomb:    'an electromagnetic pulse shockwave ring of blue lightning expanding outward',
  ambush:     'desert militia fighters bursting from concealment under sand tarps with rifles raised',
  cashBounty: 'a stack of gold coins and cash bills marked with a red target reticle',
  sneakAttack:'a tunnel hole torn open in the ground at night with armed fighters climbing out',
  anthrax:    'a green biohazard bomb shrouded in a toxic vapor cloud',
};

const only = process.argv.slice(2);
const keys = only.length ? only : Object.keys(SUBJECTS);
const queue = keys.filter((k) => {
  if (!SUBJECTS[k]) { console.warn('unknown key', k); return false; }
  return only.length || !existsSync(join(OUT, k + '.png'));
});
console.log(`${queue.length} icons to generate (of ${keys.length})`);

async function genOne(key, attempt = 0) {
  const body = {
    contents: [{ parts: [{ text: STYLE(SUBJECTS[key]) }] }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1' } },
  };
  const res = await fetch(URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 5) throw new Error(`${key}: giving up after ${res.status}`);
    const wait = Math.min(60, 5 * 2 ** attempt);
    console.log(`  ${key}: ${res.status}, retry in ${wait}s`);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return genOne(key, attempt + 1);
  }
  if (!res.ok) throw new Error(`${key}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const d = await res.json();
  const part = d.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) throw new Error(`${key}: no image in response ${JSON.stringify(d).slice(0, 200)}`);
  writeFileSync(join(OUT, key + '.png'), Buffer.from(part.inlineData.data, 'base64'));
  console.log(`✓ ${key}`);
}

const CONCURRENCY = 3;
let failed = 0;
async function worker() {
  while (queue.length) {
    const key = queue.shift();
    try { await genOne(key); } catch (e) { failed++; console.error('✗', e.message); }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(failed ? `done with ${failed} failures (rerun to retry)` : 'all done');
process.exit(failed ? 1 : 0);

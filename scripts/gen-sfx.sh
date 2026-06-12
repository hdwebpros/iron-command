#!/usr/bin/env bash
# Generate Freedom Fight's SFX library + EVA voice lines via ElevenLabs.
# Usage: bash scripts/gen-sfx.sh   (requires ELEVENLABS_API in .env)
set -u
cd "$(dirname "$0")/.."
source .env
OUT=public/sfx
mkdir -p "$OUT"

gen_sfx() { # name duration prompt
  local name="$1" dur="$2" prompt="$3" f="$OUT/$1.mp3"
  [ -s "$f" ] && { echo "skip  $name"; return; }
  local body
  body=$(printf '{"text":%s,"duration_seconds":%s,"prompt_influence":0.45}' \
    "$(printf '%s' "$prompt" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')" "$dur")
  local code
  code=$(curl -s -w "%{http_code}" -o "$f" -X POST \
    "https://api.elevenlabs.io/v1/sound-generation" \
    -H "xi-api-key: $ELEVENLABS_API" -H "Content-Type: application/json" -d "$body")
  if [ "$code" = "200" ]; then echo "ok    $name"; else echo "FAIL  $name http=$code $(head -c 200 "$f")"; rm -f "$f"; fi
}

gen_tts() { # name text
  local name="$1" text="$2" f="$OUT/$1.mp3"
  [ -s "$f" ] && { echo "skip  $name"; return; }
  local body
  body=$(printf '{"text":%s,"model_id":"eleven_multilingual_v2","voice_settings":{"stability":0.6,"similarity_boost":0.8}}' \
    "$(printf '%s' "$text" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')")
  local code
  code=$(curl -s -w "%{http_code}" -o "$f" -X POST \
    "https://api.elevenlabs.io/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL" \
    -H "xi-api-key: $ELEVENLABS_API" -H "Content-Type: application/json" -d "$body")
  if [ "$code" = "200" ]; then echo "ok    $name"; else echo "FAIL  $name http=$code $(head -c 200 "$f")"; rm -f "$f"; fi
}

# ── weapon fire ──────────────────────────────────────────────────────────────
gen_sfx shot_rifle   1.0 "short assault rifle burst, three rounds, punchy dry military gunfire, no reverb tail" &
gen_sfx shot_gatling 1.2 "rapid minigun gatling gun burst, very fast fire rate, mechanical whirring, punchy" &
gen_sfx shot_cannon  1.5 "tank main cannon single shot, deep powerful boom with a sharp crack, military" &
gen_sfx shot_missile 1.2 "subtle quiet rocket launch, soft muffled whoosh fading into the distance, gentle airy hiss, understated" &
gen_sfx shot_flame   1.5 "flamethrower burst, roaring whoosh of fire with deep crackle" &
gen_sfx shot_toxin   1.2 "pressurized chemical sprayer burst, liquid spray hiss, sizzling" &
gen_sfx shot_sniper  1.2 "single suppressed sniper rifle shot, quiet muffled thump through a silencer, soft mechanical bolt click, subdued" &
gen_sfx shot_beam    1.2 "soft science fiction laser zap, quiet focused energy pulse, gentle electric fizz, understated" &
# ── impacts & deaths ─────────────────────────────────────────────────────────
gen_sfx exp_small    1.4 "small explosion, sharp concussive blast with light debris, short tail" &
gen_sfx exp_big      2.5 "large powerful explosion, deep bass boom with rumbling debris tail" &
gen_sfx flash        1.0 "flashbang stun grenade pop with brief high pitched ringing" &
gen_sfx die_infantry 1.0 "quick male soldier death grunt, short pained cry, battlefield" &
gen_sfx die_vehicle  1.8 "armored vehicle exploding, bursting metal explosion with clattering debris" &
gen_sfx die_structure 2.5 "large building collapsing, deep rumble, concrete crumbling, settling dust" &
# ── superweapons ─────────────────────────────────────────────────────────────
gen_sfx super_nuke   4.0 "nuclear bomb detonation, colossal deep blast with a long rumbling shockwave tail" &
gen_sfx super_beam   3.5 "giant orbital laser beam firing down from the sky, sustained searing energy hum, crackling air" &
gen_sfx super_launch 2.5 "missile silo launching, warning klaxon then huge rocket ignition roar" &
# ── economy / ui ─────────────────────────────────────────────────────────────
gen_sfx build_place  1.0 "heavy construction placement, hydraulic clank and power tools starting up" &
gen_sfx build_done   1.0 "positive two tone science fiction confirmation chime" &
gen_sfx unit_ready   0.8 "short military radio acknowledgment chirp beep" &
gen_sfx sold         1.0 "cash register cha-ching with falling coins" &
gen_sfx crate        0.8 "bright bonus pickup chime, sparkling treasure" &
gen_sfx rankup       1.5 "short triumphant brass fanfare sting, military promotion" &
gen_sfx alert        1.2 "urgent military base alarm klaxon, two blasts" &
gen_sfx win          2.5 "victory fanfare, triumphant orchestral brass sting with snare drums" &
gen_sfx lose         2.5 "defeat sting, dark somber low brass and a heavy drum hit" &
# ── EVA announcer voice lines (calm female mission-control voice) ────────────
gen_tts eva_constructionComplete "Construction complete."
gen_tts eva_unitReady "Unit ready."
gen_tts eva_lowPower "Warning: low power."
gen_tts eva_baseUnderAttack "Our base is under attack!"
gen_tts eva_unitsUnderAttack "Our forces are under attack."
gen_tts eva_harvesterUnderAttack "Our harvesters are under attack."
gen_tts eva_enemySuperDetected "Warning: enemy superweapon detected."
gen_tts eva_enemySuperReady "Warning: enemy superweapon ready."
gen_tts eva_superLaunchDetected "Superweapon launch detected!"
gen_tts eva_ourSuperReady "Superweapon ready. Select a target."
gen_tts eva_promotion "General promoted. Promotion point available."
gen_tts eva_capturedDerrick "Oil derrick captured."
gen_tts eva_insufficientFunds "Insufficient funds."
gen_tts eva_victory "Victory. Enemy command destroyed."
gen_tts eva_defeat "Our command has fallen."
echo "DONE: $(ls "$OUT" | wc -l) files in $OUT"

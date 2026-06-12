#!/usr/bin/env bash
# gen-voices.sh — Unit acknowledgment voice pack generator for Freedom Fight
# Idempotent: skips existing non-empty files. Batches of 4 with wait. Retries once on failure.
# Output: public/sfx/voice/<unitKey>_<action><n>.mp3

set -euo pipefail

API_KEY="${ELEVENLABS_API:-}"
if [[ -z "$API_KEY" ]]; then
  # try loading from .env in project root
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  ENV_FILE="$SCRIPT_DIR/../.env"
  if [[ -f "$ENV_FILE" ]]; then
    API_KEY="$(grep -m1 'ELEVENLABS_API' "$ENV_FILE" | cut -d= -f2- | tr -d '[:space:]')"
  fi
fi
if [[ -z "$API_KEY" ]]; then
  echo "ERROR: ELEVENLABS_API not set and not found in .env" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$SCRIPT_DIR/../public/sfx/voice"
mkdir -p "$OUT_DIR"

BATCH_COUNT=0
PIDS=()
LABELS=()

# ─── TTS call ────────────────────────────────────────────────────────────────
# gen <unitKey> <action> <n> <voice_id> <stability> <similarity> <style> <text>
gen() {
  local unit="$1" action="$2" n="$3" voice_id="$4" stability="$5" similarity="$6" style="$7"
  shift 7
  local text="$*"
  local out="$OUT_DIR/${unit}_${action}${n}.mp3"
  local label="${unit}_${action}${n}"

  if [[ -f "$out" && $(wc -c < "$out") -gt 1000 ]]; then
    echo "skip  $label"
    return 0
  fi

  (
    local http_code tmp
    tmp=$(mktemp)
    http_code=$(curl -s -o "$tmp" -w "%{http_code}" -X POST \
      "https://api.elevenlabs.io/v1/text-to-speech/${voice_id}" \
      -H "xi-api-key: ${API_KEY}" \
      -H "Content-Type: application/json" \
      -d "{\"text\":\"${text}\",\"model_id\":\"eleven_multilingual_v2\",\"voice_settings\":{\"stability\":${stability},\"similarity_boost\":${similarity},\"style\":${style}}}")

    if [[ "$http_code" == "200" && $(wc -c < "$tmp") -gt 1000 ]]; then
      mv "$tmp" "$out"
      echo "ok    $label"
    else
      # retry once after 4s
      sleep 4
      http_code=$(curl -s -o "$tmp" -w "%{http_code}" -X POST \
        "https://api.elevenlabs.io/v1/text-to-speech/${voice_id}" \
        -H "xi-api-key: ${API_KEY}" \
        -H "Content-Type: application/json" \
        -d "{\"text\":\"${text}\",\"model_id\":\"eleven_multilingual_v2\",\"voice_settings\":{\"stability\":${stability},\"similarity_boost\":${similarity},\"style\":${style}}}")
      if [[ "$http_code" == "200" && $(wc -c < "$tmp") -gt 1000 ]]; then
        mv "$tmp" "$out"
        echo "ok    $label (retry)"
      else
        rm -f "$tmp"
        echo "FAIL  $label (http $http_code)"
      fi
    fi
  ) &

  PIDS+=($!)
  LABELS+=("$label")
  BATCH_COUNT=$((BATCH_COUNT + 1))

  if [[ $BATCH_COUNT -ge 4 ]]; then
    wait "${PIDS[@]}"
    PIDS=()
    LABELS=()
    BATCH_COUNT=0
    sleep 1
  fi
}

flush() {
  if [[ ${#PIDS[@]} -gt 0 ]]; then
    wait "${PIDS[@]}"
    PIDS=()
    LABELS=()
    BATCH_COUNT=0
  fi
}

# Voice IDs (probed working)
GEORGE="JBFqnCBsd6RMkjVDRZzb"   # m, British authoritative
ALICE="Xb7hH8MSUJpSbSDYk0k2"    # f, British

# ═══════════════════════════════════════════════════════════════════════════
# COALITION — professional western military, crisp and confident
# ═══════════════════════════════════════════════════════════════════════════

# trooper — rifleman, George, standard military (stability 0.55, style 0.3)
gen trooper select 1 "$GEORGE" 0.55 0.80 0.30 "Trooper, ready."
gen trooper select 2 "$GEORGE" 0.55 0.80 0.30 "On standby, sir."
flush
gen trooper move   1 "$GEORGE" 0.55 0.80 0.30 "Moving out."
gen trooper move   2 "$GEORGE" 0.55 0.80 0.30 "Route confirmed."
flush
gen trooper attack 1 "$GEORGE" 0.55 0.80 0.45 "CONTACT. Engaging."
gen trooper attack 2 "$GEORGE" 0.55 0.80 0.45 "Opening fire NOW."
flush

# javelin — AA missile infantry, George, focused (stability 0.5, style 0.35)
gen javelin select 1 "$GEORGE" 0.50 0.80 0.35 "Javelin team, locked."
gen javelin select 2 "$GEORGE" 0.50 0.80 0.35 "Missile system online."
flush
gen javelin move   1 "$GEORGE" 0.50 0.80 0.35 "Repositioning for coverage."
gen javelin move   2 "$GEORGE" 0.50 0.80 0.35 "New firing position, copy."
flush
gen javelin attack 1 "$GEORGE" 0.50 0.80 0.50 "MISSILE AWAY!"
gen javelin attack 2 "$GEORGE" 0.50 0.80 0.50 "Target ACQUIRED. Firing."
flush

# marksman — sniper, stealth when still, Alice, cool/precise (stability 0.65, style 0.25)
gen marksman select 1 "$ALICE" 0.65 0.80 0.25 "Marksman, in position."
gen marksman select 2 "$ALICE" 0.65 0.80 0.25 "Scope is clear."
flush
gen marksman move   1 "$ALICE" 0.65 0.80 0.25 "Changing overwatch position."
gen marksman move   2 "$ALICE" 0.65 0.80 0.25 "Relocating. Staying low."
flush
gen marksman attack 1 "$ALICE" 0.65 0.80 0.35 "One shot. One kill."
gen marksman attack 2 "$ALICE" 0.65 0.80 0.35 "TARGET DOWN."
flush

# ghost — stealth hero, sniper/C4/knife, Alice, intense and dry (stability 0.60, style 0.50)
gen ghost select 1 "$ALICE" 0.60 0.80 0.50 "Ghost. What's the mission?"
gen ghost select 2 "$ALICE" 0.60 0.80 0.50 "You found me. Impressive."
flush
gen ghost move   1 "$ALICE" 0.60 0.80 0.45 "Like a shadow."
gen ghost move   2 "$ALICE" 0.60 0.80 0.45 "They won't see me coming."
flush
gen ghost attack 1 "$ALICE" 0.60 0.80 0.60 "Terminating. QUIETLY."
gen ghost attack 2 "$ALICE" 0.60 0.80 0.60 "KNIFE OUT. Moving in."
flush

# dozer — shared construction builder, George, workmanlike (stability 0.70, style 0.20)
gen dozer select 1 "$GEORGE" 0.70 0.80 0.20 "Dozer on site."
gen dozer select 2 "$GEORGE" 0.70 0.80 0.20 "Ready to build."
flush
gen dozer move   1 "$GEORGE" 0.70 0.80 0.20 "En route to site."
gen dozer move   2 "$GEORGE" 0.70 0.80 0.20 "Moving equipment."
flush
gen dozer attack 1 "$GEORGE" 0.70 0.80 0.30 "Not what I'm built for, but okay."
gen dozer attack 2 "$GEORGE" 0.70 0.80 0.30 "I'll clear the area."
flush

# pelican — supply helicopter, Alice, upbeat professional (stability 0.55, style 0.40)
gen pelican select 1 "$ALICE" 0.55 0.80 0.40 "Pelican, fuelled and ready."
gen pelican select 2 "$ALICE" 0.55 0.80 0.40 "Supply run standing by."
flush
gen pelican move   1 "$ALICE" 0.55 0.80 0.40 "Inbound to supply point."
gen pelican move   2 "$ALICE" 0.55 0.80 0.40 "On approach. ETA shortly."
flush
gen pelican attack 1 "$ALICE" 0.55 0.80 0.50 "Taking evasive action!"
gen pelican attack 2 "$ALICE" 0.55 0.80 0.50 "I'm a supply bird, not a fighter!"
flush

# outrider — scout/transport/AA missile buggy, George, fast and casual (stability 0.45, style 0.50)
gen outrider select 1 "$GEORGE" 0.45 0.80 0.50 "Outrider. Eyes on."
gen outrider select 2 "$GEORGE" 0.45 0.80 0.50 "Scout team, ready to roll."
flush
gen outrider move   1 "$GEORGE" 0.45 0.80 0.45 "Throttle wide open."
gen outrider move   2 "$GEORGE" 0.45 0.80 0.45 "We're moving, fast."
flush
gen outrider attack 1 "$GEORGE" 0.45 0.80 0.60 "MISSILES! Light them up."
gen outrider attack 2 "$GEORGE" 0.45 0.80 0.60 "On them NOW."
flush

# paladin — main battle tank, George, deep and steady (stability 0.75, style 0.30)
gen paladin select 1 "$GEORGE" 0.75 0.80 0.30 "Paladin tank, battle ready."
gen paladin select 2 "$GEORGE" 0.75 0.80 0.30 "Main gun loaded."
flush
gen paladin move   1 "$GEORGE" 0.75 0.80 0.25 "Advancing on bearing."
gen paladin move   2 "$GEORGE" 0.75 0.80 0.25 "Tank, rolling forward."
flush
gen paladin attack 1 "$GEORGE" 0.75 0.80 0.45 "CANNON. FIRE!"
gen paladin attack 2 "$GEORGE" 0.75 0.80 0.45 "Engaging armour. FIRING."
flush

# tempest — long-range missile artillery, George, deliberate/technical (stability 0.65, style 0.30)
gen tempest select 1 "$GEORGE" 0.65 0.80 0.30 "Tempest battery, calibrated."
gen tempest select 2 "$GEORGE" 0.65 0.80 0.30 "Long-range fire support, online."
flush
gen tempest move   1 "$GEORGE" 0.65 0.80 0.25 "Displacing to new firing point."
gen tempest move   2 "$GEORGE" 0.65 0.80 0.25 "Battery redeploying."
flush
gen tempest attack 1 "$GEORGE" 0.65 0.80 0.50 "FIRE MISSION. Missiles away."
gen tempest attack 2 "$GEORGE" 0.65 0.80 0.50 "Target coords locked. LAUNCH."
flush

# specter — stealth gunship helicopter, Alice, predatory/focused (stability 0.60, style 0.45)
gen specter select 1 "$ALICE" 0.60 0.80 0.45 "Specter gunship, hunting."
gen specter select 2 "$ALICE" 0.60 0.80 0.45 "Cloaked and on station."
flush
gen specter move   1 "$ALICE" 0.60 0.80 0.40 "Ghosting to new sector."
gen specter move   2 "$ALICE" 0.60 0.80 0.40 "Silent approach."
flush
gen specter attack 1 "$ALICE" 0.60 0.80 0.60 "GUNS GUNS GUNS."
gen specter attack 2 "$ALICE" 0.60 0.80 0.60 "Strafing run. WEAPONS FREE."
flush

# falcon — fast air-to-air jet, George, aggressive/urgent (stability 0.40, style 0.60)
gen falcon select 1 "$GEORGE" 0.40 0.80 0.60 "Falcon flight, armed and spooled."
gen falcon select 2 "$GEORGE" 0.40 0.80 0.60 "Intercept vector ready."
flush
gen falcon move   1 "$GEORGE" 0.40 0.80 0.55 "Heading to sector."
gen falcon move   2 "$GEORGE" 0.40 0.80 0.55 "Flying CAP."
flush
gen falcon attack 1 "$GEORGE" 0.40 0.80 0.70 "FOX TWO! BREAK!"
gen falcon attack 2 "$GEORGE" 0.40 0.80 0.70 "MISSILES AWAY. Splash incoming."
flush

# meteor — strategic bomber, Alice, grave/deliberate (stability 0.80, style 0.20)
gen meteor select 1 "$ALICE" 0.80 0.80 0.20 "Meteor bomber, on alert."
gen meteor select 2 "$ALICE" 0.80 0.80 0.20 "Payload armed and ready."
flush
gen meteor move   1 "$ALICE" 0.80 0.80 0.20 "Proceeding to target area."
gen meteor move   2 "$ALICE" 0.80 0.80 0.20 "Bomb run corridor confirmed."
flush
gen meteor attack 1 "$ALICE" 0.80 0.80 0.35 "Bomb doors open. RELEASING."
gen meteor attack 2 "$ALICE" 0.80 0.80 0.35 "IMPACT in five. Four. Three."
flush

# ═══════════════════════════════════════════════════════════════════════════
# DOMINION — stern, authoritarian, zealous
# ═══════════════════════════════════════════════════════════════════════════

# conscript — horde rifle infantry, George, gruff/scared (stability 0.50, style 0.40)
gen conscript select 1 "$GEORGE" 0.50 0.80 0.40 "Conscript reporting."
gen conscript select 2 "$GEORGE" 0.50 0.80 0.40 "For the Dominion."
flush
gen conscript move   1 "$GEORGE" 0.50 0.80 0.35 "Advancing as ordered."
gen conscript move   2 "$GEORGE" 0.50 0.80 0.35 "Moving. Don't leave us behind."
flush
gen conscript attack 1 "$GEORGE" 0.50 0.80 0.55 "CHARGE! For the State!"
gen conscript attack 2 "$GEORGE" 0.50 0.80 0.55 "Attack! ATTACK!"
flush

# hunter — AA missile infantry, horde, George, aggressive (stability 0.45, style 0.50)
gen hunter select 1 "$GEORGE" 0.45 0.80 0.50 "Hunter unit, missiles primed."
gen hunter select 2 "$GEORGE" 0.45 0.80 0.50 "Ready to kill aircraft."
flush
gen hunter move   1 "$GEORGE" 0.45 0.80 0.45 "New position, move!"
gen hunter move   2 "$GEORGE" 0.45 0.80 0.45 "Following orders."
flush
gen hunter attack 1 "$GEORGE" 0.45 0.80 0.60 "Bring it DOWN."
gen hunter attack 2 "$GEORGE" 0.45 0.80 0.60 "MISSILE LOCKED. FIRE."
flush

# hacker — income unit, Alice, smug/nerdy (stability 0.55, style 0.55)
gen hacker select 1 "$ALICE" 0.55 0.80 0.55 "Connected and ready."
gen hacker select 2 "$ALICE" 0.55 0.80 0.55 "Their systems are mine."
flush
gen hacker move   1 "$ALICE" 0.55 0.80 0.50 "Relocating terminal."
gen hacker move   2 "$ALICE" 0.55 0.80 0.50 "New network access point."
flush
gen hacker attack 1 "$ALICE" 0.55 0.80 0.65 "Uploading PAIN."
gen hacker attack 2 "$ALICE" 0.55 0.80 0.65 "You can't fight what you can't see."
flush

# mantis — dominion stealth hero, hacker/disable, Alice, cold/menacing (stability 0.65, style 0.55)
gen mantis select 1 "$ALICE" 0.65 0.80 0.55 "Mantis. Patience is a weapon."
gen mantis select 2 "$ALICE" 0.65 0.80 0.55 "I see everything. You see nothing."
flush
gen mantis move   1 "$ALICE" 0.65 0.80 0.50 "Slipping through the cracks."
gen mantis move   2 "$ALICE" 0.65 0.80 0.50 "They won't know I was there."
flush
gen mantis attack 1 "$ALICE" 0.65 0.80 0.65 "DISABLE them. Strip their assets."
gen mantis attack 2 "$ALICE" 0.65 0.80 0.65 "STRIKE. Leave nothing standing."
flush

# supplyTruck — dominion collector, George, gruff/working class (stability 0.65, style 0.25)
gen supplyTruck select 1 "$GEORGE" 0.65 0.80 0.25 "Supply truck, engine running."
gen supplyTruck select 2 "$GEORGE" 0.65 0.80 0.25 "Ready to collect."
flush
gen supplyTruck move   1 "$GEORGE" 0.65 0.80 0.25 "Driving to supply."
gen supplyTruck move   2 "$GEORGE" 0.65 0.80 0.25 "Route is clear."
flush
gen supplyTruck attack 1 "$GEORGE" 0.65 0.80 0.40 "I'm a truck, not a tank!"
gen supplyTruck attack 2 "$GEORGE" 0.65 0.80 0.40 "Running them over."
flush

# warmaster — dominion main tank, horde, George, booming/zealous (stability 0.70, style 0.45)
gen warmaster select 1 "$GEORGE" 0.70 0.80 0.45 "Warmaster tank, primed."
gen warmaster select 2 "$GEORGE" 0.70 0.80 0.45 "Steel and fire, ready."
flush
gen warmaster move   1 "$GEORGE" 0.70 0.80 0.40 "The column advances."
gen warmaster move   2 "$GEORGE" 0.70 0.80 0.40 "Crushing all resistance."
flush
gen warmaster attack 1 "$GEORGE" 0.70 0.80 0.60 "ANNIHILATE them!"
gen warmaster attack 2 "$GEORGE" 0.70 0.80 0.60 "OPEN FIRE. Show no mercy."
flush

# shredder — AA gatling vehicle, George, fast-talking/intense (stability 0.45, style 0.55)
gen shredder select 1 "$GEORGE" 0.45 0.80 0.55 "Shredder, barrels spinning."
gen shredder select 2 "$GEORGE" 0.45 0.80 0.55 "Anti-air online."
flush
gen shredder move   1 "$GEORGE" 0.45 0.80 0.50 "Relocating air cover."
gen shredder move   2 "$GEORGE" 0.45 0.80 0.50 "Moving to new grid."
flush
gen shredder attack 1 "$GEORGE" 0.45 0.80 0.70 "SHREDDING! Clear the sky!"
gen shredder attack 2 "$GEORGE" 0.45 0.80 0.70 "GUNS HOT. Come get some."
flush

# dragon — flame tank, George, unhinged/gleeful (stability 0.40, style 0.65)
gen dragon select 1 "$GEORGE" 0.40 0.80 0.65 "Dragon tank. Feed the fire."
gen dragon select 2 "$GEORGE" 0.40 0.80 0.65 "Fuel tanks topped off. Beautiful."
flush
gen dragon move   1 "$GEORGE" 0.40 0.80 0.60 "Bring me something to burn."
gen dragon move   2 "$GEORGE" 0.40 0.80 0.60 "Rolling to new kindling."
flush
gen dragon attack 1 "$GEORGE" 0.40 0.80 0.75 "BURN IT ALL DOWN!"
gen dragon attack 2 "$GEORGE" 0.40 0.80 0.75 "EVERYTHING. ON FIRE. NOW."
flush

# hellstorm — napalm artillery, George, cold satisfaction (stability 0.60, style 0.50)
gen hellstorm select 1 "$GEORGE" 0.60 0.80 0.50 "Hellstorm battery, loaded."
gen hellstorm select 2 "$GEORGE" 0.60 0.80 0.50 "Napalm rounds standing by."
flush
gen hellstorm move   1 "$GEORGE" 0.60 0.80 0.45 "Displacing to range."
gen hellstorm move   2 "$GEORGE" 0.60 0.80 0.45 "New bombardment position."
flush
gen hellstorm attack 1 "$GEORGE" 0.60 0.80 0.65 "HELLFIRE INCOMING. No retreat."
gen hellstorm attack 2 "$GEORGE" 0.60 0.80 0.65 "RAIN napalm on their heads."
flush

# emperor — super-heavy tank, George, imperial/menacing (stability 0.85, style 0.35)
gen emperor select 1 "$GEORGE" 0.85 0.80 0.35 "The Emperor moves."
gen emperor select 2 "$GEORGE" 0.85 0.80 0.35 "Nothing withstands this machine."
flush
gen emperor move   1 "$GEORGE" 0.85 0.80 0.30 "The earth trembles before us."
gen emperor move   2 "$GEORGE" 0.85 0.80 0.30 "Advancing. Make way."
flush
gen emperor attack 1 "$GEORGE" 0.85 0.80 0.50 "CRUSH them beneath our treads."
gen emperor attack 2 "$GEORGE" 0.85 0.80 0.50 "OBLITERATE the opposition."
flush

# vulture — napalm strike jet, George, reckless (stability 0.40, style 0.60)
gen vulture select 1 "$GEORGE" 0.40 0.80 0.60 "Vulture, locked and loaded."
gen vulture select 2 "$GEORGE" 0.40 0.80 0.60 "Napalm delivery, on deck."
flush
gen vulture move   1 "$GEORGE" 0.40 0.80 0.55 "Heading to strike zone."
gen vulture move   2 "$GEORGE" 0.40 0.80 0.55 "Circling like a vulture."
flush
gen vulture attack 1 "$GEORGE" 0.40 0.80 0.70 "NAPALM STRIKE. Watch the burn."
gen vulture attack 2 "$GEORGE" 0.40 0.80 0.70 "BOMBS HOT. Light it up."
flush

# ═══════════════════════════════════════════════════════════════════════════
# SYNDICATE — scrappy, sly, irreverent
# ═══════════════════════════════════════════════════════════════════════════

# worker — builder AND collector (Syndicate only), Alice, resourceful/tired (stability 0.55, style 0.45)
gen worker select 1 "$ALICE" 0.55 0.80 0.45 "Yeah yeah, what do you need?"
gen worker select 2 "$ALICE" 0.55 0.80 0.45 "Worker, at your disposal."
flush
gen worker move   1 "$ALICE" 0.55 0.80 0.40 "On my way. Don't rush me."
gen worker move   2 "$ALICE" 0.55 0.80 0.40 "Moving. This better pay well."
flush
gen worker attack 1 "$ALICE" 0.55 0.80 0.55 "You want me to FIGHT?"
gen worker attack 2 "$ALICE" 0.55 0.80 0.55 "Fine. Tools out."
flush

# militant — basic rifle, George, scrappy/cocky (stability 0.45, style 0.55)
gen militant select 1 "$GEORGE" 0.45 0.80 0.55 "Militant, ready to scrap."
gen militant select 2 "$GEORGE" 0.45 0.80 0.55 "They underestimate us. Good."
flush
gen militant move   1 "$GEORGE" 0.45 0.80 0.50 "Slinking through the alleys."
gen militant move   2 "$GEORGE" 0.45 0.80 0.50 "We know this ground better than them."
flush
gen militant attack 1 "$GEORGE" 0.45 0.80 0.65 "FOR THE SYNDICATE!"
gen militant attack 2 "$GEORGE" 0.45 0.80 0.65 "Open fire! Take what's ours."
flush

# stinger — AA missile infantry, George, defiant (stability 0.50, style 0.55)
gen stinger select 1 "$GEORGE" 0.50 0.80 0.55 "Stinger team. No air support for them."
gen stinger select 2 "$GEORGE" 0.50 0.80 0.55 "Their fancy jets won't save them."
flush
gen stinger move   1 "$GEORGE" 0.50 0.80 0.50 "New ambush position."
gen stinger move   2 "$GEORGE" 0.50 0.80 0.50 "Setting up the kill zone."
flush
gen stinger attack 1 "$GEORGE" 0.50 0.80 0.65 "KNOCK IT OUT OF THE SKY."
gen stinger attack 2 "$GEORGE" 0.50 0.80 0.65 "FIRE. Watch it fall."
flush

# fanatic — suicide bomber, Alice, frantic/ecstatic (stability 0.30, style 0.75)
gen fanatic select 1 "$ALICE" 0.30 0.80 0.75 "I go where I am needed!"
gen fanatic select 2 "$ALICE" 0.30 0.80 0.75 "Death is just the beginning."
flush
gen fanatic move   1 "$ALICE" 0.30 0.80 0.70 "Running! Don't stop me!"
gen fanatic move   2 "$ALICE" 0.30 0.80 0.70 "Yes! This way!"
flush
gen fanatic attack 1 "$ALICE" 0.30 0.80 0.85 "FOR THE CAUSE! ALLAHU AKBAR!"
gen fanatic attack 2 "$ALICE" 0.30 0.80 0.85 "I AM THE WEAPON!"
flush

# cobra — syndicate stealth hero, sniper, George, slick/mercenary (stability 0.60, style 0.60)
gen cobra select 1 "$GEORGE" 0.60 0.80 0.60 "Cobra. Name your target."
gen cobra select 2 "$GEORGE" 0.60 0.80 0.60 "I've killed for less than this."
flush
gen cobra move   1 "$GEORGE" 0.60 0.80 0.55 "Melting into the shadows."
gen cobra move   2 "$GEORGE" 0.60 0.80 0.55 "Cutting through. Silent."
flush
gen cobra attack 1 "$GEORGE" 0.60 0.80 0.70 "DEAD. And they never saw me."
gen cobra attack 2 "$GEORGE" 0.60 0.80 0.70 "Taking the SHOT."
flush

# technical — armed pickup transport, salvage, George, rowdy (stability 0.40, style 0.65)
gen technical select 1 "$GEORGE" 0.40 0.80 0.65 "Technical crew, locked and loaded."
gen technical select 2 "$GEORGE" 0.40 0.80 0.65 "This hunk of junk still runs."
flush
gen technical move   1 "$GEORGE" 0.40 0.80 0.60 "Flooring it."
gen technical move   2 "$GEORGE" 0.40 0.80 0.60 "Hauling through the dust."
flush
gen technical attack 1 "$GEORGE" 0.40 0.80 0.75 "Light them UP."
gen technical attack 2 "$GEORGE" 0.40 0.80 0.75 "SPRAY them down! Go go go!"
flush

# scorpion — light tank, salvage, George, pragmatic/rough (stability 0.55, style 0.50)
gen scorpion select 1 "$GEORGE" 0.55 0.80 0.50 "Scorpion tank. Patched but deadly."
gen scorpion select 2 "$GEORGE" 0.55 0.80 0.50 "Running on scrap and stubbornness."
flush
gen scorpion move   1 "$GEORGE" 0.55 0.80 0.45 "Pushing forward."
gen scorpion move   2 "$GEORGE" 0.55 0.80 0.45 "Scavenging and moving."
flush
gen scorpion attack 1 "$GEORGE" 0.55 0.80 0.60 "FIRE! Right between the eyes."
gen scorpion attack 2 "$GEORGE" 0.55 0.80 0.60 "Blow that thing to PIECES."
flush

# quad — AA gatling, salvage, Alice, manic (stability 0.40, style 0.65)
gen quad select 1 "$ALICE" 0.40 0.80 0.65 "Quad cannon, four barrels ready."
gen quad select 2 "$ALICE" 0.40 0.80 0.65 "Cobbled together. Still deadly."
flush
gen quad move   1 "$ALICE" 0.40 0.80 0.60 "Repositioning the guns."
gen quad move   2 "$ALICE" 0.40 0.80 0.60 "Rolling to new coverage."
flush
gen quad attack 1 "$ALICE" 0.40 0.80 0.75 "FOUR BARRELS. All of them."
gen quad attack 2 "$ALICE" 0.40 0.80 0.75 "SHRED that aircraft to parts."
flush

# toxinTractor — toxin sprayer, salvage, Alice, unpleasant/gleeful (stability 0.45, style 0.65)
gen toxinTractor select 1 "$ALICE" 0.45 0.80 0.65 "Tractor's loaded. Try not to breathe."
gen toxinTractor select 2 "$ALICE" 0.45 0.80 0.65 "Tank of fun, right here."
flush
gen toxinTractor move   1 "$ALICE" 0.45 0.80 0.60 "Driving the hazmat special."
gen toxinTractor move   2 "$ALICE" 0.45 0.80 0.60 "Watch out for the drips."
flush
gen toxinTractor attack 1 "$ALICE" 0.45 0.80 0.75 "SPRAY THEM. Don't waste a drop."
gen toxinTractor attack 2 "$ALICE" 0.45 0.80 0.75 "They'll be coughing for WEEKS."
flush

# buggy — rocket buggy artillery, George, wild (stability 0.35, style 0.70)
gen buggy select 1 "$GEORGE" 0.35 0.80 0.70 "Buggy crew, ready to rumble."
gen buggy select 2 "$GEORGE" 0.35 0.80 0.70 "This thing goes zero to boom real fast."
flush
gen buggy move   1 "$GEORGE" 0.35 0.80 0.65 "Kicking up dust."
gen buggy move   2 "$GEORGE" 0.35 0.80 0.65 "Off-road, obviously."
flush
gen buggy attack 1 "$GEORGE" 0.35 0.80 0.80 "ROCKETS AWAY! Hold on tight!"
gen buggy attack 2 "$GEORGE" 0.35 0.80 0.80 "LAUNCH EVERYTHING. RIGHT NOW."
flush

# scud — SCUD missile launcher, salvage, George, theatrical (stability 0.60, style 0.60)
gen scud select 1 "$GEORGE" 0.60 0.80 0.60 "Scud launcher, target acquired."
gen scud select 2 "$GEORGE" 0.60 0.80 0.60 "Long arm of the Syndicate."
flush
gen scud move   1 "$GEORGE" 0.60 0.80 0.55 "Driving the missile to a better view."
gen scud move   2 "$GEORGE" 0.60 0.80 0.55 "Moving the big one."
flush
gen scud attack 1 "$GEORGE" 0.60 0.80 0.70 "LAUNCH. Say goodbye to their base."
gen scud attack 2 "$GEORGE" 0.60 0.80 0.70 "SCUD IS AWAY. Beautiful."
flush

# Final flush for any remaining batch
flush

echo ""
echo "Voice generation complete."
echo "Files written to: $OUT_DIR"
ls -1 "$OUT_DIR" | wc -l | xargs echo "Total files:"

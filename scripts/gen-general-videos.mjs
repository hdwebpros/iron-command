#!/usr/bin/env node
// Generate general-select intro videos via Veo 3 (Gemini API / AI Studio key).
// One ~8s 16:9 clip per faction general, dialogue only (no music — the game's
// own soundtrack plays underneath). Saved to public/video/generals/<faction>.mp4.
//
// Usage:
//   node scripts/gen-general-videos.mjs              # generate missing videos
//   node scripts/gen-general-videos.mjs --force      # regenerate all
//   node scripts/gen-general-videos.mjs --only=dominion
//
// Requires AI_STUDIO_KEY in .env. Veo is a paid feature; each clip costs a few dollars.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'video', 'generals');
const MODEL = 'veo-3.0-generate-001';
const API = 'https://generativelanguage.googleapis.com/v1beta';

const KEY = (() => {
  try {
    const m = readFileSync(join(ROOT, '.env'), 'utf8').match(/^AI_STUDIO_KEY=(.+)$/m);
    if (m) return m[1].trim();
  } catch {}
  return process.env.AI_STUDIO_KEY;
})();
if (!KEY) { console.error('AI_STUDIO_KEY not found in .env or environment'); process.exit(1); }

// Audio direction is repeated in every prompt: dialogue + light ambience only,
// explicitly no music, since the game's soundtrack already plays under the video.
const NO_MUSIC = 'Audio: dialogue and faint ambience only. Absolutely no music, no score, no soundtrack.';

const VIDEOS = {
  coalition: {
    general: 'Kira "Phantom" Voss',
    prompt: `Cinematic live-action character introduction, 16:9. A tall American woman in her mid-30s — broad-shouldered, athletic and muscular like an MMA fighter yet unmistakably feminine, strong jawline, wavy dark brown hair falling loose past her shoulders, piercing green eyes, full lips curled in a calm, dangerous smirk. She wears a fitted dark navy-blue high-tech military commander jacket with subtle glowing trim, open at the collar. She stands in a sleek futuristic command center bathed in blue light, holographic tactical maps and drone feeds floating behind her. She turns from a hologram to face the camera, steps slowly closer, tilts her head slightly and says with smooth, smoky confidence: "They'll never know what hit them." Dramatic blue rim lighting, shallow depth of field, slow push-in, slight film grain. ${NO_MUSIC}`,
  },
  dominion: {
    general: 'Vance "Steel" Karov',
    prompt: `Cinematic live-action character introduction, 16:9. A hulking Russian military general in his mid-50s — square jaw, gray buzz cut, weathered face with a scar through one eyebrow, broad shoulders in an immaculate crimson-and-black dress uniform heavy with steel medals. He stands over a wall-sized battle map in a red-lit concrete war room, fists planted on the table, smoke drifting through harsh light. He slams one fist on the table, glares straight into the camera and barks in a deep Russian-accented voice: "No hesitation. Take no prisoners." Hard red key light, low camera angle making him tower, slow ominous push-in. ${NO_MUSIC}`,
  },
  syndicate: {
    general: 'Ali "Viper" Abazz',
    prompt: `Cinematic live-action character introduction, 16:9. A lean, cunning Middle Eastern warlord in his mid-40s — trimmed black beard, sharp watchful eyes, checkered shemagh draped over dusty olive-green tactical fatigues, a gold ring catching the light. He sits half in shadow in a desert hideout lit by a single swinging lantern, surrounded by worn maps and salvaged weapon crates. He leans slowly forward into the light with a sly, knowing smile and says quietly, with silky menace: "How are you gentlemen. All your base are belong to us." Warm flickering lantern light, dust motes in the air, green-tinted color grade, slow creeping push-in. ${NO_MUSIC}`,
  },
};

const NEGATIVE = 'music, soundtrack, score, background music, singing, drums, orchestral';

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const only = args.find((a) => a.startsWith('--only='))?.split('=')[1];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function jfetch(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url.replace(KEY, '<key>')}: ${text.slice(0, 500)}`);
  return json;
}

// Find any downloadable video uri in an operation response, schema-defensively.
function findVideoUri(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (typeof obj.uri === 'string' && obj.uri.includes('http')) return obj.uri;
  for (const v of Object.values(obj)) {
    const found = findVideoUri(v);
    if (found) return found;
  }
  return null;
}

async function generate(key, { general, prompt }) {
  const outPath = join(OUT_DIR, `${key}.mp4`);
  if (existsSync(outPath) && !FORCE) {
    console.log(`[${key}] exists, skipping (use --force to regenerate)`);
    return;
  }
  console.log(`[${key}] requesting Veo generation for ${general}…`);
  const op = await jfetch(`${API}/models/${MODEL}:predictLongRunning?key=${KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { aspectRatio: '16:9', resolution: '1080p', negativePrompt: NEGATIVE },
    }),
  });
  if (!op?.name) throw new Error(`[${key}] no operation name in response: ${JSON.stringify(op).slice(0, 300)}`);

  let done = null;
  for (let i = 0; i < 60; i++) {
    await sleep(10000);
    const poll = await jfetch(`${API}/${op.name}?key=${KEY}`);
    if (poll.error) throw new Error(`[${key}] operation failed: ${JSON.stringify(poll.error).slice(0, 500)}`);
    if (poll.done) { done = poll; break; }
    console.log(`[${key}] …generating (${(i + 1) * 10}s)`);
  }
  if (!done) throw new Error(`[${key}] timed out after 10 minutes`);

  const resp = done.response || {};
  const filtered = JSON.stringify(resp).match(/raiMediaFilteredReasons":\s*(\[[^\]]*\])/);
  const uri = findVideoUri(resp);
  if (!uri) {
    throw new Error(`[${key}] no video in response${filtered ? ` (filtered: ${filtered[1]})` : ''}: ${JSON.stringify(resp).slice(0, 500)}`);
  }

  console.log(`[${key}] downloading…`);
  const dl = await fetch(uri.includes('key=') ? uri : `${uri}${uri.includes('?') ? '&' : '?'}key=${KEY}`);
  if (!dl.ok) throw new Error(`[${key}] download failed: HTTP ${dl.status}`);
  const buf = Buffer.from(await dl.arrayBuffer());
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(outPath, buf);
  console.log(`[${key}] saved ${outPath} (${(buf.length / 1e6).toFixed(1)} MB)`);
}

const keys = Object.keys(VIDEOS).filter((k) => !only || k === only);
const results = await Promise.allSettled(keys.map((k) => generate(k, VIDEOS[k])));
let failed = false;
for (let i = 0; i < keys.length; i++) {
  if (results[i].status === 'rejected') { failed = true; console.error(results[i].reason.message || results[i].reason); }
}
process.exit(failed ? 1 : 0);

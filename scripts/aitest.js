// IRON COMMAND — AI self-test. Runs under plain `node`.
// Drives AIController vs AIController across all 3 faction matchup pairings at HARD,
// then one easy-vs-brutal match. Asserts the DESIGN §11 behavior bar, prints compact
// per-match summaries, exits 0 (green) / 1 (fail).
//
// Run: node scripts/aitest.js

import { Game } from '../src/sim/game.js';
import { AIController } from '../src/sim/ai.js';

const TICK = 1 / 30;

function runMatch(pf, af, { difA = 'hard', difB = 'hard', maxSeconds = 900, seed = 1234 } = {}) {
  const game = new Game({ playerFaction: pf, aiFaction: af, difficulty: 'hard', seed });
  const ev = {
    spawn: 0, death: 0, attack: 0, projectile: 0, hit: 0,
    superBuilt: 0, superLaunch: 0, superImpact: 0, rankUp: 0,
    powerUsed: 0, captureComplete: 0, garrisonChange: 0, constructionComplete: 0, gameOver: 0,
  };
  const built = { player: 0, enemy: 0 };
  const trained = { player: 0, enemy: 0 };
  let winner = null, exception = null;
  for (const k of Object.keys(ev)) game.on(k, () => { ev[k]++; });
  game.on('gameOver', (p) => { winner = p.winner; });
  game.on('constructionComplete', (p) => {
    const e = game.entity(p.id); if (e && (e.side === 'player' || e.side === 'enemy')) built[e.side]++;
  });
  game.on('spawn', (p) => {
    const e = p.entity; if (e && e.kind === 'unit' && (e.side === 'player' || e.side === 'enemy')) trained[e.side]++;
  });

  const aiP = new AIController(game, 'player', difA);
  const aiE = new AIController(game, 'enemy', difB);

  const totalTicks = Math.ceil(maxSeconds / TICK);
  try {
    for (let i = 0; i < totalTicks; i++) {
      aiP.tick(TICK);
      aiE.tick(TICK);
      game.tick(TICK);
      if (game.state.over) break;
    }
  } catch (e) { exception = e; }

  return { game, ev, built, trained, winner, exception, time: game.time };
}

function main() {
  const out = [];
  let failures = 0;
  const assert = (c, m) => { if (!c) { failures++; out.push('  FAIL: ' + m); } else out.push('  ok:   ' + m); return c; };

  console.log('IRON COMMAND — AI self-test\n');

  const matchups = [
    ['coalition', 'dominion'],
    ['dominion', 'syndicate'],
    ['syndicate', 'coalition'],
  ];

  let captureSeen = false, powerSeen = false, superSeen = false, winnerSeen = false;

  matchups.forEach(([pf, af], idx) => {
    out.push(`\n[hard match ${idx + 1}] ${pf} vs ${af}`);
    const r = runMatch(pf, af, { difA: 'hard', difB: 'hard', maxSeconds: 900, seed: 2000 + idx });

    assert(!r.exception, `no exceptions${r.exception ? ' — ' + r.exception.stack : ''}`);
    assert(r.built.player >= 10 && r.built.enemy >= 10, `both sides built >=10 structures (P${r.built.player}/E${r.built.enemy})`);
    assert(r.trained.player >= 15 && r.trained.enemy >= 15, `both sides trained >=15 units (P${r.trained.player}/E${r.trained.enemy})`);
    assert(r.ev.death >= 50, `combat occurred (>=50 deaths: ${r.ev.death})`);

    if (r.ev.captureComplete > 0) captureSeen = true;
    if (r.ev.powerUsed > 0) powerSeen = true;
    if (r.ev.superBuilt > 0) superSeen = true;
    if (r.winner) winnerSeen = true;

    out.push(`  · structs P${r.built.player}/E${r.built.enemy} units P${r.trained.player}/E${r.trained.enemy} kills=${r.ev.death} caps=${r.ev.captureComplete} powers=${r.ev.powerUsed} superBuilt=${r.ev.superBuilt} superLaunch=${r.ev.superLaunch} winner=${r.winner || 'none'} t=${r.time.toFixed(0)}s`);
  });

  out.push('\n[global behavior assertions across hard matches]');
  assert(captureSeen, 'AI captured >=1 derrick across matches');
  assert(powerSeen, '>=1 general power used');
  assert(superSeen, 'superweapon built in >=1 match');
  assert(winnerSeen, '>=1 match produced a winner (attack logic not too timid)');

  // Easy (player) vs Brutal (enemy): brutal must win.
  out.push('\n[easy vs brutal] coalition(easy) vs dominion(brutal) — brutal must win');
  {
    const r = runMatch('coalition', 'dominion', { difA: 'easy', difB: 'brutal', maxSeconds: 900, seed: 777 });
    assert(!r.exception, `no exceptions${r.exception ? ' — ' + r.exception.stack : ''}`);
    assert(r.winner === 'enemy', `brutal (enemy) won (winner=${r.winner || 'none'})`);
    out.push(`  · structs P${r.built.player}/E${r.built.enemy} units P${r.trained.player}/E${r.trained.enemy} kills=${r.ev.death} winner=${r.winner || 'none'} t=${r.time.toFixed(0)}s`);
  }

  console.log(out.join('\n'));
  console.log('\n' + (failures === 0 ? 'PASS — all checks green' : `FAIL — ${failures} check(s) failed`));
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv[1] && process.argv[1].endsWith('aitest.js')) main();

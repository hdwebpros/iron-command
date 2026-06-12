// Queue UI smoke test: boots a game, spawns a barracks, queues units, selects
// the barracks, and screenshots the HUD queue + over-building production bar.
// Run: node scripts/queue-smoke.mjs  (expects vite dev server on :5173 and chrome)
import { spawn } from 'node:child_process';

const CHROME = '/usr/bin/google-chrome';
const PORT = 9334;
const URL_GAME = 'http://localhost:5173/';

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`,
  '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader', '--window-size=1600,900', '--mute-audio',
  '--hide-scrollbars', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/json`);
      const tabs = await res.json();
      const page = tabs.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('chrome devtools not reachable');
}

let msgId = 0;
const pending = new Map();
let ws;
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('page eval failed: ' + JSON.stringify(r.exceptionDetails.exception));
  return r.result.value;
}
async function shot(path) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(path, Buffer.from(r.data, 'base64'));
}

try {
  ws = new WebSocket(await getWsUrl());
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
  };

  await send('Page.enable');
  await send('Page.navigate', { url: URL_GAME });
  await sleep(4000);
  await evaluate(`(window.__START('coalition', 'easy', {}), true)`);
  await sleep(3000);

  // Spawn a finished barracks near the CC, fund the player, queue 5 units.
  const setup = await evaluate(`(() => {
    const { game, setSelection, issueP, lookAt } = window.__DBG;
    let cc = null;
    for (const e of game.entities.values())
      if (e.side === 'player' && e.key === 'commandCenter') cc = e;
    const b = game._spawnStructure('player', 'barracks', cc.x + 10, cc.z + 4, true);
    game._addMoney('player', 10000);
    const res = [];
    for (const k of ['trooper', 'trooper', 'javelin', 'marksman', 'trooper'])
      res.push(issueP({ type: 'queueUnit', structureId: b.id, key: k }).ok);
    setSelection([b.id]);
    lookAt(b.x, b.z);
    return { barracks: b.id, queued: res };
  })()`);
  console.log('setup:', JSON.stringify(setup));

  await sleep(3500); // let the first unit make visible progress
  const probe = await evaluate(`(() => {
    const { game } = window.__DBG;
    const b = game.entity(${setup.barracks});
    const slots = [...document.querySelectorAll('.ic-queue-item')];
    return {
      queueLen: b.queue.length,
      prog: b.queue[0] ? +b.queue[0].progress.toFixed(2) : null,
      slotCount: slots.length,
      filled: slots.filter(s => s.classList.contains('ic-filled')).length,
      activeDeg: slots[0] ? slots[0].style.getPropertyValue('--prog-deg') : null,
      count: (document.querySelector('.ic-queue-count') || {}).textContent,
      title: document.title,
      errs: window.__ERRS,
    };
  })()`);
  console.log('probe:', JSON.stringify(probe));
  await shot('/tmp/queue-smoke-1.png');

  // Cancel one queued item via slot click (slot 2), then re-probe.
  const afterCancel = await evaluate(`(() => {
    const slots = [...document.querySelectorAll('.ic-queue-item')];
    slots[2].click();
    const { game } = window.__DBG;
    const b = game.entity(${setup.barracks});
    return { queueLen: b.queue.length };
  })()`);
  console.log('afterCancel:', JSON.stringify(afterCancel));
  await sleep(1200);
  await shot('/tmp/queue-smoke-2.png');

  const ok = probe.slotCount === 9 && probe.filled === 5 && probe.prog > 0
    && /IC_OK/.test(probe.title) && probe.errs.length === 0
    && afterCancel.queueLen === 4;
  console.log(ok ? 'QUEUE_SMOKE_PASS' : 'QUEUE_SMOKE_FAIL');
  process.exitCode = ok ? 0 : 1;
} catch (e) {
  console.error('QUEUE_SMOKE_FAIL', e.message);
  process.exitCode = 1;
} finally {
  chrome.kill();
}

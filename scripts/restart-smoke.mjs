// Restart smoke test: pause → Restart must not freeze the game.
// Regression guard for the onModelsReady-fires-synchronously-on-restart bug
// (GfxEngine constructor read this._recs before it was initialized).
// Boots headless, waits for unit models to load (the trigger condition),
// pauses via Esc, clicks the pause-menu Restart button, then asserts the sim
// heartbeat (title "IC_OK t=N") keeps advancing and __ERRS stays empty.
// Run: node scripts/restart-smoke.mjs  (expects vite dev server on :5173 and chrome)
import { spawn } from 'node:child_process';

const CHROME = '/usr/bin/google-chrome';
const PORT = 9334;
const URL_GAME = 'http://localhost:5173/?autostart=hard&pf=coalition';

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`,
  '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader', '--window-size=1280,800', '--mute-audio',
  'about:blank',
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
const consoleMsgs = [];
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

try {
  ws = new WebSocket(await getWsUrl());
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    } else if (m.method === 'Runtime.consoleAPICalled') {
      consoleMsgs.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      consoleMsgs.push('EXCEPTION: ' + (d.exception?.description || d.text));
    }
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: URL_GAME });
  await sleep(5000); // let the sim boot and tick

  // Wait until unit models finished loading — the user-reported freeze happens
  // when restarting AFTER models are ready (vite serves the same module singleton).
  await evaluate(`import('/src/gfx/models.js').then((m) => new Promise((res) => m.onModelsReady(res))).then(() => 'models ready')`);
  console.log('models ready');

  const t0 = await evaluate('document.title');
  console.log('before pause:', t0);

  // Esc → pause menu
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true`);
  await sleep(500);
  const pauseVisible = await evaluate(`!!document.querySelector('[data-restart]')`);
  console.log('pause menu visible:', pauseVisible);

  // click Restart
  await evaluate(`(() => { const b = document.querySelector('[data-restart]'); if (!b) return 'NO_BUTTON'; b.click(); return 'CLICKED'; })()`);
  await sleep(1000);
  const t1 = await evaluate('document.title');
  await sleep(4000);
  const t2 = await evaluate('document.title');
  const errs = await evaluate('JSON.stringify(window.__ERRS)');

  console.log('1s after restart:', t1);
  console.log('5s after restart:', t2);
  console.log('__ERRS:', errs);
  if (consoleMsgs.length) console.log('console:', consoleMsgs.slice(-20).join('\n  '));

  const tick = (s) => { const m = /t=(\d+)/.exec(s); return m ? +m[1] : -1; };
  const advancing = tick(t2) > tick(t1) && /IC_OK/.test(t2);
  const ok = advancing && errs === '[]';
  console.log(ok ? 'REPRO_PASS (no freeze)' : 'REPRO_FAIL (frozen or errors)');
  process.exitCode = ok ? 0 : 1;
} catch (e) {
  console.error('REPRO_FAIL', e.message);
  process.exitCode = 1;
} finally {
  chrome.kill();
}

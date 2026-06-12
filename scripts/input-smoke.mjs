// Input smoke test: boots the game headless, synthesizes the Generals-scheme
// mouse/keyboard input, and asserts no runtime errors and a running sim (IC_OK).
// Run: node scripts/input-smoke.mjs  (expects vite dev server on :5173 and chrome)
import { spawn } from 'node:child_process';

const CHROME = '/usr/bin/google-chrome';
const PORT = 9333;
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
    }
  };

  await send('Page.enable');
  await send('Page.navigate', { url: URL_GAME });
  await sleep(6000); // let the sim boot and tick

  // Synthesize the new input scheme on the canvas.
  await evaluate(`(() => {
    const cv = document.getElementById('game-canvas');
    const pe = (type, o) => window.dispatchEvent(new PointerEvent(type, {
      bubbles: true, clientX: o.x, clientY: o.y, button: o.b ?? 0,
      ctrlKey: !!o.ctrl, shiftKey: !!o.shift, pointerId: 1, ...o.extra,
    }));
    const peCanvas = (type, o) => cv.dispatchEvent(new PointerEvent(type, {
      bubbles: true, clientX: o.x, clientY: o.y, button: o.b ?? 0,
      ctrlKey: !!o.ctrl, pointerId: 1,
    }));
    const key = (k, o = {}) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...o }));
      window.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true, ...o }));
    };
    // left drag box-select
    peCanvas('pointerdown', { x: 300, y: 300 });
    pe('pointermove', { x: 500, y: 500 });
    pe('pointerup', { x: 500, y: 500 });
    // left click ground (order or deselect path)
    peCanvas('pointerdown', { x: 640, y: 400 });
    pe('pointerup', { x: 640, y: 400 });
    // ctrl+click (force fire path)
    peCanvas('pointerdown', { x: 620, y: 380, ctrl: true });
    pe('pointerup', { x: 620, y: 380, ctrl: true });
    // RMB hold + drag (anchor scroll), then plain RMB click (deselect)
    peCanvas('pointerdown', { x: 640, y: 400, b: 2 });
    pe('pointermove', { x: 740, y: 480, b: 2 });
    pe('pointerup', { x: 740, y: 480, b: 2 });
    peCanvas('pointerdown', { x: 640, y: 400, b: 2 });
    pe('pointerup', { x: 641, y: 401, b: 2 });
    // command keys: Q, E, double-E, A then click, S, G, H, B, group assign/select/view
    key('q'); key('e'); key('e');
    key('a');
    peCanvas('pointerdown', { x: 600, y: 350 });
    pe('pointerup', { x: 600, y: 350 });
    key('s'); key('g'); key('h'); key('b');
    key('1', { ctrlKey: true }); key('1'); key('1', { altKey: true });
    // arrows pan
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    return true;
  })()`);

  await sleep(3000); // let arrow pan + rmb cleanup run frames
  const title = await evaluate('document.title');
  const errs = await evaluate('JSON.stringify(window.__ERRS)');
  console.log('title:', title);
  console.log('__ERRS:', errs);
  const ok = /IC_OK/.test(title) && errs === '[]';
  console.log(ok ? 'SMOKE_PASS' : 'SMOKE_FAIL');
  process.exitCode = ok ? 0 : 1;
} catch (e) {
  console.error('SMOKE_FAIL', e.message);
  process.exitCode = 1;
} finally {
  chrome.kill();
}

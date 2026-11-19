/**
 * One-off: screenshot the "School Governance" item on /glance to show where
 * the Palli Paarvai KPIs were wired in. Same headless-Chrome-over-CDP
 * approach as snapshot-glance.mjs, trimmed to "navigate, click, screenshot".
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const base = process.argv[2] ?? 'http://localhost:4200';
const outFile = path.resolve(process.argv[3] ?? 'school-governance.png');
const user = process.env.DASHBOARD_USER || 'Admin';
const pass = process.env.DASHBOARD_PASSWORD || 'Admin@123';

const browsers = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const exe = browsers.find((p) => fs.existsSync(p));
if (!exe) { console.error('No Chrome / Edge found.'); process.exit(1); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-shot-'));
const port = 9334;
const chrome = spawn(exe, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--window-size=1600,1600', '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank',
], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill(); } catch {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} };
process.on('exit', cleanup);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, label, ms = 60000, step = 250) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${label}`);
    await sleep(step);
  }
}

let version;
await waitFor(async () => { try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); return true; } catch { return false; } }, 'devtools endpoint', 20000);
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
let seq = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { ok, bad } = pending.get(m.id); pending.delete(m.id); m.error ? bad(new Error(m.error.message)) : ok(m.result); } };
const send = (method, params = {}, sessionId) => new Promise((ok, bad) => { const id = ++seq; pending.set(id, { ok, bad }); ws.send(JSON.stringify({ id, method, params, sessionId })); });

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const call = (method, params) => send(method, params, sessionId);
const evalJs = async (expression) => {
  const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'evaluate failed');
  return r.result.value;
};
await call('Page.enable'); await call('Runtime.enable');
await call('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1600, deviceScaleFactor: 1, mobile: false });

console.log('opening', `${base}/glance`);
await call('Page.navigate', { url: `${base}/glance` });
await waitFor(() => evalJs(`!!document.querySelector('.login-card, .gl-top')`), 'page shell');
if (await evalJs(`!!document.querySelector('.login-card')`)) {
  console.log('signing in as', user);
  await evalJs(`(() => {
    const set = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    const inputs = document.querySelectorAll('.login-card input');
    set(inputs[0], ${JSON.stringify(user)}); set(inputs[1], ${JSON.stringify(pass)});
    (document.querySelector('.login-card form') ?? document.querySelector('.login-card')).querySelector('.login-btn').click();
  })()`);
}
await waitFor(() => evalJs(`!!document.querySelector('.gl-wrap')`), 'dashboard body', 120000);
await sleep(800);

// open the "3. Learning Outcomes First" group, then click "School Governance"
console.log('opening group 3 and the School Governance item');
const clicked = await evalJs(`(() => {
  const groups = [...document.querySelectorAll('.gl-grp')];
  const g3 = groups.find((b) => /Learning Outcomes First/i.test(b.textContent));
  if (!g3) return 'group not found';
  if (!g3.classList.contains('open')) g3.click();
  return 'group opened: ' + (g3?.textContent || '').trim();
})()`);
console.log(clicked);
await sleep(400);
const clicked2 = await evalJs(`(() => {
  const subBtns = [...document.querySelectorAll('.gl-sni-sub')];
  const gov = subBtns.find((b) => /School Governance/i.test(b.textContent));
  if (!gov) return 'item not found';
  gov.click();
  return 'clicked: ' + gov.textContent.trim();
})()`);
console.log(clicked2);
await waitFor(() => evalJs(`!!document.querySelector('.gl-modhead')`), 'module page', 20000);
await sleep(900); // entrance animation

const { data } = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
  clip: await (async () => { const r = await evalJs(`(() => { const r = document.querySelector('.gl-wrap').getBoundingClientRect(); return { x: 0, y: window.scrollY, width: 1600, height: Math.min(1600, document.body.scrollHeight) }; })()`); return { ...r, scale: 1 }; })() });
fs.writeFileSync(outFile, Buffer.from(data, 'base64'));
console.log('saved', outFile, (fs.statSync(outFile).size / 1024).toFixed(0) + ' KB');
ws.close();
cleanup();
process.exit(0);

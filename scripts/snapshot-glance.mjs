/**
 * Save the live "At a glance" page (/glance) as a standalone HTML file by
 * driving headless Chrome / Edge over the DevTools protocol and pressing the
 * page's own "Download HTML" button — so the file carries exactly the figures
 * the app computes, with no second implementation of the KPI logic here.
 *
 * Usage:  node scripts/snapshot-glance.mjs [baseUrl] [outDir]
 *   baseUrl  default http://localhost:4200   (the dev server must be running)
 *   outDir   default the repo root
 * Credentials: DASHBOARD_USER / DASHBOARD_PASSWORD (same defaults as gen-auth).
 * Needs Node 22+ (global WebSocket) and Chrome or Edge installed.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const base = process.argv[2] ?? 'http://localhost:4200';
const outDir = path.resolve(process.argv[3] ?? '.');
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

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'glance-snap-'));
const port = 9333;
const chrome = spawn(exe, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--window-size=1600,2400', '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank',
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

// ---- attach to the browser target ----
let version;
await waitFor(async () => { try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); return true; } catch { return false; } }, 'devtools endpoint', 20000);
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
let seq = 0; const pending = new Map(); const listeners = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const { ok, bad } = pending.get(m.id); pending.delete(m.id); m.error ? bad(new Error(m.error.message)) : ok(m.result); }
  else if (m.method) for (const l of listeners) l(m);
};
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
await call('Emulation.setDeviceMetricsOverride', { width: 1600, height: 2400, deviceScaleFactor: 1, mobile: false });
fs.mkdirSync(outDir, { recursive: true });
await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: outDir, eventsEnabled: true });

// ---- load, sign in, wait for data ----
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
// lazy assets behind two of the trend charts, and the chart canvases themselves
await waitFor(() => evalJs(`!document.querySelector('.gl-nodata .fa-spinner') && document.querySelectorAll('[echarts] canvas').length >= 4`), 'charts', 120000);
await sleep(1500); // let the entrance animations and count-ups settle

// ---- press the page's own Download HTML button and wait for the file ----
let done = null;
listeners.push((m) => { if (m.method === 'Browser.downloadProgress' && m.params.state === 'completed') done = m.params; });
const names = {};
listeners.push((m) => { if (m.method === 'Browser.downloadWillBegin') names[m.params.guid] = m.params.suggestedFilename; });
await evalJs(`(() => { const b = [...document.querySelectorAll('.b1r button')].find((x) => /Download HTML/.test(x.textContent)); if (!b) throw new Error('Download HTML button not found'); b.click(); return true; })()`);
await waitFor(() => done, 'download', 120000);
const name = names[done.guid] ?? 'At-a-Glance.html';
// Chrome saves under the guid when the name is taken; normalise to the suggested name
const saved = fs.existsSync(path.join(outDir, name)) ? path.join(outDir, name) : path.join(outDir, done.guid);
const finalPath = path.join(outDir, name);
if (saved !== finalPath) fs.renameSync(saved, finalPath);
const kb = (fs.statSync(finalPath).size / 1024).toFixed(0);
console.log(`saved ${finalPath} (${kb} KB)`);
ws.close();
cleanup();
process.exit(0);

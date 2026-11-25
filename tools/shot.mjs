// Headless Edge + CDP screenshot harness for the SOMNA page.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;
const PAGE = 'E:\\DSH工作区B\\somna\\index.html';
const OUT = 'E:\\DSH工作区B\\somna\\_shots';
const PROFILE = 'E:\\DSH工作区B\\somna\\_edge-profile';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) {
        (this.listeners.get(msg.method) || []).forEach((fn) => fn(msg.params));
      }
    });
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout ' + method)); }
      }, 30000);
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception?.description || ''));
    return r.result.value;
  }
}

async function main() {
  const width = Number(process.argv[2] || 1440);
  const height = Number(process.argv[3] || 900);
  const tag = process.argv[4] || 'shot';
  mkdirSync(OUT, { recursive: true });
  mkdirSync(PROFILE, { recursive: true });

  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--mute-audio',
    '--disable-features=Translate', '--force-device-scale-factor=1',
    `--window-size=${width},${height}`,
    `--user-data-dir=${PROFILE}`,
    `--remote-debugging-port=${PORT}`,
    'about:blank'
  ], { stdio: 'ignore' });

  let wsUrl;
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const j = await r.json();
      wsUrl = j.webSocketDebuggerUrl;
      if (wsUrl) break;
    } catch (e) { /* not up yet */ }
  }
  if (!wsUrl) { console.error('edge did not start'); process.exit(1); }

  const t = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json());
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = new CDP(ws);

  const logs = [];
  cdp.on('Runtime.exceptionThrown', (p) => logs.push('EXCEPTION: ' + (p.exceptionDetails?.exception?.description || p.exceptionDetails?.text)));
  cdp.on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error' || p.type === 'warning') logs.push(p.type.toUpperCase() + ': ' + p.args.map((a) => a.value ?? a.description).join(' '));
  });
  cdp.on('Log.entryAdded', (p) => { if (p.entry.level === 'error') logs.push('LOG: ' + p.entry.text); });

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 700 });

  const url = pathToFileURL(PAGE).href;
  await cdp.send('Page.navigate', { url });
  await sleep(2800);

  const dims = await cdp.eval(`(() => {
    const d = document.querySelector('#descent');
    return {
      doc: document.documentElement.scrollHeight,
      max: document.documentElement.scrollHeight - innerHeight,
      top: d.offsetTop,
      span: d.offsetHeight - innerHeight,
      vh: innerHeight,
      font: getComputedStyle(document.querySelector('.display')).fontFamily
    };
  })()`);
  console.log('dims', JSON.stringify(dims));

  const sections = await cdp.eval(`(() => {
    const out = {};
    ['.hero','.press','.system','.product','.stats','.voices','.science','.pricing','.faq','.cta','.foot'].forEach(sel => {
      const el = document.querySelector(sel);
      if (el) { const r = el.getBoundingClientRect(); out[sel] = { top: Math.round(r.top + scrollY), h: Math.round(r.height) }; }
    });
    return out;
  })()`);
  console.log('sections', JSON.stringify(sections));

  async function shot(name) {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${OUT}\\${tag}-${name}.png`, Buffer.from(r.data, 'base64'));
    const info = await cdp.eval(`(() => ({y: Math.round(scrollY), act: document.body.dataset.act}))()`);
    console.log('  ', name, JSON.stringify(info));
  }
  async function go(y, wait = 1000) {
    await cdp.eval(`document.documentElement.style.scrollBehavior='auto'; window.scrollTo(0, ${Math.round(y)});`);
    await sleep(wait);
  }

  const plan = [];
  for (const [sel, info] of Object.entries(sections)) {
    const name = sel.replace('.', '');
    plan.push([name, info.top]);
    if (info.h > 880) plan.push([name + '-b', info.top + info.h - 900]);
  }
  for (const [name, y] of plan) {
    await go(Math.max(0, Math.min(y, dims.top - 10)), 950);
    await shot(name);
  }

  for (const d of [0.02, 0.09, 0.18, 0.27, 0.36, 0.45, 0.55, 0.65, 0.75, 0.82]) {
    await go(dims.top + dims.span * d, 1100);
    await shot('d' + String(d).replace('.', ''));
  }

  // climax
  await go(dims.top + dims.span * 0.878, 900);
  await shot('climax-a');
  await sleep(900);
  await shot('climax-b');
  await sleep(2600);
  await shot('after');

  console.log('--- logs ---');
  console.log(logs.length ? logs.join('\n') : '(clean)');
  ws.close();
  edge.kill();
  await sleep(400);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

// Verify a URL renders with JavaScript (used for the public tunnel link).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9335;
const URL_TO_CHECK = process.argv[2] || 'https://73f338d68d780f.app.lhr.life/';
const PROFILE = 'E:\\DSH工作区B\\somna\\_edge-profile3';
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
      } else if (msg.method) (this.listeners.get(msg.method) || []).forEach((fn) => fn(msg.params));
    });
  }
  on(m, fn) { if (!this.listeners.has(m)) this.listeners.set(m, []); this.listeners.get(m).push(fn); }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout ' + method)); } }, 30000);
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception?.description || ''));
    return r.result.value;
  }
}

mkdirSync(PROFILE, { recursive: true });
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--mute-audio', '--force-device-scale-factor=1',
  '--window-size=390,844', `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`, 'about:blank'], { stdio: 'ignore' });

let wsUrl;
for (let i = 0; i < 80; i++) {
  await sleep(250);
  try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); wsUrl = j.webSocketDebuggerUrl; if (wsUrl) break; } catch (e) { }
}
const t = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json());
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
const cdp = new CDP(ws);
const logs = [];
cdp.on('Runtime.exceptionThrown', (p) => logs.push('EXCEPTION: ' + (p.exceptionDetails?.exception?.description || p.exceptionDetails?.text)));
cdp.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error') logs.push('CONSOLE: ' + p.args.map((a) => a.value ?? a.description).join(' ')); });
cdp.on('Network.loadingFailed', (p) => logs.push('LOAD FAILED: ' + p.errorText + ' ' + (p.blockedReason || '')));
cdp.on('Network.responseReceived', (p) => {
  const u = p.response.url;
  if (/\.(css|js)(\?|$)/.test(u)) logs.push('ASSET ' + p.response.status + ' ' + (p.response.mimeType || '?') + ' ' + u.slice(-40));
});
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Network.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await cdp.send('Page.navigate', { url: URL_TO_CHECK });
await sleep(14000);

const out = await cdp.eval(`(() => ({
  title: document.title,
  vw: innerWidth,
  scrollH: document.documentElement.scrollHeight,
  gate: document.querySelector('#gate') ? document.querySelector('#gate').className : 'missing',
  beats: document.querySelectorAll('.beat').length,
  css: getComputedStyle(document.body).backgroundColor,
  font: getComputedStyle(document.querySelector('.display')).fontFamily.slice(0, 40),
  canvas: (() => { const c = document.querySelector('#scene'); return c ? c.width + 'x' + c.height : 'missing'; })(),
  overflowX: document.documentElement.scrollWidth - innerWidth
}))()`);
console.log(JSON.stringify(out, null, 2));
const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
const { writeFileSync } = await import('node:fs');
writeFileSync('E:\\DSH工作区B\\somna\\_check2.png', Buffer.from(shot.data, 'base64'));
console.log('--- logs ---');
console.log(logs.length ? logs.join('\n') : '(clean)');
ws.close(); edge.kill();
await sleep(300); process.exit(0);

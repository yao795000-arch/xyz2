// Interaction smoke test: gate, dialog, buy buttons, FAQ, ending.
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9334;
const PAGE = 'E:\\DSH工作区B\\somna\\index.html';
const PROFILE = 'E:\\DSH工作区B\\somna\\_edge-profile2';
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
  '--no-default-browser-check', '--disable-extensions', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
  '--window-size=1440,900', `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`, 'about:blank'], { stdio: 'ignore' });

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
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await cdp.send('Page.navigate', { url: pathToFileURL(PAGE).href });
await sleep(3000);

const out = {};
const click = (sel) => cdp.eval(`(() => { const e = document.querySelector('${sel}'); if (!e) return 'missing'; e.click(); return 'ok'; })()`);

out.gateVisible = await cdp.eval(`document.querySelector('#gate').classList.contains('show')`);
await click('#gateBtn');
await sleep(400);
out.gateAfterClick = await cdp.eval(`({hidden: document.querySelector('#gate').classList.contains('hide'), pressed: document.querySelector('#soundBtn').getAttribute('aria-pressed')})`);

// scroll through the site to science
await cdp.eval(`document.documentElement.style.scrollBehavior='auto'; window.scrollTo(0, document.querySelector('.science').offsetTop - 200)`);
await sleep(2600);
out.dialogShown = await cdp.eval(`document.querySelector('#dialog').classList.contains('show')`);
await click('#dlgOk');
await sleep(300);
out.dialogConnected = await cdp.eval(`({cls: document.querySelector('#dialog').className, title: document.querySelector('#dlgTitle').textContent})`);

// faq
await cdp.eval(`window.scrollTo(0, document.querySelector('.faq').offsetTop - 100)`);
await sleep(2400);
out.faqText = await cdp.eval(`document.querySelector('#faqQ').textContent`);
await cdp.eval(`document.querySelector('.faq details').open = true`);
out.faqOpen = await cdp.eval(`document.querySelector('.faq details').open`);

// buy
await cdp.eval(`window.scrollTo(0, document.querySelector('.pricing').offsetTop)`);
await sleep(2200);
await click('[data-buy]');
await sleep(300);
out.toast = await cdp.eval(`document.querySelector('#toast').textContent`);
out.price = await cdp.eval(`[...document.querySelectorAll('.amt')].map(e => e.textContent).join(',')`);
out.stat = await cdp.eval(`[...document.querySelectorAll('.stat-num')].map(e => e.textContent.trim()).join(' | ')`);

// descent
const dims = await cdp.eval(`(() => { const d = document.querySelector('#descent'); return { top: d.offsetTop, span: d.offsetHeight - innerHeight }; })()`);
await cdp.eval(`window.scrollTo(0, ${dims.top + dims.span * 0.45})`);
await sleep(1400);
out.act45 = await cdp.eval(`({act: document.body.dataset.act, hud: document.querySelector('#hudMode').textContent, hint: document.querySelector('#hudHint').textContent, sLink: document.querySelector('#sLink').textContent, beat: [...document.querySelectorAll('.beat.on')].length})`);

await cdp.eval(`window.scrollTo(0, ${dims.top + dims.span * 0.9})`);
await sleep(3600);
out.ending = await cdp.eval(`({act: document.body.dataset.act, after: document.querySelector('#after').classList.contains('show'), l1: document.querySelector('#al1').classList.contains('on'), l2: document.querySelector('#al2').classList.contains('on'), locked: !!document.querySelector('#after.show')})`);
await sleep(5200);
out.afterMeta = await cdp.eval(`document.querySelector('#al4').textContent`);
out.actions = await cdp.eval(`document.querySelector('.after-actions').classList.contains('on')`);

console.log(JSON.stringify(out, null, 2));
console.log('--- logs ---');
console.log(logs.length ? logs.join('\n') : '(clean)');
ws.close(); edge.kill();
await sleep(300); process.exit(0);

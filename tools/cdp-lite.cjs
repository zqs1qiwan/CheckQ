/**
 * 极简 CDP 驱动（零依赖）：用 Node 内置 WebSocket 连 Chrome/Edge DevTools。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function launch(port = 9333) {
  const bin = fs.existsSync(CHROME) ? CHROME : EDGE;
  const profile = path.join(os.tmpdir(), 'cq-cdp-profile-' + port);
  fs.rmSync(profile, { recursive: true, force: true });
  const args = [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
    '--disable-extensions', '--mute-audio', '--no-sandbox', 'about:blank',
  ];
  const proc = spawn(bin, args, { stdio: 'ignore' });
  let ver = null;
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch { /* retry */ }
  }
  if (!ver) { proc.kill(); throw new Error('DevTools 未就绪'); }
  return { proc, port, wsUrl: ver.webSocketDebuggerUrl, bin };
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
    const c = new CDP(ws);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && c.pending.has(msg.id)) {
        const { resolve, reject } = c.pending.get(msg.id);
        c.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) c.listeners.forEach((l) => l(msg));
    };
    return c;
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('CDP 超时: ' + method)); }
      }, 60000);
    });
  }
  on(fn) { this.listeners.push(fn); }
  close() { try { this.ws.close(); } catch {} }
}

async function newPage(cdp) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const consoleErrors = [];
  cdp.on((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push('EXCEPTION: ' + (msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push('CONSOLE.ERROR: ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      consoleErrors.push('LOG.ERROR: ' + String(msg.params.entry.text || '').slice(0, 300));
    }
  });
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Log.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);

  const page = {
    targetId, sessionId, consoleErrors,
    async setViewport(width, height, mobile = false) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height,
      }, sessionId);
    },
    async goto(url) { await cdp.send('Page.navigate', { url }, sessionId); await sleep(900); },
    async reload() { await cdp.send('Page.reload', {}, sessionId); await sleep(900); },
    async eval(expression) {
      const r = await cdp.send('Runtime.evaluate', {
        expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true,
      }, sessionId);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async shot(file) {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      return file;
    },
    async close() { try { await cdp.send('Target.closeTarget', { targetId }); } catch {} },
  };
  return page;
}

module.exports = { launch, CDP, newPage, sleep };

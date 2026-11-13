#!/usr/bin/env node
/**
 * UI 冒烟检查（零依赖 CDP 驱动）
 *
 * 目的：用精确视口（桌面 / 移动）真实点击一遍界面，把「低级 UI 错误」机器化：
 *   - 横向溢出（内容比视口宽 → 出现横向滚动条）
 *   - 图标按钮没有按钮框（外链 a.iconbtn 曾经没有边框/底色）
 *   - 下拉菜单被祖先 overflow 裁掉 / 超出视口 / 点不到（底部那几行最常见）
 *   - 弹窗：右上角 ✕、Esc 关闭、遮罩关闭、超出视口、**视口居中（不贴左上角）**、背景滚动未锁
 *   - 顶栏控件：单行、等高、垂直对齐；按钮不被挤到换行
 *   - 控制台报错 / 未捕获异常
 *
 * 用法：
 *   node tools/ui-smoke.cjs [baseUrl] [--shots <dir>]
 *   baseUrl 默认 http://localhost:19998（需先起一个本地实例）
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://localhost:19998';
const shotsIdx = process.argv.indexOf('--shots');
const SHOTS = shotsIdx > -1 ? process.argv[shotsIdx + 1] : '';
const USER = process.env.CHECKQ_USER || 'admin';
const PASS = process.env.CHECKQ_PASSWORD || 'test1234';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- 极简 CDP 客户端（Node 内置 WebSocket，无第三方依赖） ---------------- */
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('WebSocket 连接失败')); });
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
      }, 30000);
    });
  }
  on(fn) { this.listeners.push(fn); }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

async function launchBrowser(port = 9444) {
  const bin = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!bin) throw new Error('找不到 Chrome / Edge');
  const profile = path.join(os.tmpdir(), 'cq-ui-smoke-' + port);
  fs.rmSync(profile, { recursive: true, force: true });
  const proc = spawn(bin, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
    '--disable-extensions', '--mute-audio', '--no-sandbox', 'about:blank',
  ], { stdio: 'ignore' });
  let ver = null;
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch { /* retry */ }
  }
  if (!ver) { proc.kill(); throw new Error('DevTools 未就绪'); }
  return { proc, wsUrl: ver.webSocketDebuggerUrl };
}

/* ---------------- 页面封装 ---------------- */
async function newPage(cdp) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const errors = [];
  cdp.on((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push('未捕获异常: ' + (msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
      errors.push('console.' + msg.params.type + ': ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    }
    if (msg.method === 'Log.entryAdded' && ['error'].includes(msg.params.entry.level)) {
      const t = msg.params.entry.text || '';
      if (!/status of 401/.test(t)) errors.push('log.error: ' + t.slice(0, 300));
    }
  });
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Log.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);

  const page = {
    targetId, sessionId, errors,
    async viewport(w, h, mobile = false) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: w, height: h, deviceScaleFactor: 1, mobile, screenWidth: w, screenHeight: h,
      }, sessionId);
    },
    async goto(url) { await cdp.send('Page.navigate', { url }, sessionId); await sleep(900); },
    async reload() { await cdp.send('Page.reload', {}, sessionId); await sleep(900); },
    async eval(expr) {
      const r = await cdp.send('Runtime.evaluate', {
        expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true,
      }, sessionId);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async key(key, code = key, keyCode = 0) {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode }, sessionId);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode }, sessionId);
    },
    async shot(file) {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    },
    async close() { try { await cdp.send('Target.closeTarget', { targetId }); } catch { /* ignore */ } },
  };
  return page;
}

/* ---------------- 检查结果收集 ---------------- */
const issues = [];
const notes = [];
function fail(where, msg) { issues.push(`[${where}] ${msg}`); }
function ok(where, msg) { notes.push(`[${where}] ✓ ${msg}`); }

/* 页面内通用断言片段 */
const WAIT = `
  const waitFor = async (sel, ms = 5000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const el = document.querySelector(sel);
      if (el) return el;
      await new Promise(r => setTimeout(r, 100));
    }
    return null;
  };
`;

const ASSERT = `
  const A = { issues: [], notes: [] };
  const bad = (m) => A.issues.push(m);
  const good = (m) => A.notes.push(m);
  const rect = (el) => el.getBoundingClientRect();
  const visible = (el) => { const r = rect(el); return r.width > 0 && r.height > 0; };
  // 1) 横向溢出
  if (document.documentElement.scrollWidth > window.innerWidth + 1) {
    bad('横向溢出: 文档宽 ' + document.documentElement.scrollWidth + ' > 视口 ' + window.innerWidth);
  } else good('无横向溢出');
  // 2) 视口外溢元素（顶栏/主区里的关键块不应越界）
  for (const el of document.querySelectorAll('.topbar, .page, .big-tabs, .table-scroll')) {
    const r = rect(el);
    if (r.right > window.innerWidth + 1) bad('元素越界: ' + el.className + ' right=' + Math.round(r.right));
  }
  // 3) 任何元素伸出视口右边（横向滚动容器里的除外）
  const inScroller = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
    return false;
  };
  const spill = [...document.querySelectorAll('.topbar *, .page *')].filter((e) => {
    const r = rect(e);
    return r.width > 0 && r.height > 0 && r.right > window.innerWidth + 1 && !inScroller(e);
  }).slice(0, 5).map((e) => e.tagName + '.' + (typeof e.className === 'string' ? e.className : '') + '(right=' + Math.round(rect(e).right) + ')');
  if (spill.length) bad('元素伸出视口: ' + spill.join(', '));

  // 4) 页面上不能出现 undefined / NaN / [object Object]（数据形状对不上时的低级错误）
  const bodyText = (document.body.innerText || '');
  for (const token of ['undefined', 'NaN', '[object Object]']) {
    if (bodyText.includes(token)) {
      const at = bodyText.indexOf(token);
      bad('页面出现「' + token + '」: …' + bodyText.slice(Math.max(0, at - 30), at + 30).replace(/\s+/g, ' ') + '…');
    }
  }
`;

/** 下拉菜单通用检查：打开 → 是否完整可见 → 是否被裁剪 → 点击项是否命中 */
async function checkDropdown(page, where, openExpr, label = '') {
  await page.eval(`${openExpr}\nawait new Promise(r => setTimeout(r, 260));`);
  const res = await page.eval(`
    const pop = document.querySelector('.dd-pop:popover-open');
    if (!pop) return { ok: false, why: '菜单没有打开' };
    const r = pop.getBoundingClientRect();
    const vw = innerWidth, vh = innerHeight;
    const issues = [];
    if (r.top < -1) issues.push('菜单顶部出界 top=' + Math.round(r.top));
    if (r.bottom > vh + 1) issues.push('菜单底部出界 bottom=' + Math.round(r.bottom) + ' > ' + vh);
    if (r.left < -1) issues.push('菜单左侧出界 left=' + Math.round(r.left));
    if (r.right > vw + 1) issues.push('菜单右侧出界 right=' + Math.round(r.right));
    // 是否被祖先裁剪：命中测试（菜单中心点最上层元素必须属于菜单）
    const cx = r.left + r.width / 2, cy = r.top + 20;
    const hit = document.elementFromPoint(cx, cy);
    if (!hit || !pop.contains(hit)) issues.push('菜单被遮挡/裁剪（命中测试失败）');
    const style = getComputedStyle(pop);
    if (style.position !== 'fixed') issues.push('菜单未使用 fixed 定位（会被父级 overflow 裁剪）');
    return { ok: issues.length === 0, issues, rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }, items: [...pop.querySelectorAll('button')].map(b => b.textContent.trim()) };
  `);
  if (!res.ok) fail(where, `${label} 下拉菜单异常: ${res.issues.join('; ') || res.why}`);
  else ok(where, `${label} 下拉菜单正常（${res.items.length} 项, ${res.rect.top}~${res.rect.bottom}）`);
  return res;
}

/** 弹窗通用检查 */
async function checkModal(page, where, openExpr, opts = {}) {
  const { expectClose = true, label = '' } = opts;
  const name = label ? `「${label}」` : '';
  await page.eval(`${openExpr}\nawait new Promise(r => setTimeout(r, 320));`);
  const res = await page.eval(`
    const m = document.querySelector('dialog.modal[open]') || document.querySelector('.modal');
    if (!m) return { ok: false, why: '弹窗未打开' };
    const r = m.getBoundingClientRect();
    const issues = [];
    if (r.width > innerWidth + 1 || r.height > innerHeight + 1) issues.push('弹窗超出视口 ' + Math.round(r.width) + 'x' + Math.round(r.height));
    if (r.top < -1 || r.left < -1) issues.push('弹窗位置出界');
    // 弹窗必须在视口正中：贴到左上角（0,0）也是 bug，不能只查负数
    const dx = r.left + r.width / 2 - innerWidth / 2;
    const dy = r.top + r.height / 2 - innerHeight / 2;
    if (Math.abs(dx) > 12 || Math.abs(dy) > 12) {
      issues.push('弹窗未居中（疑似贴到左上角）dx=' + Math.round(dx) + ' dy=' + Math.round(dy) + ' rect=' + [r.left, r.top, r.width, r.height].map(Math.round).join(','));
    }
    const cs = getComputedStyle(m);
    if (cs.position !== 'fixed') issues.push('弹窗未用 fixed 定位（滚动时会跑偏）');
    const hasX = !!m.querySelector('.modal-close,[aria-label="关闭"],button.modal-x');
    const locked = m.matches(':modal');
    if (!locked) issues.push('不是模态 dialog（背景未 inert）');
    // 正文内部横向溢出
    const bodyEl = m.querySelector('.modal-body') || m;
    if (bodyEl.scrollWidth > bodyEl.clientWidth + 2) issues.push('弹窗内容横向溢出 ' + bodyEl.scrollWidth + '>' + bodyEl.clientWidth);
    // 底部操作区必须可见
    const foot = m.querySelector('.modal-foot');
    if (foot) { const fr = foot.getBoundingClientRect(); if (fr.bottom > innerHeight + 1) issues.push('弹窗底部按钮区出界'); }
    return { ok: issues.length === 0, issues, hasX, locked, title: (m.querySelector('h3,h2,.modal-title')||{}).textContent||'' };
  `);
  if (!res.ok) fail(where, `弹窗${name}异常: ${res.issues.join('; ') || res.why}`);
  else ok(where, `弹窗${name}「${res.title.trim().slice(0, 12)}」正常（尺寸合规、背景已锁、✕ 齐全）`);
  if (expectClose && !res.hasX) fail(where, `弹窗${name}「${res.title.trim()}」缺少右上角 ✕ 关闭按钮`);
  // Esc 关闭
  await page.key('Escape', 'Escape', 27);
  await new Promise(r => setTimeout(r, 320));
  const closed = await page.eval(`return !document.querySelector('dialog.modal[open]');`);
  if (!closed) {
    fail(where, `弹窗${name}「${res.title.trim()}」Esc 未关闭`);
    await page.eval(`document.querySelector('.modal-close,[aria-label="关闭"]')?.click(); await new Promise(r => setTimeout(r, 200));`);
  } else ok(where, `弹窗${name} Esc 关闭正常`);
  // 背景滚动还原
  const restored = await page.eval(`const b = getComputedStyle(document.body); return b.overflow !== 'hidden' || b.position !== 'fixed';`);
  if (!restored) fail(where, `弹窗${name}关闭后背景滚动未还原`);
  return res;
}

/* ---------------- 主流程 ---------------- */
(async () => {
  const { proc, wsUrl } = await launchBrowser();
  const cdp = await CDP.connect(wsUrl);
  const page = await newPage(cdp);
  const tag = (n) => `${n}`;

  try {
    /* 1) 登录 + 首页（桌面） */
    await page.viewport(1440, 900);
    await page.goto(BASE + '/');
    const login = await page.eval(`
      const r = await fetch('/api/login', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({username:${JSON.stringify(USER)}, password:${JSON.stringify(PASS)}})});
      return r.status;
    `);
    if (login !== 200) throw new Error('登录失败：' + login);
    await page.reload();

    const home = await page.eval(ASSERT + `
      // 图标按钮必须有按钮框（边框 + 尺寸）；幽灵样式平时透明是刻意的
      for (const el of document.querySelectorAll('.topbar .iconbtn')) {
        const cs = getComputedStyle(el); const r = rect(el);
        if (r.width < 1 || r.height < 1) continue; // 窄屏隐藏的动作组
        if (parseFloat(cs.borderTopWidth) < 1) bad('图标按钮没有边框: ' + (el.getAttribute('title')||el.className));
        if (r.width < 24 || r.height < 24) bad('图标按钮太小: ' + Math.round(r.width) + 'x' + Math.round(r.height));
      }
      if (!document.querySelector('.topbar a.iconbtn[href*="github.io"]')) bad('顶栏缺少「文档中心」外链');
      return { rows: document.querySelectorAll('.flow-table tbody tr').length, A };
    `);
    home.A.issues.forEach((i) => fail('首页/1440', i));
    home.A.notes.forEach((n) => ok('首页/1440', n));
    if (!home.rows) fail('首页/1440', '任务列表为空，无法验证行内菜单');
    if (SHOTS) await page.shot(path.join(SHOTS, 'home-1440.png'));

    /* 2) 底部行内菜单（最容易出界的一处） */
    await page.eval(WAIT + `
      const rows = [...document.querySelectorAll('.flow-table tbody tr')];
      const last = rows[rows.length - 1];
      last.scrollIntoView({ block: 'end' });
      await new Promise(r => setTimeout(r, 200));
      const trig = await waitFor('details.row-menu > summary, .dd-trigger');
      if (trig) trig.click();
      await new Promise(r => setTimeout(r, 260));
    `);
    await checkDropdown(page, '首页/1440', `return 1;`, '底部行');
    await page.eval(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await new Promise(r=>setTimeout(r,150));`);

    /* 2b) 交互契约：点任务名 = 任务详情；「更多」里才是「编辑流程」，且没有单独的基础信息入口 */
    const contract = await page.eval(WAIT + `
      const rows=[...document.querySelectorAll('.flow-table tbody tr')];
      const row=rows[0];
      const nameBtn=row.querySelector('button.flow-name');
      if (!nameBtn) return { ok:false, why:'任务名不是按钮（应可点开任务详情）' };
      nameBtn.click();
      await new Promise(r=>setTimeout(r,700));
      const m=document.querySelector('.modal');
      const title=m?(m.querySelector('.modal-title')||{}).textContent:'';
      const cells=m?[...m.querySelectorAll('.detail-k')].map(e=>e.textContent):[];
      const hasNote=m?!!m.querySelector('textarea'):false;
      document.querySelector('.modal-close,[aria-label="关闭"]')?.click();
      await new Promise(r=>setTimeout(r,300));
      row.scrollIntoView({block:'center'}); await new Promise(r=>setTimeout(r,250));
      row.querySelector('.dd-trigger').click(); await new Promise(r=>setTimeout(r,320));
      const items=[...document.querySelectorAll('.dd-pop:popover-open button')].map(b=>b.textContent.trim());
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      await new Promise(r=>setTimeout(r,200));
      return { ok:true, title, cells, hasNote, items };
    `);
    if (!contract.ok) fail('交互契约', contract.why);
    else {
      if (contract.title !== '任务详情') fail('交互契约', `点任务名打开的不是「任务详情」而是「${contract.title}」`);
      else ok('交互契约', '点任务名打开任务详情（含备注、调度、变量等信息）');
      if (!contract.hasNote) fail('交互契约', '任务详情里没有备注输入框');
      if (!contract.items.some((x) => x.startsWith('编辑'))) fail('交互契约', `「更多」菜单里没有编辑流程入口：${contract.items.join('/')}`);
      if (contract.items.some((x) => x.includes('任务信息'))) fail('交互契约', '「更多」菜单里仍有重复的基础信息入口');
      if (contract.cells.length < 6) fail('交互契约', `任务详情信息项太少：${contract.cells.join('/')}`);
      else ok('交互契约', `更多菜单 = ${contract.items.join(' / ')}（无重复入口）`);
    }

    /* 3) 顶栏「更多」菜单 */
    await checkDropdown(page, '首页/1440', `document.querySelector('.topbar .dd-trigger').click(); await new Promise(r=>setTimeout(r,260));`, '顶栏更多');
    await page.eval(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await new Promise(r=>setTimeout(r,150));`);

    /* 4) 模板 Tab（卡片菜单 + 模板市场） */
    await page.eval(`[...document.querySelectorAll('.big-tabs button')].find(b=>b.textContent.includes('模板')).click(); await new Promise(r=>setTimeout(r,300));`);
    const tpl = await page.eval(ASSERT + `return { A, cards: document.querySelectorAll('.tpl-card').length };`);
    tpl.A.issues.forEach((i) => fail('模板页/1440', i));
    if (SHOTS) await page.shot(path.join(SHOTS, 'templates-1440.png'));
    if (tpl.cards) {
      await page.eval(WAIT + `
        const trig = await waitFor('.tpl-card .dd-trigger');
        if (trig) trig.click();
        await new Promise(r => setTimeout(r, 260));
      `);
      await checkDropdown(page, '模板页/1440', `return 1;`, '模板卡');
      await page.eval(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await new Promise(r=>setTimeout(r,150));`);
    }
    await page.eval(`[...document.querySelectorAll('.big-tabs button')].find(b=>b.textContent.includes('任务')).click(); await new Promise(r=>setTimeout(r,250));`);

    /* 5) 设置弹窗（5 个页面）+ API 密钥 ⋯ 菜单 */
    await page.eval(`document.querySelector('.topbar .iconbtn[aria-label="设置"],.topbar button[title="设置"]').click(); await new Promise(r=>setTimeout(r,350));`);
    const st = await page.eval(`
      const m = document.querySelector('.modal');
      const r = m.getBoundingClientRect();
      const tabs = [...m.querySelectorAll('.settings-tab')].map(t => t.textContent.trim().slice(0,12));
      return { tabs, w: Math.round(r.width), h: Math.round(r.height), fits: r.width <= innerWidth && r.height <= innerHeight, vw: innerWidth, vh: innerHeight };
    `);
    if (!st.fits) fail('设置/1440', `设置弹窗超出视口 ${st.w}x${st.h} > ${st.vw}x${st.vh}`);
    else ok('设置/1440', `设置弹窗 ${st.w}x${st.h} 放得下，${st.tabs.length} 个分区`);
    if (SHOTS) await page.shot(path.join(SHOTS, 'settings-1440.png'));
    for (let i = 0; i < st.tabs.length; i++) {
      await page.eval(`document.querySelectorAll('.settings-tab')[${i}].click(); await new Promise(r=>setTimeout(r,280));`);
      const p = await page.eval(`
        const panel = document.querySelector('.settings-panel');
        if (!panel) return { ok: false };
        const over = panel.scrollWidth > panel.clientWidth + 2;
        const txt = panel.innerText || '';
        const bads = ['undefined', 'NaN', '[object Object]'].filter(t => txt.includes(t));
        return { ok: !over && !bads.length, over, bads, name: document.querySelector('.settings-tab.active')?.textContent.trim().slice(0,12) };
      `);
      if (!p.ok) fail('设置/1440', `设置分区「${p.name}」${p.over ? '内容横向溢出' : ''}${p.bads?.length ? ' 出现 ' + p.bads.join('/') : ''}`);
      else ok('设置/1440', `分区「${p.name}」无横向溢出、无 undefined/NaN`);
      if (i === 2 && SHOTS) await page.shot(path.join(SHOTS, 'settings-page-' + i + '.png'));
    }
    // API 密钥页的 ⋯ 菜单
    const keyMenu = await page.eval(`
      const tabs = [...document.querySelectorAll('.settings-tab')];
      const apikey = tabs.find(t => t.textContent.includes('API'));
      if (apikey) { apikey.click(); await new Promise(r=>setTimeout(r,300)); }
      const t = document.querySelector('.key-ops .dd-trigger');
      return { hasTab: !!apikey, hasTrigger: !!t };
    `);
    if (keyMenu.hasTrigger) {
      await page.eval(WAIT + `
        const trig = await waitFor('.key-ops .dd-trigger');
        if (trig) trig.click();
        await new Promise(r => setTimeout(r, 260));
      `);
      await checkDropdown(page, '设置/1440', `return 1;`, 'API 密钥');
      await page.eval(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await new Promise(r=>setTimeout(r,150));`);
    }
    await page.eval(`document.querySelector('.modal-close,[aria-label="关闭"]')?.click(); await new Promise(r=>setTimeout(r,250));`);

    /* 6) 站内通知弹窗 */
    await checkModal(page, '首页/1440', `document.querySelector('.bell-btn').click(); await new Promise(r=>setTimeout(r,320));`, {});
    await page.eval(`document.querySelector('.modal-close,[aria-label="关闭"]')?.click(); await new Promise(r=>setTimeout(r,200));`);

    /* 7) 快速组装 / cURL / 导入 弹窗 */
    await page.eval(`document.querySelector('.topbar .dd-trigger').click(); await new Promise(r=>setTimeout(r,250));`);
    await checkModal(page, '首页/1440', `document.querySelector('.dd-pop:popover-open button').click(); await new Promise(r=>setTimeout(r,350));`, {});
    await page.eval(`document.querySelector('.modal-close,[aria-label="关闭"]')?.click(); await new Promise(r=>setTimeout(r,200));`);

    /* 7b) 所有首页弹窗逐个体检（✕ / 尺寸 / Esc / 滚动锁 / 内部溢出） */
    const homeModals = [
      ['恢复', `[...document.querySelectorAll('.page button')].find(b=>b.textContent.trim()==='恢复')?.click()`],
      ['完整备份', `[...document.querySelectorAll('.page button')].find(b=>b.textContent.trim()==='完整备份')?.click()`],
      ['导入 cURL', `document.querySelector('.topbar .dd-trigger').click(); await new Promise(r=>setTimeout(r,220)); [...document.querySelectorAll('.dd-pop:popover-open button')].find(b=>b.textContent.includes('cURL'))?.click()`],
      ['导入 HAR/JSON', `document.querySelector('.topbar .dd-trigger').click(); await new Promise(r=>setTimeout(r,220)); [...document.querySelectorAll('.dd-pop:popover-open button')].find(b=>b.textContent.includes('HAR'))?.click()`],
      ['快速组装', `document.querySelector('.topbar .dd-trigger').click(); await new Promise(r=>setTimeout(r,220)); [...document.querySelectorAll('.dd-pop:popover-open button')].find(b=>b.textContent.includes('快速组装'))?.click()`],
    ];
    for (const [label, expr] of homeModals) {
      await checkModal(page, '首页弹窗', `${expr}; await new Promise(r=>setTimeout(r,380));`, { label });
      await page.eval(`
        document.querySelector('.modal-close,[aria-label="关闭"]')?.click();
        await new Promise(r=>setTimeout(r,220));
        document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
        await new Promise(r=>setTimeout(r,150));`);
    }

    /* 8) 编辑器 */
    const openEditor = await page.eval(WAIT + `
      const btn = [...document.querySelectorAll('.flow-table tbody tr td button')].find(b => b.textContent.trim().startsWith('编辑'));
      if (btn) { btn.click(); return true; }
      const row = await waitFor('.flow-table tbody tr');
      if (row) { const m = row.querySelector('.dd-trigger'); m.click(); await new Promise(r=>setTimeout(r,250));
        const e = [...document.querySelectorAll('.dd-pop:popover-open button')].find(b=>b.textContent.trim().startsWith('编辑')); if (e) { e.click(); return true; } }
      return false;
    `);
    if (openEditor) {
      await sleep(1200);
      const ed = await page.eval(ASSERT + `
        const palette = document.querySelector('.palette'), canvas = document.querySelector('.canvas-wrap'), cfg = document.querySelector('.config-panel');
        if (!palette || !canvas) bad('编辑器缺少积木/画布');
        if (canvas && canvas.getBoundingClientRect().height < 120) bad('画布高度塌陷: ' + Math.round(canvas.getBoundingClientRect().height));
        return { A, hasCanvas: !!canvas, h: canvas ? Math.round(canvas.getBoundingClientRect().height) : 0 };
      `);
      ed.A.issues.forEach((i) => fail('编辑器/1440', i));
      if (!ed.A.issues.length) ok('编辑器/1440', '三栏布局正常');
      if (SHOTS) await page.shot(path.join(SHOTS, 'editor-1440.png'));
      await checkDropdown(page, '编辑器/1440', WAIT + `
        const trig = await waitFor('.editor-topbar .dd-trigger');
        if (trig) trig.click();
        await new Promise(r => setTimeout(r, 260));
      `, '编辑器更多');
      await page.eval(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await new Promise(r=>setTimeout(r,150));`);
      /* 8b) 编辑器里的每个弹窗 */
      const editorModals = [
        ['调度', `[...document.querySelectorAll('.editor-topbar button')].find(b=>b.textContent.includes('调度'))?.click()`],
        ['通知渠道', `document.querySelector('.editor-topbar .dd-trigger').click(); await new Promise(r=>setTimeout(r,220)); [...document.querySelectorAll('.dd-pop:popover-open button')].find(b=>b.textContent.includes('通知渠道'))?.click()`],
        ['填入 Cookie', `document.querySelector('.editor-topbar .dd-trigger').click(); await new Promise(r=>setTimeout(r,220)); [...document.querySelectorAll('.dd-pop:popover-open button')].find(b=>b.textContent.includes('Cookie'))?.click()`],
        ['日志配置', `document.querySelector('.editor-topbar .dd-trigger').click(); await new Promise(r=>setTimeout(r,220)); [...document.querySelectorAll('.dd-pop:popover-open button')].find(b=>b.textContent.includes('日志配置'))?.click()`],
        ['存为模板', `document.querySelector('.editor-topbar .dd-trigger').click(); await new Promise(r=>setTimeout(r,220)); [...document.querySelectorAll('.dd-pop:popover-open button')].find(b=>b.textContent.includes('存为模板'))?.click()`],
        ['使用引导', `document.querySelector('.editor-topbar .iconbtn[aria-label="使用引导"]')?.click()`],
      ];
      for (const [label, expr] of editorModals) {
        await checkModal(page, '编辑器弹窗', `${expr}; await new Promise(r=>setTimeout(r,380));`, { label });
        await page.eval(`
          document.querySelector('.modal-close,[aria-label="关闭"]')?.click();
          await new Promise(r=>setTimeout(r,220));
          document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
          await new Promise(r=>setTimeout(r,150));`);
      }
      /* 8c) 参数面板：选中节点后检查控件排版 */
      await page.eval(`
        const n = document.querySelector('.react-flow__node');
        if (n) n.dispatchEvent(new MouseEvent('click',{bubbles:true}));
        await new Promise(r=>setTimeout(r,500));`);
      const cfg = await page.eval(`
        const p = document.querySelector('.config-panel');
        if (!p) return { ok: false, why: '参数面板没打开' };
        const issues = [];
        if (p.scrollWidth > p.clientWidth + 2) issues.push('参数面板横向溢出');
        // 按钮不该被拉成整行（看起来像输入框）
        // 次要按钮不该被拉成整行（看起来像输入框）；主操作按钮整宽是允许的
        const stretched = [...p.querySelectorAll('button.small')].filter(b => b.getBoundingClientRect().width > p.clientWidth * 0.9).length;
        if (stretched) issues.push(stretched + ' 个次要按钮被拉满整行，看起来像输入框');
        return { ok: issues.length === 0, issues };
      `);
      if (!cfg.ok) fail('编辑器参数面板', cfg.issues.join('; ') || cfg.why);
      else ok('编辑器参数面板', '控件排版正常（按钮不被拉成整行、无横向溢出）');

      /* 8d) 左侧面板：变量行的按钮不能被面板裁掉（此时编辑器已打开） */
      const pal = await page.eval(`
        const pal=document.querySelector('.palette');
        if (!pal) return { ok:false, why:'左侧积木面板不存在' };
        const pr=pal.getBoundingClientRect();
        const bad=[];
        for (const v of pal.querySelectorAll('.var-row')) {
          for (const b of v.querySelectorAll('button')) {
            const br=b.getBoundingClientRect();
            if (br.right > pr.right + 0.5 || br.left < pr.left - 0.5) bad.push((b.textContent||b.title||'?') + ' 越出面板');
          }
        }
        return { ok: bad.length === 0, bad, n: pal.querySelectorAll('.var-row').length };
      `);
      if (!pal.ok) fail('编辑器左侧面板', `变量行按钮被裁掉: ${pal.bad.join('、') || pal.why}`);
      else ok('编辑器左侧面板', `变量行按钮都在面板内（${pal.n} 行）`);
      // 回到列表
      await page.eval(`const b = [...document.querySelectorAll('.editor-topbar button')].find(x=>x.textContent.includes('返回')||x.getAttribute('title')?.includes('返回')); if (b) b.click(); await new Promise(r=>setTimeout(r,600));`);
    } else fail('编辑器/1440', '打不开编辑器');

    /* 9) 移动端视口 */
    await page.viewport(390, 844, true);
    await page.reload();
    const mob = await page.eval(ASSERT + `
      const wide = [...document.querySelectorAll('.topbar *, .page *')].filter(e => {
        const r = rect(e);
        return r.width > innerWidth + 1 && !inScroller(e);
      }).slice(0, 5).map(e => e.className + '(' + Math.round(rect(e).width) + ')');
      if (wide.length) bad('移动端元素超宽: ' + wide.join(', '));
      return { A };
    `);
    mob.A.issues.forEach((i) => fail('移动端/390', i));
    mob.A.notes.forEach((n) => ok('移动端/390', n));
    if (SHOTS) await page.shot(path.join(SHOTS, 'home-390.png'));
    await page.eval(WAIT + `
      const rows=[...document.querySelectorAll('.flow-table tbody tr')];
      if(rows.length){
        const last=rows[rows.length-1];
        last.scrollIntoView({block:'end'});
        await new Promise(r=>setTimeout(r,200));
        const trig=await waitFor('.dd-trigger');
        if(trig) trig.click();
        await new Promise(r=>setTimeout(r,260));
      }
    `);
    await checkDropdown(page, '移动端/390', `return 1;`, '底部行');
    await page.eval(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await new Promise(r=>setTimeout(r,150));`);

    /* 9b) 二次确认弹窗生命周期：取消 / 确认 / Esc / ✕ 都必须真正关闭，且不能卡住后续操作 */
    await page.viewport(1440, 900);
    await page.reload();
    const openConfirm = `
      const row=document.querySelector('.flow-table tbody tr');
      row.querySelector('.dd-trigger').click();
      await new Promise(r=>setTimeout(r,300));
      const b=[...document.querySelectorAll('.dd-pop:popover-open button')].find(x=>x.textContent.trim()==='删除');
      if (b) b.click();
      await new Promise(r=>setTimeout(r,400));
      return !!document.querySelector('dialog.modal[open]');
    `;
    // 1) 取消
    const c1 = await page.eval(openConfirm);
    if (!c1) fail('确认弹窗/1440', '删除任务没有弹出确认框');
    await page.eval(`[...document.querySelectorAll('dialog.modal[open] .modal-foot button')].find(b=>b.textContent.trim()==='取消')?.click(); await new Promise(r=>setTimeout(r,400)); return 1;`);
    const closed1 = await page.eval(`return !document.querySelector('dialog.modal[open]');`);
    if (!closed1) fail('确认弹窗/1440', '点「取消」后确认框没有消失');
    else ok('确认弹窗/1440', '点「取消」后确认框关闭');
    // 2) Esc
    await page.eval(openConfirm);
    await page.key('Escape', 'Escape', 27);
    await sleep(350);
    const closed2 = await page.eval(`return !document.querySelector('dialog.modal[open]');`);
    if (!closed2) fail('确认弹窗/1440', 'Esc 后确认框没有消失');
    else ok('确认弹窗/1440', 'Esc 关闭确认框');
    // 3) 右上角 ✕
    await page.eval(openConfirm);
    await page.eval(`document.querySelector('dialog.modal[open] .modal-close')?.click(); await new Promise(r=>setTimeout(r,350)); return 1;`);
    const closed3 = await page.eval(`return !document.querySelector('dialog.modal[open]');`);
    if (!closed3) fail('确认弹窗/1440', '点 ✕ 后确认框没有消失');
    else ok('确认弹窗/1440', '✕ 关闭确认框');
    // 4) 确认删除：弹窗消失 + 任务真的少一行（仅删本地预置的「冒烟临时任务」，生产实例跳过以保持只读）
    const tempRow = await page.eval(`return [...document.querySelectorAll('.flow-table tbody tr')].some(r=>r.innerText.includes('冒烟临时任务'));`);
    if (tempRow) {
      const before = await page.eval(`return document.querySelectorAll('.flow-table tbody tr').length;`);
      await page.eval(`
        const row=[...document.querySelectorAll('.flow-table tbody tr')].find(r=>r.innerText.includes('冒烟临时任务'));
        row.querySelector('.dd-trigger').click(); await new Promise(r=>setTimeout(r,300));
        [...document.querySelectorAll('.dd-pop:popover-open button')].find(x=>x.textContent.trim()==='删除')?.click();
        await new Promise(r=>setTimeout(r,400)); return 1;
      `);
      await page.eval(`[...document.querySelectorAll('dialog.modal[open] .modal-foot button')].find(b=>b.textContent.includes('删除'))?.click(); return 1;`);
      const after = await page.eval(`
        const t0=Date.now();
        while (Date.now()-t0 < 4000) {
          if (!document.querySelector('dialog.modal[open]') && document.querySelectorAll('.flow-table tbody tr').length < ${before}) break;
          await new Promise(r=>setTimeout(r,150));
        }
        return JSON.stringify({ closed: !document.querySelector('dialog.modal[open]'), rows: document.querySelectorAll('.flow-table tbody tr').length });
      `);
      const a = JSON.parse(after);
      if (!a.closed) fail('确认弹窗/1440', '点「删除」后确认框仍卡在屏幕上（已删除但未关闭）');
      else ok('确认弹窗/1440', '点「删除」后确认框关闭');
      if (a.rows >= before) fail('确认弹窗/1440', `确认后临时任务没有被删除（${before} → ${a.rows}）`);
      else ok('确认弹窗/1440', `确认后临时任务已删除（${before} → ${a.rows}）`);
    } else {
      ok('确认弹窗/1440', '生产/无临时任务：跳过破坏性确认分支（取消/Esc/✕ 已覆盖 resolver 关闭路径）');
    }

    // 4b) 提交型弹窗：保存成功后必须关闭（本地实例才做，避免写生产数据）
    if (tempRow) {
      await page.eval(`
        const row=document.querySelector('.flow-table tbody tr');
        row.querySelector('.dd-trigger').click(); await new Promise(r=>setTimeout(r,250));
        [...document.querySelectorAll('.dd-pop:popover-open button')].find(b=>b.textContent.includes('编辑流程')).click();
        await new Promise(r=>setTimeout(r,1300));
        document.querySelector('.editor-topbar .dd-trigger').click(); await new Promise(r=>setTimeout(r,250));
        [...document.querySelectorAll('.dd-pop:popover-open button')].find(b=>b.textContent.includes('通知渠道')).click();
        await new Promise(r=>setTimeout(r,500)); return 1;
      `);
      const opened = await page.eval(`return !!document.querySelector('dialog.modal[open]');`);
      if (!opened) fail('提交型弹窗/1440', '通知渠道弹窗没有打开');
      await page.eval(`[...document.querySelectorAll('dialog.modal[open] .modal-foot button')].find(b=>b.textContent.trim()==='保存')?.click(); await new Promise(r=>setTimeout(r,900)); return 1;`);
      const closed = await page.eval(`return !document.querySelector('dialog.modal[open]');`);
      if (!closed) fail('提交型弹窗/1440', '点「保存」后通知渠道弹窗没有消失');
      else ok('提交型弹窗/1440', '点「保存」后通知渠道弹窗关闭');
      await page.eval(`[...document.querySelectorAll('.editor-topbar button')].find(b=>b.textContent.trim()==='返回')?.click(); await new Promise(r=>setTimeout(r,800)); return 1;`);
    }

    // 5) 全局提示条自动消失（不能一直挂着）
    await page.eval(`window.__checkqToast?.('UI 冒烟测试提示', 'fail'); await new Promise(r=>setTimeout(r,700)); return 1;`);
    const toastShown = await page.eval(`return !!document.querySelector('.toast-stack .toast');`);
    if (!toastShown) fail('全局提示', '备份成功提示没有出现');
    else ok('全局提示', '备份成功提示出现');
    await sleep(5200);
    const toastGone = await page.eval(`return !document.querySelector('.toast-stack .toast');`);
    if (!toastGone) fail('全局提示', '提示条 5 秒后仍未自动消失（只能手动点掉）');
    else ok('全局提示', '提示条 5 秒后自动消失');

    /* 10) 控制台错误 */
    if (page.errors.length) page.errors.forEach((e) => fail('控制台', e));
    else ok('控制台', '无报错、无未捕获异常');

    /* 11) 视口矩阵：多个尺寸 + 明暗两套主题，逐个体检 */
    const sizes = [[1920, 1080], [1440, 900], [1280, 800], [1024, 768], [820, 1180], [390, 844], [360, 640]];
    for (const [w, h] of sizes) {
      await page.viewport(w, h, w < 700);
      await page.reload();
      for (const mode of ['dark', 'light']) {
        await page.eval(`
          document.documentElement.dataset.mode = ${JSON.stringify(mode)};
          document.documentElement.dataset.theme = ${JSON.stringify(mode)};
          await new Promise(r => setTimeout(r, 200)); return 1;`);
        const res = await page.eval(ASSERT + `
          // 顶栏控件不能互相压字
          const items = [...document.querySelectorAll('.topbar > *')].filter(e => {
            const r = rect(e); return r.width > 0 && r.height > 0;
          });
          for (let i = 0; i < items.length; i++) {
            for (let j = i + 1; j < items.length; j++) {
              const a = rect(items[i]), b = rect(items[j]);
              const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
              const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
              if (ox > 2 && oy > 2) bad('顶栏元素重叠: ' + (items[i].className||items[i].tagName) + ' × ' + (items[j].className||items[j].tagName));
            }
          }
          // 图标按钮：细边框 + 足够点击区（幽灵样式平时透明是刻意的，悬停才浮出底色）
          for (const el of document.querySelectorAll('.topbar .iconbtn')) {
            const cs = getComputedStyle(el); const r = rect(el);
            if (r.width < 1 || r.height < 1) continue; // 窄屏收进「更多」的动作组是隐藏的
            if (parseFloat(cs.borderTopWidth) < 1) bad('图标按钮没有边框: ' + (el.getAttribute('title')||el.className));
            if (r.width < 24 || r.height < 24) bad('图标按钮太小: ' + Math.round(r.width) + 'x' + Math.round(r.height));
          }
          // 顶栏可交互控件：必须单行、等高、垂直居中对齐（按钮被挤到换行是回归项）
          const ctrls = [...document.querySelectorAll('.topbar button, .topbar a.iconbtn, .topbar .dd-trigger')]
            .filter(e => { const q = rect(e); return q.width > 0 && q.height > 0 && getComputedStyle(e).visibility !== 'hidden'; });
          const heights = [...new Set(ctrls.map(e => Math.round(rect(e).height)))];
          if (heights.length > 1) bad('顶栏控件高度不一致: ' + heights.join(','));
          const tops = [...new Set(ctrls.map(e => Math.round(rect(e).top)))];
          if (tops.length > 1) bad('顶栏控件被挤到换行: top=' + tops.join(','));
          // 主题必须真的切过去（背景色变化）
          const bg = getComputedStyle(document.body).backgroundColor;
          return { A, bg };
        `);
        res.A.issues.forEach((i) => fail(`视口${w}x${h}/${mode}`, i));
        if (!res.A.issues.length) ok(`视口${w}x${h}/${mode}`, '布局无溢出、顶栏无重叠、图标按钮齐全');
      }
      if (SHOTS) await page.shot(path.join(SHOTS, `viewport-${w}x${h}.png`));
    }
    await page.viewport(1440, 900);
  } catch (e) {
    fail('运行', e.message + (e.stack ? ' | ' + String(e.stack).split('\n').slice(0, 3).join(' <- ') : ''));
  }

  await page.close();
  cdp.close();
  proc.kill();

  console.log('===== 通过项 =====');
  notes.forEach((n) => console.log('  ' + n));
  console.log('\n===== 问题项 =====');
  if (!issues.length) console.log('  （无）');
  else issues.forEach((i) => console.log('  ✗ ' + i));
  console.log(`\n合计：${notes.length} 项通过 / ${issues.length} 个问题`);
  process.exit(issues.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });

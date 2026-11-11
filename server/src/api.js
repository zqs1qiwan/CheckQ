/**
 * CheckQ API server — Fastify
 * 认证: cookie session + 可选 X-API-Key（自动化）
 * run 接口: 同步返回完整结果（流程通常 < 60s）
 */

import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';

import { Store, hashPwd, verifyPwd } from './store.js';
import { checkPassword, checkUsername, ROLES, PASSWORD_MIN, hashApiKey, newApiKey } from './auth.js';
import { generateSecret, verifyTotp, generateRecoveryCodes, hashRecoveryCode, verifyRecoveryCode, otpauthUri } from './totp.js';
import { Engine, redactVars } from './engine.js';
import { validateFlow } from './model.js';
import { importHar } from './har-import.js';
import { parseCurl } from './curl-import.js';
import { Scheduler } from './scheduler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** POSIX shell 单引号包裹（curl 生成用） */
function shellQuote(s) {
  if (s === '' || s === undefined || s === null) return "''";
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

export function buildServer({ dataDir, port }) {
  const store = new Store(dataDir);
  const app = Fastify({ logger: false, bodyLimit: 32 * 1024 * 1024 });
  // 容器 stop/restart 会发 SIGTERM：先立即落盘再退出，避免丢掉 400ms 节流窗口内的配置变更
  const flushExit = () => {
    store.flush();
    process.exit(0);
  };
  process.once('SIGTERM', flushExit);
  process.once('SIGINT', flushExit);
  const sessions = new Map(); // qsid -> { userId, createdAt, lastSeenAt, ip, ua, expiresAt }
  const SESSION_TTL = 7 * 24 * 3600e3;   // 绝对有效期 7 天
  const SESSION_IDLE = 24 * 3600e3;       // 空闲 24 小时失效
  const CSRF_SAFE = new Set(['/api/login', '/api/logout', '/api/health', '/api/system/bootstrap']);
  // 登录防爆破（PRD §4.10）：同一 IP 10 分钟内失败 5 次 → 429 锁定
  const loginFails = new Map(); // ip -> { count, firstAt }
  const LOGIN_FAIL_LIMIT = 5;
  const LOGIN_FAIL_WINDOW = 10 * 60 * 1000;
  const loginLocked = (ip) => {
    const rec = loginFails.get(ip);
    if (!rec) return false;
    if (Date.now() - rec.firstAt > LOGIN_FAIL_WINDOW) { loginFails.delete(ip); return false; }
    return rec.count >= LOGIN_FAIL_LIMIT;
  };
  const noteLoginFail = (ip) => {
    const rec = loginFails.get(ip);
    if (rec && Date.now() - rec.firstAt <= LOGIN_FAIL_WINDOW) rec.count++;
    else loginFails.set(ip, { count: 1, firstAt: Date.now() });
  };
  const ACCOUNT_FAIL_LIMIT = 8;          // 单账号连续失败上限
  const ACCOUNT_FAIL_WINDOW = 15 * 60e3; // 单账号锁定窗口

  /** 当前会话（过期即清理） */
  function currentSession(req) {
    const qsid = req.cookies?.qsid;
    if (!qsid) return null;
    const s = sessions.get(qsid);
    if (!s) return null;
    if (s.expiresAt < Date.now() || Date.now() - s.lastSeenAt > SESSION_IDLE) {
      sessions.delete(qsid);
      return null;
    }
    s.lastSeenAt = Date.now();
    return { qsid, ...s };
  }

  /** 某用户的全部会话 id */
  function sessionsOf(userId) {
    return [...sessions.entries()].filter(([, s]) => s.userId === userId).map(([id]) => id);
  }

  const runningFlows = new Set();
  const queueMap = new Map(); // flowId -> Promise 链（运行排队：同 flow 串行执行）
  const enqueueRun = (flowId, fn) => {
    const prev = queueMap.get(flowId) || Promise.resolve();
    let release;
    const cur = new Promise((res) => { release = res; });
    queueMap.set(flowId, prev.then(() => cur));
    return prev.then(async () => {
      try { return await fn(); } finally { release(); }
    });
  };
  const queuedSet = new Set(); // 等待中的 flowId（排队中徽章）
  const runner = {
    async runFlow(flow, trigger, { debugStopId, onLog, debug } = {}) {
      const isQueued = runningFlows.has(flow.id);
      if (isQueued) queuedSet.add(flow.id);
      try {
        return await enqueueRun(flow.id, async () => {
          runningFlows.add(flow.id);
          queuedSet.delete(flow.id);
          const runId = crypto.randomUUID();
          const run = {
            id: runId, flowId: flow.id, flowName: flow.name, trigger,
            startedAt: Date.now(), status: 'running', logs: [], vars: {}, finalMessage: '',
          };
          try {
            const engine = new Engine(flow);
            const result = await engine.run({ trigger, runId, debugStopId, debug: debug === true, logSink: onLog });
            run.status = result.ok ? 'success' : 'failed';
            run.logs = result.logs;
            run.finalMessage = result.finalMessage || (result.ok ? '' : '执行失败');
            run.summary = result.summary || '';
            run.vars = redactVars(result.vars);
            run.durationMs = Date.now() - run.startedAt;
          } catch (err) {
            run.status = 'failed';
            run.finalMessage = `引擎异常: ${err.message}`;
            run.durationMs = Date.now() - run.startedAt;
          } finally {
            runningFlows.delete(flow.id);
          }
          store.addRun(run);
          await sendNotify(flow, run);
          return run;
        });
      } finally {
        if (queuedSet.has(flow.id) && !runningFlows.has(flow.id)) queuedSet.delete(flow.id);
      }
    },
  };

  async function sendNotify(flow, run) {
    const n = flow.notify || {};
    const fire = (run.status === 'success' && n.onSuccess) || (run.status === 'failed' && n.onFailure);
    if (!fire || !n.channels?.length) return;
    const text = renderNotifyTemplate(n, flow, run);
    return sendToChannels(n.channels, text, { flowId: flow.id, flowName: flow.name, status: run.status });
  }

  /** 每日汇总的「推送单位」：由用户勾选的任务列表（每个任务用它自己的通知渠道） */
  function summaryTargets(cfg = store.meta.dailySummary || {}) {
    const ids = Array.isArray(cfg.targetFlowIds) && cfg.targetFlowIds.length
      ? cfg.targetFlowIds
      : (cfg.targetFlowId ? [cfg.targetFlowId] : []);
    return ids.map((id) => store.getFlow(id)).filter((f) => f && f.notify?.channels?.length);
  }

  async function pushDailySummary(targets) {
    const s = store.stats();
    const text = `每日汇总：今日 ${s.todayRuns} 次（成功 ${s.todaySuccess} / 失败 ${s.todayFailed}，成功率 ${s.successRate ?? '—'}%）；任务 ${s.flows}，调度中 ${s.enabledScheduled}，下次 ${s.nextRunAt ? new Date(s.nextRunAt).toLocaleString('zh-CN') : '—'}`;
    const groups = [];
    for (const target of targets) {
      const results = await sendToChannels(target.notify.channels, text, { flowId: target.id, flowName: target.name, status: 'success' });
      groups.push({ flowId: target.id, flowName: target.name, results });
    }
    const total = groups.reduce((n, g) => n + g.results.length, 0);
    const ok = groups.reduce((n, g) => n + g.results.filter((x) => x.ok).length, 0);
    console.log(`[CheckQ] dailySummary 已发送 ${ok}/${total} 渠道（${groups.length} 个推送单位）`);
    return { text, results: groups.flatMap((g) => g.results), groups };
  }

  runner.sendDailySummary = async () => {
    const targets = summaryTargets();
    if (!targets.length) {
      console.log('[CheckQ] dailySummary 跳过：未选择推送单位（或所选任务没有通知渠道）');
      return null;
    }
    return pushDailySummary(targets);
  };

  function renderNotifyTemplate(n, flow, run) {
    const tpl = (n.template || '[CheckQ] {{flow.name}} {{status}}\n{{message}}');
    return tpl
      .replace(/\{\{\s*flow\.name\s*\}\}/g, flow.name || '')
      .replace(/\{\{\s*status\s*\}\}/g, run.status === 'success' ? '成功 ✅' : '失败 ❌')
      .replace(/\{\{\s*message\s*\}\}/g, run.finalMessage || (run.logs?.at(-1)?.message || ''))
      .replace(/\{\{\s*duration\s*\}\}/g, `${((run.durationMs || 0) / 1000).toFixed(1)}s`)
      .replace(/\{\{\s*time\s*\}\}/g, new Date(run.startedAt || Date.now()).toLocaleString('zh-CN'));
  }

  // Cookie 一键回填（统一浏览器登录）：书签脚本在站点页把 document.cookie POST 到这里，前端已登录的任务自动写入变量
  app.options('/api/cookie-capture', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'POST,OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'content-type');
    return reply.code(204).send();
  });
  app.post('/api/cookie-capture', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    const { flowId, cookie, varName } = req.body || {};
    if (!flowId || !cookie) return reply.code(400).send({ error: '缺少 flowId/cookie' });
    const f = store.getFlow(flowId);
    if (!f) return reply.code(404).send({ error: '任务不存在' });
    const name = /^[A-Za-z_][\w]*$/.test(varName || 'cookie') ? (varName || 'cookie') : 'cookie';
    store.updateFlow(flowId, { vars: { ...(f.vars || {}), [name]: String(cookie).trim() } });
    store.flush();
    return { ok: true, flowId, varName: name };
  });

  // 统一浏览器登录（Camofox 自动回填）：服务端开签到站登录页，用户在同一窗口登录后点「已登录，自动抓」
  // 原理：CheckQ 调 Camofox 新建 tab → navigate 到登录页 → 前端用户自行在该浏览器里操作（noVNC/镜像可见）→ 后端 evaluate 读 document.cookie 写回变量
  const camoBase = process.env.CAMOFOX_URL || 'http://checkq.local:9377';
  async function camo(method, path, body) {
    const res = await fetch(`${camoBase}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    if (!res.ok) throw new Error(`camofox ${res.status}: ${String(text).slice(0, 200)}`);
    return data;
  }
  app.post('/api/browser-login/start', async (req, reply) => {
    const { flowId, url } = req.body || {};
    const f = flowId ? store.getFlow(flowId) : null;
    if (!url || !/^https?:\/\//i.test(String(url))) return reply.code(400).send({ error: '缺少合法 url' });
    const userId = `checkq-${f?.id || 'anon'}`;
    try {
      const tab = await camo('POST', '/tabs', { userId, sessionKey: 'login', url });
      return { ok: true, tabId: tab.tabId || tab.id || tab, url };
    } catch (e) {
      return reply.code(502).send({ error: `统一浏览器打不开：${e.message}` });
    }
  });
  app.post('/api/browser-login/capture', async (req, reply) => {
    const { flowId, tabId, varName } = req.body || {};
    const f = flowId ? store.getFlow(flowId) : null;
    if (!f || !tabId) return reply.code(400).send({ error: '缺少 flowId/tabId' });
    const userId = `checkq-${f.id}`;
    try {
      const ev = await camo('POST', `/tabs/${tabId}/evaluate`, { userId, expression: 'document.cookie' });
      const cookie = String(ev.result || '').trim();
      if (!cookie) return reply.code(400).send({ error: '当前页面还没有 cookie（可能未登录）' });
      const name = /^[A-Za-z_][\w]*$/.test(varName || 'cookie') ? (varName || 'cookie') : 'cookie';
      store.updateFlow(flowId, { vars: { ...(f.vars || {}), [name]: cookie } });
      store.flush();
      return { ok: true, flowId, varName: name, length: cookie.length };
    } catch (e) {
      return reply.code(502).send({ error: `抓取失败：${e.message}` });
    }
  });

  async function sendToChannels(channels, text, ctx = {}) {
    const results = [];
    for (const ch of channels || []) {
      try {
        if (ch.type === 'webhook') {
          const res = await fetch(ch.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: text, signal: AbortSignal.timeout(15000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } else if (ch.type === 'inbox') {
          store.addNotification({
            title: ch.title || `${ctx.flowName || 'CheckQ'} ${ctx.status === 'failed' ? '失败' : '通知'}`,
            content: text, level: ctx.status === 'failed' ? 'fail' : 'success',
            flowId: ctx.flowId || null, flowName: ctx.flowName || '',
          });
        } else if (ch.type === 'pushplus') {
          const res = await fetch('https://www.pushplus.plus/send', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token: String(ch.token || '').trim(), title: ch.title || 'CheckQ 通知', content: text, template: ch.template || 'txt' }),
            signal: AbortSignal.timeout(15000),
          });
          const j = await res.json().catch(() => ({}));
          if (!res.ok || (j.code !== undefined && j.code !== 200)) throw new Error(`HTTP ${res.status} code=${j.code} ${j.msg || ''}`);
        } else if (ch.type === 'gotify') {
          const base = String(ch.url || '').replace(/\/+$/, '');
          const res = await fetch(`${base}/message?token=${encodeURIComponent(ch.token || '')}`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: ch.title || 'CheckQ', message: text, priority: Number(ch.priority) || 5 }),
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } else if (ch.type === 'ntfy') {
          const base = String(ch.url || 'https://ntfy.sh').replace(/\/+$/, '');
          const topic = String(ch.topic || '').trim();
          if (!topic) throw new Error('缺少 topic');
          const res = await fetch(`${base}/${encodeURIComponent(topic)}`, {
            method: 'POST',
            headers: { 'content-type': 'text/plain; charset=utf-8', Title: ch.title || 'CheckQ', Priority: String(ch.priority || 'default') },
            body: text, signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } else if (ch.type === 'email') {
          await smtpSend(ch, ch.subject || ch.title || '[CheckQ] 通知', text);
        } else if (ch.type === 'telegram') {
          const res = await fetch(`https://api.telegram.org/bot${ch.token}/sendMessage`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ chat_id: ch.chat, text, disable_web_page_preview: true }),
            signal: AbortSignal.timeout(15000),
          });
          const j = await res.json().catch(() => ({}));
          if (!res.ok || j.ok === false) throw new Error(`HTTP ${res.status} ${j.description || ''}`);
        } else if (ch.type === 'bark') {
          const u = (ch.url || '').replace(/\/+$/, '');
          const title = encodeURIComponent(ch.title || 'CheckQ');
          const body = encodeURIComponent(text);
          const res = await fetch(`${u}/${title}/${body}${ch.group ? '?group=' + encodeURIComponent(ch.group) : ''}`, { signal: AbortSignal.timeout(15000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } else if (ch.type === 'serverchan') {
          const key = String(ch.key || '').trim();
          const res = await fetch(`https://sctapi.ftqq.com/${key}.send`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: ch.title || 'CheckQ 通知', desp: text }),
            signal: AbortSignal.timeout(15000),
          });
          const j = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(`HTTP ${res.status} ${j.message || ''}`);
          if (j.code !== undefined && j.code !== 0) throw new Error(`HTTP ${res.status} code=${j.code} ${j.message || ''}`);
        } else if (ch.type === 'dingtalk') {
          const url = await signBotUrl(ch);
          const res = await fetch(url, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ msgtype: 'markdown', markdown: { title: ch.title || 'CheckQ 通知', text } }),
            signal: AbortSignal.timeout(15000),
          });
          const j = await res.json().catch(() => ({}));
          if (!res.ok || j.errcode !== 0) throw new Error(`HTTP ${res.status} errcode=${j.errcode} ${j.errmsg || ''}`);
        } else if (ch.type === 'wecom') {
          const res = await fetch(ch.url, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ msgtype: 'markdown', markdown: { content: text } }),
            signal: AbortSignal.timeout(15000),
          });
          const j = await res.json().catch(() => ({}));
          if (!res.ok || j.errcode !== 0) throw new Error(`HTTP ${res.status} errcode=${j.errcode} ${j.errmsg || ''}`);
        } else if (ch.type === 'feishu') {
          const url = await signBotUrl(ch);
          const res = await fetch(url, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ msg_type: 'text', content: { text } }),
            signal: AbortSignal.timeout(15000),
          });
          const j = await res.json().catch(() => ({}));
          if (!res.ok || j.code !== 0) throw new Error(`HTTP ${res.status} code=${j.code} ${j.msg || ''}`);
        } else {
          throw new Error('未知通知类型: ' + ch.type);
        }
        results.push({ type: ch.type, ok: true });
      } catch (err) {
        console.error(`[CheckQ] notify ${ch.type} failed:`, err.message);
        results.push({ type: ch.type, ok: false, error: err.message });
      }
    }
    return results;
  }

  /** 钉钉/飞书机器人签名：timestamp + "\n" + secret 做 HMAC-SHA256，base64 后拼到 URL */
  async function signBotUrl(ch) {
    const url = String(ch.url || '');
    if (!ch.secret) return url;
    const ts = Date.now();
    const sign = encodeURIComponent(crypto.createHmac('sha256', ch.secret).update(`${ts}\n${ch.secret}`).digest('base64'));
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}timestamp=${ts}&sign=${sign}`;
  }

  /**
   * 极简 SMTP 发信（零依赖）：支持 465 隐式 TLS / 587 STARTTLS / AUTH LOGIN。
   * ch: { host, port, secure, user, pass, from, to }
   */
  function smtpSend(ch, subject, text) {
    const host = String(ch.host || '').trim();
    const port = Number(ch.port) || 465;
    const from = String(ch.from || ch.user || '').trim();
    const to = String(ch.to || '').trim();
    if (!host || !from || !to) return Promise.reject(new Error('缺少 host/from/to'));
    const implicitTLS = ch.secure === true || (ch.secure !== false && port === 465);

    return new Promise((resolve, reject) => {
      let socket = implicitTLS
        ? tls.connect({ host, port, servername: host })
        : net.connect({ host, port });
      let buf = '';
      let collect = [];
      const waiters = [];
      let settled = false;

      const fail = (err) => { if (settled) return; settled = true; try { socket.destroy(); } catch {} reject(err); };
      const done = (val) => { if (settled) return; settled = true; try { socket.end(); } catch {} resolve(val); };

      const attach = (s) => {
        s.setEncoding('utf8');
        s.setTimeout(20000, () => fail(new Error('SMTP 超时')));
        s.on('data', (d) => { buf += d; pump(); });
        s.on('error', fail);
      };
      const pump = () => {
        let idx;
        while ((idx = buf.indexOf('\r\n')) !== -1) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (/^\d{3}-/.test(line)) { collect.push(line); continue; }
          const full = [...collect, line].join('\n');
          collect = [];
          const w = waiters.shift();
          if (w) w(null, full);
        }
      };
      const read = () => new Promise((res, rej) => {
        waiters.push((e, v) => (e ? rej(e) : res(v)));
        // 超时兜底
        setTimeout(() => { const i = waiters.indexOf(waiters[waiters.length - 1]); if (i === -1 && !settled) rej(new Error('SMTP 响应超时')); }, 20000);
      });
      const cmd = async (line) => { socket.write(line + '\r\n'); return read(); };
      const expect = (resp, code, what) => {
        if (!resp || !resp.startsWith(String(code))) throw new Error(`${what} 失败: ${String(resp || '').split('\n').pop()}`);
        return resp;
      };

      attach(socket);
      (async () => {
        expect(await read(), 220, '连接');
        let ehlo = await cmd('EHLO checkq.local');
        if (!implicitTLS && /STARTTLS/i.test(ehlo)) {
          expect(await cmd('STARTTLS'), 220, 'STARTTLS');
          const plain = socket;
          plain.removeAllListeners('data');
          socket = tls.connect({ socket: plain, servername: host });
          attach(socket);
          ehlo = await cmd('EHLO checkq.local');
        }
        if (ch.user) {
          expect(await cmd('AUTH LOGIN'), 334, 'AUTH LOGIN');
          expect(await cmd(Buffer.from(String(ch.user)).toString('base64')), 334, 'AUTH 用户名');
          expect(await cmd(Buffer.from(String(ch.pass || '')).toString('base64')), 235, 'AUTH 密码');
        }
        expect(await cmd(`MAIL FROM:<${from}>`), 250, 'MAIL FROM');
        for (const rcpt of to.split(/[,;]\s*/).filter(Boolean)) expect(await cmd(`RCPT TO:<${rcpt}>`), 250, 'RCPT TO');
        expect(await cmd('DATA'), 354, 'DATA');
        const bodyB64 = Buffer.from(text, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
        const msg = [
          `From: <${from}>`,
          `To: <${to}>`,
          `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`,
          `Date: ${new Date().toUTCString()}`,
          'MIME-Version: 1.0',
          'Content-Type: text/plain; charset=UTF-8',
          'Content-Transfer-Encoding: base64',
          '',
          bodyB64,
          '.',
        ].join('\r\n');
        socket.write(msg + '\r\n');
        expect(await read(), 250, '发送正文');
        await cmd('QUIT').catch(() => '');
        done('sent');
      })().catch(fail);
    });
  }

  const scheduler = new Scheduler(store, runner);
  scheduler.start();

  app.register(cookie);
  app.register(multipart);

  // ---- 安全响应头 + 同源校验（防 CSRF / 点击劫持 / MIME 嗅探）----
  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
  });

  // 写操作必须同源（浏览器会带 Origin；跨站表单/图片不会带同源 Origin）
  app.addHook('onRequest', async (req, reply) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    if (CSRF_SAFE.has(req.url.split('?')[0])) return;
    const origin = req.headers.origin;
    if (!origin) return; // 非浏览器客户端（脚本/MCP/测试）不拦
    let host = '';
    try { host = new URL(origin).host; } catch { host = ''; }
    const self = req.headers.host;
    if (host && self && host !== self) {
      return reply.code(403).send({ error: '跨站请求被拒绝（CSRF 防护）' });
    }
  });

  // ---- auth ----
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0];
    const pub = path === '/api/login' || path === '/api/health' || path === '/api/system/bootstrap' || path === '/api/me' || !path.startsWith('/api/');
    if (pub) return;
    const sess = currentSession(req);
    if (sess) {
      const user = store.getUser(sess.userId);
      if (!user || user.disabled) { sessions.delete(sess.qsid); return reply.code(401).send({ error: '账号不可用' }); }
      req.user = user;
      req.session = sess;
      // 只读角色：禁止一切写操作
      if (user.role === 'viewer' && !['GET', 'HEAD'].includes(req.method)) {
        return reply.code(403).send({ error: '只读账号不能执行写操作' });
      }
      return;
    }
    const auth = req.headers['x-api-key'];
    if (auth) {
      const key = store.findApiKeyByHash(hashApiKey(auth));
      if (key) {
        // 作用域：read=查看 / run=运行任务 / write=增删改配置
        const scopes = Array.isArray(key.scopes) && key.scopes.length ? key.scopes : ['read', 'run', 'write'];
        const path = req.url.split('?')[0];
        const need = ['GET', 'HEAD'].includes(req.method) ? 'read'
          : (/^\/api\/flows\/[^/]+\/run$/.test(path) ? 'run' : 'write');
        if (!scopes.includes(need)) {
          return reply.code(403).send({ error: `API Key 权限不足：需要 ${need}，当前仅 ${scopes.join('/') || '无'}` });
        }
        req.apiKey = key;
        req.apiKeyScopes = scopes;
        return;
      }
      // 兼容旧的单条 meta.apiKey（全权限）
      if (store.meta.apiKey && auth === store.meta.apiKey) { req.legacyApiKey = true; return; }
    }
    return reply.code(401).send({ error: '未登录' });
  });

  /** 需要管理员 */
  const requireAdmin = (req, reply) => {
    if (req.user && req.user.role === 'admin') return true;
    reply.code(403).send({ error: '需要管理员权限' });
    return false;
  };

  app.post('/api/login', async (req, reply) => {
    const ip = req.ip || req.hostname || 'unknown';
    if (loginLocked(ip)) {
      return reply.code(429).send({ error: '登录失败次数过多，请 10 分钟后再试' });
    }
    const { username, password, code } = req.body || {};
    // 未给用户名时：只有一个账号就用它，否则默认 admin
    const name = String(username || (store.meta.users.length === 1 ? store.meta.users[0].username : 'admin')).trim();
    const user = store.getUserByName(name);

    const fail = (msg, code2 = 401) => {
      noteLoginFail(ip);
      if (user) {
        user.failedLogins = (user.failedLogins || 0) + 1;
        if (user.failedLogins >= ACCOUNT_FAIL_LIMIT) user.lockedUntil = Date.now() + ACCOUNT_FAIL_WINDOW;
        store.flush();
      }
      if (loginLocked(ip)) return reply.code(429).send({ error: '登录失败次数过多，请 10 分钟后再试' });
      return reply.code(code2).send({ error: msg });
    };

    // 用户不存在也要走一次 scrypt，避免用户名枚举（时序一致）
    const dummy = '00:' + crypto.createHash('sha256').update('dummy').digest('hex');
    const okPwd = verifyPwd(password || '', user ? user.passwordHash : dummy);
    if (!user || user.disabled || !okPwd) {
      store.audit('login.fail', `用户名=${name}`, '');
      return fail('用户名或密码错误');
    }
    if (user.lockedUntil && user.lockedUntil > Date.now()) {
      const mins = Math.ceil((user.lockedUntil - Date.now()) / 60000);
      return reply.code(429).send({ error: `账号已锁定，请 ${mins} 分钟后重试` });
    }

    // 两步验证
    if (user.totp?.enabled) {
      if (!code) {
        return reply.code(401).send({ error: '需要两步验证码', needTotp: true });
      }
      const input = String(code).trim();
      let ok2fa = verifyTotp(user.totp.secret, input);
      if (!ok2fa) {
        // 恢复码（一次性）
        const idx = (user.recoveryCodes || []).findIndex((h) => verifyRecoveryCode(input, h));
        if (idx >= 0) {
          user.recoveryCodes.splice(idx, 1);
          store.flush();
          ok2fa = true;
        }
      }
      if (!ok2fa) {
        store.audit('login.2fa-fail', `用户名=${name}`, name);
        return fail('两步验证码错误');
      }
    }

    loginFails.delete(ip);
    user.failedLogins = 0;
    user.lockedUntil = null;
    user.lastLoginAt = Date.now();
    store.flush();

    const qsid = crypto.randomBytes(24).toString('base64url');
    sessions.set(qsid, {
      userId: user.id, createdAt: Date.now(), lastSeenAt: Date.now(),
      ip, ua: String(req.headers['user-agent'] || '').slice(0, 120), expiresAt: Date.now() + SESSION_TTL,
    });
    reply.setCookie('qsid', qsid, { path: '/', httpOnly: true, sameSite: 'strict', maxAge: 7 * 86400 });
    store.audit('login.ok', `用户名=${name}`, user.username);
    return { ok: true, user: { username: user.username, displayName: user.displayName, role: user.role, totpEnabled: !!user.totp?.enabled } };
  });

  app.post('/api/logout', async (req, reply) => {
    const qsid = req.cookies?.qsid;
    if (qsid) sessions.delete(qsid);
    reply.clearCookie('qsid', { path: '/' });
    return { ok: true };
  });

  // 当前登录信息（供前端显示用户名/角色）
  app.get('/api/me', async (req) => {
    // API Key 调用方（外部 Agent）：返回 key 身份与权限范围
    if (req.apiKey) {
      return {
        authenticated: true,
        via: 'api-key',
        apiKey: { prefix: req.apiKey.prefix, name: req.apiKey.name, scopes: req.apiKeyScopes || [] },
        permissions: {
          read: true,
          run: (req.apiKeyScopes || []).includes('run'),
          write: (req.apiKeyScopes || []).includes('write'),
        },
      };
    }
    const sess = currentSession(req);
    if (!sess) return { authenticated: false };
    const user = store.getUser(sess.userId);
    if (!user) return { authenticated: false };
    return {
      authenticated: true,
      user: {
        id: user.id, username: user.username, displayName: user.displayName || user.username,
        role: user.role, totpEnabled: !!user.totp?.enabled,
        recoveryCodesLeft: (user.recoveryCodes || []).length,
        lastLoginAt: user.lastLoginAt || null, passwordUpdatedAt: user.passwordUpdatedAt || null,
      },
      session: { createdAt: sess.createdAt, ip: sess.ip, ua: sess.ua },
    };
  });

  // ---- 我的会话 ----
  app.get('/api/system/sessions', async (req) => {
    const me = req.user;
    if (!me) return { sessions: [] };
    const current = req.cookies?.qsid;
    return {
      sessions: sessionsOf(me.id).map((id) => {
        const s = sessions.get(id);
        return { id, current: id === current, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, ip: s.ip, ua: s.ua };
      }).sort((a, b) => b.lastSeenAt - a.lastSeenAt),
    };
  });

  app.delete('/api/system/sessions/:id', async (req, reply) => {
    const me = req.user;
    if (!me) return reply.code(401).send({ error: '未登录' });
    const s = sessions.get(req.params.id);
    if (!s || s.userId !== me.id) return reply.code(404).send({ error: '会话不存在' });
    sessions.delete(req.params.id);
    store.audit('session.revoke', `会话=${req.params.id.slice(0, 8)}`, me.username);
    return { ok: true };
  });

  app.post('/api/system/logout-all', async (req) => {
    const me = req.user;
    if (!me) return { ok: false };
    for (const id of sessionsOf(me.id)) sessions.delete(id);
    store.audit('logout.all', '', me.username);
    return { ok: true };
  });

  app.get('/api/health', async () => ({ ok: true, version: '0.3.17' }));

  // 首次启动：还没有任何账号时，引导创建管理员（用户名 + 密码）
  app.get('/api/system/bootstrap', async () => ({
    needsSetup: store.meta.users.length === 0,
    username: store.meta.users[0]?.username || 'admin',
    hasUsers: store.meta.users.length > 0,
  }));
  app.post('/api/system/bootstrap', async (req, reply) => {
    if (store.meta.users.length) return reply.code(400).send({ error: '账号已存在，无需初始化' });
    const { username = 'admin', password } = req.body || {};
    const nameErr = checkUsername(username);
    if (nameErr) return reply.code(400).send({ error: nameErr });
    const pwdErr = checkPassword(password, username);
    if (pwdErr) return reply.code(400).send({ error: pwdErr });
    store.createUser({ username, password, role: 'admin', displayName: '管理员' });
    store.audit('bootstrap', `创建管理员 ${username}`, username);
    for (const id of [...sessions.keys()]) sessions.delete(id);
    return { ok: true };
  });


  // ---- 两步验证（TOTP）----
  // 1) 开始绑定：生成密钥（此时未启用）
  app.post('/api/system/2fa/enroll', async (req, reply) => {
    const me = req.user;
    if (!me) return reply.code(401).send({ error: '未登录' });
    const { password } = req.body || {};
    if (!verifyPwd(password || '', me.passwordHash)) return reply.code(401).send({ error: '密码不正确' });
    if (me.totp?.enabled) return reply.code(400).send({ error: '已启用两步验证，请先关闭' });
    const secret = generateSecret();
    me.totp = { enabled: false, secret, createdAt: Date.now() };
    store.flush();
    store.audit('2fa.enroll-start', `用户=${me.username}`, me.username);
    return { ok: true, secret, uri: otpauthUri({ secret, account: me.username }), digits: 6, period: 30 };
  });

  // 2) 确认绑定：校验一次验证码 → 启用 + 生成恢复码（明文只返回这一次）
  app.post('/api/system/2fa/confirm', async (req, reply) => {
    const me = req.user;
    if (!me) return reply.code(401).send({ error: '未登录' });
    const { code } = req.body || {};
    if (!me.totp?.secret) return reply.code(400).send({ error: '尚未开始绑定' });
    if (!verifyTotp(me.totp.secret, code)) return reply.code(400).send({ error: '验证码错误' });
    const codes = generateRecoveryCodes(10);
    me.totp = { ...me.totp, enabled: true, confirmedAt: Date.now() };
    me.recoveryCodes = codes.map(hashRecoveryCode);
    store.flush();
    store.audit('2fa.enable', `用户=${me.username}`, me.username);
    return { ok: true, recoveryCodes: codes };
  });

  // 3) 关闭两步验证（需密码 + 当前验证码）
  app.post('/api/system/2fa/disable', async (req, reply) => {
    const me = req.user;
    if (!me) return reply.code(401).send({ error: '未登录' });
    const { password, code } = req.body || {};
    if (!verifyPwd(password || '', me.passwordHash)) return reply.code(401).send({ error: '密码不正确' });
    if (!me.totp?.enabled) return reply.code(400).send({ error: '未启用两步验证' });
    if (!verifyTotp(me.totp.secret, code)) return reply.code(400).send({ error: '验证码错误' });
    me.totp = null;
    me.recoveryCodes = [];
    store.flush();
    store.audit('2fa.disable', `用户=${me.username}`, me.username);
    return { ok: true };
  });

  // 4) 重新生成恢复码
  app.post('/api/system/2fa/recovery-codes', async (req, reply) => {
    const me = req.user;
    if (!me) return reply.code(401).send({ error: '未登录' });
    const { password, code } = req.body || {};
    if (!verifyPwd(password || '', me.passwordHash)) return reply.code(401).send({ error: '密码不正确' });
    if (!me.totp?.enabled) return reply.code(400).send({ error: '未启用两步验证' });
    if (!verifyTotp(me.totp.secret, code)) return reply.code(400).send({ error: '验证码错误' });
    const codes = generateRecoveryCodes(10);
    me.recoveryCodes = codes.map(hashRecoveryCode);
    store.flush();
    store.audit('2fa.recovery-codes', `用户=${me.username}`, me.username);
    return { ok: true, recoveryCodes: codes };
  });

  // ---- 用户管理（仅管理员）----
  app.get('/api/system/users', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return { users: store.listUsers(), roles: ROLES, passwordMin: PASSWORD_MIN };
  });

  app.post('/api/system/users', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { username, password, role = 'operator', displayName } = req.body || {};
    const nameErr = checkUsername(username);
    if (nameErr) return reply.code(400).send({ error: nameErr });
    if (store.getUserByName(username)) return reply.code(400).send({ error: '用户名已存在' });
    if (!ROLES.includes(role)) return reply.code(400).send({ error: '角色无效' });
    const pwdErr = checkPassword(password, username);
    if (pwdErr) return reply.code(400).send({ error: pwdErr });
    const u = store.createUser({ username, password, role, displayName });
    store.audit('user.create', `用户=${u.username} 角色=${role}`, req.user.username);
    return { ok: true, user: store.listUsers().find((x) => x.id === u.id) };
  });

  app.put('/api/system/users/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const u = store.getUser(req.params.id);
    if (!u) return reply.code(404).send({ error: '用户不存在' });
    const { role, disabled, displayName, username } = req.body || {};
    if (role !== undefined) {
      if (!ROLES.includes(role)) return reply.code(400).send({ error: '角色无效' });
      if (u.id === req.user.id && role !== 'admin') return reply.code(400).send({ error: '不能降低自己的管理员权限' });
      if (u.role === 'admin' && role !== 'admin') {
        const admins = store.meta.users.filter((x) => x.role === 'admin' && !x.disabled).length;
        if (admins <= 1) return reply.code(400).send({ error: '至少保留一个管理员' });
      }
    }
    if (disabled !== undefined && u.id === req.user.id && disabled) {
      return reply.code(400).send({ error: '不能停用自己的账号' });
    }
    if (username !== undefined) {
      const nameErr = checkUsername(username);
      if (nameErr) return reply.code(400).send({ error: nameErr });
      if (store.getUserByName(username) && store.getUserByName(username).id !== u.id) {
        return reply.code(400).send({ error: '用户名已存在' });
      }
    }
    const patch = {};
    if (role !== undefined) patch.role = role;
    if (disabled !== undefined) patch.disabled = !!disabled;
    if (displayName !== undefined) patch.displayName = displayName;
    if (username !== undefined) patch.username = username;
    store.updateUser(u.id, patch);
    if (patch.disabled) for (const id of sessionsOf(u.id)) sessions.delete(id);
    store.audit('user.update', `用户=${u.username}`, req.user.username);
    return { ok: true, user: store.listUsers().find((x) => x.id === u.id) };
  });

  // 管理员重置他人密码（强制该用户下次登录改密由管理员分配新密码）
  app.post('/api/system/users/:id/password', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const u = store.getUser(req.params.id);
    if (!u) return reply.code(404).send({ error: '用户不存在' });
    const { password } = req.body || {};
    const pwdErr = checkPassword(password, u.username);
    if (pwdErr) return reply.code(400).send({ error: pwdErr });
    store.updateUser(u.id, { passwordHash: hashPwd(String(password)) });
    for (const id of sessionsOf(u.id)) sessions.delete(id);
    store.audit('user.reset-password', `用户=${u.username}`, req.user.username);
    return { ok: true };
  });

  // 管理员重置他人 2FA（用户丢失验证器时用）
  app.post('/api/system/users/:id/2fa/reset', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const u = store.getUser(req.params.id);
    if (!u) return reply.code(404).send({ error: '用户不存在' });
    store.updateUser(u.id, { totp: null, recoveryCodes: [] });
    for (const id of sessionsOf(u.id)) sessions.delete(id);
    store.audit('user.2fa-reset', `用户=${u.username}`, req.user.username);
    return { ok: true };
  });

  app.delete('/api/system/users/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const u = store.getUser(req.params.id);
    if (!u) return reply.code(404).send({ error: '用户不存在' });
    if (u.id === req.user.id) return reply.code(400).send({ error: '不能删除自己的账号' });
    if (u.role === 'admin' && store.meta.users.filter((x) => x.role === 'admin' && !x.disabled).length <= 1) {
      return reply.code(400).send({ error: '至少保留一个管理员' });
    }
    for (const id of sessionsOf(u.id)) sessions.delete(id);
    store.deleteUser(u.id);
    store.audit('user.delete', `用户=${u.username}`, req.user.username);
    return { ok: true };
  });

  // 审计日志（仅管理员）
  app.get('/api/system/audit', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return { entries: store.listAudit(Number(req.query?.limit) || 100) };
  });

  // 设置：改密 / API Key（单用户）
  app.get('/api/system/settings', async (req) => ({
    hasApiKey: !!store.meta.apiKey || store.meta.apiKeys.length > 0,
    apiKey: store.meta.apiKey ? store.meta.apiKey.slice(0, 8) + '…' : null,
    apiKeys: req.user?.role === 'admin' ? store.listApiKeys() : [],
    userCount: store.meta.users.length,
  }));
  // 修改自己的用户名 / 显示名
  // 对齐 qinglong「安全设置 → 修改用户名密码」：改用户名后强制重新登录（吊销全部会话）
  app.put('/api/system/account', async (req, reply) => {
    const me = req.user;
    if (!me) return reply.code(401).send({ error: '未登录' });
    const { username, displayName, currentPassword } = req.body || {};
    const patch = {};
    let reauth = false;

    if (username !== undefined && String(username).trim() !== me.username) {
      const name = String(username).trim();
      const nameErr = checkUsername(name);
      if (nameErr) return reply.code(400).send({ error: nameErr });
      const exist = store.getUserByName(name);
      if (exist && exist.id !== me.id) return reply.code(400).send({ error: '用户名已存在' });
      if (!verifyPwd(currentPassword || '', me.passwordHash)) {
        store.audit('account.username-fail', `用户=${me.username}`, me.username);
        return reply.code(401).send({ error: '当前密码不正确' });
      }
      patch.username = name;
      reauth = true;
    }
    if (displayName !== undefined) patch.displayName = String(displayName).trim().slice(0, 40) || patch.username || me.username;

    if (!Object.keys(patch).length) return { ok: true, reauth: false };
    store.updateUser(me.id, patch);
    store.audit(reauth ? 'account.username' : 'account.displayName', `用户=${me.username} → ${patch.username || me.username}`, me.username);

    if (reauth) {
      // 用户名变更 → 所有会话失效（需用新用户名重新登录）
      for (const id of sessionsOf(me.id)) sessions.delete(id);
      reply.clearCookie('qsid', { path: '/' });
    }
    return { ok: true, reauth, user: { username: patch.username || me.username, displayName: patch.displayName || me.displayName } };
  });

  // 修改自己的密码（需校验旧密码；改密后其他会话失效）
  app.post('/api/system/password', async (req, reply) => {
    const me = req.user;
    if (!me) return reply.code(401).send({ error: '未登录' });
    const { oldPassword, newPassword } = req.body || {};
    if (!verifyPwd(oldPassword || '', me.passwordHash)) {
      store.audit('password.fail', `用户=${me.username}`, me.username);
      return reply.code(401).send({ error: '当前密码不正确' });
    }
    const err = checkPassword(newPassword, me.username);
    if (err) return reply.code(400).send({ error: err });
    if (verifyPwd(newPassword || '', me.passwordHash)) return reply.code(400).send({ error: '新密码不能与当前密码相同' });
    store.updateUser(me.id, { passwordHash: hashPwd(String(newPassword)) });
    store.audit('password.change', `用户=${me.username}`, me.username);
    const current = req.cookies?.qsid;
    for (const id of sessionsOf(me.id)) if (id !== current) sessions.delete(id);
    return { ok: true };
  });
  // API Key：明文只在创建时返回一次，服务端只存 sha256 摘要
  app.get('/api/system/apikeys', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return { keys: store.listApiKeys() };
  });
  app.post('/api/system/apikeys', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { name, scopes } = req.body || {};
    const wanted = Array.isArray(scopes) ? scopes.filter((s) => ['read', 'run', 'write'].includes(s)) : [];
    const useScopes = wanted.length ? wanted : ['read', 'run', 'write'];
    const { key, hash, prefix } = newApiKey();
    const k = store.addApiKey({ name: String(name || 'API Key').slice(0, 40), hash, prefix, userId: req.user?.id || null, scopes: useScopes });
    store.audit('apikey.create', `名称=${k.name} 权限=${useScopes.join('/')}`, req.user?.username || '');
    return { ok: true, apiKey: key, key: { id: k.id, name: k.name, prefix: k.prefix, createdAt: k.createdAt, scopes: useScopes } };
  });
  app.delete('/api/system/apikeys/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const ok = store.revokeApiKey(req.params.id);
    if (!ok) return reply.code(404).send({ error: '不存在' });
    store.audit('apikey.revoke', `id=${req.params.id.slice(0, 8)}`, req.user?.username || '');
    return { ok: true };
  });
  // 兼容旧接口（单 key）
  app.post('/api/system/apikey', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { key, hash, prefix } = newApiKey();
    store.meta.apiKey = key; // 兼容旧字段（明文仅此一次由管理员自行保管）
    store.addApiKey({ name: '默认 Key', hash, prefix, userId: req.user?.id || null });
    store.audit('apikey.create', '默认 Key', req.user?.username || '');
    return { apiKey: key };
  });

  // AI 助手（快速组装 LLM）：OpenAI 兼容接口配置，key 只存 meta、返回时打码
  app.get('/api/system/ai', async () => {
    const a = store.meta.ai || {};
    return { configured: !!(a.baseUrl && a.apiKey && a.model), baseUrl: a.baseUrl || '', model: a.model || '', apiKey: a.apiKey ? a.apiKey.slice(0, 6) + '…' : '' };
  });
  app.put('/api/system/ai', async (req) => {
    const { baseUrl, apiKey, model } = req.body || {};
    const prev = store.meta.ai || {};
    // apiKey 传空或打码占位时保留旧 key
    const key = String(apiKey || '').trim();
    store.meta.ai = {
      baseUrl: String(baseUrl || '').trim(),
      apiKey: key && !key.endsWith('…') ? key : (prev.apiKey || ''),
      model: String(model || '').trim(),
    };
    store.flush();
    return { ok: true };
  });
  app.post('/api/ai/generate', async (req, reply) => {
    const a = store.meta.ai || {};
    if (!a.baseUrl || !a.apiKey || !a.model) return reply.code(400).send({ error: '未配置 AI：请到「设置 → AI 助手」填 Base URL / API Key / 模型' });
    const sentence = String((req.body || {}).sentence || '').trim();
    if (!sentence) return reply.code(400).send({ error: '请先输入一句话描述' });
    const sys = 'You generate CheckQ automation flow JSON. Output ONLY compact JSON, no markdown fences. Shape: '
      + '{"name":"<short task name>","cron":"<5-field cron e.g. 0 8 * * *>","nodes":[{"id":"n0","type":"http","name":"<short>","x":80,"y":60,"config":{"method":"GET","url":"<absolute https url from user text>","headers":[{"name":"user-agent","value":"Mozilla/5.0","enabled":true}],"body":"","asserts":[]}},{"id":"n1","type":"log","name":"记录结果","x":360,"y":60,"config":{"text":"完成：{{last.status}}"}}],"edges":[{"id":"e0","source":"n0","sourceHandle":"success","target":"n1"}]} '
      + 'Rules: only node types http,log,set,delay; first node must be http with a real absolute url from the user text; if user says 看到X算成功 set asserts:[{"res":["X"],"from":"content"}]; <=5 nodes; JSON only.';
    try {
      const r = await fetch(a.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + a.apiKey },
        body: JSON.stringify({ model: a.model, temperature: 0.2, messages: [{ role: 'system', content: sys }, { role: 'user', content: sentence }] }),
        signal: AbortSignal.timeout(60000),
      });
      if (!r.ok) {
        const t = await r.text();
        return reply.code(502).send({ error: `LLM 接口错误 ${r.status}: ${t.slice(0, 200)}` });
      }
      const data = await r.json();
      let text = String(data.choices?.[0]?.message?.content || '');
      text = text.replace(/^```(json)?/i, '').replace(/```\s*$/, '').trim();
      const start = text.indexOf('{'); const end = text.lastIndexOf('}');
      if (start < 0 || end <= start) return reply.code(502).send({ error: 'LLM 未返回 JSON' });
      const draft = JSON.parse(text.slice(start, end + 1));
      if (!Array.isArray(draft.nodes) || !draft.nodes.length) return reply.code(502).send({ error: 'LLM JSON 缺少 nodes' });
      const okTypes = new Set(['http', 'log', 'set', 'delay']);
      draft.nodes = draft.nodes.slice(0, 6).map((n, i) => ({
        id: String(n.id || 'n' + i),
        type: okTypes.has(n.type) ? n.type : 'log',
        name: String(n.name || n.type || '节点').slice(0, 60),
        x: Number(n.x) || 80 + i * 280,
        y: Number(n.y) || 60,
        config: n.config && typeof n.config === 'object' ? n.config : {},
      }));
      draft.edges = Array.isArray(draft.edges) ? draft.edges.slice(0, 8) : [];
      const first = draft.nodes.find((n) => n.type === 'http');
      if (!first || !/^https?:\/\//.test(String(first.config?.url || ''))) return reply.code(502).send({ error: 'LLM 未给出有效 HTTP 节点/URL' });
      draft.name = String(draft.name || 'AI 生成任务').slice(0, 60);
      draft.cron = typeof draft.cron === 'string' ? draft.cron.slice(0, 40) : '';
      draft.timezone = 'Asia/Shanghai';
      draft.enabled = false;
      draft.vars = {};
      return { draft };
    } catch (e) {
      return reply.code(502).send({ error: 'LLM 调用失败: ' + e.message });
    }
  });

  // 通知测试：向指定 flow 的渠道发一条测试消息（PRD §4.8 P2）
  app.post('/api/flows/:id/notify-test', async (req, reply) => {
    const f = store.getFlow(req.params.id);
    if (!f) return reply.code(404).send({ error: 'not found' });
    const n = f.notify || {};
    if (!n.channels?.length) return reply.code(400).send({ error: '该任务未配置通知渠道' });
    const testRun = { status: 'success', finalMessage: '测试通知（CheckQ）', durationMs: 0, startedAt: Date.now(), logs: [] };
    const text = renderNotifyTemplate({ ...n, template: n.template || '测试通知：[CheckQ] {{flow.name}} {{status}}' }, f, testRun);
    const results = await sendToChannels(n.channels, text, { flowId: f.id, flowName: f.name, status: 'success' });
    const failed = results.filter((r) => !r.ok);
    if (failed.length) return reply.code(502).send({ error: `部分渠道失败：${failed.map((x) => `${x.type}:${x.error}`).join('；')}`, results });
    return { ok: true, results, text };
  });

  // 每日汇总预览/发送（PRD §4.8 P2）：基于 store.stats() 今日口径
  app.post('/api/system/daily-summary', async (req, reply) => {
    const body = req.body || {};
    const ids = Array.isArray(body.flowIds) && body.flowIds.length ? body.flowIds : (body.flowId ? [body.flowId] : null);
    if (ids) {
      const targets = ids.map((id) => store.getFlow(id)).filter(Boolean);
      if (!targets.length) return reply.code(404).send({ error: '任务不存在' });
      const missing = targets.filter((t) => !t.notify?.channels?.length);
      if (missing.length === targets.length) return reply.code(400).send({ error: '所选任务都没有通知渠道' });
      const out = await pushDailySummary(targets.filter((t) => t.notify?.channels?.length));
      return { ok: out.results.every((r) => r.ok), text: out.text, results: out.results, groups: out.groups };
    }
    return { ok: true, stats: store.stats() };
  });

  // ---- flows ----
  app.get('/api/flows', async () => store.listFlows());

  // ---- templates (user-created, stored in DB) ----
  // 从现有流程"另存为模板"
  app.post('/api/templates/from-flow/:flowId', async (req, reply) => {
    const f = store.getFlow(req.params.flowId);
    if (!f) return reply.code(404).send({ error: '流程不存在' });
    const { name, desc } = req.body || {};
    const tpl = store.createTemplate({
      name: name || f.name.replace(/\s*·\s*\d+$/, '') + ' 模板',
      desc: desc || `来自流程「${f.name}」`,
      vars: f.vars || {},
      nodes: f.nodes,
      edges: f.edges,
      log: f.log,
      notify: f.notify || {},
    }, 'flow');
    return { id: tpl.id, name: tpl.name };
  });

  app.get('/api/templates', async () => store.listTemplates());

  app.post('/api/templates', async (req, reply) => {
    const { name, desc, vars, varNames, nodes, edges, log, notify } = req.body || {};
    const errors = validateFlow({ name, nodes, edges, vars });
    if (errors.length) return reply.code(400).send({ error: errors.join('; ') });
    const tpl = store.createTemplate({ name, desc, vars, varNames, nodes, edges, log, notify }, 'import');
    return { id: tpl.id, name: tpl.name };
  });

  app.put('/api/templates/:id', async (req, reply) => {
    const t = store.updateTemplate(req.params.id, req.body || {});
    if (!t) return reply.code(404).send({ error: 'not found' });
    return t;
  });

  app.delete('/api/templates/:id', async (req, reply) => {
    const ok = store.deleteTemplate(req.params.id);
    return ok ? { ok: true } : reply.code(404).send({ error: 'not found' });
  });

  // 模板 → 生成任务实例（变量差异化）
  app.post('/api/templates/:id/instantiate', async (req, reply) => {
    const { name, vars, note } = req.body || {};
    const flow = store.instantiateTemplate(req.params.id, { name, vars, note });
    if (!flow) return reply.code(404).send({ error: '模板不存在' });
    return flow;
  });

  // 模板详情（编辑用）
  app.get('/api/templates/:id', async (req, reply) => {
    const t = store.getTemplate(req.params.id);
    if (!t) return reply.code(404).send({ error: 'not found' });
    return t;
  });

  // 模板导出（4.3）：脱敏 —— 敏感变量默认值置空，样本不导出
  app.get('/api/templates/:id/export', async (req, reply) => {
    const t = store.getTemplate(req.params.id);
    if (!t) return reply.code(404).send({ error: 'not found' });
    const safeVars = {};
    for (const [k, v] of Object.entries(t.vars || {})) {
      safeVars[k] = /cookie|token|password|secret|key/i.test(k) ? '' : v;
    }
    return {
      name: t.name, desc: t.desc,
      varNames: t.varNames || Object.keys(safeVars),
      vars: safeVars,
      nodes: t.nodes, edges: t.edges,
      log: t.log || null,
      samplesIncluded: false,
    };
  });

  // CSV 批量建任务（4.3）
  app.post('/api/templates/:id/instantiate-csv', async (req, reply) => {
    const { csv } = req.body || {};
    if (!csv || typeof csv !== 'string') return reply.code(400).send({ error: '缺少 csv 内容' });
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return reply.code(404).send({ error: '模板不存在' });

    // 极简 CSV 解析（支持双引号转义）
    const parseCsvLine = (line) => {
      const cells = [];
      let cur = '', inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQ) {
          if (ch === '"') {
            if (line[i + 1] === '"') { cur += '"'; i++; }
            else inQ = false;
          } else cur += ch;
        } else if (ch === '"') inQ = true;
        else if (ch === ',') { cells.push(cur); cur = ''; }
        else cur += ch;
      }
      cells.push(cur);
      return cells.map((c) => c.trim());
    };

    const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return reply.code(400).send({ error: 'CSV 需要表头行 + 至少一行数据' });
    const header = parseCsvLine(lines[0]).map((h) => h.trim());
    const varNames = new Set(tpl.varNames && tpl.varNames.length ? tpl.varNames : Object.keys(tpl.vars || {}));
    const unknownCols = header.filter((h) => h !== 'name' && h !== 'note' && !varNames.has(h));
    if (unknownCols.length) return reply.code(400).send({ error: `未知列: ${unknownCols.join(', ')}（可用列: name, note, ${[...varNames].join(', ')}）` });

    const created = [];
    const skipped = [];
    const defaults = tpl.vars || {};
    for (let i = 1; i < lines.length; i++) {
      const cells = parseCsvLine(lines[i]);
      const row = {};
      header.forEach((h, j) => { row[h] = cells[j] ?? ''; });
      const name = (row.name || '').trim();
      if (row._skip === '1') { skipped.push(i); continue; }
      if (!name && !Object.keys(row).some((k) => varNames.has(k) && row[k])) { skipped.push(i); continue; }
      const vars = {};
      for (const vn of varNames) {
        const v = (row[vn] ?? '').trim();
        vars[vn] = v || defaults[vn] || '';
      }
      try {
        const flow = store.instantiateTemplate(tpl.id, {
          name: name || undefined,
          vars,
          note: (row.note || '').trim() || undefined,
        });
        created.push({ id: flow.id, name: flow.name });
      } catch (err) {
        skipped.push(i);
      }
    }
    return { created, skipped: skipped.length, total: lines.length - 1 };
  });

  // cURL 导入（4.9）：静态解析，返回 http 节点 config
  app.post('/api/import/curl', async (req, reply) => {
    const { command } = req.body || {};
    if (!command || typeof command !== 'string') return reply.code(400).send({ error: '缺少 command' });
    try {
      const config = parseCurl(command);
      return { config };
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.post('/api/flows', async (req, reply) => {
    const flow = req.body || {};
    const errors = validateFlow(flow);
    if (errors.length) return reply.code(400).send({ error: errors.join('; ') });
    return store.createFlow(flow);
  });

  app.get('/api/flows/:id', async (req, reply) => {
    const f = store.getFlow(req.params.id);
    if (!f) return reply.code(404).send({ error: 'not found' });
    return f;
  });

  app.put('/api/flows/:id', async (req, reply) => {
    const patch = req.body || {};
    const f0 = store.getFlow(req.params.id);
    if (!f0) return reply.code(404).send({ error: 'not found' });
    const errors = validateFlow({ ...f0, ...patch });
    if (errors.length) return reply.code(400).send({ error: errors.join('; ') });
    const f = store.updateFlow(req.params.id, patch);
    scheduler.rebuild();
    return f;
  });

  app.delete('/api/flows/:id', async (req, reply) => {
    const ok = store.deleteFlow(req.params.id);
    scheduler.rebuild();
    return ok ? { ok: true } : reply.code(404).send({ error: 'not found' });
  });

  app.post('/api/flows/:id/run', async (req, reply) => {
    const f = store.getFlow(req.params.id);
    if (!f) return reply.code(404).send({ error: 'not found' });
    const debugStopId = (req.body || {}).debugStopId || null;
    const stream = (req.body || {}).stream === true;
    const queued = runningFlows.has(f.id); // 排队提示（第二次请求进入串行队列）

    // SSE 模式（PRD §4.7.3 实时推送）：边执行边推送日志，结束事件携带完整 run
    if (stream) {
      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      const push = (event, data) => {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      push('start', { flowId: f.id, flowName: f.name, queued });
      const run = await runner.runFlow(f, debugStopId ? 'debug' : 'manual', {
        debugStopId,
        debug: (req.body || {}).debug === true,
        onLog: (log) => push('log', log),
      });
      push('done', run);
      reply.raw.end();
      return reply;
    }

    const run = await runner.runFlow(f, debugStopId ? 'debug' : 'manual', { debugStopId, debug: (req.body || {}).debug === true });
    return run; // 完整 run 对象（含 logs），前端直接渲染
  });

  // 克隆任务：复制为新任务（PRD §4.4）
  app.post('/api/flows/:id/clone', async (req, reply) => {
    const f = store.getFlow(req.params.id);
    if (!f) return reply.code(404).send({ error: 'not found' });
    const seq = store.flows.filter((x) => x.name.startsWith(f.name)).length + 1;
    const clone = store.createFlow({
      name: `${f.name} · 副本${seq > 1 ? ' ' + seq : ''}`,
      note: f.note,
      cron: f.cron,
      timezone: f.timezone,
      enabled: false, // 克隆任务默认暂停，避免立即重复执行
      jitterMinutes: f.jitterMinutes || 0,
      vars: f.vars,
      nodes: f.nodes,
      edges: f.edges,
      notify: f.notify,
      log: f.log,
      tplId: f.tplId || null,
    });
    return clone;
  });

  // 复制为 curl（PRD §4.7.2）：从节点配置生成等价 curl 命令
  app.post('/api/flows/:id/curl', async (req, reply) => {
    const f = store.getFlow(req.params.id);
    if (!f) return reply.code(404).send({ error: 'not found' });
    const { nodeId, vars } = req.body || {};
    const node = (f.nodes || []).find((n) => n.id === nodeId);
    if (!node || node.type !== 'http') return reply.code(400).send({ error: 'node not found or not http' });
    const c = node.config || {};
    const method = (c.method || 'GET').toUpperCase();
    const url = (c.url || '').replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, p) => {
      const v = (vars || {})[p];
      return v === undefined ? `{{${p}}}` : String(v);
    });
    const parts = [`curl -X ${method}`];
    for (const h of c.headers || []) {
      if (h.enabled === false) continue;
      const value = String(h.value || '').replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, p) => {
        const v = (vars || {})[p];
        return v === undefined ? `{{${p}}}` : String(v);
      });
      parts.push(`-H ${shellQuote(`${h.name}: ${value}`)}`);
    }
    if (c.body) parts.push(`--data ${shellQuote(String(c.body))}`);
    parts.push(shellQuote(url));
    return { curl: parts.join(' \\\n  ') };
  });

  // ---- runs ----
  // 可推送单位：所有已配置通知渠道的任务（每日总推送时由用户勾选）
  app.get('/api/system/push-targets', async () => store.flows
    .filter((f) => f.notify?.channels?.length)
    .map((f) => ({ id: f.id, name: f.name, channels: f.notify.channels.map((c) => c.type) })));

  app.get('/api/system/stats', async () => {
    const s = store.stats();
    return { ...s, queuedFlows: [...runningFlows, ...queuedSet], queueCount: queuedSet.size, runningCount: runningFlows.size, dailySummary: store.meta.dailySummary || null, unreadNotifications: store.listNotifications(1).unread };
  });

  // 站内通知（inbox 渠道）：列表 / 已读 / 清空
  app.get('/api/notifications', async (req) => store.listNotifications((req.query || {}).limit));
  app.post('/api/notifications/read', async (req) => {
    const { ids } = req.body || {};
    return { ok: true, updated: store.markNotificationsRead(ids) };
  });
  app.delete('/api/notifications', async () => ({ ok: true, cleared: store.clearNotifications() }));

  app.get('/api/system/daily-summary-config', async () => {
    const cfg = store.meta.dailySummary || {};
    const targetFlowIds = Array.isArray(cfg.targetFlowIds) ? cfg.targetFlowIds : (cfg.targetFlowId ? [cfg.targetFlowId] : []);
    return { enabled: !!cfg.enabled, time: cfg.time || '08:00', timezone: cfg.timezone || 'Asia/Shanghai', targetFlowId: cfg.targetFlowId || null, targetFlowIds };
  });
  app.put('/api/system/daily-summary-config', async (req, reply) => {
    const cfg = req.body || {};
    if (cfg.enabled && !/^\d{1,2}:\d{2}$/.test(String(cfg.time || ''))) return reply.code(400).send({ error: 'time must be HH:MM' });
    const ids = Array.isArray(cfg.targetFlowIds)
      ? cfg.targetFlowIds.filter(Boolean)
      : (cfg.targetFlowId ? [cfg.targetFlowId] : []);
    store.meta.dailySummary = {
      enabled: !!cfg.enabled,
      time: cfg.time || '08:00',
      timezone: cfg.timezone || 'Asia/Shanghai',
      targetFlowIds: ids,
      targetFlowId: ids[0] || null, // compat with old field
    };
    store.flush();
    scheduler.rebuild();
    return store.meta.dailySummary;
  });

  // 模板市场索引导入（规范见 docs/TEMPLATE-MARKET.md）：从 URL 拉取 {name,desc,vars,nodes,edges,log} 建模板
  app.post('/api/templates/from-url', async (req, reply) => {
    const { url } = req.body || {};
    if (!url || !/^https?:\/\//i.test(String(url))) return reply.code(400).send({ error: '缺少合法 url' });
    let data;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return reply.code(502).send({ error: `拉取失败 HTTP ${res.status}` });
      data = await res.json();
    } catch (e) {
      return reply.code(502).send({ error: `拉取失败: ${e.message}` });
    }
    if (!data?.name || !Array.isArray(data.nodes)) return reply.code(400).send({ error: '索引 JSON 不合法（需 name + nodes[]）' });
    const tpl = store.createTemplate({ name: data.name, desc: data.desc || `来自 ${url}`, vars: data.vars || {}, varNames: data.varNames, nodes: data.nodes, edges: data.edges || [], log: data.log || null }, 'market');
    return { id: tpl.id, name: tpl.name };
  });

  // 批量操作（青龙/千岛对标：多选批量运行/启停/删除）
  app.post('/api/flows/batch', async (req, reply) => {
    const { ids, action } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) return reply.code(400).send({ error: '缺少 ids' });
    if (!['run', 'enable', 'disable', 'delete'].includes(action)) return reply.code(400).send({ error: '不支持的 action' });
    if (ids.length > 200) return reply.code(400).send({ error: '单次最多 200 个' });
    const results = [];
    let changed = false;
    for (const id of ids) {
      const f = store.getFlow(id);
      if (!f) { results.push({ id, ok: false, error: 'not found' }); continue; }
      try {
        if (action === 'enable') { store.updateFlow(id, { enabled: true }); changed = true; results.push({ id, ok: true }); }
        else if (action === 'disable') { store.updateFlow(id, { enabled: false }); changed = true; results.push({ id, ok: true }); }
        else if (action === 'delete') { store.deleteFlow(id); changed = true; results.push({ id, ok: true }); }
        else if (action === 'run') {
          const run = await runner.runFlow(f, 'manual');
          results.push({ id, ok: run.status === 'success', runId: run.id, status: run.status });
        }
      } catch (e) {
        results.push({ id, ok: false, error: e.message });
      }
    }
    if (changed) scheduler.rebuild();
    const okCount = results.filter((r) => r.ok).length;
    return { action, total: ids.length, ok: okCount, failed: ids.length - okCount, results };
  });

  // 备份/恢复：导出 flows/runs/templates（meta 密码不导出）；恢复以新 ID 导入避免覆盖
  // 备份（默认脱敏：cookie/token/密码等一律清空，适合分享与存档）
  app.get('/api/system/backup', async () => ({
    version: '0.3.17',
    exportedAt: new Date().toISOString(),
    masked: true,
    note: '敏感凭据已脱敏；如需完整迁移请用 POST /api/system/backup（需当前密码）',
    flows: store.flows.map((f) => store.maskedFlow(f)),
    runs: store.runs,
    templates: store.templates.map((t) => store.maskedTemplate(t)),
  }));

  // 完整备份（含凭据）：需要再次输入当前密码，防止误下载/误分享
  app.post('/api/system/backup', async (req, reply) => {
    const me = req.user;
    if (!me) return reply.code(401).send({ error: '未登录' });
    const { password } = req.body || {};
    if (!verifyPwd(password || '', me.passwordHash)) return reply.code(401).send({ error: '当前密码不正确' });
    store.audit('backup.full', '导出含凭据的完整备份', me.username);
    return {
      version: '0.3.17',
      exportedAt: new Date().toISOString(),
      masked: false,
      note: '包含明文凭据，请妥善保管',
      flows: store.flows,
      runs: store.runs,
      templates: store.templates,
    };
  });

  app.post('/api/system/restore', async (req, reply) => {
    const b = req.body || {};
    if (!Array.isArray(b.flows)) return reply.code(400).send({ error: '备份文件无效：缺少 flows 数组' });
    const createdFlows = [];
    for (const f of b.flows) {
      if (!f?.name) continue;
      const nf = store.createFlow({
        name: `${f.name}（恢复）`,
        note: f.note || '从备份恢复',
        cron: f.cron || '', timezone: f.timezone, jitterMinutes: f.jitterMinutes || 0,
        vars: f.vars || {}, nodes: f.nodes || [], edges: f.edges || [],
        notify: f.notify || {}, log: f.log || null, tplId: null,
      });
      nf.enabled = false;
      createdFlows.push({ id: nf.id, name: nf.name });
    }
    const createdTemplates = [];
    if (Array.isArray(b.templates)) {
      for (const t of b.templates) {
        if (!t?.name) continue;
        const nt = store.createTemplate({ name: `${t.name}（恢复）`, desc: t.desc, vars: t.vars || {}, varNames: t.varNames, nodes: t.nodes || [], edges: t.edges || [], log: t.log || null });
        createdTemplates.push({ id: nt.id, name: nt.name });
      }
    }
    scheduler.rebuild();
    return { createdFlows, createdTemplates };
  });


  app.get('/api/runs', async (req) => {
    const { flowId, limit } = req.query;
    return store.listRuns(flowId, Math.min(Number(limit) || 30, 200));
  });

  app.get('/api/runs/:id', async (req, reply) => {
    const r = store.getRun(req.params.id);
    if (!r) return reply.code(404).send({ error: 'not found' });
    return r;
  });

  /**
   * 连续日志流（qinglong 面板风格）：把该任务多次运行的日志拍平成一条可滚动的时间线。
   * query: limit=总行数（默认 200，最大 2000）, before=runId（取更早的历史）
   * 返回 { entries: [{runId, startedAt, status, index, name, message, type, ok, ms, summary, finalMessage}], runs, hasMore }
   */
  app.get('/api/flows/:id/logs', async (req, reply) => {
    const f = store.getFlow(req.params.id);
    if (!f) return reply.code(404).send({ error: 'not found' });
    const q = req.query || {};
    const limit = Math.min(Math.max(Number(q.limit) || 200, 20), 2000);
    const before = q.before ? String(q.before) : null;
    const all = store.listRuns(f.id, 500);
    const runs = before ? all.slice(all.findIndex((r) => r.id === before) + 1) : all;
    const entries = [];
    for (const r of runs) {
      const lines = (r.logs || []).map((l) => ({
        runId: r.id,
        startedAt: r.startedAt,
        status: r.status,
        index: l.index,
        name: l.name,
        message: l.message || '',
        type: l.type,
        ok: l.ok !== false,
        ms: l.ms || 0,
        summary: r.summary || '',
        finalMessage: r.finalMessage || '',
      }));
      entries.push(...lines);
      if (entries.length >= limit) break;
    }
    const truncated = entries.slice(0, limit);
    return {
      entries: truncated,
      runs: runs.slice(0, 60).map((r) => ({ id: r.id, startedAt: r.startedAt, status: r.status, count: (r.logs || []).length, summary: r.summary || '', finalMessage: r.finalMessage || '' })),
      hasMore: entries.length > truncated.length || runs.length > 60,
      nextBefore: runs.length ? runs[Math.min(runs.length - 1, 60)].id : null,
    };
  });

  // 界面偏好（提示级别等）：全局设置
  app.get('/api/system/ui', async () => ({ toastLevel: store.meta.ui?.toastLevel || 'error' }));
  app.put('/api/system/ui', async (req) => {
    const level = String((req.body || {}).toastLevel || 'error');
    const allowed = ['error', 'success', 'all'];
    store.meta.ui = { ...(store.meta.ui || {}), toastLevel: allowed.includes(level) ? level : 'error' };
    store.flush();
    return store.meta.ui;
  });

  // ---- import ----
  app.post('/api/import/har', async (req, reply) => {
    let text;
    if (req.headers['content-type']?.includes('multipart/form-data')) {
      const f = await req.file();
      text = (await f.toBuffer()).toString('utf8');
    } else {
      text = JSON.stringify(req.body);
    }
    try {
      const flow = importHar(text);
      return { flow };
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // ---- 静态前端 ----
  const pubDir = path.join(__dirname, '..', 'public');
  if (fs.existsSync(pubDir)) {
    app.register(fastifyStatic, { root: pubDir, prefix: '/' });
    app.setNotFoundHandler(async (req, reply) => {
      if (!req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'not found' });
    });
  }

  return { app, store, scheduler, runner };
}

export function startServer({ dataDir, port }) {
  const { app, store, scheduler } = buildServer({ dataDir, port });
  const shutdown = (sig) => {
    try { scheduler.stop(); store.flush(); } catch {}
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  app.listen({ port, host: '0.0.0.0' }).then(() => {
    console.log(`[CheckQ] listening on :${port}`);
  }).catch((err) => {
    console.error('[CheckQ] failed to start:', err);
    process.exit(1);
  });
}

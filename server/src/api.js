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
import { fileURLToPath } from 'node:url';

import { Store, hashPwd, verifyPwd } from './store.js';
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
  const sessions = new Map(); // qsid -> expiry
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
    async runFlow(flow, trigger, { debugStopId, onLog } = {}) {
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
            const result = await engine.run({ trigger, runId, debugStopId, logSink: onLog });
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
    return sendToChannels(n.channels, text);
  }

  runner.sendDailySummary = async () => {
    const cfg = store.meta.dailySummary || {};
    const target = cfg.targetFlowId ? store.getFlow(cfg.targetFlowId) : null;
    if (!target?.notify.channels?.length) {
      console.log('[CheckQ] dailySummary 跳过：目标任务无通知渠道');
      return null;
    }
    const s = store.stats();
    const text = `每日汇总：今日 ${s.todayRuns} 次（成功 ${s.todaySuccess} / 失败 ${s.todayFailed}，成功率 ${s.successRate ?? '—'}%）；任务 ${s.flows}，调度中 ${s.enabledScheduled}，下次 ${s.nextRunAt ? new Date(s.nextRunAt).toLocaleString('zh-CN') : '—'}`;
    const results = await sendToChannels(target.notify.channels, text);
    console.log(`[CheckQ] dailySummary 已发送 ${results.filter((x) => x.ok).length}/${results.length} 渠道`);
    return { text, results };
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

  async function sendToChannels(channels, text) {
    const results = [];
    for (const ch of channels || []) {
      try {
        if (ch.type === 'webhook') {
          await fetch(ch.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: text });
        } else if (ch.type === 'telegram') {
          const res = await fetch(`https://api.telegram.org/bot${ch.token}/sendMessage`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ chat_id: ch.chat, text }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } else if (ch.type === 'bark') {
          const u = ch.url.endsWith('/') ? ch.url : ch.url + '/';
          await fetch(u + encodeURIComponent(text));
        }
        results.push({ type: ch.type, ok: true });
      } catch (err) {
        console.error(`[CheckQ] notify ${ch.type} failed:`, err.message);
        results.push({ type: ch.type, ok: false, error: err.message });
      }
    }
    return results;
  }

  const scheduler = new Scheduler(store, runner);
  scheduler.start();

  app.register(cookie);
  app.register(multipart);

  // ---- auth ----
  app.addHook('onRequest', async (req, reply) => {
    const pub = req.url === '/api/login' || req.url === '/api/health' || !req.url.startsWith('/api/');
    if (pub) return;
    const qsid = req.cookies?.qsid;
    const exp = sessions.get(qsid);
    if (!qsid || !exp || exp < Date.now()) {
      const auth = req.headers['x-api-key'];
      if (auth && store.meta.apiKey && auth === store.meta.apiKey) return;
      return reply.code(401).send({ error: '未登录' });
    }
  });

  app.post('/api/login', async (req, reply) => {
    const ip = req.ip || req.hostname || 'unknown';
    if (loginLocked(ip)) {
      return reply.code(429).send({ error: '登录失败次数过多，请 10 分钟后再试' });
    }
    const { password } = req.body || {};
    if (!password || !verifyPwd(password, store.meta.passwordHash)) {
      noteLoginFail(ip);
      if (loginLocked(ip)) {
        return reply.code(429).send({ error: '登录失败次数过多，请 10 分钟后再试' });
      }
      return reply.code(401).send({ error: '密码错误' });
    }
    loginFails.delete(ip);
    const qsid = crypto.randomBytes(24).toString('base64url');
    sessions.set(qsid, Date.now() + 7 * 86400e3);
    reply.setCookie('qsid', qsid, { path: '/', sameSite: 'lax', maxAge: 7 * 86400 });
    return { ok: true };
  });

  app.post('/api/logout', async () => {
    sessions.clear();
    return { ok: true };
  });

  app.get('/api/health', async () => ({ ok: true, version: '0.3.12' }));

  // 设置：改密 / API Key（单用户）
  app.get('/api/system/settings', async () => ({ hasApiKey: !!store.meta.apiKey, apiKey: store.meta.apiKey ? store.meta.apiKey.slice(0, 8) + '…' : null }));
  app.post('/api/system/password', async (req, reply) => {
    const { oldPassword, newPassword } = req.body || {};
    if (!verifyPwd(oldPassword || '', store.meta.passwordHash)) return reply.code(401).send({ error: '当前密码错误' });
    if (!newPassword || String(newPassword).length < 8) return reply.code(400).send({ error: '新密码至少 8 位' });
    store.meta.passwordHash = hashPwd(String(newPassword));
    store.meta.generatedPassword = false;
    store.flush();
    sessions.clear();
    return { ok: true };
  });
  app.post('/api/system/apikey', async () => {
    const key = crypto.randomBytes(24).toString('base64url');
    store.meta.apiKey = key;
    store.flush();
    return { apiKey: key };
  });

  // 通知测试：向指定 flow 的渠道发一条测试消息（PRD §4.8 P2）
  app.post('/api/flows/:id/notify-test', async (req, reply) => {
    const f = store.getFlow(req.params.id);
    if (!f) return reply.code(404).send({ error: 'not found' });
    const n = f.notify || {};
    if (!n.channels?.length) return reply.code(400).send({ error: '该任务未配置通知渠道' });
    const testRun = { status: 'success', finalMessage: '测试通知（CheckQ）', durationMs: 0, startedAt: Date.now(), logs: [] };
    const text = renderNotifyTemplate({ ...n, template: n.template || '测试通知：[CheckQ] {{flow.name}} {{status}}' }, f, testRun);
    const results = await sendToChannels(n.channels, text);
    const failed = results.filter((r) => !r.ok);
    if (failed.length) return reply.code(502).send({ error: `部分渠道失败：${failed.map((x) => `${x.type}:${x.error}`).join('；')}`, results });
    return { ok: true, results, text };
  });

  // 每日汇总预览/发送（PRD §4.8 P2）：基于 store.stats() 今日口径
  app.post('/api/system/daily-summary', async (req, reply) => {
    const s = store.stats();
    const target = (req.body || {}).flowId ? store.getFlow((req.body || {}).flowId) : null;
    if (target) {
      const n = target.notify || {};
      if (!n.channels?.length) return reply.code(400).send({ error: '该任务未配置通知渠道' });
      const text = `每日汇总：今日 ${s.todayRuns} 次（成功 ${s.todaySuccess} / 失败 ${s.todayFailed}，成功率 ${s.successRate ?? '—'}%）；任务 ${s.flows}，调度中 ${s.enabledScheduled}，下次 ${s.nextRunAt ? new Date(s.nextRunAt).toLocaleString('zh-CN') : '—'}`;
      const results = await sendToChannels(n.channels, text);
      return { ok: results.every((r) => r.ok), text, results };
    }
    return { ok: true, stats: s };
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
    }, 'flow');
    return { id: tpl.id, name: tpl.name };
  });

  app.get('/api/templates', async () => store.listTemplates());

  app.post('/api/templates', async (req, reply) => {
    const { name, desc, vars, varNames, nodes, edges, log } = req.body || {};
    const errors = validateFlow({ name, nodes, edges, vars });
    if (errors.length) return reply.code(400).send({ error: errors.join('; ') });
    const tpl = store.createTemplate({ name, desc, vars, varNames, nodes, edges, log }, 'import');
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
        onLog: (log) => push('log', log),
      });
      push('done', run);
      reply.raw.end();
      return reply;
    }

    const run = await runner.runFlow(f, debugStopId ? 'debug' : 'manual', { debugStopId });
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
  app.get('/api/system/stats', async () => {
    const s = store.stats();
    return { ...s, queuedFlows: [...runningFlows, ...queuedSet], queueCount: queuedSet.size, runningCount: runningFlows.size, dailySummary: store.meta.dailySummary || null };
  });

  app.get('/api/system/daily-summary-config', async () => store.meta.dailySummary || { enabled: false, time: '08:00', timezone: 'Asia/Shanghai', targetFlowId: null });
  app.put('/api/system/daily-summary-config', async (req, reply) => {
    const cfg = req.body || {};
    if (cfg.enabled && !/^\d{1,2}:\d{2}$/.test(String(cfg.time || ''))) return reply.code(400).send({ error: 'time 应为 HH:MM' });
    store.meta.dailySummary = { enabled: !!cfg.enabled, time: cfg.time || '08:00', timezone: cfg.timezone || 'Asia/Shanghai', targetFlowId: cfg.targetFlowId || null };
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
  app.get('/api/system/backup', async () => ({
    version: '0.3.12',
    exportedAt: new Date().toISOString(),
    flows: store.flows,
    runs: store.runs,
    templates: store.templates,
  }));

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
  const { app } = buildServer({ dataDir, port });
  app.listen({ port, host: '0.0.0.0' }).then(() => {
    console.log(`[CheckQ] listening on :${port}`);
  }).catch((err) => {
    console.error('[CheckQ] failed to start:', err);
    process.exit(1);
  });
}

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
import { Engine } from './engine.js';
import { validateFlow } from './model.js';
import { importHar } from './har-import.js';
import { Scheduler } from './scheduler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function buildServer({ dataDir, port }) {
  const store = new Store(dataDir);
  const app = Fastify({ logger: false, bodyLimit: 32 * 1024 * 1024 });
  const sessions = new Map(); // qsid -> expiry

  const runner = {
    async runFlow(flow, trigger, { debugStopId } = {}) {
      const runId = crypto.randomUUID();
      const run = {
        id: runId, flowId: flow.id, flowName: flow.name, trigger,
        startedAt: Date.now(), status: 'running', logs: [], vars: {}, finalMessage: '',
      };
      try {
        const engine = new Engine(flow);
        const result = await engine.run({ trigger, runId, debugStopId });
        run.status = result.ok ? 'success' : 'failed';
        run.logs = result.logs;
        run.finalMessage = result.finalMessage || (result.ok ? '' : '执行失败');
        run.vars = result.vars;
        run.durationMs = Date.now() - run.startedAt;
      } catch (err) {
        run.status = 'failed';
        run.finalMessage = `引擎异常: ${err.message}`;
        run.durationMs = Date.now() - run.startedAt;
      }
      store.addRun(run);
      sendNotify(flow, run);
      return run;
    },
  };

  async function sendNotify(flow, run) {
    const n = flow.notify || {};
    const fire = (run.status === 'success' && n.onSuccess) || (run.status === 'failed' && n.onFailure);
    if (!fire || !n.channels?.length) return;
    const text = `[CheckQ] ${flow.name} ${run.status === 'success' ? '成功' : '失败'}\n${run.finalMessage || (run.logs.at(-1)?.message || '')}`;
    for (const ch of n.channels) {
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
      } catch (err) {
        console.error(`[CheckQ] notify ${ch.type} failed:`, err.message);
      }
    }
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
    const { password } = req.body || {};
    if (!password || !verifyPwd(password, store.meta.passwordHash)) {
      return reply.code(401).send({ error: '密码错误' });
    }
    const qsid = crypto.randomBytes(24).toString('base64url');
    sessions.set(qsid, Date.now() + 7 * 86400e3);
    reply.setCookie('qsid', qsid, { path: '/', sameSite: 'lax', maxAge: 7 * 86400 });
    return { ok: true };
  });

  app.post('/api/logout', async () => {
    sessions.clear();
    return { ok: true };
  });

  app.get('/api/health', async () => ({ ok: true, version: '0.1.0' }));

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
    }, 'flow');
    return { id: tpl.id, name: tpl.name };
  });

  app.get('/api/templates', async () => store.listTemplates());

  app.post('/api/templates', async (req, reply) => {
    const { name, desc, vars, nodes, edges } = req.body || {};
    const errors = validateFlow({ name, nodes, edges, vars });
    if (errors.length) return reply.code(400).send({ error: errors.join('; ') });
    const tpl = store.createTemplate({ name, desc, vars, nodes, edges }, 'import');
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
    const run = await runner.runFlow(f, debugStopId ? 'debug' : 'manual', { debugStopId });
    return run; // 完整 run 对象（含 logs），前端直接渲染
  });

  // ---- runs ----
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

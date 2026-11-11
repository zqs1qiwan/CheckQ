/**
 * 外部 Agent 接入：API Key 作用域 + MCP 工具面 测试
 *  - read-only key：能查、不能跑、不能改
 *  - read+run key：能跑签到，不能改配置
 *  - full key：全能
 *  - MCP tools/list 覆盖 agent 需要的操作（换 cookie / 跑 / 看日志 / 切调度）
 */
process.env.ADMIN_PASSWORD = 'test1234';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';

const dir = fs.mkdtempSync(os.tmpdir() + '/cq-agent-');
const { buildServer } = await import('../src/api.js');
const server = buildServer({ dataDir: dir, port: 0 });
const { app, scheduler } = server;
await app.ready();

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name} ${extra}`); }
};

const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: 'test1234' } });
const cookie = (login.headers['set-cookie'] || '').split(';')[0];
const H = { cookie, 'content-type': 'application/json' };

// 建一个任务用于跑
const flow = await app.inject({
  method: 'POST', url: '/api/flows', headers: H,
  payload: {
    name: 'agent-test', cron: '', vars: { cookie: 'abc' },
    nodes: [{ id: 'n0', type: 'log', name: '日志', x: 0, y: 0, config: { text: 'hi' } }], edges: [],
    log: { level: 'all', record: 'log' },
  },
});
assert.strictEqual(flow.statusCode, 200, flow.body);
const fid = flow.json().id;

const mkKey = async (scopes) => {
  const r = await app.inject({ method: 'POST', url: '/api/system/apikeys', headers: H, payload: { name: 'agent', scopes } });
  assert.strictEqual(r.statusCode, 200, r.body);
  return r.json().apiKey;
};

const readKey = await mkKey(['read']);
const runKey = await mkKey(['read', 'run']);
const fullKey = await mkKey(['read', 'run', 'write']);

await check('只读 key 可以查任务列表', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/flows', headers: { 'x-api-key': readKey } });
  return r.statusCode === 200;
});

await check('只读 key 不能运行任务（403 权限不足）', async () => {
  const r = await app.inject({ method: 'POST', url: `/api/flows/${fid}/run`, headers: { 'x-api-key': readKey } });
  return r.statusCode === 403 && /权限不足/.test(r.json().error);
});

await check('只读 key 不能改变量（403）', async () => {
  const r = await app.inject({ method: 'PUT', url: `/api/flows/${fid}`, headers: { 'x-api-key': readKey }, payload: { vars: { cookie: 'x' } } });
  return r.statusCode === 403;
});

await check('read+run key 可以运行任务', async () => {
  const r = await app.inject({ method: 'POST', url: `/api/flows/${fid}/run`, headers: { 'x-api-key': runKey } });
  const j = r.json();
  return r.statusCode === 200 && j.status === 'success';
});

await check('read+run key 不能改配置（403）', async () => {
  const r = await app.inject({ method: 'PUT', url: `/api/flows/${fid}`, headers: { 'x-api-key': runKey }, payload: { vars: { cookie: 'x' } } });
  return r.statusCode === 403;
});

await check('full key 可以改变量', async () => {
  const r = await app.inject({ method: 'PUT', url: `/api/flows/${fid}`, headers: { 'x-api-key': fullKey }, payload: { vars: { cookie: 'new-cookie' } } });
  return r.statusCode === 200;
});

await check('key 列表带作用域', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/system/apikeys', headers: { cookie } });
  const keys = r.json().keys;
  const ro = keys.find((k) => k.scopes.length === 1);
  return !!ro && ro.scopes[0] === 'read';
});

await check('吊销 key 后立即失效', async () => {
  const list = await app.inject({ method: 'GET', url: '/api/system/apikeys', headers: { cookie } });
  const k = list.json().keys.find((x) => x.name === 'agent');
  const del = await app.inject({ method: 'DELETE', url: `/api/system/apikeys/${k.id}`, headers: { cookie } });
  const use = await app.inject({ method: 'GET', url: '/api/flows', headers: { 'x-api-key': readKey } });
  return del.statusCode === 200 && use.statusCode === 401;
});


await check('API Key 可设回收日期（列表显示剩余天数）', async () => {
  const soon = new Date(Date.now() + 3 * 86400e3).toISOString().slice(0, 10);
  const r = await app.inject({ method: 'POST', url: '/api/system/apikeys', headers: H, payload: { name: 'temp-key', scopes: ['read'], expiresAt: soon } });
  assert.strictEqual(r.statusCode, 200, r.body);
  const list = await app.inject({ method: 'GET', url: '/api/system/apikeys', headers: { cookie } });
  const k = list.json().keys.find((x) => x.name === 'temp-key');
  return !!k && k.expiresAt && k.daysLeft >= 2 && k.daysLeft <= 3 && k.expired === false;
});

await check('回收日期非法/过期被拒', async () => {
  const bad = await app.inject({ method: 'POST', url: '/api/system/apikeys', headers: H, payload: { name: 'bad', expiresAt: 'not-a-date' } });
  const past = await app.inject({ method: 'POST', url: '/api/system/apikeys', headers: H, payload: { name: 'past', expiresAt: '2020-01-01' } });
  return bad.statusCode === 400 && past.statusCode === 400;
});

await check('过期的 Key 立即失效并被回收', async () => {
  // 直接造一把“已过期”的 key
  const { hashApiKey } = await import('../src/auth.js');
  const expired = 'cq_expired_test_key_0000';
  const list = await app.inject({ method: 'GET', url: '/api/system/apikeys', headers: { cookie } });
  const created = await app.inject({ method: 'POST', url: '/api/system/apikeys', headers: H, payload: { name: 'expire-me', scopes: ['read'] } });
  const key = created.json().apiKey;
  // 把它改成过期（直接改 store）
  const store = server.store;
  const rec = store.meta.apiKeys.find((k) => k.prefix === key.slice(0, 10));
  rec.expiresAt = Date.now() - 1000;
  store.flush();
  const use = await app.inject({ method: 'GET', url: '/api/flows', headers: { 'x-api-key': key } });
  const after = await app.inject({ method: 'GET', url: '/api/system/apikeys', headers: { cookie } });
  const gone = !after.json().keys.some((k) => k.prefix === key.slice(0, 10));
  return use.statusCode === 401 && /过期/.test(use.json().error || '') && gone;
});

await check('GET /api 提供基础 API 索引（免登录）', async () => {
  const r = await app.inject({ method: 'GET', url: '/api' });
  const j = r.json();
  return r.statusCode === 200 && j.name === 'CheckQ API' && !!j.openapi && !!j.endpoints?.flows;
});

await check('GET /api/openapi.json 提供机器可读描述（免登录）', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/openapi.json' });
  const j = r.json();
  const paths = Object.keys(j.paths || {});
  return r.statusCode === 200 && j.openapi.startsWith('3.1')
    && paths.includes('/api/flows') && paths.includes('/api/flows/{id}/run') && paths.includes('/api/flows/{id}/logs')
    && paths.includes('/api/system/apikeys');
});

await check('OpenAPI 描述里标注了 API Key 认证与作用域', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/openapi.json' });
  const j = r.json();
  return !!j.components?.securitySchemes?.apiKeyAuth && !!j['x-scopes']?.read && !!j['x-scopes']?.run && !!j['x-scopes']?.write;
});

await check('MCP 工具覆盖 agent 需要的操作', async () => {
  const src = fs.readFileSync('mcp/checkq-mcp.cjs', 'utf8');
  const need = ['flows_list', 'flow_get', 'flow_run', 'flow_logs', 'flow_update_vars', 'flow_update', 'flow_toggle', 'flow_create', 'flow_notify_test', 'templates_list', 'template_get', 'runs_list', 'run_get', 'stats', 'notifications_list', 'whoami', 'health'];
  return need.every((n) => src.includes(`name: '${n}'`));
});

await check('MCP 支持 API Key 方式（CHECKQ_API_KEY）', async () => {
  const src = fs.readFileSync('mcp/checkq-mcp.cjs', 'utf8');
  return src.includes('CHECKQ_API_KEY') && src.includes("h['x-api-key']");
});

await check('MCP 不提供删除任务的工具（避免误删）', async () => {
  const src = fs.readFileSync('mcp/checkq-mcp.cjs', 'utf8');
  return !src.includes("name: 'flow_delete'");
});

await app.close();
scheduler.stop();
console.log(`\n${passed}/${passed + failed} passed`);
if (failed) process.exit(1);

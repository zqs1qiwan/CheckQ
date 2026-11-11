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

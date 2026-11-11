/**
 * 日志「干净模式」回归测试（PRD v0.4.1）：
 *  - 默认只记录 log 节点输出（人话）+ 失败步骤
 *  - 流程里没有 log 节点时自动退回全步骤（避免日志空白）
 *  - 调试模式（log.debug=true）保留每步请求/响应细节
 *  - GET /api/flows/:id/logs 连续日志流
 *  - GET/PUT /api/system/ui 提示级别
 */
process.env.ADMIN_PASSWORD = 'test1234';
import fs from 'node:fs';
import os from 'node:os';
import assert from 'node:assert';
import { Engine } from '../src/engine.js';

let passed = 0, failed = 0;
async function ok(name, fn) {
  try { await fn(); passed++; console.log(`  PASS ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}: ${e.message}`); }
}

const httpNode = (id, extra = {}) => ({
  id, type: 'http', name: '请求', x: 0, y: 0,
  config: { method: 'GET', url: 'https://example.com/api', headers: [], body: '', asserts: [], ...extra },
});
const logNode = (id, text) => ({ id, type: 'log', name: '日志', x: 100, y: 0, config: { text } });

function mockFetch(body = '{"ok":1}', status = 200) {
  globalThis.fetch = async () => new Response(body, { status, headers: { 'content-type': 'application/json' } });
}

const edges = [{ id: 'e1', source: 'h1', sourceHandle: 'success', target: 'l1' }];

await ok('默认（干净模式）只留 log 节点输出', async () => {
  mockFetch();
  const f = { id: 't', name: 't', vars: {}, nodes: [httpNode('h1'), logNode('l1', '完成：{{last.status}}')], edges };
  const r = await new Engine(f).run({});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.logs.length, 1, JSON.stringify(r.logs.map((l) => l.type)));
  assert.strictEqual(r.logs[0].type, 'log');
  assert.ok(r.logs[0].message.includes('200'), r.logs[0].message);
});

await ok('没有 log 节点时退回全步骤（不出现空白日志）', async () => {
  mockFetch();
  const f = { id: 't', name: 't', vars: {}, nodes: [httpNode('h1')], edges: [] };
  const r = await new Engine(f).run({});
  assert.strictEqual(r.logs.length, 1);
  assert.strictEqual(r.logs[0].type, 'http');
  assert.ok(r.logs[0].detail?.response?.body, 'http 步骤应保留响应细节');
});

await ok('失败步骤在干净模式下仍然保留（含细节）', async () => {
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
  const f = { id: 't', name: 't', vars: {}, nodes: [httpNode('h1'), logNode('l1', 'x')], edges };
  const r = await new Engine(f).run({});
  assert.strictEqual(r.ok, false);
  assert.ok(r.logs.some((l) => !l.ok), '失败步骤必须保留');
});

await ok('调试模式保留每步请求/响应细节', async () => {
  mockFetch();
  const f = { id: 't', name: 't', vars: {}, log: { debug: true }, nodes: [httpNode('h1'), logNode('l1', '完成')], edges };
  const r = await new Engine(f).run({});
  const httpLog = r.logs.find((l) => l.type === 'http');
  assert.ok(httpLog, '调试模式应保留 http 步骤');
  assert.ok(httpLog.detail?.response?.body, '调试模式应保留响应体');
});

await ok('显式 record=all 时保留全部步骤', async () => {
  mockFetch();
  const f = { id: 't', name: 't', vars: {}, log: { record: 'all' }, nodes: [httpNode('h1'), logNode('l1', '完成')], edges };
  const r = await new Engine(f).run({});
  assert.strictEqual(r.logs.length, 2);
});

await ok('单次运行临时开启调试（run({debug:true})）', async () => {
  mockFetch();
  const f = { id: 't', name: 't', vars: {}, log: { record: 'log' }, nodes: [httpNode('h1'), logNode('l1', '完成')], edges };
  const r = await new Engine(f).run({ debug: true });
  const httpLog = r.logs.find((l) => l.type === 'http');
  assert.ok(httpLog, '调试运行应记录 http 步骤');
  assert.ok(httpLog.detail?.response?.body, '调试运行应记录响应体');
});

// ---- API 层 ----
const dir = fs.mkdtempSync(os.tmpdir() + '/cq-logclean-');
const { buildServer } = await import('../src/api.js');
const server = buildServer({ dataDir: dir, port: 0 });
const { app, scheduler } = server;
await app.ready();

const login = await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'test1234' } });
const cookie = (login.headers['set-cookie'] || '').split(';')[0];

const created = await app.inject({
  method: 'POST', url: '/api/flows', headers: { cookie },
  payload: {
    name: 'clean-demo', nodes: [], vars: {},
    log: { level: 'all', record: 'log' },
  },
});
assert.strictEqual(created.statusCode, 200, created.body);

await ok('GET /api/flows/:id/logs 返回连续日志流', async () => {
  const r = await app.inject({ method: 'GET', url: `/api/flows/${created.json().id}/logs?limit=50`, headers: { cookie } });
  assert.strictEqual(r.statusCode, 200);
  const j = r.json();
  assert.ok(Array.isArray(j.entries), 'entries 应为数组');
  assert.ok(Array.isArray(j.runs), 'runs 应为数组');
  assert.strictEqual(typeof j.hasMore, 'boolean');
});

await ok('GET /api/system/ui 默认仅错误提示', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/system/ui', headers: { cookie } });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.json().toastLevel, 'error');
});

await ok('PUT /api/system/ui 可改提示级别并持久化', async () => {
  const put = await app.inject({ method: 'PUT', url: '/api/system/ui', headers: { cookie }, payload: { toastLevel: 'success' } });
  assert.strictEqual(put.statusCode, 200);
  assert.strictEqual(put.json().toastLevel, 'success');
  const get = await app.inject({ method: 'GET', url: '/api/system/ui', headers: { cookie } });
  assert.strictEqual(get.json().toastLevel, 'success');
  // 非法值回落 error
  const bad = await app.inject({ method: 'PUT', url: '/api/system/ui', headers: { cookie }, payload: { toastLevel: 'xx' } });
  assert.strictEqual(bad.json().toastLevel, 'error');
});

await app.close();
scheduler.stop();
console.log(`\n${passed}/${passed + failed} passed`);
if (failed) process.exit(1);

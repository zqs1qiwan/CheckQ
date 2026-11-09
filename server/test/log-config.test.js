/**
 * 日志配置生效测试（PRD §4.7.4）：include 开关 / resBodyLimit / varsSnapshot。
 * + 模板边界 log 往返（store.createTemplate → instantiate 携带 log）。
 * + QD retry 映射（har-import）。
 */
import assert from 'node:assert';
import { Engine } from '../src/engine.js';
import { importHar } from '../src/har-import.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const realFetch = globalThis.fetch;
let passed = 0;
let failed = 0;
async function ok(name, fn) {
  try { await fn(); passed++; console.log(`  PASS ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}: ${e.message}`); }
}
function httpNode(id, config) { return { id, type: 'http', name: id, x: 0, y: 0, config }; }
function flow(nodes, edges = [], vars = {}, log = null) { return { id: 't', name: 't', vars, nodes, edges, log }; }
function mockFetch(body) {
  globalThis.fetch = async () => new Response(body, { headers: { 'content-type': 'application/json' } });
}

// ========== include 开关（level=all） ==========
await ok('include.reqHeaders=false → detail 无 headers', async () => {
  mockFetch('{"ok":1}');
  const f = flow(
    [httpNode('a', { method: 'GET', url: 'https://example.com/x', headers: [{ name: 'x-secret', value: '1', enabled: true }], body: '', asserts: [] })],
    [], {}, { level: 'all', include: { reqHeaders: false } },
  );
  const res = await new Engine(f).run({});
  const l = res.logs.find((x) => x.type === 'http');
  assert.strictEqual(l.detail.headers, undefined);
  assert.ok(l.detail.url);
});

await ok('include.reqBody=false → detail 无 body', async () => {
  mockFetch('{"ok":1}');
  const f = flow(
    [httpNode('a', { method: 'POST', url: 'https://example.com/x', headers: [], body: 'secret=1', asserts: [] })],
    [], {}, { level: 'all', include: { reqBody: false } },
  );
  const res = await new Engine(f).run({});
  const l = res.logs.find((x) => x.type === 'http');
  assert.strictEqual(l.detail.body, undefined);
});

await ok('include.resBody=false → detail.response.body 为 undefined', async () => {
  mockFetch('{"ok":1,"big":"secret-data"}');
  const f = flow(
    [httpNode('a', { method: 'GET', url: 'https://example.com/x', headers: [], body: '', asserts: [] })],
    [], {}, { level: 'all', include: { resBody: false } },
  );
  const res = await new Engine(f).run({});
  const l = res.logs.find((x) => x.type === 'http');
  assert.strictEqual(l.detail.response.body, undefined);
  assert.strictEqual(l.detail.response.status, 200);
});

await ok('include.varsSnapshot=false → run vars 为空', async () => {
  mockFetch('{"ok":1}');
  const f = flow(
    [httpNode('a', { method: 'GET', url: 'https://example.com/x', headers: [], body: '', asserts: [] })],
    [], { username: 'plainuser' }, { level: 'all', include: { varsSnapshot: false } },
  );
  const res = await new Engine(f).run({});
  assert.deepStrictEqual(res.vars, {});
});

// ========== resBodyLimit ==========
await ok('resBodyLimit=10 → 响应体按 10 截断并标注总长', async () => {
  mockFetch('x'.repeat(100));
  const f = flow(
    [httpNode('a', { method: 'GET', url: 'https://example.com/x', headers: [], body: '', asserts: [] })],
    [], {}, { level: 'all', resBodyLimit: 10 },
  );
  const res = await new Engine(f).run({});
  const l = res.logs.find((x) => x.type === 'http');
  assert.ok(l.detail.response.body.startsWith('xxxxxxxxxx'), l.detail.response.body);
  assert.ok(l.detail.response.body.includes('100 bytes'), l.detail.response.body);
});

await ok('resBodyLimit=0 → 响应体记录为空串', async () => {
  mockFetch('{"ok":1}');
  const f = flow(
    [httpNode('a', { method: 'GET', url: 'https://example.com/x', headers: [], body: '', asserts: [] })],
    [], {}, { level: 'all', resBodyLimit: 0 },
  );
  const res = await new Engine(f).run({});
  const l = res.logs.find((x) => x.type === 'http');
  assert.strictEqual(l.detail.response.body, '');
});

await ok('默认 resBodyLimit=2000（无配置时行为不变）', async () => {
  mockFetch('y'.repeat(3000));
  const f = flow(
    [httpNode('a', { method: 'GET', url: 'https://example.com/x', headers: [], body: '', asserts: [] })],
    [], {}, null,
  );
  const res = await new Engine(f).run({});
  const l = res.logs.find((x) => x.type === 'http');
  assert.ok(l.detail.response.body.length > 2000, '应截断到约 2000+页脚');
  assert.ok(l.detail.response.body.includes('3000 bytes'));
});

// ========== 模板边界 log + notify 往返 ==========
await ok('模板 log/notify 配置经 createTemplate → instantiate 完整复制', async () => {
  const { Store } = await import('../src/store.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cq-tpl-'));
  const s = new Store(dir);
  const logCfg = { level: 'failure', include: { reqHeaders: false }, resBodyLimit: 500, keywords: [{ name: '积分', regex: '积分(\\d+)', from: 'response', into: 'summary' }] };
  const notifyCfg = { channels: [{ type: 'webhook', url: 'https://httpbin.org/post' }], onSuccess: true, template: 't {{status}}' };
  const tpl = s.createTemplate({
    name: 't1', vars: { a: '1' },
    nodes: [{ id: 'n1', type: 'log', name: 'x', x: 0, y: 0, config: { text: 'hi' } }],
    edges: [], log: logCfg, notify: notifyCfg,
  });
  assert.deepStrictEqual(tpl.log, logCfg);
  assert.deepStrictEqual(tpl.notify, notifyCfg);
  const inst = s.instantiateTemplate(tpl.id, {});
  assert.deepStrictEqual(inst.log, logCfg);
  assert.deepStrictEqual(inst.notify, notifyCfg);
  // updateTemplate 持久化 log + 默认变量编辑
  s.updateTemplate(tpl.id, { vars: { a: '2', b: '3' }, log: { level: 'summary' } });
  assert.deepStrictEqual(s.getTemplate(tpl.id).vars, { a: '2', b: '3' });
  assert.deepStrictEqual(s.getTemplate(tpl.id).varNames, ['a', 'b']);
  assert.deepStrictEqual(s.getTemplate(tpl.id).log, { level: 'summary' });
});

// ========== QD retry 映射 ==========
await ok('QD retry_count/retry_interval → 每个 http 节点注入 retry', async () => {
  const qd = JSON.stringify({
    tpl: [
      { request: { method: 'GET', url: 'https://example.com/a', headers: [] }, rule: {} },
      { request: { method: 'GET', url: 'https://example.com/b', headers: [] }, rule: {} },
    ],
    retry_count: '3', retry_interval: '2',
  });
  const f = importHar(qd);
  const https = f.nodes.filter((n) => n.type === 'http');
  assert.strictEqual(https.length, 2);
  for (const n of https) assert.deepStrictEqual(n.config.retry, { times: 3, backoffMs: 2000, retryOn: 'both' });
});

await ok('无 retry 字段时不注入 retry（行为不变）', async () => {
  const qd = JSON.stringify({ tpl: [{ request: { method: 'GET', url: 'https://example.com/a', headers: [] }, rule: {} }] });
  const f = importHar(qd);
  assert.strictEqual(f.nodes[0].config.retry, undefined);
});

await ok('importHar opts.retryCount 显式映射', async () => {
  const qd = JSON.stringify({ tpl: [{ request: { method: 'GET', url: 'https://example.com/a', headers: [] }, rule: {} }] });
  const f = importHar(qd, { retryCount: 2, retryInterval: 1 });
  assert.deepStrictEqual(f.nodes[0].config.retry, { times: 2, backoffMs: 1000, retryOn: 'both' });
});

globalThis.fetch = realFetch;
console.log(`\n${passed}/${passed + failed} passed`);
if (failed) process.exit(1);

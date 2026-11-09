/**
 * P1 回归：foreach 遍历、并发保护 409、消息模板、错误分类、改密/API Key。
 */
process.env.ADMIN_PASSWORD = 'test1234';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import { Engine } from '../src/engine.js';

let passed = 0, failed = 0;
async function ok(n, fn) { try { await fn(); passed++; console.log(`  PASS ${n}`); } catch (e) { failed++; console.log(`  FAIL ${n}: ${e.message}`); } }
function check(n, c) { if (c) { passed++; console.log(`  PASS ${n}`); } else { failed++; console.log(`  FAIL ${n}`); } }

await ok('foreach 对数组逐项执行循环体', async () => {
  const f = {
    id: 't', name: 't', vars: { list: ['a', 'b', 'c'] },
    nodes: [
      { id: 'fe', type: 'foreach', name: '遍历', x: 0, y: 0, config: { source: 'vars.list', itemVar: 'item', indexVar: 'i' } },
      { id: 'body', type: 'log', name: '取', x: 200, y: 0, config: { text: '{{i}}={{item}}' } },
      { id: 'done', type: 'log', name: '完', x: 0, y: 200, config: { text: 'done' } },
    ],
    edges: [
      { id: 'e1', source: 'fe', sourceHandle: 'each', target: 'body' },
      { id: 'e2', source: 'fe', sourceHandle: 'next', target: 'done' },
    ],
  };
  const r = await new Engine(f).run({});
  assert.strictEqual(r.ok, true);
  const bodies = r.logs.filter((l) => l.name.startsWith('取'));
  assert.strictEqual(bodies.length, 3);
  assert.ok(bodies[0].message.includes('0=a'), bodies[0].message);
  assert.ok(bodies[2].message.includes('2=c'), bodies[2].message);
  assert.ok(r.logs.some((l) => l.name === '完'), 'next 后继应执行');
});

await ok('foreach 源非数组则失败', async () => {
  const f = {
    id: 't', name: 't', vars: { x: 'abc' },
    nodes: [
      { id: 'fe', type: 'foreach', name: '遍历', x: 0, y: 0, config: { source: 'vars.x', itemVar: 'item' } },
      { id: 'body', type: 'log', name: '取', x: 200, y: 0, config: { text: 'x' } },
    ],
    edges: [{ id: 'e1', source: 'fe', sourceHandle: 'each', target: 'body' }],
  };
  const r = await new Engine(f).run({});
  assert.strictEqual(r.ok, false);
  assert.ok(/不是数组/.test(r.finalMessage), r.finalMessage);
});

await ok('foreach 未连 each 则失败', async () => {
  const f = {
    id: 't', name: 't', vars: { list: [1] },
    nodes: [{ id: 'fe', type: 'foreach', name: '遍历', x: 0, y: 0, config: { source: 'vars.list', itemVar: 'item' } }],
    edges: [],
  };
  const r = await new Engine(f).run({});
  assert.strictEqual(r.ok, false);
  assert.ok(/未连线循环体/.test(r.finalMessage), r.finalMessage);
});

await ok('错误分类：网络/断言/引擎', async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('{"ok":0}', { headers: { 'content-type': 'application/json' } });
    // assert
    const f1 = { id: 't', name: 't', vars: {}, nodes: [{ id: 'a', type: 'http', name: 'h', x: 0, y: 0, config: { method: 'GET', url: 'https://x', headers: [], body: '', asserts: [{ expr: 'last.json.ok == 1' }] } }], edges: [] };
    const r1 = await new Engine(f1).run({});
    assert.strictEqual(r1.logs[0]?.errorType, 'assert');
    // engine（condition 表达式异常）
    const f2 = { id: 't', name: 't', vars: {}, nodes: [{ id: 'a', type: 'condition', name: 'c', x: 0, y: 0, config: { expr: '1/0 === 1' } }], edges: [] };
    // 注：jexl 1/0 不抛错；用非对象变量调用不存在方法触发
    f2.nodes[0].config.expr = 'last.json.toDeep.call(null)';
    const r2 = await new Engine(f2).run({});
    // 表达式异常的 stepLog 应带 errorType=engine（若 jexl 没抛则不强制）
    if (r2.ok === false) assert.ok(r2.logs[0]?.errorType === 'engine' || /异常/.test(r2.logs[0]?.message), r2.logs[0]?.message);
    else console.log('  (jexl 未抛错，跳过 engine 分类断言)');
    // network：fetch 抛错
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
    const f3 = { id: 't', name: 't', vars: {}, nodes: [{ id: 'a', type: 'http', name: 'h', x: 0, y: 0, config: { method: 'GET', url: 'https://x', headers: [], body: '', asserts: [] } }], edges: [] };
    const r3 = await new Engine(f3).run({});
    assert.strictEqual(r3.logs[0]?.errorType, 'network');
  } finally { globalThis.fetch = realFetch; }
});

// ---- 并发 + 改密 + 模板（API）----
const dir = fs.mkdtempSync(os.tmpdir() + '/cq-p1-');
const { buildServer } = await import('../src/api.js');
const { app, scheduler } = buildServer({ dataDir: dir, port: 0 });
await app.ready();
let r = await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'test1234' } });
const sid = r.headers['set-cookie'].split(';')[0].split('=')[1];
const ck = { qsid: sid };
r = await app.inject({ method: 'POST', url: '/api/flows', cookies: ck, payload: { name: 'slow', nodes: [{ id: 'n0', type: 'delay', name: '等', x: 0, y: 0, config: { seconds: 2 } }, { id: 'n1', type: 'log', name: '记', x: 200, y: 0, config: { text: 'ok' } }], edges: [{ id: 'e1', source: 'n0', sourceHandle: 'next', target: 'n1' }] } });
const slowId = r.json().id;
// 快速连打两次：一次应成功（跑 2s），第二次应 409
const p1 = app.inject({ method: 'POST', url: `/api/flows/${slowId}/run`, cookies: ck, payload: {} });
await new Promise((res) => setTimeout(res, 200));
const p2 = await app.inject({ method: 'POST', url: `/api/flows/${slowId}/run`, cookies: ck, payload: {} });
check('并发第二次 409', p2.statusCode === 409);
const r1 = await p1;
check('第一次运行成功', r1.json().status === 'success');

r = await app.inject({ method: 'GET', url: '/api/system/settings', cookies: ck });
check('settings 含 hasApiKey', typeof r.json().hasApiKey === 'boolean');
r = await app.inject({ method: 'POST', url: '/api/system/password', cookies: ck, payload: { oldPassword: 'wrong', newPassword: 'newpass123' } });
check('错误旧密码改密 401', r.statusCode === 401);
r = await app.inject({ method: 'POST', url: '/api/system/password', cookies: ck, payload: { oldPassword: 'test1234', newPassword: 'short' } });
check('短新密码 400', r.statusCode === 400);
r = await app.inject({ method: 'POST', url: '/api/system/apikey', cookies: ck, payload: {} });
check('生成 API Key', !!r.json().apiKey);

await app.close();
scheduler.stop();
console.log(`\n${passed}/${passed + failed} passed`);
if (failed) process.exit(1);

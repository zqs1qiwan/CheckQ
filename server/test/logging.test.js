/**
 * 日志系统测试（PRD §4.7）：keywords 关键字提取、level 三档裁剪、变量脱敏。
 */

import assert from 'node:assert';
import { Engine, redactVars } from '../src/engine.js';

const realFetch = globalThis.fetch;
const passing = [];
const failing = [];
async function ok(name, fn) {
  try {
    await fn();
    passing.push(name);
    console.log(`  PASS ${name}`);
  } catch (e) {
    failing.push({ name, err: e });
    console.log(`  FAIL ${name}: ${e.message}`);
  }
}

function mockFetch(body) {
  globalThis.fetch = async () => new Response(body, { headers: { 'content-type': 'application/json' } });
}

function httpNode(id, config) {
  return { id, type: 'http', name: id, x: 0, y: 0, config };
}
function flow(nodes, edges, vars = {}, log = null) {
  return { id: 't', name: 't', vars, nodes, edges, log };
}

// ========== 1. keywords 提取 ==========
await ok('keywords 命中 → stepLog.keywords + 运行 summary', async () => {
  mockFetch(JSON.stringify({ title: '积分：1234', ok: 1 }));
  const f = flow(
    [httpNode('a', { method: 'GET', url: 'https://example.com/x', headers: [], body: '', asserts: [] })],
    [],
    {},
    { level: 'all', keywords: [{ name: '积分', regex: '积分：?\\s*(\\d+)', from: 'response', into: 'summary' }] },
  );
  const res = await new Engine(f).run({});
  assert.strictEqual(res.ok, true);
  const httpLog = res.logs.find((l) => l.type === 'http');
  assert.ok(httpLog.keywords?.length, 'stepLog 应有 keywords');
  assert.deepStrictEqual(httpLog.keywords[0].values, ['1234']);
  assert.ok(res.summary.includes('积分: 1234'), `summary 应含提取值: ${res.summary}`);
});

await ok('keywords 未命中 → 不报错, summary 为空', async () => {
  mockFetch('{"ok":1}');
  const f = flow(
    [httpNode('a', { method: 'GET', url: 'https://example.com/x', headers: [], body: '', asserts: [] })],
    [],
    {},
    { level: 'all', keywords: [{ name: '余额', regex: 'balance[":]?(\\d+)', from: 'response', into: 'summary' }] },
  );
  const res = await new Engine(f).run({});
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.summary, '');
});

await ok('keywords 非法正则 → 跳过不崩', async () => {
  mockFetch('{"ok":1}');
  const f = flow(
    [httpNode('a', { method: 'GET', url: 'https://example.com/x', headers: [], body: '', asserts: [] })],
    [],
    {},
    { level: 'all', keywords: [{ name: 'bad', regex: '([unclosed', from: 'response', into: 'summary' }] },
  );
  const res = await new Engine(f).run({});
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.summary, '');
});

// ========== 2. level 三档裁剪 ==========
await ok('level=failure → 失败步骤保留完整记录', async () => {
  mockFetch('{"ok":0,"err":"failed detail"}');
  const f = flow(
    [httpNode('a', {
      method: 'GET', url: 'https://example.com/x', headers: [], body: '',
      asserts: [{ expr: 'last.json.ok == 1', expect: 'true' }],
    })],
    [],
    {},
    { level: 'failure', keywords: [] },
  );
  const res = await new Engine(f).run({});
  const httpLog = res.logs.find((l) => l.type === 'http');
  assert.ok(httpLog.detail, `失败步骤应保留完整记录(有detail): ${JSON.stringify(Object.keys(httpLog))}`);
});

await ok('level=summary → 所有步骤只记标题', async () => {
  mockFetch('{"ok":1,"big":"x".repeat(3000)}');
  const f = flow(
    [httpNode('a', { method: 'GET', url: 'https://example.com/x', headers: [], body: '', asserts: [] })],
    [],
    {},
    { level: 'summary', keywords: [] },
  );
  const res = await new Engine(f).run({});
  const httpLog = res.logs.find((l) => l.type === 'http');
  assert.ok(!httpLog.detail, 'summary 级别不应记录 detail');
  assert.ok(httpLog.message, '应保留 message');
});

// ========== 3. 变量脱敏 ==========
await ok('redactVars 敏感名值打码, 非敏感名保留', async () => {
  const r = redactVars({
    cookie: 'sess=abcdef1234567890; other=1',
    token: 'tok_very_long_secret_value',
    username: 'plainuser',
    note: '普通内容',
  });
  assert.ok(r.cookie.startsWith('sess=abcdef1'), `cookie 应截断保留前12字符: ${r.cookie}`);
  assert.ok(r.cookie.endsWith('…'));
  assert.ok(r.token.endsWith('…'));
  assert.strictEqual(r.username, 'plainuser');
  assert.strictEqual(r.note, '普通内容');
});

globalThis.fetch = realFetch;

console.log(`\n${passing.length}/${passing.length + failing.length} passed`);
if (failing.length) {
  for (const f of failing) console.error(`FAIL ${f.name}:`, f.err.message);
  process.exit(1);
}

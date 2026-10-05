/**
 * CheckQ v0.2 引擎新能力测试 —— 不依赖任何具体站点。
 * 覆盖: 节点重试(网络错误+断言失败)、extract json/header/setCookie 模式、
 *       random-delay 节点、Set-Cookie 捕获(fetch+curl)、charset 转码、QD 回归。
 */

import assert from 'node:assert';
import { Engine } from '../src/engine.js';

const realFetch = globalThis.fetch;
const calls = [];

function mockFetch(responses, headers = {}) {
  let queue = responses;
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    const r = queue.shift() || queue[queue.length - 1];
    const h = { 'content-type': 'application/json', ...headers };
    return new Response(r.body, { status: r.status || 200, headers: h });
  };
}

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

function httpNode(id, config) {
  return { id, type: 'http', name: id, x: 0, y: 0, config };
}
function flow(nodes, edges, vars = {}) {
  return { id: 't', name: 't', vars, nodes, edges };
}

// ========== 1. 节点级重试：网络错误 ==========
await ok('网络错误 → 自动重试 → 成功', async () => {
  let n = 0;
  globalThis.fetch = async () => {
    n++;
    if (n <= 2) throw new Error('ECONNRESET');
    return new Response('{"ok":1}', { headers: { 'content-type': 'application/json' } });
  };
  calls.length = 0;
  const f = flow(
    [httpNode('a', { method: 'GET', url: 'https://example.com/x', headers: [], body: '', asserts: [], retry: { times: 3, backoffMs: 10, retryOn: 'both' } })],
    []);
  const res = await new Engine(f).run({});
  assert.strictEqual(res.ok, true, res.logs.map((l) => l.message).join('; '));
  assert.strictEqual(n, 3, `应请求 3 次, 实际 ${n}`);
});

await ok('网络错误重试耗尽 → 流程失败', async () => {
  globalThis.fetch = async () => { throw new Error('ECONNRESET'); };
  const f = flow(
    [httpNode('a', { method: 'GET', url: 'https://example.com/x', headers: [], body: '', asserts: [], retry: { times: 2, backoffMs: 10, retryOn: 'both' } })],
    []);
  const res = await new Engine(f).run({});
  assert.strictEqual(res.ok, false);
});

// ========== 2. 断言失败重试 ==========
await ok('断言失败 + retryOn=both → 重试后成功', async () => {
  mockFetch([
    { body: '{"code":1}' },
    { body: '{"code":0}' },
  ]);
  calls.length = 0;
  const f = flow(
    [httpNode('a', {
      method: 'GET', url: 'https://example.com/x', headers: [], body: '',
      asserts: [{ expr: 'last.json.code == 0', expect: 'true' }],
      retry: { times: 2, backoffMs: 10, retryOn: 'both' },
    })],
    []);
  const res = await new Engine(f).run({});
  assert.strictEqual(res.ok, true, res.logs.map((l) => l.message).join('; '));
  assert.strictEqual(calls.length, 2);
});

await ok('断言失败 + retryOn=error → 不重试', async () => {
  mockFetch([{ body: '{"code":1}' }]);
  calls.length = 0;
  const f = flow(
    [httpNode('a', {
      method: 'GET', url: 'https://example.com/x', headers: [], body: '',
      asserts: [{ expr: 'last.json.code == 0', expect: 'true' }],
      retry: { times: 3, backoffMs: 10, retryOn: 'error' },
    })],
    []);
  const res = await new Engine(f).run({});
  assert.strictEqual(res.ok, false);
  assert.strictEqual(calls.length, 1, 'retryOn=error 时断言失败不应重试');
});

// ========== 3. extract json 模式 ==========
await ok('extract mode=json 点路径提取（含数组下标）', async () => {
  mockFetch([{ body: '{"data":{"token":"abc123","list":[{"n":1},{"n":2}]}}' }]);
  const f = flow([
    httpNode('a', { method: 'GET', url: 'https://example.com/x', headers: [], body: '', asserts: [] }),
    { id: 'b', type: 'extract', name: 'get token', x: 100, y: 0, config: { mode: 'json', path: 'data.token', name: 'token' } },
    { id: 'c', type: 'extract', name: 'get item', x: 200, y: 0, config: { mode: 'json', path: 'data.list.1.n', name: 'n2' } },
  ], [{ id: 'e1', source: 'a', target: 'b' }, { id: 'e2', source: 'b', target: 'c' }]);
  const res = await new Engine(f).run({});
  assert.strictEqual(res.ok, true, res.logs.map((l) => l.message).join('; '));
  assert.strictEqual(res.vars.token, 'abc123');
  assert.strictEqual(res.vars.n2, '2');
});

// ========== 4. extract setCookie 模式 ==========
await ok('extract mode=setCookie 捕获多值 + 过滤', async () => {
  // Node Response 多值头
  const mockSetCookie = () => {
    globalThis.fetch = async () => {
      const resp = new Response('{"ok":1}', { headers: { 'content-type': 'application/json' } });
      // 构造多 Set-Cookie
      resp.headers.append('set-cookie', 'sess=AAA111; Path=/; HttpOnly');
      resp.headers.append('set-cookie', 'other=BBB222; Path=/');
      return resp;
    };
  };
  mockSetCookie();
  const f = flow([
    httpNode('a', { method: 'GET', url: 'https://example.com/login', headers: [], body: '', asserts: [] }),
    { id: 'b', type: 'extract', name: 'capture cookies', x: 100, y: 0, config: { mode: 'setCookie', name: 'cookies' } },
  ], [{ id: 'e1', source: 'a', target: 'b' }]);
  const res = await new Engine(f).run({});
  assert.strictEqual(res.ok, true);
  assert.ok(res.vars.cookies.includes('sess=AAA111'), `应含 sess: ${res.vars.cookies}`);
  assert.ok(res.vars.cookies.includes('other=BBB222'), `应含 other: ${res.vars.cookies}`);

  // 过滤: 只要 sess
  const f2 = flow([
    httpNode('a', { method: 'GET', url: 'https://example.com/login', headers: [], body: '', asserts: [] }),
    { id: 'b', type: 'extract', name: 'capture sess', x: 100, y: 0, config: { mode: 'setCookie', name: 'cookies', cookieFilter: 'sess' } },
  ], [{ id: 'e1', source: 'a', target: 'b' }]);
  const res2 = await new Engine(f2).run({});
  assert.strictEqual(res2.vars.cookies, 'sess=AAA111', `过滤后应只有 sess: ${res2.vars.cookies}`);
});

// ========== 5. extract header 模式 ==========
await ok('extract mode=header 取响应头', async () => {
  mockFetch([{ body: 'x' }], { 'x-request-id': 'req-42', location: '/next-step' });
  const f = flow([
    httpNode('a', { method: 'GET', url: 'https://example.com/x', headers: [], body: '', asserts: [] }),
    { id: 'b', type: 'extract', name: 'get rid', x: 100, y: 0, config: { mode: 'header', headerName: 'x-request-id', name: 'rid' } },
  ], [{ id: 'e1', source: 'a', target: 'b' }]);
  const res = await new Engine(f).run({});
  assert.strictEqual(res.vars.rid, 'req-42');
});

// ========== 6. charset 转码 ==========
await ok('charset=gbk 正确解码中文', async () => {
  const gbkBytes = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3, 0x2c, 0xe7, 0xad, 0xbe]); // "你好,签到" 的 GBK
  globalThis.fetch = async () => new Response(gbkBytes, { headers: { 'content-type': 'text/html' } });
  const f = flow([
    httpNode('a', { method: 'GET', url: 'https://example.com/gbk', headers: [], body: '', asserts: [], charset: 'gbk' }),
    { id: 'b', type: 'log', name: 'show', x: 100, y: 0, config: { text: '内容: {{last.jsonText}}' } },
  ], [{ id: 'e1', source: 'a', target: 'b' }]);
  const res = await new Engine(f).run({});
  assert.strictEqual(res.ok, true);
  assert.ok(res.logs.some((l) => l.type === 'http' && l.detail?.response?.body?.includes('你好')), '响应体应解码为中文');
});

// ========== 7. random-delay 节点 ==========
await ok('random-delay 在 [min,max] 区间执行', async () => {
  const t0 = Date.now();
  const f = flow([
    { id: 'a', type: 'random-delay', name: 'rd', x: 0, y: 0, config: { min: 0, max: 1 } },
  ], []);
  const res = await new Engine(f).run({});
  const elapsed = Date.now() - t0;
  assert.strictEqual(res.ok, true);
  assert.ok(elapsed >= 0 && elapsed < 2000, `耗时应 <2s, 实际 ${elapsed}ms`);
  const rdLog = res.logs.find((l) => l.type === 'random-delay');
  assert.ok(rdLog.message.includes('随机等待'), rdLog.message);
});

// ========== 8. 回归: 原有正则提取不受影响 ==========
await ok('回归: 无 mode 时正则提取照常', async () => {
  mockFetch([{ body: 'Got 42 Points' }]);
  const f = flow([
    httpNode('a', { method: 'GET', url: 'https://example.com/x', headers: [], body: '', asserts: [] }),
    { id: 'b', type: 'extract', name: 'pts', x: 100, y: 0, config: { from: 'last.text', re: 'Got (\\d+) Points', name: 'points' } },
  ], [{ id: 'e1', source: 'a', target: 'b' }]);
  const res = await new Engine(f).run({});
  assert.strictEqual(res.vars.points, '42');
});

globalThis.fetch = realFetch;

console.log(`\n${passing.length}/${passing.length} passed`);
if (failing.length) {
  for (const f of failing) console.error(`FAIL ${f.name}:`, f.err.message);
  process.exit(1);
}

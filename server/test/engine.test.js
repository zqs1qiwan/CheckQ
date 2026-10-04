/**
 * CheckQ 引擎测试 —— 不依赖任何具体站点。
 * 覆盖: 条件分支重试、直接成功、失败日志完整性、QD 模板导入后真实执行。
 */

import assert from 'node:assert';
import fs from 'node:fs';
import { Engine } from '../src/engine.js';
import { importHar } from '../src/har-import.js';

const realFetch = globalThis.fetch;
const calls = [];

function mockFetch(responses) {
  let queue = responses;
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    const r = queue.shift() || queue[queue.length - 1];
    return new Response(r.body, { status: r.status || 200, headers: { 'content-type': 'application/json' } });
  };
}

const passing = [];
let failing = [];
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

// ========== 1. 条件分支 + 变量切换 + 重试 ==========
const retryFlow = {
  id: 'f1', name: 'condition-retry',
  vars: { ua_mac: 'UA-Mac/1.0', ua_win: 'UA-Win/1.0', ua: 'UA-Win/1.0' },
  nodes: [
    { id: 'n0', type: 'http', name: 'call', x: 0, y: 0, config: {
      method: 'GET', url: 'https://example.com/api/action',
      headers: [{ name: 'user-agent', value: '{{ua}}', enabled: true }],
      body: '', asserts: [],
    } },
    { id: 'n1', type: 'condition', name: 'switch-required?', x: 240, y: 0, config: {
      expr: "last.json.code == 4 && last.json.reason == 'switch-required'",
    } },
    { id: 'n2', type: 'set', name: 'switch ua', x: 480, y: 140, config: {
      name: 'ua', value: "=last.json.loginDevice == 'macOS' ? vars.ua_mac : vars.ua_win",
    } },
    { id: 'n3', type: 'http', name: 'retry', x: 720, y: 140, config: {
      method: 'GET', url: 'https://example.com/api/action',
      headers: [{ name: 'user-agent', value: '{{ua}}', enabled: true }],
      body: '', asserts: [],
    } },
    { id: 'n4', type: 'set', name: 'save result', x: 960, y: 140, config: {
      name: 'result', value: '=last.json.message',
    } },
    { id: 'n5', type: 'log', name: 'output', x: 1200, y: 140, config: { text: 'Result: {{result}}' } },
  ],
  edges: [
    { id: 'e0', source: 'n0', target: 'n1' },
    { id: 'e1', source: 'n1', sourceHandle: 'true', target: 'n2' },
    { id: 'e2', source: 'n2', target: 'n3' },
    { id: 'e3', source: 'n3', target: 'n4' },
    { id: 'e4', source: 'n4', target: 'n5' },
    { id: 'e5', source: 'n1', sourceHandle: 'false', target: 'n5' },
  ],
};

await ok('mismatch → 切 UA → 重试成功', async () => {
  mockFetch([
    { body: JSON.stringify({ code: 4, reason: 'switch-required', loginDevice: 'macOS', message: 'Switch required.' }) },
    { body: JSON.stringify({ code: 0, message: 'OK after switch' }) },
  ]);
  calls.length = 0;
  const eng = new Engine(retryFlow);
  const res = await eng.run({});
  assert.strictEqual(res.ok, true, JSON.stringify(res.logs.map((l) => `${l.name}:${l.ok}:${l.message}`)));
  assert.strictEqual(calls.length, 2, `应发 2 次请求, 实际 ${calls.length}`);
  const firstUa = calls[0].opts.headers['user-agent'];
  const retryUa = calls[1].opts.headers['user-agent'];
  assert.strictEqual(firstUa, 'UA-Win/1.0', '首次用默认 UA');
  assert.strictEqual(retryUa, 'UA-Mac/1.0', `重试应切换到 mac UA, got: ${retryUa}`);
  const logMsg = res.logs.find((l) => l.type === 'log');
  assert.ok(logMsg.message.includes('OK after switch'), `日志应含结果: ${logMsg.message}`);
});

await ok('直接成功(不重试)', async () => {
  mockFetch([{ body: JSON.stringify({ code: 0, message: 'OK first try' }) }]);
  calls.length = 0;
  const eng = new Engine(retryFlow);
  const res = await eng.run({});
  assert.strictEqual(res.ok, true);
  assert.strictEqual(calls.length, 1, `条件为假应直达 log, 实际 ${calls.length} 次请求`);
});

await ok('断言失败 → 日志含完整响应', async () => {
  const failFlow = {
    id: 'f2', name: 'assert-fail', vars: {},
    nodes: [
      { id: 'a0', type: 'http', name: 'req', x: 0, y: 0, config: {
        method: 'GET', url: 'https://example.com/api/data', headers: [], body: '',
        asserts: [{ expr: 'last.json.ok == true', expect: 'true' }],
      } },
      { id: 'a1', type: 'log', name: 'should-not-run', x: 200, y: 0, config: { text: 'never' } },
    ],
    edges: [{ id: 'ea0', source: 'a0', target: 'a1' }],
  };
  mockFetch([{ body: JSON.stringify({ ok: false, detail: 'insufficient balance' }) }]);
  const eng = new Engine(failFlow);
  const res = await eng.run({});
  assert.strictEqual(res.ok, false, '断言失败应整体失败');
  const httpLog = res.logs.find((l) => l.type === 'http');
  assert.ok(httpLog, '应有 http 日志');
  assert.ok(JSON.stringify(httpLog.detail?.response || {}).includes('insufficient balance'),
    `日志应含原始响应体: ${JSON.stringify(httpLog)}`);
  // 断言失败 → success 出口不走，log 节点不应执行
  assert.ok(!res.logs.some((l) => l.name === 'should-not-run'), '后续节点不应执行');
});

// ========== 4. QD/HAR 导入 → 真实执行 ==========
await ok('QD 模板导入 → 流程可执行', async () => {
  // 构造一个最小 QD 模板（不依赖任何具体站点）
  const qd = JSON.stringify({
    tpl: [{
      request: {
        method: 'POST',
        url: 'https://example.com/api/checkin',
        headers: [
          { name: 'cookie', value: '{{cookie}}' },
          { name: 'content-type', value: 'application/json' },
        ],
        postData: { text: '{"token":"demo"}' },
      },
      rule: {
        success_asserts: [{ re: '"code":0', from: 'content' }],
        extract_variables: [{ name: 'points', re: 'Got (\\d+) Points' }],
      },
    }],
  });
  const flow = importHar(qd);
  assert.strictEqual(flow.nodes.length, 2, `http + extract 节点, got ${flow.nodes.length}`);
  assert.strictEqual(flow.nodes[0].type, 'http');
  assert.strictEqual(flow.nodes[1].type, 'extract');
  assert.ok(flow.nodes[0].config.asserts.length >= 1, 'QD success_asserts 应转为断言');
  assert.strictEqual(flow.nodes[0].config.body, '{"token":"demo"}', 'postData.text 应保留');
  assert.strictEqual(flow.nodes[1].config.name, 'points', 'extract 节点应命名');
  assert.strictEqual(flow.nodes[1].config.optional, true, 'QD extract 语义为尽力提取');

  mockFetch([
    { body: JSON.stringify({ code: 0, message: 'Checkin! Got 9 Points' }) },
  ]);
  flow.vars = { cookie: 'sess=fake; sig=fake' };
  const eng = new Engine(flow);
  const res = await eng.run({});
  assert.strictEqual(res.ok, true, `应成功: ${JSON.stringify(res.logs.map((l) => `${l.type}:${l.ok}:${l.message.slice(0, 60)}`))}`);
  assert.strictEqual(res.vars.points, '9', 'points 应被提取');
});

globalThis.fetch = realFetch;

console.log(`\n${passing.length - failing.length}/${passing.length} passed`);
if (failing.length) {
  for (const f of failing) console.error(`FAIL ${f.name}:`, f.err.message);
  process.exit(1);
}

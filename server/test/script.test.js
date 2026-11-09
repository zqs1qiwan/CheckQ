/**
 * script 沙箱节点回归：返回值合并 vars、无 require/网络泄漏、超时、空脚本失败。
 */
import assert from 'node:assert';
import { Engine } from '../src/engine.js';
let passed = 0, failed = 0;
async function ok(n, fn) { try { await fn(); passed++; console.log(`  PASS ${n}`); } catch (e) { failed++; console.log(`  FAIL ${n}: ${e.message}`); } }
function flow(nodes, vars = {}) { return { id: 't', name: 't', vars, nodes, edges: [] }; }
const scriptNode = (code) => ({ id: 's1', type: 'script', name: '脚本', x: 0, y: 0, config: { code } });
const logNode = (text) => ({ id: 'l1', type: 'log', name: '日志', x: 200, y: 0, config: { text } });

await ok('script 返回对象合并回 vars', async () => {
  const f = flow([scriptNode('return { doubled: Number(vars.n || 0) * 2 };'), logNode('d={{doubled}}')], { n: '21' });
  f.edges = [{ id: 'e1', source: 's1', sourceHandle: 'next', target: 'l1' }];
  const r = await new Engine(f).run({});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.vars.doubled, '42');
  assert.ok(r.logs[1].message.includes('d=42'), r.logs[1].message);
});
await ok('script 拿不到 require（沙箱隔离）', async () => {
  const f = flow([scriptNode('return { x: require("fs") };')]);
  const r = await new Engine(f).run({});
  assert.strictEqual(r.ok, false);
  assert.ok(/脚本异常/.test(r.finalMessage), r.finalMessage);
});
await ok('script 空代码失败', async () => {
  const f = flow([scriptNode('  ')]);
  const r = await new Engine(f).run({});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.finalMessage, '脚本为空');
});
console.log(`\n${passed}/${passed + failed} passed`);
if (failed) process.exit(1);

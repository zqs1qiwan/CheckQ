/**
 * 模板联动测试（派生任务 = 模板 + 各自的参数，模板一改任务立刻跟着变）
 * 运行：node server/test/template-link.test.js
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cq-tpl-'));
process.env.DATA_DIR = tmp;
process.env.ADMIN_PASSWORD = 'test1234';
process.env.PORT = '19997';

const { Store } = await import('../src/store.js');

let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  PASS', msg); }
  else { fail++; console.log('  FAIL', msg); }
};

const store = new Store(tmp);
const nodes = (url, x = 0) => ([
  { id: 'n0', type: 'http', name: '请求', x, y: 0, config: { method: 'GET', url } },
  { id: 'n1', type: 'log', name: '记录', x: 200, y: 0, config: { text: 'ok' } },
]);
const edges = [{ id: 'e0', source: 'n0', sourceHandle: 'success', target: 'n1' }];

console.log('模板联动（自动跟随）');

// 1) 建模板 → 建派生任务
const tpl = store.createTemplate({
  name: '签到模板', desc: 'd', vars: { cookie: '' }, varNames: ['cookie'],
  nodes: nodes('https://example.com/v1'), edges, log: { level: 'log' },
});
const flow = store.instantiateTemplate(tpl.id, { name: '任务A' });
ok(flow.tplId === tpl.id, '派生任务记录了 tplId');
ok(store.getFlow(flow.id).nodes[0].config.url === 'https://example.com/v1', '派生任务读到的就是模板的流程');

// 2) 模板一改，任务立刻跟着变（无需任何同步动作）
store.updateTemplate(tpl.id, { nodes: nodes('https://example.com/v2'), edges });
ok(store.getFlow(flow.id).nodes[0].config.url === 'https://example.com/v2', '模板改完，派生任务立刻用新流程（无需同步）');
ok(store.listFlows().find((f) => f.id === flow.id).nodesCount === 2, '任务列表显示的是模板当前的步数');
ok(store.getFlow(flow.id).log?.level === 'log', '日志配置也跟随模板');

// 3) 变量各自独立，模板加变量不影响已有任务的值
flow.vars.cookie = 'real-cookie';
store.flush();
store.updateTemplate(tpl.id, { varNames: ['cookie', 'ua'], vars: { cookie: '', ua: '' } });
ok(store.getFlow(flow.id).vars.cookie === 'real-cookie', '模板更新不会覆盖任务自己的变量值');

// 4) 只挪节点位置 → 仍算跟随模板（不算改脚本）
const moved = store.getFlow(flow.id).nodes.map((n) => ({ ...n, x: n.x + 37 }));
store.updateFlow(flow.id, { nodes: moved, edges });
ok(store.getFlowRaw(flow.id).tplId === tpl.id, '只移动节点位置不会让任务脱离模板');

// 5) 改了脚本内容 → 自动转成独立任务
const changed = store.getFlow(flow.id).nodes.map((n) => (n.id === 'n0' ? { ...n, config: { ...n.config, url: 'https://example.com/custom' } } : n));
const upd = store.updateFlow(flow.id, { nodes: changed, edges });
ok(upd.detached === '签到模板', '改了脚本内容会提示「已转为独立任务」');
ok(store.getFlowRaw(flow.id).tplId === null, '任务已脱离模板（tplId 清空）');
ok(store.getFlow(flow.id).nodes[0].config.url === 'https://example.com/custom', '独立任务保留自己的流程');

// 6) 模板更新不再影响已独立的任务
store.updateTemplate(tpl.id, { nodes: nodes('https://example.com/v3'), edges });
ok(store.getFlow(flow.id).nodes[0].config.url === 'https://example.com/custom', '独立任务不受模板后续更新影响');

// 7) 模板删除 → 任务保留最后一份流程，照常能用
const tpl2 = store.createTemplate({ name: 'T2', vars: {}, varNames: [], nodes: nodes('https://example.com/t2'), edges });
const f2 = store.instantiateTemplate(tpl2.id, {});
store.deleteTemplate(tpl2.id);
ok(store.getFlow(f2.id).nodes[0].config.url === 'https://example.com/t2', '模板删除后任务保留最后一份流程');
ok(store.templateInfo(store.getFlow(f2.id)).missing === true, '模板删除后标注「模板已删除」');

// 8) 非模板任务不受影响
const plain = store.createFlow({ name: '独立任务', nodes: nodes('https://example.com/p'), edges });
store.updateTemplate(tpl.id, { nodes: nodes('https://example.com/v4'), edges });
ok(store.getFlow(plain.id).nodes[0].config.url === 'https://example.com/p', '非模板任务不受模板更新影响');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);

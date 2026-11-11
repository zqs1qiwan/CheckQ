/**
 * 模板联动测试：模板版本 / 落后标注 / 同步（单任务 + 批量）
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
const nodes = (tag) => ([
  { id: 'n0', type: 'http', name: '请求', x: 0, y: 0, config: { method: 'GET', url: `https://example.com/${tag}` } },
  { id: 'n1', type: 'log', name: '记录', x: 200, y: 0, config: { text: 'ok' } },
]);
const edges = [{ id: 'e0', source: 'n0', sourceHandle: 'success', target: 'n1' }];

console.log('模板联动');

// 1) 建模板 → 建派生任务
const tpl = store.createTemplate({ name: '签到模板', desc: 'd', vars: { cookie: '' }, varNames: ['cookie'], nodes: nodes('v1'), edges, log: { level: 'log' } });
ok(!!tpl.updatedAt, '模板有版本号 updatedAt');
const flow = store.instantiateTemplate(tpl.id, { name: '任务A' });
ok(flow.tplId === tpl.id, '派生任务记录了 tplId');
ok(flow.tplUpdatedAt === tpl.updatedAt, '派生任务记录了「已同步到的模板版本」');
ok(store.templateDrift(flow) === false, '刚创建时不算落后');

// 2) 模板更新 → 派生任务被标记为落后
await new Promise((r) => setTimeout(r, 5));
store.updateTemplate(tpl.id, { nodes: nodes('v2'), edges });
ok(store.templateDrift(flow) === true, '模板更新后派生任务被标记为落后');
ok(store.templateInfo(flow).stale === true, 'templateInfo 返回 stale');
ok(store.listTemplates()[0].staleTasks === 1, '模板列表统计出 1 个待更新任务');
ok(store.listFlows().find((f) => f.id === flow.id).template.stale === true, '任务列表带出 stale 标注');

// 3) 只改名字/描述不算新版本
const tpl2 = store.createTemplate({ name: 'T2', vars: {}, varNames: [], nodes: nodes('x'), edges });
const f2 = store.instantiateTemplate(tpl2.id, {});
await new Promise((r) => setTimeout(r, 5));
store.updateTemplate(tpl2.id, { name: 'T2 改名', desc: '仅描述' });
ok(store.templateDrift(f2) === false, '只改名称/描述不算内容更新（不标记落后）');

// 4) 同步：流程图覆盖、变量保留
const before = store.getFlow(flow.id);
before.vars.cookie = 'real-cookie';
before.vars.extra = 'keep-me';
store.flush();
store.syncFlowWithTemplate(flow.id, { keepNotify: true });
const after = store.getFlow(flow.id);
ok(after.nodes[0].config.url === 'https://example.com/v2', '同步后流程图被模板覆盖');
ok(after.vars.cookie === 'real-cookie', '同步保留任务自己的变量值');
ok(after.vars.extra === 'keep-me', '同步保留任务额外变量');
ok(store.templateDrift(after) === false, '同步后不再落后');

// 5) 模板新增变量 → 同步后补空值
const tpl3 = store.createTemplate({ name: 'T3', vars: { a: '1' }, varNames: ['a'], nodes: nodes('y'), edges });
const f3 = store.instantiateTemplate(tpl3.id, {});
store.updateTemplate(tpl3.id, { varNames: ['a', 'b'], vars: { a: '1', b: '' } });
store.syncFlowWithTemplate(f3.id, {});
ok(store.getFlow(f3.id).vars.b !== undefined, '模板新增的变量在同步后补上（空值）');

// 6) 非模板任务同步 → 明确报错
const plain = store.createFlow({ name: '独立任务', nodes: nodes('p'), edges });
const r = store.syncFlowWithTemplate(plain.id, {});
ok(r && r.error, '非模板任务同步会报错而不是静默');

// 7) 模板删除后派生任务的标注
store.deleteTemplate(tpl.id);
const info = store.templateInfo(store.getFlow(flow.id));
ok(info && info.missing === true, '模板删除后派生任务标注「模板已删除」');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);

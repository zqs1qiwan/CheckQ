/**
 * 新建任务回归（2026-11-09 用户反馈：无法创建新任务/无编辑器画板）：
 *  - 空流程草稿必须 200 创建（旧 validateFlow 要求至少一个步骤，新建空白任务 400 卡死）
 *  - 空流程运行给出明确中文提示，不崩
 *  - GET /api/system/stats（首页运维条）正常返回
 */
process.env.ADMIN_PASSWORD = 'test1234';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';

const dir = fs.mkdtempSync(os.tmpdir() + '/cq-draft-');
const { buildServer } = await import('../src/api.js');
const { app, scheduler } = buildServer({ dataDir: dir, port: 0 });
await app.ready();

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  PASS ${name}`); } else { failed++; console.log(`  FAIL ${name}`); }
}

let r = await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'test1234' } });
const sid = r.headers['set-cookie'].split(';')[0].split('=')[1];
const ck = { qsid: sid };

r = await app.inject({ method: 'POST', url: '/api/flows', cookies: ck, payload: { name: '新任务', nodes: [], edges: [], vars: {} } });
check('空流程草稿创建 200（新建任务不再 400）', r.statusCode === 200);
const emptyId = r.json().id;
check('创建后可查到', (await app.inject({ method: 'GET', url: `/api/flows/${emptyId}`, cookies: ck })).json().name === '新任务');

r = await app.inject({ method: 'POST', url: `/api/flows/${emptyId}/run`, cookies: ck, payload: {} });
const emptyRun = r.json();
check('空流程运行失败但信息明确', emptyRun.status === 'failed' && /先在画布上加至少一个节点/.test(emptyRun.finalMessage));

r = await app.inject({ method: 'POST', url: '/api/flows', cookies: ck, payload: { name: 'starter', nodes: [{ id: 'n0', type: 'log', name: '记录', x: 0, y: 0, config: { text: 'hello {{who}}' } }], edges: [], vars: { who: 'world' } } });
const logId = r.json().id;
r = await app.inject({ method: 'POST', url: `/api/flows/${logId}/run`, cookies: ck, payload: {} });
const logRun = r.json();
check('log 节点运行成功并记录结果', logRun.status === 'success' && logRun.logs[0]?.message === 'hello world');
check('run.vars 含最终变量快照', logRun.vars?.who === 'world');

r = await app.inject({ method: 'GET', url: '/api/system/stats', cookies: ck });
const stats = r.json();
check('stats 任务数正确', stats.flows === 2);
check('stats 今日运行数 >=2', stats.todayRuns >= 2);
check('stats 含 successRate/nextRunAt 字段', 'successRate' in stats && 'nextRunAt' in stats);

await app.close();
scheduler.stop();
console.log(`\n${passed}/${passed + failed} passed`);
if (failed) process.exit(1);

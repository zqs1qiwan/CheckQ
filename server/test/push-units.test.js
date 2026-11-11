/**
 * 每日总推送「推送单位」测试（v0.4.2）：
 *  - GET /api/system/push-targets 只返回带通知渠道的任务
 *  - PUT/GET daily-summary-config 支持 targetFlowIds（多选）
 *  - POST /api/system/daily-summary 按勾选的多个任务推送
 *  - stats() 带 nextFlowName（首页健康条提示「下一次是哪个任务」）
 */
process.env.ADMIN_PASSWORD = 'test1234';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';

const dir = fs.mkdtempSync(os.tmpdir() + '/cq-push-');
const { buildServer } = await import('../src/api.js');
const server = buildServer({ dataDir: dir, port: 0 });
const { app, scheduler } = server;
await app.ready();

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name} ${extra}`); }
}

const calls = [];
globalThis.fetch = async (url, opts) => {
  calls.push({ url: String(url), opts: opts || {} });
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
};

const login = await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'test1234' } });
const cookie = (login.headers['set-cookie'] || '').split(';')[0];
const H = { cookie };

// 两个带渠道的任务 + 一个没有渠道的
const mk = async (name, channels, extra = {}) => {
  const r = await app.inject({
    method: 'POST', url: '/api/flows', headers: H,
    payload: { name, nodes: [], vars: {}, cron: '', enabled: false, notify: { onSuccess: true, onFailure: true, channels }, ...extra },
  });
  assert.strictEqual(r.statusCode, 200, r.body);
  return r.json();
};
const a = await mk('推送甲', [{ type: 'webhook', url: 'http://127.0.0.1:9/a' }]);
const b = await mk('推送乙', [{ type: 'webhook', url: 'http://127.0.0.1:9/b' }, { type: 'telegram', token: '1:x', chat: '2' }]);
const c = await mk('没有渠道', []);

await check('GET /api/system/push-targets 只返回带渠道的任务', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/system/push-targets', headers: H });
  const j = r.json();
  const ids = j.map((x) => x.id);
  return j.length === 2 && ids.includes(a.id) && ids.includes(b.id) && !ids.includes(c.id);
});

await check('push-targets 带上渠道类型', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/system/push-targets', headers: H });
  const j = r.json();
  const bj = j.find((x) => x.id === b.id);
  return bj && bj.channels.join(',') === 'webhook,telegram';
});

await check('PUT daily-summary-config 支持 targetFlowIds 多选', async () => {
  const put = await app.inject({
    method: 'PUT', url: '/api/system/daily-summary-config', headers: H,
    payload: { enabled: true, time: '09:30', timezone: 'Asia/Shanghai', targetFlowIds: [a.id, b.id] },
  });
  assert.strictEqual(put.statusCode, 200, put.body);
  const get = await app.inject({ method: 'GET', url: '/api/system/daily-summary-config', headers: H });
  const j = get.json();
  return j.enabled === true && j.time === '09:30' && j.targetFlowIds.length === 2 && j.targetFlowIds.includes(b.id);
});

await check('POST /api/system/daily-summary 向多个推送单位发送', async () => {
  calls.length = 0;
  const r = await app.inject({ method: 'POST', url: '/api/system/daily-summary', headers: H, payload: { flowIds: [a.id, b.id] } });
  assert.strictEqual(r.statusCode, 200, r.body);
  const j = r.json();
  const urls = calls.map((x) => x.url);
  return j.groups.length === 2 && j.results.length === 3 && urls.some((u) => u.includes('/a')) && urls.some((u) => u.includes('/b')) && urls.some((u) => u.includes('api.telegram.org'));
});

await check('汇总文案含今日运行统计', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/system/daily-summary', headers: H, payload: { flowIds: [a.id] } });
  return /每日汇总：今日 \d+ 次/.test(r.json().text || '');
});

await check('未选推送单位时拒绝推送', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/system/daily-summary', headers: H, payload: { flowIds: [] } });
  return r.statusCode === 200 && r.json().ok === true && !r.json().groups;
});

await check('stats 带 nextFlowName（下一次调度属于哪个任务）', async () => {
  const withCron = await mk('有调度的任务', [], { cron: '0 3 * * *', enabled: true });
  const r = await app.inject({ method: 'GET', url: '/api/system/stats', headers: H });
  const j = r.json();
  return j.nextRunAt && j.nextFlowName === '有调度的任务';
});

await app.close();
scheduler.stop();
console.log(`\n${passed}/${passed + failed} passed`);
if (failed) process.exit(1);

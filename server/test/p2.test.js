/**
 * P2 回归：通知测试、每日汇总、排队。
 */
process.env.ADMIN_PASSWORD = 'test1234';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';

let passed = 0, failed = 0;
function check(n, c) { if (c) { passed++; console.log(`  PASS ${n}`); } else { failed++; console.log(`  FAIL ${n}`); } }

const dir = fs.mkdtempSync(os.tmpdir() + '/cq-p2-');
const { buildServer } = await import('../src/api.js');
const { app, scheduler } = buildServer({ dataDir: dir, port: 0 });
await app.ready();
let r = await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'test1234' } });
const sid = r.headers['set-cookie'].split(';')[0].split('=')[1];
const ck = { qsid: sid };

r = await app.inject({ method: 'POST', url: '/api/flows', cookies: ck, payload: { name: 't', nodes: [{ id: 'n0', type: 'log', name: '记', x: 0, y: 0, config: { text: 'hi' } }], edges: [], notify: { channels: [{ type: 'webhook', url: 'http://127.0.0.1:1/hook' }], onSuccess: true, template: '测试 {{flow.name}} {{status}}' } } });
const fid = r.json().id;
r = await app.inject({ method: 'POST', url: `/api/flows/${fid}/notify-test`, cookies: ck, payload: {} });
check('通知测试打到不可达 webhook → 502 带结果', r.statusCode === 502 && r.json().results?.[0]?.ok === false);
r = await app.inject({ method: 'POST', url: '/api/system/daily-summary', cookies: ck, payload: {} });
check('每日汇总预览返回 stats', r.json().ok === true && typeof r.json().stats?.flows === 'number');
r = await app.inject({ method: 'POST', url: `/api/flows/${fid}/run`, cookies: ck, payload: {} });
check('run 触发后 webhook 失败不影响主流程', r.json().status === 'success');

await app.close();
scheduler.stop();
console.log(`\n${passed}/${passed + failed} passed`);
if (failed) process.exit(1);

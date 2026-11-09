/**
 * P2 回归：汇总定时配置、排队串行、模板 URL 导入。
 */
process.env.ADMIN_PASSWORD = 'test1234';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';

let passed = 0, failed = 0;
function check(n, c) { if (c) { passed++; console.log(`  PASS ${n}`); } else { failed++; console.log(`  FAIL ${n}`); } }

const dir = fs.mkdtempSync(os.tmpdir() + '/cq-p2b-');
const { buildServer } = await import('../src/api.js');
const { app, scheduler } = buildServer({ dataDir: dir, port: 0 });
await app.ready();
let r = await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'test1234' } });
const sid = r.headers['set-cookie'].split(';')[0].split('=')[1];
const ck = { qsid: sid };
r = await app.inject({ method: 'GET', url: '/api/system/daily-summary-config', cookies: ck });
check('汇总配置默认关闭', r.json().enabled === false);
r = await app.inject({ method: 'PUT', url: '/api/system/daily-summary-config', cookies: ck, payload: { enabled: true, time: 'bad', targetFlowId: null } });
check('time 非法 400', r.statusCode === 400);
r = await app.inject({ method: 'PUT', url: '/api/system/daily-summary-config', cookies: ck, payload: { enabled: true, time: '08:00', targetFlowId: null } });
check('汇总保存开启', r.json().enabled === true);
check('scheduler 注册汇总任务', scheduler.jobs.has('__summary__'));
r = await app.inject({ method: 'GET', url: '/api/system/stats', cookies: ck });
check('stats 含排队字段', typeof r.json().queueCount === 'number' && typeof r.json().runningCount === 'number');
r = await app.inject({ method: 'POST', url: '/api/templates/from-url', cookies: ck, payload: { url: 'http://127.0.0.1:1/x.json' } });
check('模板 URL 不可达 502', r.statusCode === 502);
await app.close();
scheduler.stop();
console.log(`\n${passed}/${passed + failed} passed`);
if (failed) process.exit(1);

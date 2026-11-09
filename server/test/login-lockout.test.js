/**
 * 登录防爆破测试（PRD §4.10）：同一 IP 失败 5 次 → 429 锁定。
 * 用 app.inject（不占端口，需先设 ADMIN_PASSWORD 避免 Store 生成随机密码）。
 */
process.env.ADMIN_PASSWORD = 'test1234';
process.env.DATA_DIR = '';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';

const dir = fs.mkdtempSync(os.tmpdir() + '/cq-login-');
const { buildServer } = await import('../src/api.js');
const server = buildServer({ dataDir: dir, port: 0 });
const { app, scheduler } = server;
await app.ready();

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name}`); }
}

for (let i = 1; i <= 4; i++) {
  const r = await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'wrong' } });
  check(`失败第 ${i} 次 → 401`, r.statusCode === 401);
}
// 第 5 次失败触发锁定（429），且后续即使密码正确也 429
const r5 = await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'wrong' } });
check('第 5 次失败 → 429 锁定', r5.statusCode === 429);
const r6 = await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'test1234' } });
check('锁定期间正确密码仍 429', r6.statusCode === 429);

// 登录成功清计数：新 server 实例（同数据目录不会影响计数，计数在内存）
const server2 = buildServer({ dataDir: dir, port: 0 });
const { app: app2, scheduler: scheduler2 } = server2;
await app2.ready();
const okLogin = await app2.inject({ method: 'POST', url: '/api/login', payload: { password: 'test1234' } });
check('正确密码 → 200', okLogin.statusCode === 200 && okLogin.json().ok === true);

const health = await app2.inject({ method: 'GET', url: '/api/health' });
check('health version 与 package 一致(0.3.11)', health.json().version === '0.3.11');

await app.close();
await app2.close();
scheduler.stop();
scheduler2.stop();

console.log(`\n${passed}/${passed + failed} passed`);
if (failed) process.exit(1);

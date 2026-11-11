/**
 * IP 允许名单 / 黑名单 测试
 *  - CIDR 解析与匹配（IPv4 / IPv6 / v4-mapped）
 *  - Key 级允许名单：不在名单 → 403；在名单 → 放行
 *  - X-Forwarded-For 优先（Docker 端口映射下容器只看到网关地址）
 *  - 全局黑名单：登录与 API Key 都被拦
 */
process.env.ADMIN_PASSWORD = 'test1234';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';

const dir = fs.mkdtempSync(os.tmpdir() + '/cq-ipacl-');
const { buildServer } = await import('../src/api.js');
const server = buildServer({ dataDir: dir, port: 0 });
const { app, scheduler } = server;
await app.ready();
const { ipAllowed, parseCidr } = await import('../src/iprange.js');

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name} ${extra}`); }
};

await check('CIDR：精确 IPv4 命中', () => ipAllowed('192.168.1.5', ['192.168.1.5']) === true);
await check('CIDR：精确 IPv4 不命中', () => ipAllowed('192.168.1.6', ['192.168.1.5']) === false);
await check('CIDR：/24 网段命中', () => ipAllowed('192.168.1.77', ['192.168.1.0/24']) === true);
await check('CIDR：/24 网段不命中', () => ipAllowed('192.168.2.77', ['192.168.1.0/24']) === false);
await check('CIDR：/8 网段命中', () => ipAllowed('10.5.6.7', ['10.0.0.0/8']) === true);
await check('CIDR：多条件任一命中', () => ipAllowed('172.16.0.9', ['10.0.0.0/8', '172.16.0.0/16']) === true);
await check('CIDR：IPv6 命中', () => ipAllowed('fd00::1', ['fd00::/8']) === true);
await check('CIDR：IPv4-mapped IPv6 归一', () => ipAllowed('::ffff:192.168.1.5', ['192.168.1.0/24']) === true);
await check('CIDR：空名单 = 不限制', () => ipAllowed('8.8.8.8', []) === true);
await check('CIDR：非法条目被忽略', () => ipAllowed('1.2.3.4', ['not-an-ip']) === false && parseCidr('999.1.1.1') === null);

const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: 'test1234' } });
const cookie = (login.headers['set-cookie'] || '').split(';')[0];
const H = { cookie, 'content-type': 'application/json' };

// 生成一把限制 10.0.0.0/8 的 Key
const mk = await app.inject({
  method: 'POST', url: '/api/system/apikeys', headers: H,
  payload: { name: 'limited', scopes: ['read'], allowedIps: ['10.0.0.0/8'] },
});
assert.strictEqual(mk.statusCode, 200, mk.body);
const key = mk.json().apiKey;

await check('Key 允许名单：名单外 IP 被拒（403）', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/flows', headers: { 'x-api-key': key } });
  return r.statusCode === 403 && /允许名单/.test(r.json().error);
});

await check('Key 允许名单：名单内 IP 放行', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/flows', headers: { 'x-api-key': key, 'x-forwarded-for': '10.1.2.3' } });
  return r.statusCode === 200;
});

await check('X-Forwarded-For 优先于容器内看到的网关 IP', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/flows', headers: { 'x-api-key': key, 'x-forwarded-for': '10.9.9.9, 172.17.0.1' } });
  return r.statusCode === 200;
});

await check('更新 Key 的允许名单立即生效', async () => {
  const list = await app.inject({ method: 'GET', url: '/api/system/apikeys', headers: { cookie } });
  const k = list.json().keys.find((x) => x.name === 'limited');
  const up = await app.inject({ method: 'PUT', url: `/api/system/apikeys/${k.id}`, headers: H, payload: { allowedIps: [] } });
  const use = await app.inject({ method: 'GET', url: '/api/flows', headers: { 'x-api-key': key } });
  return up.statusCode === 200 && up.json().key.allowedIps.length === 0 && use.statusCode === 200;
});

await check('全局黑名单：API Key 被拦', async () => {
  const add = await app.inject({ method: 'PUT', url: '/api/system/ip-blocklist', headers: H, payload: { ip: '203.0.113.0/24' } });
  const use = await app.inject({ method: 'GET', url: '/api/flows', headers: { 'x-api-key': key, 'x-forwarded-for': '203.0.113.9' } });
  const other = await app.inject({ method: 'GET', url: '/api/flows', headers: { 'x-api-key': key, 'x-forwarded-for': '8.8.8.8' } });
  return add.statusCode === 200 && use.statusCode === 403 && /黑名单/.test(use.json().error) && other.statusCode === 200;
});

await check('全局黑名单：登录也被拦', async () => {
  const r = await app.inject({
    method: 'POST', url: '/api/login', headers: { 'x-forwarded-for': '203.0.113.9', 'content-type': 'application/json' },
    payload: { username: 'admin', password: 'test1234' },
  });
  return r.statusCode === 403 && /黑名单/.test(r.json().error);
});

await check('移出黑名单后恢复访问', async () => {
  const list = await app.inject({ method: 'GET', url: '/api/system/ip-blocklist', headers: { cookie } });
  const ip = list.json().ips[0];
  const del = await app.inject({ method: 'DELETE', url: `/api/system/ip-blocklist/${encodeURIComponent(ip)}`, headers: { cookie } });
  const use = await app.inject({ method: 'GET', url: '/api/flows', headers: { 'x-api-key': key, 'x-forwarded-for': '203.0.113.9' } });
  return del.statusCode === 200 && use.statusCode === 200;
});

await app.close();
scheduler.stop();
console.log(`\n${passed}/${passed + failed} passed`);
if (failed) process.exit(1);

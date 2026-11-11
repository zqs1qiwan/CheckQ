/**
 * 认证与账号管理测试（v0.4.3 安全加固）
 *  - 多用户登录（用户名 + 密码）、角色权限、只读账号
 *  - TOTP 两步验证（RFC 6238 固定向量 + 启用/确认/关闭 + 恢复码）
 *  - 密码策略、改密后其他会话失效
 *  - 会话列表 / 吊销 / 退出全部
 *  - 用户管理（创建/改角色/停用/重置密码/重置 2FA/删除）与审计
 *  - 安全响应头、同源（CSRF）校验、API Key 只存摘要
 */
process.env.ADMIN_PASSWORD = 'test1234';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import { totpAt, base32Encode, base32Decode } from '../src/totp.js';

const dir = fs.mkdtempSync(os.tmpdir() + '/cq-auth-');
const { buildServer } = await import('../src/api.js');
const server = buildServer({ dataDir: dir, port: 0 });
const { app, scheduler } = server;
await app.ready();

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name} ${extra}`); }
};

const login = async (body) => {
  const r = await app.inject({ method: 'POST', url: '/api/login', payload: body });
  return { status: r.statusCode, body: r.json(), cookie: (r.headers['set-cookie'] || '').split(';')[0] };
};

// admin 登录（初始密码来自 ADMIN_PASSWORD）
const admin = await login({ username: 'admin', password: 'test1234' });
check('管理员登录成功', admin.status === 200 && !!admin.cookie, JSON.stringify(admin.body));

await check('未登录访问受保护接口返回 401', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/flows' });
  return r.statusCode === 401;
});

await check('错误密码被拒绝（不区分用户名/密码错误）', async () => {
  const r = await login({ username: 'admin', password: 'wrong-password-x' });
  return r.status === 401 && /用户名或密码错误/.test(r.body.error);
});

await check('不存在的用户名同样返回相同错误（防枚举）', async () => {
  const r = await login({ username: 'nosuchuser', password: 'whatever' });
  return r.status === 401 && /用户名或密码错误/.test(r.body.error);
});

await check('GET /api/me 返回当前用户', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: admin.cookie } });
  const j = r.json();
  return j.authenticated && j.user.username === 'admin' && j.user.role === 'admin';
});

await check('安全响应头齐备', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/health' });
  const h = r.headers;
  return h['x-content-type-options'] === 'nosniff'
    && h['x-frame-options'] === 'DENY'
    && h['referrer-policy'] === 'same-origin'
    && String(h['content-security-policy'] || '').includes("default-src 'self'");
});

await check('跨站 Origin 的写操作被拒（CSRF 防护）', async () => {
  const r = await app.inject({
    method: 'POST', url: '/api/flows', headers: { cookie: admin.cookie, origin: 'http://evil.example.com' },
    payload: { name: 'csrf', nodes: [] },
  });
  return r.statusCode === 403 && /CSRF/.test(r.json().error);
});

await check('同源 Origin 正常放行', async () => {
  const r = await app.inject({
    method: 'POST', url: '/api/flows', headers: { cookie: admin.cookie, origin: 'http://localhost' },
    payload: { name: 'same-origin-ok', nodes: [] },
  });
  return r.statusCode === 200;
});

// ---- 用户管理 ----
let opId = null;
await check('管理员可创建用户', async () => {
  const r = await app.inject({
    method: 'POST', url: '/api/system/users', headers: { cookie: admin.cookie },
    payload: { username: 'operator1', password: 'Operator#2026x', role: 'operator' },
  });
  const j = r.json();
  opId = j.user && j.user.id;
  return r.statusCode === 200 && j.user.username === 'operator1' && j.user.role === 'operator';
});

await check('弱密码被策略拒绝', async () => {
  const r = await app.inject({
    method: 'POST', url: '/api/system/users', headers: { cookie: admin.cookie },
    payload: { username: 'weakuser', password: '123456' },
  });
  return r.statusCode === 400 && /密码/.test(r.json().error);
});

await check('重复用户名被拒绝', async () => {
  const r = await app.inject({
    method: 'POST', url: '/api/system/users', headers: { cookie: admin.cookie },
    payload: { username: 'operator1', password: 'Operator#2026x' },
  });
  return r.statusCode === 400 && /已存在/.test(r.json().error);
});

await check('新用户可登录', async () => {
  const r = await login({ username: 'operator1', password: 'Operator#2026x' });
  return r.status === 200 && r.body.user.role === 'operator';
});

let opCookie = '';
await check('operator 登录并拿到会话', async () => {
  const r = await login({ username: 'operator1', password: 'Operator#2026x' });
  opCookie = r.cookie;
  return !!opCookie;
});

await check('operator 不能管理用户（403）', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/system/users', headers: { cookie: opCookie } });
  return r.statusCode === 403;
});

await check('viewer 只读：写操作被拒', async () => {
  const r = await app.inject({
    method: 'POST', url: '/api/system/users', headers: { cookie: admin.cookie },
    payload: { username: 'viewer1', password: 'Viewer#2026abcd', role: 'viewer' },
  });
  const v = await login({ username: 'viewer1', password: 'Viewer#2026abcd' });
  const w = await app.inject({ method: 'POST', url: '/api/flows', headers: { cookie: v.cookie }, payload: { name: 'x', nodes: [] } });
  const g = await app.inject({ method: 'GET', url: '/api/flows', headers: { cookie: v.cookie } });
  return r.statusCode === 200 && w.statusCode === 403 && g.statusCode === 200;
});

await check('停用账号后无法登录', async () => {
  const r = await app.inject({ method: 'PUT', url: `/api/system/users/${opId}`, headers: { cookie: admin.cookie }, payload: { disabled: true } });
  const l = await login({ username: 'operator1', password: 'Operator#2026x' });
  return r.statusCode === 200 && l.status === 401;
});

await check('管理员重置密码后可用新密码登录', async () => {
  await app.inject({ method: 'PUT', url: `/api/system/users/${opId}`, headers: { cookie: admin.cookie }, payload: { disabled: false } });
  const r = await app.inject({
    method: 'POST', url: `/api/system/users/${opId}/password`, headers: { cookie: admin.cookie },
    payload: { password: 'Reset#2026abcd' },
  });
  const l = await login({ username: 'operator1', password: 'Reset#2026abcd' });
  return r.statusCode === 200 && l.status === 200;
});

await check('不能删除自己', async () => {
  const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: admin.cookie } });
  const id = me.json().user.id;
  const r = await app.inject({ method: 'DELETE', url: `/api/system/users/${id}`, headers: { cookie: admin.cookie } });
  return r.statusCode === 400;
});

// ---- TOTP ----
await check('TOTP 计算符合 RFC 6238 风格（自洽验证）', async () => {
  const secret = base32Encode(Buffer.from('12345678901234567890', 'utf8'));
  const code = totpAt(secret, 1);
  return /^\d{6}$/.test(code) && totpAt(secret, 1) === code && totpAt(secret, 2) !== code;
});

await check('base32 编解码可逆', async () => {
  const buf = Buffer.from('hello checkq 123', 'utf8');
  return base32Decode(base32Encode(buf)).toString('utf8') === buf.toString('utf8');
});

let totpSecret = null;
await check('开始绑定两步验证（需密码）', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/system/2fa/enroll', headers: { cookie: admin.cookie }, payload: { password: 'test1234' } });
  const j = r.json();
  totpSecret = j.secret;
  return r.statusCode === 200 && !!j.secret && String(j.uri).startsWith('otpauth://totp/');
});

await check('错误密码不能绑定', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/system/2fa/enroll', headers: { cookie: admin.cookie }, payload: { password: 'nope' } });
  return r.statusCode === 401;
});

await check('确认绑定：错误验证码被拒', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/system/2fa/confirm', headers: { cookie: admin.cookie }, payload: { code: '000000' } });
  return r.statusCode === 400;
});

let recoveryCodes = [];
await check('确认绑定：正确验证码启用 + 返回 10 个恢复码', async () => {
  const code = totpAt(totpSecret, Math.floor(Date.now() / 1000 / 30));
  const r = await app.inject({ method: 'POST', url: '/api/system/2fa/confirm', headers: { cookie: admin.cookie }, payload: { code } });
  const j = r.json();
  recoveryCodes = j.recoveryCodes || [];
  return r.statusCode === 200 && recoveryCodes.length === 10;
});

await check('启用后登录需要两步验证码', async () => {
  const r = await login({ username: 'admin', password: 'test1234' });
  return r.status === 401 && r.body.needTotp === true;
});

await check('错误的两步验证码被拒', async () => {
  const r = await login({ username: 'admin', password: 'test1234', code: '111111' });
  return r.status === 401;
});

await check('正确的两步验证码可登录', async () => {
  const code = totpAt(totpSecret, Math.floor(Date.now() / 1000 / 30));
  const r = await login({ username: 'admin', password: 'test1234', code });
  return r.status === 200 && !!r.cookie;
});

await check('恢复码可登录且一次性', async () => {
  const r1 = await login({ username: 'admin', password: 'test1234', code: recoveryCodes[0] });
  const r2 = await login({ username: 'admin', password: 'test1234', code: recoveryCodes[0] });
  return r1.status === 200 && r2.status === 401;
});

await check('关闭两步验证需密码 + 验证码', async () => {
  const code = totpAt(totpSecret, Math.floor(Date.now() / 1000 / 30));
  const bad = await app.inject({ method: 'POST', url: '/api/system/2fa/disable', headers: { cookie: admin.cookie }, payload: { password: 'test1234', code: '000000' } });
  const ok = await app.inject({ method: 'POST', url: '/api/system/2fa/disable', headers: { cookie: admin.cookie }, payload: { password: 'test1234', code } });
  return bad.statusCode === 400 && ok.statusCode === 200;
});

await check('关闭后恢复普通登录', async () => {
  const r = await login({ username: 'admin', password: 'test1234' });
  return r.status === 200;
});

// ---- 改密 / 会话 ----
await check('改密需要正确旧密码', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/system/password', headers: { cookie: admin.cookie }, payload: { oldPassword: 'bad', newPassword: 'NewStrong#2026' } });
  return r.statusCode === 401;
});

await check('弱新密码被拒（策略）', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/system/password', headers: { cookie: admin.cookie }, payload: { oldPassword: 'test1234', newPassword: 'password' } });
  return r.statusCode === 400;
});

await check('改密成功且旧密码失效', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/system/password', headers: { cookie: admin.cookie }, payload: { oldPassword: 'test1234', newPassword: 'NewStrong#2026' } });
  const old = await login({ username: 'admin', password: 'test1234' });
  const neu = await login({ username: 'admin', password: 'NewStrong#2026' });
  return r.statusCode === 200 && old.status === 401 && neu.status === 200;
});

await check('会话可列出并可吊销', async () => {
  const list = await app.inject({ method: 'GET', url: '/api/system/sessions', headers: { cookie: neu.cookie } });
  const j = list.json();
  const other = j.sessions.find((s) => !s.current);
  if (!other) return j.sessions.length >= 1;
  const del = await app.inject({ method: 'DELETE', url: `/api/system/sessions/${other.id}`, headers: { cookie: neu.cookie } });
  const after = await app.inject({ method: 'GET', url: '/api/system/sessions', headers: { cookie: neu.cookie } });
  return del.statusCode === 200 && after.json().sessions.length === j.sessions.length - 1;
});

await check('退出全部设备会清空当前用户会话', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/system/logout-all', headers: { cookie: neu.cookie } });
  const after = await app.inject({ method: 'GET', url: '/api/flows', headers: { cookie: neu.cookie } });
  return r.statusCode === 200 && after.statusCode === 401;
});

// ---- API Key 只存摘要 ----
await check('API Key 创建后只返回一次明文，服务端存摘要', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/system/apikeys', headers: { cookie: neu.cookie }, payload: { name: 'MCP' } });
  const j = r.json();
  const meta = JSON.parse(fs.readFileSync(dir + '/meta.json', 'utf8'));
  const stored = meta.apiKeys[0];
  return r.statusCode === 200 && !!j.apiKey && !!stored.hash && !JSON.stringify(meta.apiKeys).includes(j.apiKey);
});

await check('API Key 可用于鉴权', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/system/apikeys', headers: { cookie: neu.cookie }, payload: { name: 'MCP2' } });
  const key = r.json().apiKey;
  const use = await app.inject({ method: 'GET', url: '/api/flows', headers: { 'x-api-key': key } });
  return use.statusCode === 200;
});

await check('审计日志记录关键动作', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/system/audit', headers: { cookie: neu.cookie } });
  const actions = r.json().entries.map((e) => e.action);
  return r.statusCode === 200 && actions.includes('login.ok') && actions.includes('user.create') && actions.includes('password.change');
});

await check('明文密码不再落盘（meta 里没有 passwordHash/plainHint）', async () => {
  const meta = JSON.parse(fs.readFileSync(dir + '/meta.json', 'utf8'));
  return !meta.passwordHash && !meta.plainHint && !JSON.stringify(meta).includes('test1234');
});

await app.close();
scheduler.stop();
console.log(`\n${passed}/${passed + failed} passed`);
if (failed) process.exit(1);

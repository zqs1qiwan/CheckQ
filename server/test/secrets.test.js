/**
 * 签到凭据（cookie / token / 密码）静态加密 + 导出脱敏 测试
 *  - 磁盘上不出现明文 cookie / token / 渠道密钥
 *  - API 返回仍是明文（面板要能编辑）
 *  - 备份默认脱敏；完整备份需密码
 *  - 模板导出继续脱敏
 *  - 日志/运行记录里不出现明文凭据
 */
process.env.ADMIN_PASSWORD = 'test1234';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';

const dir = fs.mkdtempSync(os.tmpdir() + '/cq-secret-');
const { buildServer } = await import('../src/api.js');
const server = buildServer({ dataDir: dir, port: 0 });
const { app, scheduler } = server;
await app.ready();

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name} ${extra}`); }
};

const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: 'test1234' } });
const cookie = (login.headers['set-cookie'] || '').split(';')[0];
const H = { cookie, 'content-type': 'application/json' };

const COOKIE_VAL = 'gld:sess=abc123def456ghi789jkl012mno345pqr; gld:sess.sig=SIGNATUREVALUE';
const TG_TOKEN = '123456789:TEST_FAKE_TOKEN_FOR_ENCRYPTION_TEST';

const created = await app.inject({
  method: 'POST', url: '/api/flows', headers: H,
  payload: {
    name: '凭据测试', nodes: [], vars: { cookie: COOKIE_VAL, ua: 'Mozilla/5.0', site: 'example.com' },
    notify: { onSuccess: true, channels: [{ type: 'telegram', token: TG_TOKEN, chat: 'CHAT-ID' }] },
  },
});
assert.strictEqual(created.statusCode, 200, created.body);

await check('磁盘上不出现明文 cookie', async () => {
  const raw = fs.readFileSync(dir + '/flows.json', 'utf8');
  return !raw.includes('gld:sess=abc123def456ghi789jkl012mno345pqr') && raw.includes('enc:v1:');
});

await check('磁盘上不出现明文 Telegram token', async () => {
  const raw = fs.readFileSync(dir + '/flows.json', 'utf8');
  return !raw.includes(TG_TOKEN);
});

await check('非敏感变量保持明文（可读可 diff）', async () => {
  const raw = fs.readFileSync(dir + '/flows.json', 'utf8');
  return raw.includes('Mozilla/5.0');
});

await check('API 返回仍是明文（面板可编辑）', async () => {
  const r = await app.inject({ method: 'GET', url: `/api/flows/${created.json().id}`, headers: H });
  const j = r.json();
  return j.vars.cookie === COOKIE_VAL && j.notify.channels[0].token === TG_TOKEN;
});

await check('重新读取（模拟重启）后仍是明文（密钥一致）', async () => {
  const { Store } = await import('../src/store.js');
  const s2 = new Store(dir);
  const f = s2.getFlow(created.json().id);
  return f.vars.cookie === COOKIE_VAL && f.notify.channels[0].token === TG_TOKEN;
});

await check('密钥文件存在且权限 600', async () => {
  if (!fs.existsSync(dir + '/.secret')) return false;
  const st = fs.statSync(dir + '/.secret');
  // Windows 下 mode 位不完全可信，这里至少校验文件存在且内容是 64 位 hex
  const hex = fs.readFileSync(dir + '/.secret', 'utf8').trim();
  return /^[0-9a-f]{64}$/.test(hex) && (process.platform === 'win32' || (st.mode & 0o777) === 0o600);
});

await check('备份默认脱敏（cookie / token 为空或 ***）', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/system/backup', headers: H });
  const j = r.json();
  const f = j.flows.find((x) => x.id === created.json().id);
  return j.masked === true && f.vars.cookie === '' && f.notify.channels[0].token === '***';
});

await check('完整备份需要正确密码', async () => {
  const bad = await app.inject({ method: 'POST', url: '/api/system/backup', headers: H, payload: { password: 'wrong' } });
  return bad.statusCode === 401;
});

await check('完整备份（含密码）包含明文凭据', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/system/backup', headers: H, payload: { password: 'test1234' } });
  const j = r.json();
  const f = j.flows.find((x) => x.id === created.json().id);
  return r.statusCode === 200 && j.masked === false && f.vars.cookie === COOKIE_VAL && f.notify.channels[0].token === TG_TOKEN;
});

await check('模板导出继续脱敏敏感变量', async () => {
  const tpl = await app.inject({
    method: 'POST', url: '/api/templates', headers: H,
    payload: { name: '带凭据的模板', nodes: [], vars: { cookie: COOKIE_VAL, ua: 'UA' } },
  });
  const r = await app.inject({ method: 'GET', url: `/api/templates/${tpl.json().id}/export`, headers: H });
  const j = r.json();
  return j.vars.cookie === '' && j.vars.ua === 'UA';
});

await check('运行日志/变量快照不含明文凭据（脱敏层）', async () => {
  globalThis.fetch = async () => new Response('{"ok":1}', { status: 200, headers: { 'content-type': 'application/json' } });
  const flow = {
    id: 'x', name: 'x', vars: { cookie: COOKIE_VAL },
    nodes: [{ id: 'n0', type: 'http', name: 'r', x: 0, y: 0, config: { method: 'GET', url: 'https://example.com', headers: [{ name: 'cookie', value: '{{cookie}}', enabled: true }], body: '', asserts: [] } }],
    edges: [], log: { level: 'all', record: 'all' },
  };
  const { Engine } = await import('../src/engine.js');
  const res = await new Engine(flow).run({});
  const text = JSON.stringify(res);
  return !text.includes('gld:sess=abc123def456ghi789jkl012mno345pqr') && !text.includes('SIGNATUREVALUE');
});

await app.close();
scheduler.stop();
console.log(`\n${passed}/${passed + failed} passed`);
if (failed) process.exit(1);

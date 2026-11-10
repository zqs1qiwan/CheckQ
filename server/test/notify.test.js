/**
 * 通知渠道测试（qinglong 标准 7 渠道）：stub 外网 fetch，校验各渠道请求体与签名。
 * 用法：node test/notify.test.js
 */
process.env.ADMIN_PASSWORD = 'test1234';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';

const dir = fs.mkdtempSync(os.tmpdir() + '/cq-notify-');
const { buildServer } = await import('../src/api.js');
const server = buildServer({ dataDir: dir, port: 0 });
const { app, scheduler } = server;
await app.ready();

const realFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, opts) => {
  calls.push({ url: String(url), opts: opts || {} });
  const u = String(url);
  let body = {};
  if (u.includes('api.telegram.org')) body = { ok: true };
  else if (u.includes('sctapi.ftqq.com')) body = { code: 0, message: 'success' };
  else if (u.includes('oapi.dingtalk.com')) body = { errcode: 0, errmsg: 'ok' };
  else if (u.includes('qyapi.weixin.qq.com')) body = { errcode: 0, errmsg: 'ok' };
  else if (u.includes('open.feishu.cn')) body = { code: 0, msg: 'ok' };
  else body = { ok: true };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
};

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name} ${extra}`); }
}

// 登录
const login = await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'test1234' } });
check('登录成功', login.statusCode === 200);
const cookie = (login.headers['set-cookie'] || '').split(';')[0];

const channels = [
  { type: 'webhook', url: 'http://127.0.0.1:9/echo' },
  { type: 'bark', url: 'https://day.app/abc', title: 'CheckQ' },
  { type: 'telegram', token: '123:abc', chat: '-100123' },
  { type: 'serverchan', key: 'SCT123' },
  { type: 'dingtalk', url: 'https://oapi.dingtalk.com/robot/send?access_token=x', secret: 'SEC123' },
  { type: 'wecom', url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x' },
  { type: 'feishu', url: 'https://open.feishu.cn/open-apis/bot/v2/hook/x', secret: 'SEC456' },
];

const created = await app.inject({
  method: 'POST', url: '/api/flows',
  headers: { cookie }, payload: { name: 'notify-test', nodes: [], notify: { onSuccess: true, channels } },
});
check('创建任务', created.statusCode === 200, created.body);
const flow = created.json();

const r = await app.inject({ method: 'POST', url: `/api/flows/${flow.id}/notify-test`, headers: { cookie } });
check('notify-test 返回 200', r.statusCode === 200, r.body);
const results = r.json().results || [];
check('7 个渠道全部 ok', results.length === 7 && results.every((x) => x.ok), JSON.stringify(results));

const byHost = (h) => calls.find((c) => c.url.includes(h));
const webhook = byHost('127.0.0.1:9');
check('webhook 直发文本', webhook && webhook.opts.body.includes('notify-test'), webhook && webhook.opts.body);
const bark = byHost('day.app');
check('bark 带 title/text', bark && decodeURIComponent(bark.url).includes('CheckQ') && decodeURIComponent(bark.url).includes('notify-test'), bark && bark.url);
const tg = byHost('api.telegram.org');
check('telegram chat_id+text', tg && tg.opts.body && tg.opts.body.includes('-100123') && tg.opts.body.includes('notify-test'), tg && tg.opts.body);
const sc = byHost('sctapi.ftqq.com');
check('serverchan title+desp', sc && sc.opts.body.includes('SCT123') === false && sc.opts.body.includes('CheckQ') && sc.opts.body.includes('notify-test'), sc && sc.opts.body);
const dt = byHost('oapi.dingtalk.com');
check('dingtalk markdown + 签名', dt && dt.opts.body.includes('markdown') && dt.url.includes('sign=') && dt.url.includes('timestamp='), dt && dt.url);
const wc = byHost('qyapi.weixin.qq.com');
check('wecom markdown content', wc && wc.opts.body.includes('notify-test') && wc.opts.body.includes('markdown'), wc && wc.opts.body);
const feishu = byHost('open.feishu.cn');
check('feishu text + 签名', feishu && feishu.opts.body.includes('notify-test') && feishu.url.includes('sign='), feishu && feishu.url);

// 失败渠道要回 502
calls.length = 0;
const bad = await app.inject({
  method: 'POST', url: '/api/flows',
  headers: { cookie }, payload: { name: 'notify-bad', nodes: [], notify: { onSuccess: true, channels: [{ type: 'unknown', url: 'http://x' }] } },
});
const badFlow = bad.json();
const rb = await app.inject({ method: 'POST', url: `/api/flows/${badFlow.id}/notify-test`, headers: { cookie } });
check('未知渠道 → 502 + 失败结果', rb.statusCode === 502 && (rb.json().results || []).some((x) => !x.ok), rb.body);

globalThis.fetch = realFetch;
await app.close();
scheduler.stop();
console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);

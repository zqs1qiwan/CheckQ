/**
 * 单次运行 HAR 导出（默认脱敏）
 * 运行：node server/test/har-export.test.js
 */
import { runToHar } from '../src/har-export.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  PASS', msg); } else { fail++; console.log('  FAIL', msg); } };

const flow = {
  name: '示例流程',
  vars: { cookie: 'sess=SUPER_SECRET_COOKIE_123', token: 'TOKEN_SECRET_4567890', ua: 'Mozilla/5.0' },
};
const run = {
  id: 'run-1', flowId: 'flow-1', flowName: '示例流程', status: 'failed', startedAt: 1794000000000, durationMs: 1200,
  logs: [
    { index: 1, name: '登录', type: 'http', ok: true, ms: 100, stepId: 'n0', detail: {
      method: 'post', url: 'https://example.com/api?token=TOKEN_SECRET_4567890&x=1',
      headers: { cookie: 'sess=SUPER_SECRET_COOKIE_123', authorization: 'Bearer abc', 'content-type': 'application/json' },
      body: '{"cookie":"sess=SUPER_SECRET_COOKIE_123"}',
      response: { status: 200, ms: 100, headers: { 'content-type': 'application/json; charset=utf-8', 'set-cookie': 'sess=SUPER_SECRET_COOKIE_123' }, body: '{"ok":true,"token":"TOKEN_SECRET_4567890"}' },
    } },
    { index: 2, name: '日志', type: 'log', ok: true, ms: 0, message: '完成' },
  ],
};

const har = runToHar(run, flow);
const text = JSON.stringify(har);
ok(har.log.version === '1.2', 'HAR 版本 1.2');
ok(har.log.entries.length === 1, '只导出 http 步骤（1 条 entry）');
ok(har.log.entries[0].request.method === 'POST', '方法转大写');
ok(har.log.entries[0].response.status === 200, '响应状态正确');
ok(!text.includes('SUPER_SECRET_COOKIE_123') && !text.includes('TOKEN_SECRET_4567890'), '所有敏感变量值已脱敏');
ok(har.log.entries[0].request.headers.find((h) => h.name === 'cookie').value === '***', 'Cookie 头整值替换为 ***');
ok(har.log.entries[0].request.headers.find((h) => h.name === 'authorization').value === '***', 'Authorization 头整值替换为 ***');
ok(har.log.entries[0].response.headers.find((h) => h.name === 'set-cookie').value === '***', 'Set-Cookie 头整值替换为 ***');
ok(har.log.entries[0].request.queryString.find((q) => q.name === 'token').value === '***', 'query 中的敏感值脱敏');
ok(har.log.entries[0]._checkq.redacted === true && har.log._checkq.redacted === true, '显式标记 redacted');
ok(har.log.entries[0].response.content.mimeType === 'application/json', 'MIME 从 content-type 提取');
ok(runToHar({ logs: [] }, flow).log.entries.length === 0, '无 http 日志时 entries 为空');

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);

/**
 * 邮件（SMTP）通知测试：本地假 SMTP 服务器，校验 AUTH LOGIN / MAIL / RCPT / DATA 全流程。
 * 用法：node test/email-smtp.test.js
 */
process.env.ADMIN_PASSWORD = 'test1234';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';

const dir = fs.mkdtempSync(os.tmpdir() + '/cq-mail-');
const { buildServer } = await import('../src/api.js');
const server = buildServer({ dataDir: dir, port: 0 });
const { app, scheduler } = server;
await app.ready();

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name} ${extra}`); }
}

// ---- 假 SMTP 服务器 ----
const captured = { authUser: '', authPass: '', mailFrom: '', rcpt: [], data: '' };
const smtp = net.createServer((socket) => {
  let buf = '';
  let auth = 0;
  let inData = false;
  const dataLines = [];
  socket.write('220 fake ESMTP ready\r\n');
  socket.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\r\n')) !== -1) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (inData) {
        if (line === '.') {
          inData = false;
          captured.data = dataLines.join('\r\n');
          socket.write('250 OK queued\r\n');
        } else {
          dataLines.push(line);
        }
        continue;
      }
      if (/^EHLO/i.test(line)) socket.write('250-fake\r\n250-AUTH LOGIN\r\n250 OK\r\n');
      else if (/^AUTH LOGIN/i.test(line)) { auth = 1; socket.write('334 VXNlcm5hbWU6\r\n'); }
      else if (auth === 1) { captured.authUser = Buffer.from(line, 'base64').toString('utf8'); auth = 2; socket.write('334 UGFzc3dvcmQ6\r\n'); }
      else if (auth === 2) { captured.authPass = Buffer.from(line, 'base64').toString('utf8'); auth = 0; socket.write('235 Authentication successful\r\n'); }
      else if (/^MAIL FROM:/i.test(line)) { captured.mailFrom = line; socket.write('250 OK\r\n'); }
      else if (/^RCPT TO:/i.test(line)) { captured.rcpt.push(line); socket.write('250 OK\r\n'); }
      else if (/^DATA/i.test(line)) { inData = true; socket.write('354 End data with <CR><LF>.<CR><LF>\r\n'); }
      else if (/^QUIT/i.test(line)) { socket.write('221 Bye\r\n'); socket.end(); }
      else socket.write('250 OK\r\n');
    }
  });
  socket.on('error', () => {});
});
await new Promise((res) => smtp.listen(0, '127.0.0.1', res));
const port = smtp.address().port;

// 登录 + 创建带邮件渠道的任务
const login = await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'test1234' } });
const cookie = (login.headers['set-cookie'] || '').split(';')[0];
const created = await app.inject({
  method: 'POST', url: '/api/flows', headers: { cookie },
  payload: {
    name: 'mail-test', nodes: [],
    notify: {
      onSuccess: true,
      template: '[CheckQ] {{flow.name}} {{status}} — {{message}}',
      channels: [{ type: 'email', host: '127.0.0.1', port, secure: false, user: 'bot@example.com', pass: 'secret123', from: 'bot@example.com', to: 'a@example.com,b@example.com', subject: 'CheckQ 测试邮件' }],
    },
  },
});
check('创建邮件任务', created.statusCode === 200, created.body);
const flow = created.json();

const r = await app.inject({ method: 'POST', url: `/api/flows/${flow.id}/notify-test`, headers: { cookie } });
check('notify-test 返回 200', r.statusCode === 200, r.body);
const results = r.json().results || [];
check('email 渠道 ok', results.length === 1 && results[0].ok, JSON.stringify(results));
check('AUTH 用户名', captured.authUser === 'bot@example.com', captured.authUser);
check('AUTH 密码', captured.authPass === 'secret123', captured.authPass);
check('MAIL FROM', captured.mailFrom === 'MAIL FROM:<bot@example.com>', captured.mailFrom);
check('RCPT 两个收件人', captured.rcpt.length === 2 && captured.rcpt[1].includes('b@example.com'), JSON.stringify(captured.rcpt));
const bodyB64 = captured.data.split('\r\n\r\n')[1] || '';
const bodyText = Buffer.from(bodyB64.replace(/\r\n/g, ''), 'base64').toString('utf8');
check('正文含任务名/状态', bodyText.includes('mail-test') && bodyText.includes('成功'), bodyText.slice(0, 120));
check('主题 UTF-8 编码', /Subject: =\?UTF-8\?B\?/.test(captured.data), captured.data.slice(0, 200));

await new Promise((res) => smtp.close(res));
await app.close();
scheduler.stop();
console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);

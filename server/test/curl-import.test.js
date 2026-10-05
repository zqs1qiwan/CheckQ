/** cURL 解析器测试 —— 纯静态，零网络 */

import assert from 'node:assert';
import { parseCurl } from '../src/curl-import.js';

const passing = [];
const failing = [];
async function ok(name, fn) {
  try {
    await fn();
    passing.push(name);
    console.log(`  PASS ${name}`);
  } catch (e) {
    failing.push({ name, err: e });
    console.log(`  FAIL ${name}: ${e.message}`);
  }
}

await ok('基础 GET + 位置参数 URL', async () => {
  const c = parseCurl(`curl https://example.com/api`);
  assert.strictEqual(c.method, 'GET');
  assert.strictEqual(c.url, 'https://example.com/api');
});

await ok('POST + data + header', async () => {
  const c = parseCurl(`curl 'https://example.com/login' -X POST -H 'content-type: application/json' --data-raw '{"user":"a\\\"b"}'`);
  assert.strictEqual(c.method, 'POST');
  assert.strictEqual(c.url, 'https://example.com/login');
  assert.strictEqual(c.body, '{"user":"a\\"b"}');
  assert.ok(c.headers.some((h) => h.name === 'content-type'));
});

await ok('cookie 头 -b', async () => {
  const c = parseCurl(`curl https://example.com -b "sess=abc123"`);
  assert.strictEqual(c.headers[0].name, 'cookie');
  assert.strictEqual(c.headers[0].value, 'sess=abc123');
});

await ok('-H cookie 与 content-type', async () => {
  const c = parseCurl(`curl https://example.com -H 'Cookie: a=1; b=2' -H 'X-Custom: yes'`);
  const cookie = c.headers.find((h) => h.name.toLowerCase() === 'cookie');
  assert.ok(cookie);
  assert.strictEqual(cookie.value, 'a=1; b=2');
  const xc = c.headers.find((h) => h.name === 'X-Custom');
  assert.ok(xc);
});

await ok('GET 默认（无 -X 无 -d）', async () => {
  const c = parseCurl(`curl -H 'accept: application/json' https://example.com/x`);
  assert.strictEqual(c.method, 'GET');
});

await ok('自动补 content-type: JSON body', async () => {
  const c = parseCurl(`curl -X POST https://example.com -d '{"a":1}'`);
  const ct = c.headers.find((h) => h.name.toLowerCase() === 'content-type');
  assert.strictEqual(ct.value, 'application/json');
});

await ok('自动补 content-type: 表单 body', async () => {
  const c = parseCurl(`curl -X POST https://example.com -d 'a=1&b=2'`);
  const ct = c.headers.find((h) => h.name.toLowerCase() === 'content-type');
  assert.strictEqual(ct.value, 'application/x-www-form-urlencoded');
});

await ok('忽略不认识参数（含值跳过）', async () => {
  const c = parseCurl(`curl --some-flag value https://example.com -o /dev/null`);
  assert.strictEqual(c.url, 'https://example.com');
});

await ok('-u Basic 认证', async () => {
  const c = parseCurl(`curl -u admin:pass123 https://example.com`);
  const auth = c.headers.find((h) => h.name === 'authorization');
  assert.strictEqual(auth.value, `Basic ${Buffer.from('admin:pass123').toString('base64')}`);
});

await ok('无引号 token', async () => {
  const c = parseCurl(`curl -X POST -d a=1 -d b=2 https://example.com/form`);
  assert.strictEqual(c.body, 'a=1&b=2');
});

await ok('反斜杠换行（多行命令）', async () => {
  const c = parseCurl([
    `curl https://example.com \\`,
    `  -H 'User-Agent: Test' \\`,
    `  -d 'x=1'`,
  ].join('\n'));
  assert.strictEqual(c.method, 'POST');
  const ua = c.headers.find((h) => h.name.toLowerCase() === 'user-agent');
  assert.strictEqual(ua.value, 'Test');
});

await ok('非法输入报错', async () => {
  assert.throws(() => parseCurl('wget https://example.com'), /curl/);
  assert.throws(() => parseCurl('curl -H "x: y"'), /URL/);
});

console.log(`\n${passing.length}/${passing.length + failing.length} passed`);
if (failing.length) {
  for (const f of failing) console.error(`FAIL ${f.name}:`, f.err.message);
  process.exit(1);
}

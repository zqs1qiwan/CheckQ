/** 过滤器与日期函数单测(P0#3/#4) */
import { renderTemplate, resolvePath } from '../src/render.js';

let passed = 0;
let failed = 0;
function check(name, actual, expected) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.error(`✗ ${name}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
  }
}

// 原有过滤器
check('urlencode', renderTemplate('{{u|urlencode}}', { u: 'a b&c' }), 'a%20b%26c');
check('json', renderTemplate('{{v|json}}', { v: { a: 1 } }), '{"a":1}');
check('base64', renderTemplate('{{v|base64}}', { v: 'hello' }), Buffer.from('hello').toString('base64'));

// 新增哈希
check('md5', renderTemplate('{{v|md5}}', { v: 'hello' }), '5d41402abc4b2a76b9719d911017c592');
check('sha1', renderTemplate('{{v|sha1}}', { v: 'hello' }), 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d');
check('sha256', renderTemplate('{{v|sha256}}', { v: 'hello' }),
  '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');

// 编解码
check('base64decode', renderTemplate('{{v|base64decode}}', { v: 'aGVsbG8=' }), 'hello');
check('urldecode', renderTemplate('{{v|urldecode}}', { v: 'a%20b%26c' }), 'a b&c');
check('hex', renderTemplate('{{v|hex}}', { v: 'AB' }), '4142');

// 大小写/裁剪
check('upper', renderTemplate('{{v|upper}}', { v: 'abc' }), 'ABC');
check('lower', renderTemplate('{{v|lower}}', { v: 'ABC' }), 'abc');
check('trim', renderTemplate('[{{v|trim}}]', { v: '  x  ' }), '[x]');

// 链式
check('链式 base64|upper', renderTemplate('{{v|base64|lower}}', { v: 'hello' }),
  Buffer.from('hello').toString('base64').toLowerCase());

// 时间戳
const ts = resolvePath({}, 'timestamp', null);
check('timestamp 秒级整数', String(ts).length === 10 && !isNaN(ts), true);
const tsMs = resolvePath({}, 'timestamp:ms', null);
check('timestamp:ms 毫秒级', String(tsMs).length === 13 && !isNaN(tsMs), true);

// now 格式化
const now = resolvePath({}, 'now', null);
check('now 默认格式', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(now), true);
const nowShort = resolvePath({}, 'now:%Y%m%d', null);
check('now:%Y%m%d', /^\d{8}$/.test(nowShort), true);
const nowFull = resolvePath({}, 'now:%Y-%m-%d %H:%M:%S.%f', null);
check('now:%f 毫秒', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/.test(nowFull), true);

// 模板中的日期(签到场景: 日期 + md5 签名)
const day = renderTemplate('{{t|now:%Y-%m-%d}}', {});
check('模板 now 日期', /^\d{4}-\d{2}-\d{2}$/.test(day), true);

console.log(`${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);

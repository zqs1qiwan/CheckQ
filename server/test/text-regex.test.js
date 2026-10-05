/** 文本划选 → 自动泛化正则（PRD §4.0.3）单测 */
import { generalizeSelection, textExtractRegex } from '../src/text-regex.js';

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

// —— 规则生成 ——
check('纯数字→捕获组', generalizeSelection('1234'), '(\\d+(?:\\.\\d+)?)');
check('小数→单个捕获组', generalizeSelection('12.5'), '(\\d+(?:\\.\\d+)?)');
check('空格→\\s*', generalizeSelection(' '), '\\s*');
check('普通字符转义', generalizeSelection('a.b'), 'a\\.b');
check('冒号全半角归一(半角)', generalizeSelection(':'), '[:：]');
check('冒号全半角归一(全角)', generalizeSelection('：'), '[:：]');
check('星号转义', generalizeSelection('*'), '\\*');

// —— 端到端提取 ——
function extract(selected, sample) {
  const m = new RegExp(textExtractRegex(selected)).exec(sample);
  return m ? m[1] : null;
}

check('积分提取', extract('积分：1234', '签到成功！积分：5678。'), '5678');
check('全角/半角冒号互通', extract('积分: 100', '积分：200'), '200');
check('小数点余额', extract('Balance: 12.5', 'Your Balance: 99.9 USD'), '99.9');
check('流量GB', extract('Traffic used: 15GB', 'Traffic used: 204GB'), '204');
check('纯文本无数字', extract('exact word', 'the exact word here'), 'exact word');
// URL含数字时数字成为捕获组（设计如此：数字=变化部分）
check('URL版本号提取', extract('/api/v2/status', 'GET /api/v3/status => 200'), '3');

// 正则合法性
for (const s of ['积分：1234', 'Balance: 12.5', 'a*b?c', '(paren)', '[bracket]', 'back\\slash']) {
  let ok = true;
  try {
    new RegExp(textExtractRegex(s));
  } catch {
    ok = false;
  }
  check(`合法正则: ${s}`, ok, true);
}

console.log(`${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);

#!/usr/bin/env node
/**
 * 秘密扫描（CI 护栏）：防止真实凭据再次进仓库
 *  - 扫描已跟踪文件里的高危模式
 *  - 扫描 git 历史提交里的高危模式
 * 用法：node tools/secret-scan.cjs        （命中则 exit 1）
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

// 高危模式：按「足够特异」的标准，避免误报
const RULES = [
  { name: 'Telegram Bot Token', re: /\b\d{8,12}:[A-Za-z0-9_-]{33,45}\b/g },
  { name: 'GitHub Token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { name: 'OpenAI-style API Key', re: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { name: 'GLaDOS 会话 Cookie', re: /gld:sess=[A-Za-z0-9]{30,}/g },
  { name: '私有 Key 块', re: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
];

// 明确的测试假值（我们自己在测试里写的假凭据），不算真实凭据
const ALLOW_VALUES = [
  'gld:sess=abc123def456ghi789jkl012mno345pqr',
  '123456789:TEST_FAKE_TOKEN_FOR_ENCRYPTION_TEST',
];

// 这些文件天然含有示例/占位，忽略其中的命中
const ALLOW = [
  /tools\/secret-scan\.cjs$/,
  /tools\/copy-audit\.cjs$/,
  /docs\/SECURITY\.md$/,
  /server\/test\/secrets\.test\.js$/,
];

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    if (f === '.git' || f === 'node_modules' || f === 'wiki' || f === 'dist') continue;
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(js|jsx|cjs|mjs|ts|tsx|md|json|yml|yaml|env|txt|css|html)$/.test(f)) out.push(p);
  }
  return out;
}

const findings = [];
const files = walk(ROOT);
for (const f of files) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  if (ALLOW.some((re) => re.test(rel))) continue;
  let text;
  try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
  for (const rule of RULES) {
    const hits = (text.match(rule.re) || []).filter((h) => !ALLOW_VALUES.some((a) => h.startsWith(a)));
    if (hits.length) findings.push({ where: rel, rule: rule.name, sample: hits[0].slice(0, 8) + '…' });
  }
}

// git 历史（含已删除文件）
let history = '';
try {
  history = execSync('git log --all -p --no-color', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch { /* 无历史则跳过 */ }
for (const rule of RULES) {
  const hits = (history.match(rule.re) || []).filter((h) => !ALLOW_VALUES.some((a) => h.startsWith(a)));
  if (hits.length) {
    const uniq = [...new Set(hits)];
    findings.push({ where: 'git 历史', rule: rule.name, sample: `${uniq.length} 处（含 ${uniq[0].slice(0, 6)}…）` });
  }
}

if (!findings.length) {
  console.log('✓ 秘密扫描通过：工作区与 git 历史均未发现真实凭据');
  process.exit(0);
}
console.log(`发现 ${findings.length} 处疑似真实凭据：`);
for (const f of findings) console.log(`  ✗ [${f.rule}] ${f.where} :: ${f.sample}`);
console.log('\n处理：1) 立刻到签发方（BotFather / 控制台）轮换该凭据；2) 用 git filter-repo 清理历史；3) 提交本文件已用假值替换。');
process.exit(1);

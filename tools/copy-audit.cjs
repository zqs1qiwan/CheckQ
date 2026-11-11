#!/usr/bin/env node
/**
 * 文案治理审计（v0.4.3 金标准）
 * 规则：
 *   1) 面板里不常驻「说明性文字」——说明应放在 label 的 title（悬停）或在触发条件出现时才提示；
 *   2) Modal 不带说明性副标题（subtitle 只允许动态信息，如「13 个节点 · 2 个变量」）；
 *   3) 不留 login-hint 这类"给开发者/使用者讲道理"的段落；
 *   4) 纯状态反馈（空态、结果、错误）不算说明，允许存在。
 *
 * 用法：node tools/copy-audit.cjs        （有违规时 exit 1）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIRS = [path.join(ROOT, 'web/src/components'), path.join(ROOT, 'web/src')];

const EXPLAIN_WORDS = ['说明', '建议', '例如', '例：', '请先', '可以用', '可以在这里', '也就是说', '注意：', '提示：', '建议使用'];
const files = new Set();
for (const d of DIRS) {
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) {
    if (/\.jsx$/.test(f)) files.add(path.join(d, f));
  }
}

const findings = [];
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const lines = src.split(/\r?\n/);

  lines.forEach((line, i) => {
    const n = i + 1;
    // 1) 说明性 hint
    if (/className="hint"/.test(line)) {
      const text = line.replace(/<[^>]*>/g, '');
      const isEmptyState = /暂无|还没有|没有可推送/.test(text);
      if (!isEmptyState && EXPLAIN_WORDS.some((w) => text.includes(w))) {
        findings.push({ file: rel, line: n, rule: '常驻说明性文字', text: text.trim().slice(0, 60) });
      }
      if (!isEmptyState && text.trim().length > 46) {
        findings.push({ file: rel, line: n, rule: 'hint 文案过长', text: text.trim().slice(0, 60) });
      }
    }
    // 2) Modal 副标题（字符串字面量）
    const sub = line.match(/subtitle="([^"]+)"/);
    if (sub && sub[1].length > 12) {
      findings.push({ file: rel, line: n, rule: 'Modal 说明性副标题', text: sub[1].slice(0, 60) });
    }
    // 3) login-hint
    if (/login-hint/.test(line)) {
      findings.push({ file: rel, line: n, rule: 'login-hint 常驻说明', text: line.trim().slice(0, 60) });
    }
  });

  // 4) 超长中文句子（>45 字）视为说明性文案
  const longText = src.match(/[\u4e00-\u9fa5，。；、：]{45,}/g);
  for (const t of longText || []) {
    const ln = src.slice(0, src.indexOf(t)).split(/\r?\n/).length;
    findings.push({ file: rel, line: ln, rule: '超长中文句子', text: t.slice(0, 60) });
  }
}

if (!findings.length) {
  console.log('✓ 文案审计通过：无常驻说明性文字、无说明性副标题、无超长句子');
  process.exit(0);
}
console.log(`发现 ${findings.length} 处需处理：`);
for (const f of findings) console.log(`  ${f.file}:${f.line}  [${f.rule}] ${f.text}`);
process.exit(1);

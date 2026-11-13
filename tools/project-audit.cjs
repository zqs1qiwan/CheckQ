#!/usr/bin/env node
/**
 * 项目一致性护栏（框架自检，零依赖）
 *
 * 检查「文档写的」与「代码里有的」是否一致，防止交互改版后文档/组件悄悄失联：
 *   1) 所有相对 import 能解析到真实文件
 *   2) 文档里的相对 .md 链接存在
 *   3) wiki 页面清单的每个来源都存在（tools/build-wiki.cjs）
 *   4) docs/API.md 的端点在 server/src/api.js 里有对应路由
 *   5) MCP 文档里的工具名在 mcp/checkq-mcp.cjs 里存在
 *   6) 交互定版后的「陈旧说法」不再出现在公开文档里
 *   7) 仓库内容政策：私有资产 / 本地测试样例不出现在跟踪文件里
 *   8) 关键 CSS 契约存在（弹窗显式居中、窄屏顶栏单行、重试样式）
 *
 * 用法：node tools/project-audit.cjs   （命中即 exit 1）
 * 全程只读取仓库内文件与 git 索引，不上传、不写入任何实例数据。
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
const read = (p) => fs.readFileSync(p, 'utf8');
const findings = [];
const notes = [];
const bad = (where, msg) => findings.push(`[${where}] ${msg}`);
const good = (msg) => notes.push(msg);

let tracked = [];
try { tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').map((s) => s.trim()).filter(Boolean); }
catch { /* 非 git 环境跳过索引类检查 */ }

/* ---------- 1) 相对 import 解析 ---------- */
const srcFiles = tracked.filter((f) => /\.(js|jsx|cjs|mjs)$/.test(f) && !/^wiki\//.test(f));
let imports = 0;
for (const f of srcFiles) {
  const abs = path.join(ROOT, f);
  if (!fs.existsSync(abs)) continue;
  const text = read(abs);
  const re = /(?:import\s+(?:[\s\S]*?\s+from\s+)?|export\s+[\s\S]*?\s+from\s+|require\()\s*['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(text))) {
    const spec = m[1];
    imports++;
    const base = path.resolve(path.dirname(abs), spec);
    const candidates = [base, base + '.js', base + '.jsx', base + '.cjs', base + '.mjs',
      path.join(base, 'index.js'), path.join(base, 'index.jsx')];
    if (!candidates.some((c) => fs.existsSync(c))) bad(f, `相对 import 找不到目标: ${spec}`);
  }
}
good(`相对 import 检查：${srcFiles.length} 个源文件 / ${imports} 处引用`);

/* ---------- 2) 文档相对链接 ---------- */
const mdFiles = tracked.filter((f) => /\.md$/.test(f) && !/^wiki\//.test(f));
let links = 0;
for (const f of mdFiles) {
  const abs = path.join(ROOT, f);
  if (!fs.existsSync(abs)) continue;
  const text = read(abs);
  const re = /\[[^\]]+\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(text))) {
    const href = m[1].split('#')[0].trim();
    if (!href || /^(https?:|mailto:|\/)/.test(href)) continue;
    if (/[{}%\s]/.test(href)) continue; // 正则/格式串恰好长成链接，不是文档链接
    links++;
    let href2 = href;
    try { href2 = decodeURIComponent(href); } catch { /* 原样 */ }
    const target = path.resolve(path.dirname(abs), href2);
    if (!fs.existsSync(target)) bad(f, `文档链接失效: ${href}`);
  }
}
good(`文档相对链接检查：${mdFiles.length} 个文档 / ${links} 条链接`);

/* ---------- 3) wiki 页面来源 ---------- */
const wiki = read(path.join(ROOT, 'tools/build-wiki.cjs'));
const pageDefs = [...wiki.matchAll(/\{\s*file:\s*'([^']+\.md)'[^}]*\}/g)];
const srcBlock = wiki.slice(wiki.indexOf('const SOURCES = {'), wiki.indexOf('// ---------- 静态资源'));
const sourceKeys = new Set([...srcBlock.matchAll(/^\s*'([a-z-]+\.md)'\s*:/gm)].map((m) => m[1]));
for (const m of pageDefs) {
  const file = m[1];
  const srcMatch = m[0].match(/src:\s*'([^']+)'/);
  if (srcMatch) {
    if (!fs.existsSync(path.join(ROOT, 'docs', srcMatch[1]))) bad('wiki', `页面 ${file} 的来源 docs/${srcMatch[1]} 不存在`);
  } else if (!/auto:/.test(m[0]) && !sourceKeys.has(file)) {
    bad('wiki', `页面 ${file} 缺少 SOURCES 正文`);
  }
}
good(`wiki 页面清单检查：${pageDefs.length} 页 / SOURCES ${sourceKeys.size} 篇`);

// wiki 是终端用户文档：不得包含任何内部开发内容 / 内部文档引用
const wikiBody = wiki.slice(wiki.indexOf('const SOURCES = {'), wiki.indexOf('// ---------- 静态资源'));
const INTERNAL_TERMS = ['Modern Web Guidance', '设计令牌', 'UI/UX 规范', '设计原则', 'PRD', 'ROADMAP', 'GAP-ANALYSIS', '项目开发标准'];
for (const term of INTERNAL_TERMS) {
  if (wikiBody.includes(term)) bad('wiki', `用户文档包含内部内容「${term}」`);
}
for (const f of tracked.filter((x) => /^wiki\/.*\.html$/.test(x))) {
  let text = '';
  try { text = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
  for (const term of INTERNAL_TERMS) {
    if (text.includes(term)) bad(f, `生成的 wiki 页面包含内部内容「${term}」`);
  }
}
good('wiki 内容检查：仅用户视角内容（使用 / 排障 / 更新日志）');

/* ---------- 4) API 端点 ---------- */
const apiDoc = read(path.join(ROOT, 'docs/API.md'));
const apiSrc = read(path.join(ROOT, 'server/src/api.js')) + read(path.join(ROOT, 'server/src/openapi.js'));
const routes = [...apiSrc.matchAll(/app\.(?:get|post|put|delete|patch)\(\s*['"`](\/api\/[^'"`$]+)['"`]/g)].map((m) => m[1]);
const docRoutes = [...new Set([...apiDoc.matchAll(/\/(api\/[A-Za-z0-9_/:?&=.-]+)/g)].map((m) => '/' + m[1].split(/[?\s|)]/)[0]))];
let matched = 0;
for (const r of docRoutes) {
  const bare = r.replace(/:id/g, ':id').replace(/\/$/, '');
  const hit = routes.some((x) => x === bare || x.replace(/:([A-Za-z]+)/g, ':id') === bare.replace(/:([A-Za-z]+)/g, ':id'));
  if (hit) matched++;
  else bad('API 文档', `文档里的端点在代码中找不到: ${r}`);
}
good(`API 端点对照：文档 ${docRoutes.length} 条 / 命中 ${matched} 条`);

/* ---------- 5) MCP 工具 ---------- */
const mcpDoc = path.join(ROOT, 'docs/MCP.md');
const mcpSrc = path.join(ROOT, 'mcp/checkq-mcp.cjs');
if (fs.existsSync(mcpDoc) && fs.existsSync(mcpSrc)) {
  const doc = read(mcpDoc);
  const src = read(mcpSrc);
  const names = new Set();
  for (const line of doc.split(/\r?\n/)) {
    if (/后续|将在|待补|规划|未实现|⬜|不在|暂不|刻意不提供/.test(line)) continue;
    // 表格行：| tool_name | 参数 | 说明 |
    const cells = line.split('|').map((s) => s.trim());
    if (cells.length >= 4 && /^[a-z][a-z0-9_]{2,}$/.test(cells[1])) names.add(cells[1]);
    for (const m of line.matchAll(/`([a-z][a-z0-9_]{3,})`/g)) {
      const n = m[1];
      if (/^(health|whoami|stats|notifications_|flows_|flow_|templates_|template_|runs_|run_|import_)/.test(n)) names.add(n);
    }
  }
  let ok = 0;
  for (const n of names) if (src.includes(`'${n}'`) || src.includes(`"${n}"`)) ok++;
  else bad('MCP 文档', `工具 ${n} 在 mcp/checkq-mcp.cjs 中不存在`);
  good(`MCP 工具对照：文档 ${names.size} 个 / 命中 ${ok} 个`);
}

/* ---------- 6) 交互定版后禁止出现的陈旧说法 ---------- */
const STALE = [
  { re: /模板更新后已有任务\*\*不自动变\*\*|检查模板更新|手动应用|版本与同步/, why: '模板联动已定版为「自动跟随」，不应再描述手动同步' },
  { re: /role="dialog"\s+aria-modal|禁止各页面自建\s*`modal-mask`|body 固定.*滚动/, why: '弹窗已改为原生 <dialog>，不再手写 role/遮罩/body 锁' },
  { re: /任务\s*···\s*→\s*「(通知渠道|存为模板|调试运行)」/, why: '这些入口已移到编辑器「更多」，任务行 ··· 只剩 4 项' },
  { re: /打开弹窗会锁定背景滚动/, why: '背景滚动改由 ::backdrop / overscroll-behavior 收敛' },
  { re: /失败即结束|失败后就不动了/, why: '任务级退避重试已上线，跑满次数才判定失败' },
  { re: /19\/19|18 项任务|71 节点|16 个真实任务|39 个任务|13 模板真实样本|真实迁移实测记录|现网.{0,6}实例|路由器 18888 实例|某签到应用/, why: '公开文档不得出现实例/本地测试样例或业务专属信息' },
];
for (const f of [...mdFiles, ...tracked.filter((x) => x === 'README.md')]) {
  const abs = path.join(ROOT, f);
  if (!fs.existsSync(abs)) continue;
  const text = read(abs);
  for (const s of STALE) {
    if (s.re.test(text)) bad(f, `陈旧说法: ${s.why}`);
  }
}

/* ---------- 7) 内容政策：私有资产与本地测试样例 ---------- */
const PRIVATE_PATH = [/(^|\/)AGENTS\.md$/i, /(^|\/)docs\/agent-notes\//i,
  /(^|\/)docs\/.+\.(flow|template)\.json$/i,
  /(^|\/)tools\/wb-/i, /(^|\/)tools\/private-terms\.local\.txt$/i, /(^|\/)data\//i, /(^|\/)server\/public\//i];
for (const f of tracked) if (PRIVATE_PATH.some((re) => re.test(f))) bad(f, '私有资产不应进仓库');
const SAMPLE_SECRET = [/(?:koa|gld|sess|session):\s*[A-Za-z0-9_-]{8,}/i, /Bearer\s+[A-Za-z0-9._-]{12,}/];
for (const f of mdFiles) {
  const text = read(path.join(ROOT, f));
  for (const re of SAMPLE_SECRET) if (re.test(text)) bad(f, `出现疑似真实凭据的示例: ${re}`);
}
good(`内容政策检查：${tracked.length} 个跟踪文件`);

/* ---------- 8) 关键 CSS 契约 ---------- */
const css = read(path.join(ROOT, 'web/src/styles.css'));
const CSS_RULES = [
  [/dialog\.modal\[open\][\s\S]{0,240}position:\s*fixed;?\s*inset:\s*0;?\s*margin:\s*auto/, '弹窗显式居中（fixed + inset:0 + margin:auto）'],
  [/dialog\.modal:not\(\[open\]\)\s*\{\s*display:\s*none/, '关闭态 dialog 不显示'],
  [/\.topbar:not\(\.editor-topbar\)\s*\{[^}]*flex-wrap:\s*nowrap/, '窄屏顶栏单行'],
  [/\.mobile-only/, '移动端动作收进菜单'],
  [/\.attempt-pill/, '重试尝试条样式'],
];
for (const [re, label] of CSS_RULES) if (!re.test(css)) bad('CSS', `缺少契约: ${label}`);
else good(`CSS 契约: ${label}`);

/* ---------- 汇总 ---------- */
console.log('===== 项目一致性检查 =====');
notes.forEach((n) => console.log('  ✓ ' + n));
if (findings.length) {
  console.log(`\n发现 ${findings.length} 个问题：`);
  findings.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log('\n✓ 全部通过：组件/链接/端点/文档/CSS 契约一致，且无私有资产入库');
process.exit(0);

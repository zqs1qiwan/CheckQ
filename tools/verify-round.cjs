#!/usr/bin/env node
/**
 * 一轮全量验收（本地/测试实例）
 *
 * 顺序：前端构建 → 服务端全量单测 → 文案审计 → 秘密扫描 → 项目一致性
 *      → UI 冒烟（7 视口 × 明暗）→ UI 交互巡检（9 视口 × 明暗）
 *
 * 用法：node tools/verify-round.cjs [baseUrl]
 * 前提：目标实例已启动（默认 http://localhost:19998）。
 * 只读：不会修改任何任务/设置。
 */
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BASE = process.argv[2] || 'http://localhost:19998';
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const NODE = process.execPath;

function run(label, cmd, args, opts = {}) {
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { cwd: opts.cwd || ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' && cmd.endsWith('.cmd') });
  const out = (r.stdout || '') + (r.stderr || '');
  const ms = Date.now() - t0;
  return { label, ok: r.status === 0, status: r.status, out, ms };
}

const results = [];
const step = (label, cmd, args, opts) => {
  process.stdout.write(`\n==> ${label}\n`);
  const r = run(label, cmd, args, opts);
  results.push(r);
  const tail = r.out.trim().split(/\r?\n/).slice(-4).join('\n');
  console.log(tail);
  console.log(`   ${r.ok ? 'PASS' : 'FAIL'} (${(r.ms / 1000).toFixed(1)}s)`);
  return r;
};

const build = step('前端构建', NPM, ['run', 'build'], { cwd: path.join(ROOT, 'web') });
step('服务端全量单测', NODE, ['--test', 'test/*.test.js'], { cwd: path.join(ROOT, 'server') });
step('文案审计', NODE, ['tools/copy-audit.cjs']);
step('秘密扫描', NODE, ['tools/secret-scan.cjs']);
step('项目一致性', NODE, ['tools/project-audit.cjs']);
step('UI 冒烟', NODE, ['tools/ui-smoke.cjs', BASE]);
step('UI 交互巡检', NODE, ['tools/ui-interaction-audit.cjs', BASE]);

console.log('\n===== 本轮汇总 =====');
let bad = 0;
for (const r of results) {
  if (!r.ok) bad++;
  console.log(`  ${r.ok ? '✓' : '✗'} ${r.label}  (${(r.ms / 1000).toFixed(1)}s)`);
}
const smoke = results.find((r) => r.label === 'UI 冒烟');
const audit = results.find((r) => r.label === 'UI 交互巡检');
const server = results.find((r) => r.label === '服务端全量单测');
const sm = smoke && smoke.out.match(/合计：(\d+) 项通过 \/ (\d+) 个问题/);
const am = audit && audit.out.match(/=== FINDINGS \((\d+)\)/);
const as = server && [...server.out.matchAll(/^(\d+)\/(\d+) passed/gm)].reduce((a, x) => a + Number(x[1]), 0);
console.log(`\n  断言：${as ?? '?'}  |  UI 冒烟：${sm ? `${sm[1]} 通过 / ${sm[2]} 问题` : '?'}  |  交互巡检：${am ? `${am[1]} findings` : '?'}`);
console.log(bad ? `\n✗ 本轮有 ${bad} 项失败` : '\n✓ 本轮全绿');
process.exit(bad ? 1 : 0);

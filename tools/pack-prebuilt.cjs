#!/usr/bin/env node
/**
 * 打包「预构建产物」：web/dist + server/src → 一个 tar.gz
 * 配合 tools/deploy-prebuilt.sh 使用（低内存设备上不跑 docker build）。
 *
 * 用法：node tools/pack-prebuilt.cjs [输出路径]
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(process.env.TEMP || '.', 'checkq-prebuilt.tgz');
const STAGE = path.join(ROOT, '.prebuilt');

fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(path.join(STAGE, 'web'), { recursive: true });
fs.mkdirSync(path.join(STAGE, 'server'), { recursive: true });

// 前端产物（必须先 npm run build）
const dist = path.join(ROOT, 'web', 'dist');
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('找不到 web/dist/index.html —— 先在 web/ 下执行 npm run build');
  process.exit(1);
}
fs.cpSync(dist, path.join(STAGE, 'web'), { recursive: true });

// 服务端代码
fs.cpSync(path.join(ROOT, 'server', 'src'), path.join(STAGE, 'server', 'src'), { recursive: true });

fs.rmSync(OUT, { force: true });
execSync(`tar -czf "${OUT}" -C "${STAGE}" web server`, { stdio: 'inherit' });
fs.rmSync(STAGE, { recursive: true, force: true });
console.log('已打包 →', OUT, (fs.statSync(OUT).size / 1024 / 1024).toFixed(1) + ' MB');

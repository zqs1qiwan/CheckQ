#!/usr/bin/env node
/**
 * 生成 GitHub Pages 文档站（wiki）
 *  - 输入：docs/*.md（仓库里的现有文档）
 *  - 输出：wiki/（纯静态，无第三方依赖，可直接被 Pages 托管）
 *  - 用法：node tools/build-wiki.cjs
 *  - CI：.github/workflows/pages.yml 每次 push 到 main 自动构建并发布
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'wiki');
const DOCS = path.join(ROOT, 'docs');
const REPO = 'zqs1qiwan/CheckQ';
const SITE = `https://${REPO}.github.io/${REPO.split('/')[1]}/`;

// ---------- 极简 Markdown → HTML（够用即可） ----------
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(text, base) {
  let out = escapeHtml(text);
  // 行内代码
  out = out.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  // 链接（相对路径转站内链接）
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    if (href.startsWith('http')) return `<a href="${href}" target="_blank" rel="noreferrer">${label}</a>`;
    const clean = href.replace(/^\.\//, '');
    return `<a href="${clean}">${label}</a>`;
  });
  // 粗体 / 斜体
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|\s)\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return out;
}

function mdToHtml(md) {
  const lines = md.split(/\r?\n/);
  const html = [];
  let inCode = false, codeLang = '', codeBuf = [];
  let inTable = false, tableBuf = [];
  let listType = null, listBuf = [];

  const flushList = () => {
    if (!listType) return;
    const tag = listType === 'ul' ? 'ul' : 'ol';
    html.push(`<${tag}>` + listBuf.map((i) => `<li>${inline(i, SITE)}</li>`).join('') + `</${tag}>`);
    listType = null; listBuf = [];
  };
  const flushTable = () => {
    if (!inTable) return;
    const rows = tableBuf.filter((r) => r.trim());
    if (!rows.length) { inTable = false; tableBuf = []; return; }
    const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const head = cells(rows[0]);
    const body = rows.slice(2).map(cells);
    html.push('<div class="table-wrap"><table><thead><tr>' + head.map((h) => `<th>${inline(h, SITE)}</th>`).join('') + '</tr></thead><tbody>'
      + body.map((r) => '<tr>' + r.map((c) => `<td>${inline(c, SITE)}</td>`).join('') + '</tr>').join('')
      + '</tbody></table></div>');
    inTable = false; tableBuf = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      if (inCode) {
        html.push(`<pre class="code"><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
        inCode = false; codeBuf = [];
      } else {
        flushList(); flushTable();
        inCode = true; codeLang = line.slice(3).trim(); codeBuf = [];
      }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }

    if (/^\|/.test(line)) {
      flushList();
      if (!inTable) { inTable = true; tableBuf = []; }
      tableBuf.push(line);
      continue;
    }
    flushTable();

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushList();
      const level = h[1].length;
      const id = h[2].trim().toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '');
      html.push(`<h${level} id="${id}">${inline(h[2], SITE)}</h${level}>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushList();
      html.push(`<blockquote>${inline(line.replace(/^>\s?/, ''), SITE)}</blockquote>`);
      continue;
    }
    if (/^---+$/.test(line)) { flushList(); html.push('<hr />'); continue; }

    const li = line.match(/^\s*[-*]\s+(.*)$/);
    const oli = line.match(/^\s*\d+\.\s+(.*)$/);
    if (li || oli) {
      const want = li ? 'ul' : 'ol';
      if (listType && listType !== want) flushList();
      listType = want;
      listBuf.push((li || oli)[1]);
      continue;
    }
    if (!line.trim()) { flushList(); continue; }
    flushList();
    html.push(`<p>${inline(line, SITE)}</p>`);
  }
  flushList(); flushTable();
  if (inCode) html.push(`<pre class="code"><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
  return html.join('\n');
}

// ---------- 页面集合 ----------
const PAGES = [
  { file: 'index.md', title: '概览', desc: 'CheckQ 是什么、怎么用、去哪看' },
  { file: 'quickstart.md', title: '快速开始', desc: '3 步跑通第一个签到任务' },
  { file: 'tasks.md', title: '任务与流程', desc: '节点类型、变量、调度、模板' },
  { file: 'logs.md', title: '日志与通知', desc: '干净日志、连续日志流、12 个通知渠道' },
  { file: 'security.md', title: '账号与安全', desc: '多用户、2FA、会话、凭据加密、IP 名单' },
  { file: 'api.md', title: 'API 与 MCP', desc: '开放 API、API Key 权限、外部 Agent 接入' },
  { file: 'glados.md', title: 'GLaDOS 签到', desc: 'challenge 校验版流程与换 cookie 指引' },
  { file: 'workbuddy.md', title: 'WorkBuddy 签到', desc: '签到 + 成长中心 + 任务自动完成' },
  { file: 'faq.md', title: '常见问题', desc: '排障速查' },
  // —— 以下页面直接由仓库 docs/ 自动生成，保证与仓库同步 ——
  { file: 'reference-api.md', title: 'API 参考', desc: '全部端点（自动同步）', src: 'API.md' },
  { file: 'reference-mcp.md', title: 'MCP 工具', desc: '17 个工具与接入（自动同步）', src: 'MCP.md' },
  { file: 'reference-security.md', title: '安全说明', desc: '威胁与防护全表（自动同步）', src: 'SECURITY.md' },
  { file: 'reference-glados.md', title: 'GLaDOS 详解', desc: 'challenge 机制与排障（自动同步）', src: 'GLaDOS.md' },
  { file: 'reference-workbuddy.md', title: 'WorkBuddy 详解', desc: '接口与任务清单（自动同步）', src: 'WORKBUDDY.md' },
  { file: 'reference-agent.md', title: 'Agent 接入指南', desc: '给外部 Agent 什么（自动同步）', src: 'AGENT-ACCESS.md' },
  { file: 'reference-roadmap.md', title: '路线图', desc: '版本计划（自动同步）', src: 'ROADMAP.md' },
];

// 源文档 → 站点页面（从 docs/*.md 摘取/整合）
const SOURCES = {
  'index.md': { title: 'CheckQ 概览', body: `# CheckQ 概览

CheckQ 是一个可视化 HTTP 自动化流程引擎：把「每天要做的签到」做成可编辑的流程，支持定时调度、失败重试、通知推送与外部 Agent 接入。

## 能做什么

- **任务**：可视化画布编排 HTTP / 条件 / 赋值 / 提取 / 延迟 / 日志 / 通知 / 脚本 / 遍历 节点
- **调度**：每个任务独立 cron + 时区 + 抖动，支持手动运行与「调试运行」
- **日志**：默认只输出人话日志（qinglong/qiandao 风格），可开调试模式看每步请求/响应
- **通知**：站内通知、Webhook、Bark、Telegram、Server酱、PushPlus、钉钉、企业微信、飞书、Gotify、ntfy、邮件 SMTP 共 12 种
- **账号**：多用户 + 角色、两步验证（TOTP）、会话可吊销、API Key 作用域与回收日期、IP 允许名单/黑名单
- **接入**：REST 开放 API（OpenAPI 3.1）+ MCP（17 个工具），外部 Agent 可直接操作签到

## 快速入口

| 我想… | 去哪 |
|---|---|
| 新建第一个签到 | [快速开始](/quickstart.html) |
| 了解流程与节点 | [任务与流程](/tasks.html) |
| 看日志 / 配通知 | [日志与通知](/logs.html) |
| 给外部程序开接口 | [API 与 MCP](/api.html) |
| 加账号 / 开两步验证 | [账号与安全](/security.html) |
| 模板市场、部署、备份 | 见仓库 [README](https://github.com/${REPO}) |

## 部署形态

单容器（Docker），数据落在 \`data/\`（flows/runs/templates/meta/notifications），JSON 存储 + 原子写 + 立即 flush。
` },
  'quickstart.md': { title: '快速开始', body: `# 快速开始

## 1. 建任务

顶栏「+ 新建任务」→ 画布自带「HTTP 请求 → 日志」两个节点 → 点 HTTP 节点填 URL 与请求头。

## 2. 跑一次

顶栏「运行」。成功时日志只有一行人话；失败时点日志步骤看响应体。

## 3. 定调度

顶栏「调度」→ 填 cron（如 \`13 0 * * *\` = 每天 00:13）→ 启用。

## 4. 收通知

任务 ··· →「通知渠道」→ 选类型（站内通知零依赖）→ 填地址 →「测试发送」。

## 5. 自动化（可选）

- **调试运行**：任务 ··· →「调试运行」记录每步请求/响应并展开过程窗口
- **连续日志流**：任务行「日志」→ 多次运行滚动在一起，可上翻历史、导出
- **外部 Agent**：设置 → API 密钥 → 生成（只读 + 可运行），配合 [API 与 MCP](/api.html)
` },
  'tasks.md': { title: '任务与流程', body: `# 任务与流程

## 节点类型

| 类型 | 用途 |
|---|---|
| HTTP 请求 | 方法/URL/头/体/断言/超时/后端(fetch·curl)/编码/代理/重试 |
| 条件判断 | jexl 表达式分流 |
| 赋值 | 变量或表达式求值 |
| 提取 | 正则 / JSON 路径 / 响应头 / Set-Cookie |
| 延迟 / 随机延迟 | 固定或区间等待（避开整点风控） |
| 日志 | 输出人话日志（默认唯一可见的日志） |
| 通知 | 流程内自定义推送 |
| 脚本 | JS 沙箱（vars/last/steps 只读，1s 超时） |
| 遍历 | 数组逐项循环（上限 50 轮） |

## 变量

- 流程变量在编辑器「流程变量」面板维护；敏感值（cookie/token/密码）**落盘加密**，API 返回明文以便编辑
- 模板语法：\`{{var}}\`、\`{{x|urlencode}}\`、\`{{x|num}}\`、\`{{x|sha256}}\`、\`{{now:%Y-%m-%d}}\`
- 表达式：\`=last.json.code == 0\`（\`vars.xxx\` 取变量）

## 调度

- cron + 时区 + 抖动（0-N 分钟）；空 cron = 只手动运行
- 调度弹窗里可随时启用/停用

## 模板

- 任务 ··· →「存为模板」；模板携带节点/连线/变量/日志/通知
- 从模板创建任务时可覆盖变量（如各自的 cookie）
- 模板导出自动脱敏敏感默认值
` },
  'logs.md': { title: '日志与通知', body: `# 日志与通知

## 干净日志（默认）

记录范围默认「仅 log 节点」：只有你写的日志节点出现，失败步骤始终保留。流程里没有日志节点时自动退回全步骤，避免空白。

## 调试模式

- 任务级：日志配置里勾「调试模式」→ 每次运行都记录请求/响应
- 单次级：编辑器日志坞勾「调试」→ 仅当次记录

## 连续日志流

任务行「日志」→ 多次运行拍平成一条时间线，可「加载更早的记录」，每组可展开调试或导出 .log。

## 通知渠道（12 种）

站内通知 / Webhook / Bark / Telegram / Server酱 / PushPlus / 钉钉（加签）/ 企业微信 / 飞书（加签）/ Gotify / ntfy / 邮件 SMTP。

- 成功/失败可分别开启
- 模板支持 {{flow.name}} {{status}} {{message}} {{duration}} {{time}}
- 每日总推送：设置 → 通知与推送，勾选「推送单位」（任务），可定时推送或立即推送
` },
  'security.md': { title: '账号与安全', body: `# 账号与安全

## 账号

- 多用户 + 角色（admin / operator / viewer 只读）
- 用户名 + 密码登录；密码 scrypt 加盐哈希，明文不落盘
- 修改用户名/密码：设置 → 账号安全（改用户名需当前密码，改完强制重登）

## 两步验证

TOTP（Google Authenticator / Authy / Aegis），启用后给 10 个一次性恢复码（只显示一次，服务端只存摘要）。

## 会话与 API Key

- 会话：httpOnly + SameSite=Strict，7 天绝对 + 24h 空闲，可查看与吊销
- API Key：可命名、按作用域发放（只读/可运行/可修改）、可设回收日期、到期自动回收
- IP 名单：每把 Key 可设允许名单（CIDR）；全局黑名单同时拦登录与 API Key

## 凭据存储

cookie / token / SMTP 密码等以 AES-256-GCM 加密落盘；密钥在 \`data/.secret\`（600）或环境变量 \`CHECKQ_SECRET\`。备份默认脱敏，完整备份需再输一次密码。

## Web 加固

CSP / X-Frame-Options / nosniff / Referrer-Policy，写操作校验 Origin 同源（CSRF），登录按 IP 与账号双层限流。
` },
  'api.md': { title: 'API 与 MCP', body: `# API 与 MCP

## 基础 API

- \`GET /api\` —— 接口索引（免登录）
- \`GET /api/openapi.json\` —— OpenAPI 3.1 机器可读描述

## 认证

\`x-api-key: <key>\`（推荐，可按作用域发放）或登录会话 Cookie。

## 常用端点

| 需求 | 方法 | 路径 |
|---|---|---|
| 列任务 | GET | /api/flows |
| 任务详情 | GET | /api/flows/:id |
| 跑一次 | POST | /api/flows/:id/run |
| 连续日志流 | GET | /api/flows/:id/logs?limit=200 |
| 换变量 | PUT | /api/flows/:id |
| 历史运行 | GET | /api/runs?flowId=&limit=30 |
| 模板 | GET | /api/templates |
| 运维统计 | GET | /api/system/stats |

## MCP

\`mcp/checkq-mcp.cjs\`（stdio，零依赖）暴露 17 个工具：health、whoami、stats、notifications_list、flows_list、flow_get、flow_run、flow_logs、flow_update_vars、flow_update、flow_toggle、flow_create、flow_notify_test、templates_list、template_get、runs_list、run_get。

配置：

\`\`\`json
{ "mcpServers": { "checkq": { "command": "node",
  "args": ["/path/CheckQ/mcp/checkq-mcp.cjs"],
  "env": { "CHECKQ_URL": "http://checkq.local:18888", "CHECKQ_API_KEY": "cq_xxx" } } } }
\`\`\`
` },
  'glados.md': { title: 'GLaDOS 签到', body: `# GLaDOS 签到

## 原理

服务端自 2026-11-04 起强制 challenge 校验：先取 nonce，等 ≥2.5s，用 \`proof=SHA256(nonce+".glados-observe-v1")\` 提交，缺 challenge 只给 Base 1 分。

## 模板

首页「模板」区 → GLaDOS 每日签到（challenge 校验）→ 「+ 创建任务」→ 填 cookie 与 ua。

## 验证

- 今日已签：日志显示 \`Checkin! Got N Points\` 或 \`Today's observation logged…\`
- 次日 00:13 cron 自动跑；\`/api/user/points\` 的当日 change 应恢复到 7~13

## 排障

| 现象 | 处理 |
|---|---|
| 没有权限（code -2） | 用 curl 复现同请求：curl 也失败 = cookie 失效 |
| device-mismatch（code 4） | ua 与签发 cookie 的浏览器不一致 |
| 仍只加 1 分 | challenge 未通过：检查等待 ≥2.7s 与 proof 计算 |
` },
  'workbuddy.md': { title: 'WorkBuddy 签到', body: `# WorkBuddy 签到

## 两个任务

| 任务 | 内容 | cron |
|---|---|---|
| 每日签到 + 成长中心 | 签到、旅行礼物、连登兑换、盲盒、汇总 | 5 */4 * * * |
| 任务自动完成（全量） | 19 项任务行为事件上报 + 领奖 | 25 6 * * * |

## 积分口径

签到状态接口返回 \`daily_credit=100, today_credit=100, total_credits=900\`：100 是每日签到的固定奖励，900 = 9 天 × 100。任务奖励（+50/+100 积分、+5 能量）走另一套成长值/能量池，不叠加进 \`total_credits\`。

## Token

Token 有效期约 27 天。**不做自动续期**：到期前在任务变量里换新 \`wbToken\`（面板「流程变量」），或管理员/运维用 \`tools/wb-sync-token.cjs\` 手动同步一次。
` },
  'faq.md': { title: '常见问题', body: `# 常见问题

| 现象 | 处理 |
|---|---|
| 找不到入口节点 | 流程成环，所有节点都有入线 |
| HTTP 400 | 不一定是错误，断言通过即可继续；点日志步骤看响应体 |
| 超时 | HTTP 节点超时填秒（30），不是毫秒 |
| 变量未定义 | 日志配置开启变量快照，或看运行记录里的「未定义变量」 |
| 提示太吵 | 设置 → 通知与推送 → 界面提示 → 仅错误 |
| 日志太啰嗦 | 任务 ··· → 日志配置 → 记录范围「仅 log 节点」 |
| 忘记密码 | 管理员重置；或按 \`docs/SECURITY.md\` 的容器命令重置 |
| 忘记两步验证码 | 用恢复码；管理员可在「用户管理」重置 2FA |
| 日志窗口滚动带跑背景 | 已修复：打开弹窗会锁定背景滚动 |
` },
};

const CSS = `
:root { --bg:#0f1115; --panel:#161a20; --panel2:#1c2129; --border:#2a303a; --text:#e8e6e1; --muted:#9aa1ad; --accent:#6b93f0; --ok:#4caf7d; --warn:#d9a441; --code-bg:#11141a; }
html[data-mode='light'] { --bg:#f6f7f9; --panel:#fff; --panel2:#f0f2f5; --border:#d7dae0; --text:#1b1f24; --muted:#5b6472; --accent:#2f6feb; --ok:#1a7f43; --warn:#9a6700; --code-bg:#f6f8fa; }
* { box-sizing: border-box; }
body { margin:0; background: var(--bg); color: var(--text); font: 15px/1.65 -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
a { color: var(--accent); text-decoration: none; } a:hover { text-decoration: underline; }
.wrap { display: flex; min-height: 100vh; }
aside { width: 264px; flex: none; border-right: 1px solid var(--border); background: var(--panel); padding: 22px 16px; position: sticky; top: 0; height: 100vh; overflow-y: auto; }
.brand { display: flex; align-items: center; gap: 9px; font-weight: 700; font-size: 17px; margin-bottom: 4px; }
.brand span { color: var(--accent); }
.brand-sub { color: var(--muted); font-size: 12.5px; margin-bottom: 18px; }
nav a { display:block; padding: 7px 10px; border-radius: 7px; color: var(--text); font-size: 14px; margin-bottom: 2px; }
nav a:hover { background: var(--panel2); text-decoration: none; }
nav a.on { background: var(--panel2); font-weight: 600; }
nav a em { display:block; font-style: normal; color: var(--muted); font-size: 12px; }
main { flex: 1 1 auto; min-width: 0; padding: 34px 42px 80px; max-width: 980px; }
h1 { font-size: 28px; margin: 0 0 6px; } h2 { font-size: 20px; margin: 30px 0 10px; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
h3 { font-size: 16px; margin: 22px 0 8px; } p { margin: 0 0 12px; }
code { background: var(--code-bg); border: 1px solid var(--border); border-radius: 5px; padding: 1px 5px; font-size: 13px; font-family: ui-monospace, Consolas, monospace; }
pre.code { background: var(--code-bg); border: 1px solid var(--border); border-radius: 9px; padding: 13px 15px; overflow-x: auto; font-size: 13px; }
pre.code code { background: none; border: none; padding: 0; }
.table-wrap { overflow-x: auto; margin: 0 0 16px; }
table { border-collapse: collapse; width: 100%; font-size: 13.5px; }
th, td { border: 1px solid var(--border); padding: 7px 10px; text-align: left; vertical-align: top; }
th { background: var(--panel2); font-weight: 600; }
blockquote { margin: 0 0 14px; padding: 8px 14px; border-left: 3px solid var(--accent); background: var(--panel2); border-radius: 0 8px 8px 0; color: var(--muted); }
ul, ol { margin: 0 0 14px; padding-left: 22px; } li { margin: 3px 0; }
hr { border: none; border-top: 1px solid var(--border); margin: 22px 0; }
.foot { color: var(--muted); font-size: 12.5px; margin-top: 30px; padding-top: 14px; border-top: 1px solid var(--border); }
@media (max-width: 860px) { aside { position: static; height: auto; width: 100%; } .wrap { flex-direction: column; } main { padding: 22px 18px 60px; } }
`;

function navHtml(current) {
  return PAGES.map((p) => {
    const file = p.file.replace(/\.md$/, '.html');
    return `<a class="${p.file === current ? 'on' : ''}" href="${file}">${p.title}<em>${p.desc}</em></a>`;
  }).join('\n');
}

function page({ file, title, desc, body }) {
  return `<!doctype html>
<html lang="zh-CN" data-mode="dark">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} · CheckQ 文档</title>
<meta name="description" content="${desc}" />
<link rel="stylesheet" href="./assets/style.css" />
</head>
<body>
<div class="wrap">
  <aside>
    <div class="brand">Check<span>Q</span></div>
    <div class="brand-sub">自动化签到引擎 · 文档</div>
    <nav>
${navHtml(file)}
    </nav>
    <div class="brand-sub" style="margin-top:18px"><a href="https://github.com/${REPO}">GitHub 仓库 →</a></div>
  </aside>
  <main>
${body}
    <div class="foot">CheckQ 文档 · 由 <code>tools/build-wiki.cjs</code> 从 <code>docs/</code> 生成 · <a href="https://github.com/${REPO}/issues">反馈问题</a></div>
  </main>
</div>
</body>
</html>
`;
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'assets', 'style.css'), CSS, 'utf8');

for (const p of PAGES) {
  let title = p.title;
  let desc = p.desc;
  let body = '';
  if (p.src) {
    // 来自仓库 docs/ 的完整文档（自动同步）
    const docFile = path.join(DOCS, p.src);
    if (!fs.existsSync(docFile)) { console.log('MISS doc source:', p.src); continue; }
    const raw = fs.readFileSync(docFile, 'utf8');
    body = mdToHtml(raw);
  } else {
    const src = SOURCES[p.file];
    if (!src) { console.log('MISS source:', p.file); continue; }
    title = src.title;
    body = mdToHtml(src.body);
  }
  const html = page({ file: p.file, title, desc, body });
  fs.writeFileSync(path.join(OUT, p.file.replace(/\.md$/, '.html')), html, 'utf8');
  console.log('generated', p.file);
}

// 404
fs.writeFileSync(path.join(OUT, '404.html'), page({ file: 'index.md', title: '页面不存在', desc: '', body: '<h1>404</h1><p>没有这个页面，<a href="./index.html">回首页</a>。</p>' }), 'utf8');

// noindex（避免与主站重复内容）
fs.writeFileSync(path.join(OUT, 'robots.txt'), 'User-agent: *\nAllow: /\n', 'utf8');
console.log('wiki built →', path.relative(ROOT, OUT));

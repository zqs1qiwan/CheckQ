#!/usr/bin/env node
/**
 * 生成 GitHub Pages 文档站（wiki）
 *  - 只收录**框架/功能性**文档；不含任何具体签到脚本与账号信息（那是模板市场的事）
 *  - 输入：docs/*.md（仓库文档，自动同步）+ 本文件内的上手页
 *  - 输出：wiki/（纯静态，零依赖）
 *  - 用法：node tools/build-wiki.cjs
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'wiki');
const DOCS = path.join(ROOT, 'docs');
const REPO_OWNER = 'zqs1qiwan';
const REPO_NAME = 'checkq';
const SITE = `https://${REPO_OWNER}.github.io/${REPO_NAME}/`;

// ---------- 极简 Markdown → HTML ----------
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    if (href.startsWith('http')) return `<a href="${href}" target="_blank" rel="noreferrer">${label}</a>`;
    return `<a href="${href.replace(/^\.\//, '')}">${label}</a>`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|\s)\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return out;
}

function mdToHtml(md) {
  const lines = md.split(/\r?\n/);
  const html = [];
  let inCode = false, codeBuf = [];
  let inTable = false, tableBuf = [];
  let listType = null, listBuf = [];

  const flushList = () => {
    if (!listType) return;
    const tag = listType === 'ul' ? 'ul' : 'ol';
    html.push(`<${tag}>` + listBuf.map((i) => `<li>${inline(i)}</li>`).join('') + `</${tag}>`);
    listType = null; listBuf = [];
  };
  const flushTable = () => {
    if (!inTable) return;
    const rows = tableBuf.filter((r) => r.trim());
    inTable = false; tableBuf = [];
    if (!rows.length) return;
    const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const head = cells(rows[0]);
    const body = rows.slice(2).map(cells);
    html.push('<div class="table-wrap"><table><thead><tr>' + head.map((h) => `<th>${inline(h)}</th>`).join('') + '</tr></thead><tbody>'
      + body.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('')
      + '</tbody></table></div>');
  };

  for (const line of lines) {
    if (/^```/.test(line)) {
      if (inCode) { html.push(`<pre class="code"><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`); inCode = false; codeBuf = []; }
      else { flushList(); flushTable(); inCode = true; codeBuf = []; }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }
    if (/^\|/.test(line)) { flushList(); if (!inTable) { inTable = true; tableBuf = []; } tableBuf.push(line); continue; }
    flushTable();
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushList();
      const id = h[2].trim().toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '');
      html.push(`<h${h[1].length} id="${id}">${inline(h[2])}</h${h[1].length}>`);
      continue;
    }
    if (/^>\s?/.test(line)) { flushList(); html.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`); continue; }
    if (/^---+$/.test(line)) { flushList(); html.push('<hr />'); continue; }
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    const oli = line.match(/^\s*\d+\.\s+(.*)$/);
    if (li || oli) {
      const want = li ? 'ul' : 'ol';
      if (listType && listType !== want) flushList();
      listType = want; listBuf.push((li || oli)[1]); continue;
    }
    if (!line.trim()) { flushList(); continue; }
    flushList();
    html.push(`<p>${inline(line)}</p>`);
  }
  flushList(); flushTable();
  if (inCode) html.push(`<pre class="code"><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
  return html.join('\n');
}

const plainText = (md) => md
  .replace(/```[\s\S]*?```/g, ' ')
  .replace(/[#>*|`]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// ---------- 页面清单（只讲框架功能，不含具体脚本） ----------
const PAGES = [
  { file: 'index.md', title: '概览', desc: 'CheckQ 是什么、能做什么' },
  { file: 'quickstart.md', title: '快速开始', desc: '3 步跑通第一个任务' },
  { file: 'tasks.md', title: '任务与流程', desc: '节点、变量、调度、重试、模板' },
  { file: 'uiux.md', title: '交互与视觉规范', desc: '入口契约、原生组件、双主题、响应式' },
  { file: 'logs.md', title: '日志与通知', desc: '干净日志、连续日志流、通知渠道' },
  { file: 'security.md', title: '账号与安全', desc: '多用户、2FA、凭据加密、访问控制' },
  { file: 'api.md', title: 'API 与 MCP', desc: '开放 API、API Key、外部 Agent 接入' },
  { file: 'deploy.md', title: '部署与备份', desc: 'Docker、数据目录、备份恢复' },
  { file: 'faq.md', title: '常见问题', desc: '排障速查' },
  { file: 'changelog.md', title: '更新日志', desc: '版本变更（自动生成）', auto: 'changelog' },
  // —— 以下页面由仓库 docs/ 自动同步 ——
  { file: 'reference-api.md', title: 'API 参考', desc: '全部端点', src: 'API.md' },
  { file: 'reference-mcp.md', title: 'MCP 工具', desc: '工具清单与接入', src: 'MCP.md' },
  { file: 'reference-security.md', title: '安全说明', desc: '威胁与防护全表', src: 'SECURITY.md' },
  { file: 'reference-agent.md', title: 'Agent 接入指南', desc: '给外部 Agent 什么', src: 'AGENT-ACCESS.md' },
  { file: 'reference-roadmap.md', title: '路线图', desc: '版本计划', src: 'ROADMAP.md' },
];

const SOURCES = {
  'index.md': `# CheckQ 概览

CheckQ 是一个**可视化 HTTP 自动化流程引擎**（框架 / 平台）：把「每天要做的签到、监控、定时请求」做成可编辑、可复用、可被外部程序驱动的流程。

## 核心能力

| 能力 | 说明 |
|---|---|
| 积木式流程 | HTTP / 条件 / 赋值 / 提取 / 延迟 / 日志 / 通知 / 脚本 / 遍历 节点，拖拽连线即成流程 |
| 点选生成逻辑 | 运行后点响应里的任意值 → 一键生成提取 / 断言 / 关键字 / 通知 节点 |
| 导入 | 浏览器 HAR、cURL 命令、JSON 模板导入，自动生成流程图 |
| 调度 | 每个任务独立 cron + 时区 + 抖动；支持手动运行与「调试运行」；**失败按退避策略自动重试，跑满次数才判定最终失败** |
| 日志 | 默认只输出人话日志，可开调试模式看每步请求与响应；运行记录含逐次尝试与等待时长 |
| 通知 | 12 种渠道：站内通知、Webhook、Bark、Telegram、Server酱、PushPlus、钉钉、企业微信、飞书、Gotify、ntfy、邮件 SMTP |
| 模板 | 调试好的流程存为模板，一份模板派生多份任务；**模板一改，派生任务立刻跟随，零同步操作** |
| 账号安全 | 多用户 + 角色、TOTP 两步验证、会话吊销、凭据静态加密、API Key 作用域与 IP 名单 |
| 开放接口 | REST（OpenAPI 3.1）+ MCP（20 个工具），外部 Agent 可直接操作 |
| 现代 Web | 原生 \`<dialog>\` / Popover API / \`color-scheme\` / 容器查询 / 内容可见性；遵循 Modern Web Guidance 1.0 |

## 设计原则

- **不分享具体脚本**：CheckQ 是平台；具体的签到脚本属于**模板市场**（后续能力），文档只讲框架能力。
- **干净日志**：默认只有你写的日志节点出现，技术细节按需展开。
- **凭据不落明文**：cookie / token / 密码加密存储，备份默认脱敏。
- **终端用户优先**：面板里不写"给你讲道理"的说明文字，说明走悬停标注或按需出现。
- **原生能力优先**：弹窗/菜单/主题交给浏览器（\`<dialog>\` / Popover / \`color-scheme\`），减少自造轮子。
- **窄屏单行**：小屏顶栏只留「品牌 / 新建 / 更多 / 设置」，其余动作收进菜单，按钮不被挤到换行。

## 接下来去哪

| 我想… | 去哪 |
|---|---|
| 跑通第一个任务 | [快速开始](/quickstart.html) |
| 了解节点与变量 | [任务与流程](/tasks.html) |
| 配置日志与通知 | [日志与通知](/logs.html) |
| 给外部程序开接口 | [API 与 MCP](/api.html) |
| 部署 / 备份 / 迁移 | [部署与备份](/deploy.html) |
| 排查问题 | [常见问题](/faq.html) |
`,
  'quickstart.md': `# 快速开始

## 1. 建任务

顶栏「+ 新建任务」→ 画布自带「HTTP 请求 → 日志」两个节点 → 点 HTTP 节点填 URL、请求头（需要登录态时带上 cookie）。

## 2. 跑一次

顶栏「运行」。成功时日志只有一行人话；失败时点日志步骤可看响应体。

## 3. 定调度与重试

编辑器顶栏「调度」→ 填 cron（如 \`30 8 * * *\` = 每天 08:30）→ 启用。同一个弹窗里可配置**失败重试**：默认最多 3 次、指数退避 5 秒起、随机抖动；跑满次数仍失败才判定任务失败，逐次尝试与等待时长会写进日志与通知。调试运行不重试。

## 4. 收通知

编辑器「更多 → 通知渠道」→ 选类型（站内通知零依赖）→ 填地址 →「测试发送」。

## 5. 变成模板（可选）

编辑器「更多 → 存为模板」→ 之后从模板创建任务时，各自填自己的变量（如 token）。模板一改，已派生的任务立刻跟随。

## 6. 自动化（可选）

- **调试运行**：编辑器顶栏「调试运行」记录每步请求/响应并展开过程窗口；日常「运行」只输出配置好的日志。
- **连续日志流**：任务行「日志」→ 多次运行滚动在一起，可上翻历史、导出。
- **外部 Agent**：设置 → API 密钥 → 生成（只读 + 可运行）→ 配合 [API 与 MCP](/api.html)。
- **窄屏**：顶栏「+ / ⋯ / 设置」三个图标按钮；主题、站内通知、文档中心、登录身份都在「⋯」里。
`,
  'tasks.md': `# 任务与流程

## 节点类型

| 类型 | 用途 |
|---|---|
| HTTP 请求 | 方法 / URL / 头 / 体 / 断言 / 超时 / 后端(fetch·curl) / 编码 / 代理 / 重试 |
| 条件判断 | jexl 表达式分流（真→true 出口，假→false 出口） |
| 赋值 | 变量或表达式求值 |
| 提取 | 正则 / JSON 路径 / 响应头 / Set-Cookie |
| 延迟 / 随机延迟 | 固定或区间等待（避开整点风控） |
| 日志 | 输出人话日志（默认唯一可见的日志） |
| 通知 | 流程内自定义推送 |
| 脚本 | JS 沙箱（vars/last/steps 只读，1s 超时） |
| 遍历 | 数组逐项循环（上限 50 轮） |

## 变量与表达式

- 流程变量在编辑器「流程变量」面板维护；敏感值（cookie / token / 密码）**落盘加密**，API 返回明文以便编辑。
- 模板语法：\`{{var}}\`、\`{{x|urlencode}}\`、\`{{x|num}}\`、\`{{x|sha256}}\`、\`{{now:%Y-%m-%d}}\`
- 表达式：\`=last.json.code == 0\`（\`vars.xxx\` 取变量，\`last\` 是上一个响应）

## 调度与失败重试

- 每个任务独立 cron + 时区 + 抖动（0-N 分钟）；空 cron = 只手动运行。
- 调度弹窗里可随时启用 / 停用；首页健康条显示「下一次调度」及是哪个任务。
- **任务级失败重试**（默认开启）：最多 3 次尝试、指数退避 5 秒起、随机抖动、单次等待上限 5 分钟；只有最后一次仍失败才判定任务失败。可选线性 / 固定间隔，也可关闭。
- 调试运行不重试；上一次运行或退避尚未结束时，调度会跳过这一拍，避免堆积。
- 节点级重试（http 节点配置）是同一次执行内立刻重发，与任务级重试互补。

## 模板

- 存为模板会带走节点 / 连线 / 变量 / 日志 / 通知。
- 派生任务 = 模板 + 各自参数：**模板一改，所有派生任务立刻跟随，无需任何同步操作**；没有「更新到模板版本」按钮或「待更新」标记。
- 派生任务改了脚本内容（忽略节点坐标）会自动转成独立任务；变量值、通知渠道保留，日志配置随模板。
- 模板删除后，已建任务回退到自己保存的最后一份流程图，不受影响。
- 从模板创建任务时逐个覆盖变量；敏感默认值在模板导出时自动脱敏。
- 模板市场：「模板」页可从 JSON 索引地址批量导入。

## 点选生成逻辑

在编辑器里运行一次 → 日志里展开响应 → 点任意 JSON 值或划选文字 → 选择用途（存为变量 / 断言成功 / 记录到日志 / 加进通知）→ 自动生成标准节点并接到链尾。
`,
  'uiux.md': `# 交互与视觉规范

> 本节描述框架的交互契约与视觉令牌，供二次开发与验收对照。所有实现均为浏览器原生能力优先，不含任何业务脚本。

## 入口契约（定版）

| 动作 | 结果 |
|---|---|
| 点任务名 | 「任务详情」弹窗：任务名 / 备注可改 + 只读概览（调度、时区、状态、重试策略、下次/上次运行、流程规模、变量（敏感项遮蔽）、通知渠道、来源模板、创建/修改时间） |
| 任务行 ··· | 编辑流程 / 复制副本 / 启用或停用调度 / 删除（**没有**单独的基础信息入口） |
| 编辑器「更多」 | 任务详情 / 通知渠道 / 填入 Cookie / 日志配置 / 存为模板 / 调试运行 等 |
| 任务行「日志」或状态徽章 | 连续日志流（同一入口，避免两份视图） |

## 原生 Web 能力

| 能力 | 做法 |
|---|---|
| 弹窗 | 原生 \`<dialog>\` + \`showModal()\` + \`closedby="any"\`；浏览器负责焦点、Esc、背景 inert、顶层渲染与关闭后焦点归还 |
| 定位 | \`position: fixed; inset: 0; margin: auto; height: fit-content\`，跨浏览器居中，不依赖 UA 差异 |
| 滚动 | \`dialog:modal\` 与 \`dialog::backdrop\` 的 \`overscroll-behavior: contain\`，不给 \`<html>/<body>\` 上锁 |
| 菜单 | Popover API 顶层渲染；位于弹窗内时挂到该 \`<dialog>\` 内部，否则会被 inert 拦住 |
| 主题 | \`<meta name="color-scheme">\` + \`:root\` 的 \`color-scheme\`；日 / 夜 / 自动三段切换 |
| 表格 | 语义 \`<table>/<caption>/<th scope>\` + sticky 表头 + 容器查询；可聚焦横滚区 |
| 表单 | \`autocomplete\` / \`:user-invalid\` / \`aria-label\` / \`role="alert"\` |
| 动效 | \`prefers-reduced-motion\` 降级；长日志 \`content-visibility: auto\` |

依据 [Modern Web Guidance 1.0](https://developer.chrome.com/docs/modern-web-guidance)；机械扫描 \`npx modern-web-guidance@latest legacy-scan web/src --json\` 当前为 0 命中。

## 视觉令牌

| 项 | 夜 | 日 |
|---|---|---|
| 背景 / 面板 | \`#0b0e11\` / \`#11151a\` | \`#f3f5f6\` / \`#ffffff\` |
| 边框 | \`#232a32\` | \`#d9dfe3\` |
| 强调色 | \`#3fa7ad\` | \`#14707a\` |
| 圆角 | xs 2 / sm 4 / md 6 / lg 8 / xl 12 px（层级化，不再处处同圆角） | 同左 |
| 控件高度 | 标准 32 / 小 26 / 移动端 38 px | 同左 |

- 冷中性石墨 + 低饱和汽油蓝绿；状态用「小圆点 + 文字」，不用彩色药丸；数字等宽 \`tabular-nums\`。
- 节点配色为低饱和语义色，图标统一线性 SVG（设置用滑块式图标），禁止 emoji 充当图标。
- 元信息用细竖线分隔的 \`.meta\`，不堆中点串。

## 响应式与对齐

- 桌面顶栏：品牌 / 新建 / 更多 / 身份文字 / 动作组 / 设置，全部等高、单行、垂直居中。
- 窄屏（≤640px）：只保留「品牌 / + / ⋯ / 设置」四个 38px 控件，单行不换行；主题、站内通知、文档中心、登录身份收进「更多」。
- 工具条拆左右两组，组内不拆散、组间才折行；搜索框可伸缩，控件同高。
- 弹窗 \`height: fit-content\`（\`height: auto\` 会被 \`inset:0\` 拉满再截断，留下大片空白）。

## 验收护栏

\`node tools/ui-smoke.cjs <baseUrl>\`（7 视口 × 明暗主题，检查溢出 / 重叠 / 顶栏换行 / 弹窗居中 / 菜单裁剪 / 控制台报错）、
\`node tools/copy-audit.cjs\`、\`node tools/secret-scan.cjs\`、\`node tools/project-audit.cjs\`，命中即 \`exit 1\`。
`,
  'logs.md': `# 日志与通知

## 干净日志（默认）

- 记录范围默认「仅 log 节点」：只有你写的日志节点出现；失败步骤始终保留。
- 流程里没有日志节点时自动退回全步骤，避免"成功但没日志"。
- 记录档位 all / failure / summary 控制细节多少；关键字规则把值提取进运行摘要。

## 调试模式

- **任务级**：日志配置里勾「调试模式」→ 每次运行都记录请求 / 响应。
- **单次级**：编辑器日志坞勾「调试」→ 仅当次记录，日常运行不受影响。

## 连续日志流

任务行「日志」→ 多次运行拍平成一条时间线：可「加载更早的记录」，每组可展开调试或导出 .log。
失败重试的运行会在日志里插入「第 N/M 次尝试」分隔行；运行抽屉列出每次尝试的成败与下次等待时长，结论与通知也带尝试次数。

## 通知渠道（12 种）

站内通知 / Webhook / Bark / Telegram / Server酱 / PushPlus / 钉钉（加签）/ 企业微信 / 飞书（加签）/ Gotify / ntfy / 邮件 SMTP。

- 成功 / 失败可分别开启；模板支持 {{flow.name}} {{status}} {{message}} {{duration}} {{time}}。
- **每日汇总推送**（可选，默认关）：设置 → 通知与推送 → 勾选「推送单位」（任务），可定时推送或立即推送今日汇总。
- **界面提示级别**：默认只报错误；可在设置里改为「成功 + 错误」或「全部」。
`,
  'security.md': `# 账号与安全

## 账号与角色

- 多用户：用户名 + 密码；角色 admin（全部）/ operator（不能管账号）/ viewer（只读，写操作 403）。
- 密码 scrypt 加盐哈希存储，明文永不落盘；改用户名需当前密码，改完强制重新登录。

## 两步验证

TOTP（Google Authenticator / Authy / Aegis）：启用后给 10 个一次性恢复码（只显示一次，服务端只存摘要）。
忘记验证器：恢复码登录，或管理员在「用户管理」重置该用户的 2FA。

## 会话与 API Key

- 会话：httpOnly + SameSite=Strict，7 天绝对有效期 + 24 小时空闲失效，可查看 / 吊销 / 退出所有设备。
- API Key：可命名、按作用域发放（只读 / 可运行 / 可修改）、可设回收日期（到期自动回收）、可随时吊销；列表显示调用次数与来源 IP。

## 访问控制

- 每把 Key 可设 **IP 允许名单**（CIDR）。
- 全局 **IP 黑名单**：被拉黑的 IP 登录与 API Key 一并拦截。

## 凭据存储

cookie / token / SMTP 密码等以 AES-256-GCM 加密落盘；密钥在 \`data/.secret\`（600）或环境变量 \`CHECKQ_SECRET\`。
备份默认脱敏；完整备份需再次输入当前密码。

## Web 加固

CSP / X-Frame-Options / nosniff / Referrer-Policy；写操作校验 Origin 同源（CSRF）；登录按 IP 与账号双层限流；审计日志记录关键动作。
`,
  'api.md': `# API 与 MCP

## 基础 API

- \`GET /api\` —— 接口索引（免登录）
- \`GET /api/openapi.json\` —— OpenAPI 3.1 机器可读描述（可自动生成客户端）

## 认证

\`x-api-key: <key>\`（推荐，可按作用域发放）或登录会话 Cookie。

## 常用端点

| 需求 | 方法 | 路径 |
|---|---|---|
| 列任务 | GET | /api/flows |
| 任务详情 | GET | /api/flows/:id |
| 跑一次 | POST | /api/flows/:id/run |
| 实时日志（SSE） | POST | /api/flows/:id/run（\`{"stream": true}\`） |
| 连续日志流 | GET | /api/flows/:id/logs?limit=200 |
| 改变量 / 调度 / 重试 | PUT | /api/flows/:id |
| 历史运行（含逐次尝试） | GET | /api/runs?flowId=&limit=30 |
| 模板 | GET | /api/templates |
| 运维统计 | GET | /api/system/stats |

任务对象含 \`retry = { enabled, maxAttempts, backoff, baseDelayMs, maxDelayMs, jitter }\`（默认开启 / 3 次 / 指数 / 5s / 5min / 抖动）；运行对象含 \`attempts[]\`、\`attempt\`、\`maxAttempts\`。完整字段见 [API 参考](/reference-api.html)。

## MCP

\`mcp/checkq-mcp.cjs\`（stdio，零依赖）暴露 20 个工具：health、whoami、stats、notifications_list、flows_list、flow_get、flow_run、flow_logs、flow_update_vars、flow_update、flow_toggle、flow_create、flow_delete、flow_notify_test、templates_list、template_get、template_instantiate、import_curl、runs_list、run_get。

配置：

\`\`\`json
{ "mcpServers": { "checkq": { "command": "node",
  "args": ["/path/CheckQ/mcp/checkq-mcp.cjs"],
  "env": { "CHECKQ_URL": "http://checkq.local:18888", "CHECKQ_API_KEY": "cq_xxx" } } } }
\`\`\`

## 给外部 Agent 的东西

只有**基址 + 一把 Key**；建议只勾「只读 + 可运行」，把「可修改」留给人工。详见 [Agent 接入指南](/reference-agent.html)。
`,
  'deploy.md': `# 部署与备份

## 部署

单容器（Docker），数据落在 \`data/\`（flows / runs / templates / meta / notifications），JSON 存储 + 原子写 + 立即落盘。

\`\`\`bash
docker run -d --name checkq --restart unless-stopped -p 8888:8888 \\
  -v /path/to/data:/data -e TZ=Asia/Shanghai \\
  -e PORT=8888 -e DATA_DIR=/data checkq:latest
\`\`\`

端口可按需映射（例如 \`-p 18888:8888\`）；数据目录务必挂载到宿主机持久化。

## 数据目录

| 文件 | 内容 |
|---|---|
| flows.json | 任务定义（含加密后的敏感变量） |
| runs.json | 运行记录 |
| templates.json | 模板 |
| meta.json | 账号、API Key 摘要、审计、界面偏好 |
| notifications.json | 站内通知 |
| .secret | 凭据加密密钥（600，务必与数据一起备份） |

## 备份与恢复

- 任务页「备份」→ 下载**脱敏**备份（敏感值清空，适合分享与存档）。
- 任务页「完整备份」→ 需再输一次当前密码，含明文凭据，用于自己迁移。
- 恢复：粘贴备份 JSON → 生成带「（恢复）」后缀的停用任务 → 手动启用。

> 迁移到新机器时，请把 \`data/.secret\` 一并带走，否则已加密的凭据无法解密。
`,
  'faq.md': `# 常见问题

| 现象 | 处理 |
|---|---|
| 找不到入口节点 | 流程成环，所有节点都有入线 |
| HTTP 400 | 不一定是错误，断言通过即可继续；点日志步骤看响应体 |
| 超时 | HTTP 节点超时填秒（30），不是毫秒 |
| 变量未定义 | 日志配置开启变量快照，或看运行记录里的「未定义变量」 |
| 提示太吵 | 设置 → 通知与推送 → 界面提示 → 仅错误 |
| 日志太啰嗦 | 编辑器「更多 → 日志配置」→ 记录范围「仅 log 节点」 |
| 忘记密码 | 管理员重置；或按安全说明里的容器命令重置 |
| 忘记两步验证码 | 用恢复码；管理员可在「用户管理」重置 2FA |
| 弹窗贴到屏幕左上角 / 打开后背景跟着滚 | 已修复：弹窗用原生 \`<dialog>\` 显式居中，遮罩与弹窗用 \`overscroll-behavior: contain\` 收敛滚动；不再给页面加锁 |
| 弹窗里的下拉菜单点不到 | 已修复：菜单挂到该弹窗内部，避免被模态的 inert 拦住 |
| 窄屏顶栏按钮被挤到换行 | 已修复：小屏只留四个等高控件，其余动作收进「更多」 |
| 任务失败一次就停了 | 默认会按退避策略自动重试（最多 3 次）；在编辑器「调度 → 失败后重试」可关闭或调次数 |
| 怎么知道到底试了几次 | 任务详情显示策略；运行抽屉列出每次尝试与等待；通知结论带「第 N/M 次尝试」 |
| API Key 报权限不足 | 缺哪种能力就补勾哪种作用域（只读 / 可运行 / 可修改） |
`,
};

// ---------- 静态资源 ----------
const CSS = `
:root { color-scheme: dark; --bg:#0b0e11; --panel:#11151a; --panel2:#171c22; --border:#232a32; --text:#e3e7eb; --muted:#8a949e; --accent:#3fa7ad; --ok:#3fae7d; --warn:#c99a3f; --code-bg:#0e1216; }
html[data-mode='light'] { color-scheme: light; --bg:#f3f5f6; --panel:#fff; --panel2:#eef1f3; --border:#d9dfe3; --text:#15191d; --muted:#5f6a73; --accent:#14707a; --ok:#1b7a52; --warn:#8a6116; --code-bg:#f8fafb; }
* { box-sizing: border-box; }
body { margin:0; background: var(--bg); color: var(--text); font: 14px/1.65 "Segoe UI Variable Text", -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; -webkit-font-smoothing: antialiased; }
a { color: var(--accent); text-decoration: none; } a:hover { text-decoration: underline; }
.wrap { display: flex; min-height: 100vh; }
aside { width: 272px; flex: none; border-right: 1px solid var(--border); background: var(--panel); padding: 20px 14px; position: sticky; top: 0; height: 100vh; overflow-y: auto; }
.brand { display: flex; align-items: center; gap: 9px; font-weight: 700; font-size: 17px; margin-bottom: 4px; }
.brand span { color: var(--accent); }
.brand-sub { color: var(--muted); font-size: 12.5px; margin-bottom: 14px; }
#search { width: 100%; height: 32px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--input-bg, var(--panel2)); color: var(--text); font-size: 13px; margin-bottom: 12px; }
#search:focus { outline: none; border-color: var(--accent); }
#results { margin: -6px 0 12px; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; display: none; }
#results.on { display: block; }
#results a { display: block; padding: 7px 10px; font-size: 12.5px; color: var(--text); border-bottom: 1px solid var(--border); }
#results a:last-child { border-bottom: none; }
#results a:hover { background: var(--panel2); text-decoration: none; }
#results em { display: block; font-style: normal; color: var(--muted); font-size: 11.5px; }
nav a { display:block; padding: 7px 10px; border-radius: 7px; color: var(--text); font-size: 14px; margin-bottom: 2px; }
nav a:hover { background: var(--panel2); text-decoration: none; }
nav a.on { background: var(--panel2); font-weight: 600; }
nav a em { display:block; font-style: normal; color: var(--muted); font-size: 12px; }
main { flex: 1 1 auto; min-width: 0; padding: 34px 42px 80px; max-width: 1000px; }
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
.log { font-size: 12.5px; border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; background: var(--code-bg); margin-bottom: 12px; }
.log b { color: var(--accent); }
@media (max-width: 880px) { aside { position: static; height: auto; width: 100%; } .wrap { flex-direction: column; } main { padding: 22px 18px 60px; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; scroll-behavior: auto !important; } }
`;

const SEARCH_JS = `
(function () {
  var input = document.getElementById('search');
  var box = document.getElementById('results');
  var index = [];
  fetch('./search-index.json').then(function (r) { return r.json(); }).then(function (d) { index = d; });
  function esc(s) { return s.replace(/[&<>]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]; }); }
  function run() {
    var q = input.value.trim().toLowerCase();
    if (!q) { box.classList.remove('on'); box.innerHTML = ''; return; }
    var hits = [];
    for (var i = 0; i < index.length; i++) {
      var it = index[i];
      var pos = it.text.toLowerCase().indexOf(q);
      if (pos < 0 && it.title.toLowerCase().indexOf(q) < 0) continue;
      var start = Math.max(0, pos - 40);
      var snippet = (pos >= 0 ? it.text.slice(start, start + 120) : it.text.slice(0, 120));
      hits.push('<a href="' + it.file + '">' + esc(it.title) + '<em>' + esc(snippet) + '…</em></a>');
      if (hits.length >= 8) break;
    }
    box.innerHTML = hits.join('') || '<a href="javascript:void(0)">没有匹配</a>';
    box.classList.add('on');
  }
  input.addEventListener('input', run);
  input.addEventListener('keydown', function (e) { if (e.key === 'Escape') { input.value = ''; run(); input.blur(); } });
  document.addEventListener('click', function (e) { if (!box.contains(e.target) && e.target !== input) box.classList.remove('on'); });
})();
`;

// ---------- 生成 ----------
function navHtml(current) {
  return PAGES.map((p) => {
    const file = p.file.replace(/\.md$/, '.html');
    return `<a class="${p.file === current ? 'on' : ''}" href="${file}">${p.title}<em>${p.desc}</em></a>`;
  }).join('\n');
}

function page({ file, title, desc, body, extraHead = '' }) {
  return `<!doctype html>
<html lang="zh-CN" data-mode="dark">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark light" />
<title>${title} · CheckQ 文档</title>
<meta name="description" content="${desc}" />
<link rel="stylesheet" href="./assets/style.css" />
${extraHead}
</head>
<body>
<div class="wrap">
  <aside>
    <div class="brand">Check<span>Q</span></div>
    <div class="brand-sub">自动化签到引擎 · 文档</div>
    <input id="search" type="search" placeholder="搜索文档…" autocomplete="off" />
    <div id="results"></div>
    <nav>
${navHtml(file)}
    </nav>
    <div class="brand-sub" style="margin-top:18px"><a href="https://github.com/${REPO_OWNER}/${REPO_NAME}">GitHub 仓库 →</a></div>
  </aside>
  <main>
${body}
    <div class="foot">CheckQ 文档 · 由 <code>tools/build-wiki.cjs</code> 生成 · <a href="https://github.com/${REPO_OWNER}/${REPO_NAME}/issues">反馈问题</a></div>
  </main>
</div>
<script>${SEARCH_JS}</script>
</body>
</html>
`;
}

// 更新日志（从 git log 生成）
function changelogHtml() {
  let lines = [];
  try {
    const out = execSync('git log --date=short --pretty=format:"%ad|%h|%s" -n 150', { cwd: ROOT, encoding: 'utf8' });
    lines = out.split('\n').filter(Boolean);
  } catch { /* 没有 git 历史时忽略 */ }
  const items = lines.map((l) => {
    const [date, hash, subject] = l.split('|');
    return `<li><span class="hash">${hash}</span> ${inline(subject || '')} <span class="date">${date}</span></li>`;
  }).join('');
  const grouped = {};
  for (const l of lines) {
    const [date, hash, subject] = l.split('|');
    (grouped[date] = grouped[date] || []).push(`<li><code>${hash}</code> ${inline(subject || '')}</li>`);
  }
  const sections = Object.entries(grouped).map(([d, items]) => `<h3>${d}</h3><ul>${items.join('')}</ul>`).join('');
  return `# 更新日志

按提交时间倒序（来自 git 历史）。

${sections || '<p>暂无记录</p>'}
`;
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'assets', 'style.css'), CSS, 'utf8');

const searchIndex = [];
for (const p of PAGES) {
  let title = p.title;
  let desc = p.desc;
  let body = '';
  let md = '';
  if (p.auto === 'changelog') {
    md = changelogHtml();
  } else if (p.src) {
    const docFile = path.join(DOCS, p.src);
    if (!fs.existsSync(docFile)) { console.log('MISS doc source:', p.src); continue; }
    md = fs.readFileSync(docFile, 'utf8');
  } else {
    const src = SOURCES[p.file];
    if (!src) { console.log('MISS source:', p.file); continue; }
    if (typeof src === 'string') { md = src; }
    else { title = src.title || title; md = src.body || ''; }
  }
  body = mdToHtml(md);
  const html = page({ file: p.file, title, desc, body });
  fs.writeFileSync(path.join(OUT, p.file.replace(/\.md$/, '.html')), html, 'utf8');
  searchIndex.push({ file: p.file.replace(/\.md$/, '.html'), title, desc, text: plainText(md).slice(0, 4000) });
  console.log('generated', p.file);
}

fs.writeFileSync(path.join(OUT, 'search-index.json'), JSON.stringify(searchIndex), 'utf8');
fs.writeFileSync(path.join(OUT, '404.html'), page({ file: 'index.md', title: '页面不存在', desc: '', body: '<h1>404</h1><p>没有这个页面，<a href="./index.html">回首页</a>。</p>' }), 'utf8');
fs.writeFileSync(path.join(OUT, 'robots.txt'), 'User-agent: *\nAllow: /\n', 'utf8');
console.log('wiki built →', path.relative(ROOT, OUT), `(${PAGES.length} 页)`);

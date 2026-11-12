# 自动签到类产品竞品分析（CheckQ 视角）

> 2026-11-10 · 评估市面上主流自动签到 / 自动化框架，取长补短。

## 1. 对标产品

| 产品 | 形态 | 通知 | 日志 | 调度 | 优点 | 缺点 |
|---|---|---|---|---|---|---|
| 青龙面板 (qinglong) | Docker 面板 + 脚本仓库 | ✅ 20+ 渠道（Server酱/钉钉/飞书/Bark/PushPlus…） | ✅ 按脚本/按日期，只显示脚本 print | ✅ cron + 依赖管理 | 生态最大、渠道最全、日志干净（只显示 log） | 需要写 JS/Python；环境依赖多 |
| 签到页 (qiandao) | Docker + 模板市场 | ✅ 微信/邮件/Server酱 | ✅ 只显示 log 输出 | ✅ cron | 「点选即逻辑」、模板市场、日志极简 | 仅 HTTP 签到类；无流程编排 |
| workbuddy-task-auto | Python 脚本 | ❌ | ✅ 终端表格 | 系统计划任务 | 任务事件链逆向完整 | 无面板、无通知、无日志留存 |
| workbuddy2api-panel | Go 网关 + Web 面板 | ❌ | ✅ 面板日志 | 内置定时 | 多账号池、自动完成任务 | 面向 API 网关，非通用自动化 |
| aipunch | TS + GitHub Actions | ❌ | ✅ CLI/面板 | Actions cron | 多应用 Provider 化 | 依赖 GitHub；无自托管面板 |
| yang-212/workbuddy-signin-kit | 一键部署脚本 | ✅ 飞书 | ✅ 文件日志 | 计划任务 ×3 | 凭据自动续期、云端兜底 | 单任务、无面板 |

## 2. CheckQ 的定位差异

- **可视化流程编排**（画布 + 积木 + 点选生成）是青龙/qiandao 之外的第三形态；
- **日志只显示 log 节点**（qinglong/qiandao 风格）已落地（`log.record = log / log-final`）；
- **通知渠道原生集成**（7 种：Webhook/Bark/Telegram/Server酱/钉钉/企业微信/飞书），无需外部脚本；
- **任务自动完成**：某签到应用的全量 18 项任务（含专家事件链）已在 CheckQ 流程中跑通；
- **API + MCP**：REST + X-API-Key + stdio MCP，Agent 可直接接入。

## 3. 已借鉴并落地

| 来源 | 借鉴点 | 状态 |
|---|---|---|
| qinglong/qiandao | 日志只显示 log 节点；通知渠道模板化 | ✅ `log.record` + NotifyModal |
| qinglong | 7 渠道原生集成 | ✅ 2026-11-10 |
| workbuddy-task-auto | `/v2/report` 事件链完成任务 | ✅ 68 节点全量流程 |
| yang-212 kit | 凭据每日同步 | ✅ `tools/wb-sync-token.cjs` |
| aipunch | 多应用 Provider 化 | ⬜ 后续模板化 |

## 4. 仍需补齐（见 ROADMAP）

- 多账号/多用户（当前单管理员 + API Key）；
- 依赖管理（如 Python/Node 版本、第三方包）；
- 模板市场（已有本地模板，缺在线索引）；
- 日志长期留存与轮转（当前 JSON 文件无限增长）。

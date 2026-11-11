# CheckQ 迭代路线图（v0.4）

> 2026-11-10 · 目标：从「签到自动化」升级为「完整产品形态」。

## 当前状态（v0.3.x）

- 引擎：10 种节点（http/condition/set/extract/delay/random-delay/log/notify/script/foreach），单链 DAG，500 步上限；
- 存储：JSON 文件（flows/runs/templates/meta/notifications），原子写 + 变更立即 flush + SIGTERM flush；
- 调度：croner，每任务独立 cron/时区/抖动；
- 日志：默认干净模式（只出 log 节点）+ 连续日志流 + 调试模式；
- 通知：12 渠道原生集成（站内/Webhook/Bark/Telegram/Server酱/PushPlus/钉钉/企业微信/飞书/Gotify/ntfy/邮件SMTP）+ 站内通知中心；
- 日志：level 三档 + record 三档（all/log/log-final）+ 关键字摘要；
- API：REST + X-API-Key；MCP：stdio 10 工具；
- 任务：WorkBuddy 签到 + 成长中心 19 项任务全自动（生产 20 个任务）。

## P0（产品完整度）

| 项 | 状态 |
|---|---|
| 首次启动创建管理员密码（bootstrap） | ✅ |
| 登录防爆破（5 次/10 分钟） | ✅ |
| API Key 管理 | ✅ |
| 使用引导（? 按钮 + 6 节） | ✅ |
| 通知渠道 UI + 测试发送 | ✅（12 渠道 + 真实外网 webhook.site 验证 + 站内通知落库） |
| 日志 record 模式 + UI | ✅（all / log / log-final） |
| 备份/恢复 API + 页面入口 | ✅（任务页「备份 / 恢复」） |
| 存储可靠性（立即 flush / SIGTERM flush） | ✅ |
| WorkBuddy 19/19 任务自动完成 | ✅（71 节点流程，生产 cron 25 6 * * *） |
| UI 全量遍历（设置/日志/通知/引导/调度/导入/批量/移动端） | ✅ 2026-11-11（修复日志配置白屏） |

| 日志干净模式（默认只出 log 节点 + 失败步骤） | ✅ 2026-11-11（无 log 节点自动退回全步骤） |
| 连续日志流（多次运行一条时间线，可上翻历史） | ✅ 2026-11-11（`GET /api/flows/:id/logs` + 首页 LogStream） |
| 调试模式（任务级 + 单次运行临时开启） | ✅ 2026-11-11（`log.debug` / `run {debug:true}`） |
| 界面提示级别（默认仅错误） | ✅ 2026-11-11（`GET/PUT /api/system/ui`） |
| 每日总推送独立可选（默认关）+ 立即推送 | ✅ 2026-11-11（面板汇总始终实时） |
| GLaDOS challenge 校验版签到流程 | ✅ 2026-11-11（13 节点，真实 cookie 实跑通过） |

| UI/UX 全量迭代（统一弹窗骨架 + 统一日志入口 + 触达面积） | ✅ 2026-11-11（PRD §4.14） |

| UI/UX 二轮（调试运行 / 推送单位 / SVG 图标 / 调度弹窗 / 品牌令牌 / 应用内确认） | ✅ 2026-11-11（PRD §4.14.6-4.14.8） |

| 账号管理系统（多用户 + 角色 + TOTP 2FA + 会话管理 + 安全加固） | ✅ 2026-11-11（PRD §4.10 / docs/SECURITY.md） |
| Passkey / WebAuthn 免密登录 | ⬜ P2 |

| 签到凭据静态加密（AES-256-GCM）+ 备份脱敏 | ✅ 2026-11-11（PRD §4.10 / docs/SECURITY.md §12） |
| 独立凭据中心（全局凭据库 + 引用） | ⬜ P2 |

| 外部 Agent 接入（API Key 作用域 + MCP 17 工具 + 接入指南） | ✅ 2026-11-11（docs/AGENT-ACCESS.md） |

## P1（体验）

| 项 | 说明 |
|---|---|
| 任务列表批量操作 | ✅ 多选运行/启用/停用/删除 |
| 模板市场 | 本地模板 ✅；在线索引 ⬜ |
| 依赖管理 | ⬜ Python/Node 运行时选择 |
| 多账号 | ⬜ 多用户/多账号隔离 |
| 日志轮转 | ⬜ 按天/按大小归档 |
| 引导式调试 | ⬜ 失败节点一键「重新点选」已有，扩展引导 |

## P2（生态）

| 项 | 说明 |
|---|---|
| MCP 扩展工具 | flow_create/update/delete/import_curl 等 |
| 插件/技能市场 | 参考 qinglong 脚本仓库 |
| 多端通知卡片 | 飞书/钉钉富文本卡片 |
| 审计日志 | 谁改了什么任务 |

## 迭代节奏

- 每轮：UI/UX 走查（桌面 1440×900 + 移动 <640）→ 真机验证 → 生产部署 → 文档同步；
- 版本号：`0.3.17` → `0.4.0`（产品完整度达标后）；
- 每轮交付物：可验证的运行日志/截图 + 测试数 + 部署记录。

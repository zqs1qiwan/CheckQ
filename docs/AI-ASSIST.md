# 快速组装与 AI 助手（规划 + 现状）

> 2026-11-10 · 对应「快速组装原理是什么 / 背后有没有 AI」的答案与落地记录。

## 1. 快速组装现状（v0.3.17-ui4 之前）

**纯前端确定性规则生成器，零 AI、零外部请求。**

- `web/src/components/FlowList.jsx` → `parseNatural(text)`：正则抽取
  - URL：`/https?:\/\/[^\s"'）)]+/`
  - 方法：出现 `POST` → POST，否则 GET
  - 成功词：`/看到(.{2,12}?)算?成功/` 或 `成功词[是:：](.{2,12})`
  - 事件类型：文本命中 签到/抽卡/库存监控/信息查询
- `buildWizardFlow({url, method, keyword, eventLabel})`：硬编码 2 节点骨架
  - `http` 节点（带 UA header、可选 keyword 断言 `asserts:[{res:[kw],from:'content'}]`）
  - `log` 节点（`{{eventLabel}}完成：{{last.status}}`）
  - `cron: '0 8 * * *'`、`enabled: false`
- 一句话只是「填充表单」的语法糖，生成逻辑完全本地，可离线用。

**局限**：只能生成固定骨架；不理解多步流程（登录→取 token→签到）、不理解 POST body / 变量引用。

## 2. LLM 接入（2026-11-10 已落地）

### 服务端

| 端点 | 说明 |
|---|---|
| `GET /api/system/ai` | 读配置（key 打码 `sk-abc…`），返回 `configured` |
| `PUT /api/system/ai` | 存 `{baseUrl, apiKey, model}` 到 `meta.json`；key 传打码占位时保留旧值 |
| `POST /api/ai/generate` | 代理调用 OpenAI 兼容 `POST {baseUrl}/chat/completions`，60s 超时 |

安全与校验：
- key 只存服务端 `meta.json`，任何响应不回显明文，日志不打印。
- LLM 输出必须为 JSON（自动剥 ```json 围栏），服务端白名单校验：
  - 节点类型仅 `http / log / set / delay`，最多 6 节点
  - 必须含合法 `http` 节点且 URL 为绝对 http(s)
  - 统一补齐 `timezone: Asia/Shanghai`、`enabled: false`、`vars: {}`
- AI 只产出**草稿**，用户在弹窗里点「用 AI 结果创建」才落库；绝不自动运行。

### 前端

- 设置 → AI 助手：Base URL / API Key / 模型（支持 DeepSeek / OpenAI / Ollama 等 OpenAI 兼容端点）。
- 快速组装弹窗：一句话 →「✨ AI 生成流程」→ 预览（名称 / 节点数 / cron / 节点链）→「用 AI 结果创建」。
- 未配置或调用失败 → 中文提示，规则模式（「规则填充（不耗 API）」）始终可用。

### 验证记录（2026-11-10 本地 mock LLM）

```
unconfigured: 400 未配置 AI：请到「设置 → AI 助手」…
save-ai: 200
get-ai: 200 {"configured":true,…,"apiKey":"sk-tes…"}
generate: 200 draft.name=mock签到任务 nodes=2 cron=0 8 * * * assert=[{"res":["签到成功"],"from":"content"}]
create-from-draft: 200 mock签到任务 nodes=2
```

## 3. MCP / API 控制（规划）

CheckQ 已有完整的 REST 面 + `X-API-Key` 鉴权（`POST /api/system/apikey`），天然可被 MCP 包装：

- **近期**：`checkq-mcp` server 薄封装现有端点：
  - `create_flow(draft)` / `run_flow(id)` / `get_run(id)` / `list_flows()` / `list_templates()` / `instantiate_template(id, vars)`
  - 用途：外部 agent（Claude/Cursor/自研）直接创建与调试流程，无需 UI。
- **中期**：AI 对话面板（ChatPanel）多轮编排：
  - 工具调用流：`get_flow` → `update_flow_node` → `run_flow(debugStopId)` → 读 run 日志 → 继续修
  - 与 Pick Panel 共用节点生成器（前端确定性代码生成仍是主路径，LLM 只做「翻译」）
- **原则**（沿用 PRD §4.0）：
  1. LLM 永不直接执行外部请求，只产/改流程 JSON；
  2. 所有 LLM 产物过服务端结构校验；
  3. key 服务端存储、可随时清除；
  4. 规则模式永久保留为离线降级。

## 4. 待决策

- [ ] 是否内置默认模型供应商（当前 BYO key，零成本零锁定）
- [ ] MCP server 放本仓库 `mcp/` 还是独立包
- [ ] ChatPanel 是否走 SSE 流式（复用现有 run 流式通道）

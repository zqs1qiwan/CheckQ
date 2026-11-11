# CheckQ REST API — AI-ready 参考

> 本文面向 Agent / MCP / 外部脚本。所有端点相对基址 `http://<host>:<port>`（默认 `8888`）。
> 鉴权二选一：**Cookie Session**（`POST /api/login`）或 **X-API-Key**（`POST /api/system/apikey` 生成）。
> Content-Type: `application/json`。所有响应 JSON；错误统一 `{ error: string }` + HTTP 状态码。

## 1. 鉴权

### POST /api/login
```json
{ "password": "..." }
```
响应：`{ ok: true }` + `Set-Cookie: qsid=...`（7 天有效）。登录失败 5 次/10 分钟 → 429。

### POST /api/logout
清除会话。

### X-API-Key（推荐给 Agent/MCP）
```
X-API-Key: <key>
```
通过 `POST /api/system/apikey`（需已登录）生成；重新生成后旧 Key 立即失效。`GET /api/system/settings` 返回 `{ hasApiKey, apiKey: "abcd1234…" }`（仅前 8 位）。

### GET /api/health
```json
{ "ok": true, "version": "0.3.17" }
```
无需鉴权。

## 2. 通用字段

- **Flow**：`{ id, name, note, cron, timezone, enabled, jitterMinutes, vars, nodes, edges, notify, log, tplId, createdAt, updatedAt, lastRun, nextRunAt }`
- **Node**：`{ id, type, name, x, y, config }`
- **Log config**：`{ level: "all"|"failure"|"summary", record: "all"|"log"|"log-final", include: {reqHeaders,reqBody,resBody,varsSnapshot}, resBodyLimit, keywords: [{name,regex,from,into,stepId,negate}] }`
- **Run**：`{ id, flowId, trigger, startedAt, finishedAt, status, durationMs, summary, vars, logs, finalMessage }`
- **StepLog**：`{ stepId, index, name, type, ok, message, ms, missing, asserts, keywords, detail }`

## 3. 端点清单

### 系统
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/health | 健康 |
| GET | /api/system/settings | `{ hasApiKey, apiKey }` |
| POST | /api/system/password | `{ oldPassword, newPassword }` |
| POST | /api/system/apikey | 生成/重新生成 API Key，返回 `{ apiKey }` |
| GET | /api/system/stats | `{ flows, enabledScheduled, templates, todayRuns, todaySuccess, todayFailed, successRate, nextRunAt, queuedFlows, queueCount, runningCount, dailySummary }` |
| GET/PUT | /api/system/ai | AI 助手配置（baseUrl/apiKey/model，key 打码回显） |
| POST | /api/ai/generate | `{ sentence }` → LLM 生成流程草稿（≤6 节点，http URL 必填，草稿 enabled:false） |
| GET/PUT | /api/system/daily-summary-config | 每日汇总定时配置 |
| GET | /api/notifications?limit= | 站内通知列表 `{ items, unread, total }` |
| POST | /api/notifications/read | 标记已读（body `{ ids? }`，省略=全部） |
| DELETE | /api/notifications | 清空站内通知 |
| POST | /api/system/daily-summary | `{ flowId }` 立即发送汇总 |
| GET/POST | /api/system/backup | 导出/导入全部数据（restore 以新 ID 导入，停用） |

### 任务 (Flows)
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/flows | 列表（摘要：id/name/note/cron/timezone/enabled/jitterMinutes/varsCount/nodesCount/tplId/lastRun/nextRunAt） |
| POST | /api/flows | 创建（body = Flow 对象；空 nodes 允许，仅草稿） |
| GET | /api/flows/:id | 详情（含 nodes/edges/vars/log/notify） |
| PUT | /api/flows/:id | 更新（部分字段合并） |
| DELETE | /api/flows/:id | 删除 |
| POST | /api/flows/:id/run | `{ stream?: bool }` 运行；stream=true → SSE（start/log/done） |
| POST | /api/flows/:id/clone | 克隆为「·副本 N」，enabled:false |
| POST | /api/flows/:id/curl | 生成等价 curl 命令（变量代入） |
| POST | /api/flows/batch | `{ action: run|enable|disable|delete, ids: [] }` |
| POST | /api/flows/:id/notify-test | 测试通知渠道 |

### 运行记录
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/runs?flowId=&limit= | 列表（默认 limit 30，上限 200） |
| GET | /api/runs/:id | 单条详情（完整 logs） |

### 模板
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/templates | 列表 |
| POST | /api/templates | 从流程创建模板 `{ flowId, name }` |
| GET | /api/templates/:id | 详情 |
| PUT | /api/templates/:id | 更新 |
| DELETE | /api/templates/:id | 删除 |
| POST | /api/templates/:id/instantiate | `{ vars? }` 实例化为任务 |
| POST | /api/templates/:id/instantiate-csv | CSV 批量实例化 |
| GET | /api/templates/:id/export | 导出 JSON |
| POST | /api/templates/from-url | 从 URL 导入模板索引 |

### 导入
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/import/curl | `{ curl: "..." }` → 节点链 |
| POST | /api/import/har | HAR 导入 |

### 其他
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/cookie-capture | 浏览器登录抓 Cookie 回填 |
| POST | /api/browser-login/start | 启动浏览器登录 |
| POST | /api/browser-login/capture | 捕获 Cookie |

## 4. SSE 运行协议

`POST /api/flows/:id/run` with `{ "stream": true }`：
```
event: start
data: {"flowId":"...","name":"..."}

event: log
data: { "index":1, "name":"...", "type":"http", "ok":true, "message":"...", "ms":120, ... }

event: done
data: { "id":"run-xxx", "status":"success", "durationMs":..., "summary":"...", "logs":[...], "vars":{...} }
```

## 5. 节点类型 (8 种)

| type | config 关键字段 |
|---|---|
| http | method, url, headers[{name,value,enabled}], body, timeout(秒), backend(fetch\|curl), charset, proxy{url}, retry{times,backoffMs,retryOn}, asserts[] |
| condition | expr (jexl) |
| set | name, value |
| extract | mode(json\|header\|setCookie), path, name, optional |
| delay | seconds |
| random-delay | min, max |
| log | text (支持 `{{var}}` / `{{last.status}}`) |
| notify | channel(webhook\|telegram\|bark), message |
| script | code (JS 沙箱，vars/last/steps 可读，1s 超时) |
| foreach | source, itemVar, indexVar |
| delay | seconds |

断言 asserts：`{ res: [regex], from: "content"|"status", negate }` 或 `{ expr, expect }`。

### 通知渠道（flow.notify.channels[]，12 种）
| type | 关键字段 |
|---|---|
| inbox | title（站内通知，无需外部服务） |
| webhook | url |
| bark | url, title, group |
| telegram | token, chat |
| serverchan | key, title |
| pushplus | token, title |
| dingtalk | url, secret?, title |
| wecom | url |
| feishu | url, secret? |
| gotify | url, token, priority |
| ntfy | url, topic, priority |
| email | host, port, user, pass, from, to, subject |

## 6. 模板变量语法

`{{var}}`、过滤器 `{{x|urlencode}}`、函数 `timestamp` / `now:%Y-%m-%d`、jexl 表达式 `{{last.json.code == 0}}`。

## 7. 错误码

| HTTP | 含义 |
|---|---|
| 400 | 参数/校验失败（validateFlow、空流程等） |
| 401 | 未登录 / API Key 无效 |
| 404 | 资源不存在 |
| 429 | 登录防爆破（5 次/10 分钟） |
| 500 | 引擎异常（成环、节点类型未知等） |

## 8. Agent 调用最小示例

```bash
# 1. 生成 API Key（先用密码登录一次）
curl -s -c cq.txt -X POST http://host:8888/api/login -H 'Content-Type: application/json' -d '{"password":"..."}'
curl -s -b cq.txt -X POST http://host:8888/api/system/apikey

# 2. 用 Key 跑任务
curl -s -H 'X-API-Key: <key>' http://host:8888/api/flows
curl -s -H 'X-API-Key: <key>' -X POST http://host:8888/api/flows/<id>/run
```

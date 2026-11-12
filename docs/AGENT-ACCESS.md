# 外部 Agent 接入 CheckQ（操作签到任务）

> 结论先说：**两种方式都支持，推荐 MCP（工具化、语义清楚）；只用 REST 也完全够。**
> 你要交给对方的**只有两样东西**：① CheckQ 基址（`http://checkq.local:18888`）② 一把 **API Key**（不要给账号密码！）。

---

## 1. 两种接入方式对比

| | **MCP（stdio）** | **REST API** |
|---|---|---|
| 适合 | Claude Desktop / Cursor / OpenCode 等支持 MCP 的 Agent | 任意能发 HTTP 的脚本 / Agent 框架 |
| 交接物 | 基址 + API Key（2 个环境变量） | 基址 + API Key（1 个请求头） |
| 语义 | 现成工具（跑签到/换 cookie/看日志…） | 需自己拼 REST 路径 |
| 依赖 | Node 18+（本仓库 `mcp/checkq-mcp.cjs`，零依赖） | 无 |
| 建议 | **首选** | 需要精细控制时用 |

---

## 2. 给 Agent 什么（推荐姿势）

### 2.1 先在面板里生成一把「受限」Key
设置 → **API Key** → 填名称（如「签到 Agent」）→ 勾权限：

| 权限 | 含义 | 建议 |
|---|---|---|
| 只读 | 只能看任务、日志、统计 | 只需要观察时勾 |
| **可运行** | 可以触发任务运行（= 跑签到） | **Agent 要签到就必须勾** |
| 可修改 | 可以改变量 / 调度 / 新建任务 | 需要「自动换 cookie」才勾 |

> 明文只显示一次，服务端只存 sha256 摘要；随时可吊销。
> **不要把账号密码给 Agent**（会拿到用户管理、2FA、完整备份等能力）。

### 2.2 MCP 接入（推荐）
把下面两行放进 Agent 的 MCP 配置（Claude Desktop 的 `claude_desktop_config.json`、Cursor 的 `mcp.json`、OpenCode 的 `opencode.json`）：

```json
{
  "mcpServers": {
    "checkq": {
      "command": "node",
      "args": ["/绝对路径/CheckQ/mcp/checkq-mcp.cjs"],
      "env": {
        "CHECKQ_URL": "http://checkq.local:18888",
        "CHECKQ_API_KEY": "cq_xxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```
> 也可以用 `CHECKQ_PASSWORD` 代替 `CHECKQ_API_KEY`（会走登录流程），但**不推荐给外部 Agent**。



### 2.6 IP 允许名单 / 黑名单（访问控制）

| 能力 | 位置 | 作用 |
|---|---|---|
| **Key 级允许名单** | 设置 → API Key →「允许 IP」 | 只允许名单内的来源 IP 使用这把 Key（支持 CIDR，如 `192.168.1.0/24`）；名单外返回 403 |
| **全局 IP 黑名单** | 设置 → 账号安全 →「访问控制（IP 黑名单）」 | 被拉黑的 IP **登录和 API Key 都被拦**（与 qinglong / qiandao 的黑名单同级能力） |

> ⚠️ Docker 端口映射下，容器看到的来源 IP 是网关地址（通常 `172.17.0.1`），不是真实客户端 IP。
> 因此 IP 名单依赖 `X-Forwarded-For`：CheckQ 优先取该头的第一个地址。请让调用方（Agent / 反代）带上它，或改用 `--network host` 部署。

### 2.4 基础 API（不想用 MCP 时）
- `GET /api` → 接口索引（免登录）：认证方式、端点清单、文档位置；
- `GET /api/openapi.json` → **OpenAPI 3.1** 机器可读描述（免登录），Agent 可据此自动生成客户端/SDK；
- 完整端点见 `docs/API.md` §0 与本文第 5 节。

### 2.5 Key 的回收日期
生成 Key 时可填「回收日期」：
- 到期后该 Key **自动失效并从列表中移除**（不是留着占位）；
- 过期后调用返回 `401 {"error":"API Key 已过期并被回收（<名称>）","expired":true}`；
- 也可以随时点「立即回收」手动吊销。

### 2.3 REST 接入
所有请求带一个头即可：

```bash
curl -H "x-api-key: cq_xxxx" http://checkq.local:18888/api/flows
```

---

## 3. Agent 能做什么（MCP 工具清单，17 个）

| 工具 | 作用 | 需要权限 |
|---|---|---|
| `health` | 连通性/版本自检 | 只读 |
| `whoami` | 当前身份与权限自检 | 只读 |
| `stats` | 任务数/今日运行/成功率/下次调度 | 只读 |
| `notifications_list` | 站内通知（含未读） | 只读 |
| `flows_list` | 列出所有任务（含 cron/enabled/nextRunAt/上次结果） | 只读 |
| `flow_get` | 任务完整定义（nodes/vars/log/notify） | 只读 |
| `flow_logs` | **连续日志流**（多次运行的人话日志，最像 qinglong 面板） | 只读 |
| `runs_list` / `run_get` | 历史运行记录 / 某次运行详情 | 只读 |
| `templates_list` / `template_get` | 模板列表 / 模板详情（变量名与默认值） | 只读 |
| **`flow_run`** | **立即跑一次签到**，返回状态+摘要+人话日志 | 可运行 |
| `flow_update_vars` | **换 cookie / token / ua**（其余字段保留） | 可修改 |
| `flow_update` | 改 name/cron/timezone/jitter/enabled/note | 可修改 |
| `flow_toggle` | 启用/停用定时调度 | 可修改 |
| `flow_create` | 新建任务（可从模板克隆） | 可修改 |
| `flow_notify_test` | 向已配置渠道发测试通知 | 可修改 |

> **刻意不提供**：删除任务、删除模板、修改账号密码、导出含凭据的完整备份 —— 避免 Agent 误删或越权。

---

## 4. 外部 Agent 的典型工作流

```
① whoami / health            确认连得上、权限够
② flows_list                 找到目标签到任务（名字/cron/上次结果）
③ flow_get                   看当前配置：cron 是否启用、变量里有没有 cookie
④ flow_update_vars           cookie 过期 → 换新的 { "cookie": "..." }
⑤ flow_run                   立刻跑一次
⑥ flow_logs / run_get        读人话日志确认结果（成功/失败原因）
⑦ flow_toggle                跑通后按需启用/停用定时
```

示例（让 Agent 做的事，自然语言即可）：
> “用 checkq MCP 找到某个签到任务，把它的 cookie 换成 `xxx`，跑一次，把最后一条日志贴给我。”

---

## 5. REST 端点速查（给写脚本的人）

| 需求 | 方法 | 路径 | 体 |
|---|---|---|---|
| 列任务 | GET | `/api/flows` | — |
| 任务详情 | GET | `/api/flows/:id` | — |
| **跑一次** | POST | `/api/flows/:id/run` | `{}` |
| **连续日志流** | GET | `/api/flows/:id/logs?limit=200` | — |
| **换变量** | PUT | `/api/flows/:id` | `{"vars":{"cookie":"..."}}` |
| 改调度 | PUT | `/api/flows/:id` | `{"cron":"13 0 * * *","enabled":true}` |
| 历史运行 | GET | `/api/runs?flowId=<id>&limit=30` | — |
| 某次运行详情 | GET | `/api/runs/:id` | — |
| 模板列表 | GET | `/api/templates` | — |
| 从模板建任务 | POST | `/api/templates/:id/instantiate` | `{"name":"...","vars":{}}` |
| 测试通知 | POST | `/api/flows/:id/notify-test` | `{}` |
| 运维统计 | GET | `/api/system/stats` | — |
| 站内通知 | GET | `/api/notifications` | — |

完整参考：`docs/API.md`；MCP 说明：`docs/MCP.md`。

---

## 6. 安全边界（给 Agent 的提示词里可以带上）

- 只能通过 API Key 访问；**没有账号密码就拿不到用户管理、2FA、完整备份**；
- 敏感值（cookie/token/密码）**落盘是加密的**，但**API 返回是明文**（Agent 拿得到你给它的那个任务的凭据）→ 只把 key 给可信 Agent；
- 运行日志、审计日志里**不会出现明文凭据**（自动脱敏）；
- Key 可随时在 设置 → API Key 里吊销；
- 建议给 Agent 的 Key 只勾「只读 + 可运行」，把「可修改」留给人工；
- 生产是局域网 HTTP，凭据在链路上是明文 —— 如果 Agent 与 CheckQ 之间跨不可信网络，请先上 HTTPS 反代。

---

## 7. 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| Agent 报 `未登录`（401） | Key 写错/已吊销；或基址带错路径 |
| Agent 报 `API Key 权限不足：需要 run` | Key 只勾了「只读」→ 补勾「可运行」 |
| Agent 跑得动但看不到日志 | 用 `flow_logs`（不是 `flow_get`，后者是配置） |
| Agent 换了 cookie 但没生效 | 变量名要对（`cookie` / `wbToken` / `ua`），可用 `flow_get` 确认变量名 |
| 想知道某任务上次结果 | `flows_list` 里带 `lastRun`；或 `runs_list` |
| 想让 Agent 也拿得到通知 | 任务的「通知渠道」里加 `inbox`（站内通知，零依赖） |

# CheckQ MCP Server — AI-ready 接入指南

> MCP (Model Context Protocol) 服务端：`mcp/checkq-mcp.cjs`，零依赖，Node 18+，stdio JSON-RPC 2.0。
> 任何支持 MCP 的 Agent（Claude Desktop / Cursor / OpenCode / 自研 Agent）都能直接接入。

## 1. 快速启动

```bash
export CHECKQ_URL="http://checkq.local:18888"
export CHECKQ_PASSWORD="your-password"          # 或 CHECKQ_API_KEY
node mcp/checkq-mcp.cjs
```

## 2. 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| CHECKQ_URL | ✅ | CheckQ 基址（无尾斜杠） |
| CHECKQ_PASSWORD | 二选一 | 登录密码（服务端会换 cookie） |
| CHECKQ_API_KEY | 二选一 | X-API-Key（推荐，免登录、免会话过期） |

## 3. 工具定义（9 个）

| 工具 | 参数 | 说明 |
|---|---|---|
| health | {} | 健康检查 |
| flows_list | {} | 列出所有任务（含 cron/enabled/nextRunAt） |
| flow_get | { id } | 读取任务完整定义（nodes/edges/vars/log） |
| flow_run | { id } | 运行任务并返回逐步日志 + 摘要 |
| flow_update_vars | { id, vars } | 更新任务变量（如 wbToken），其余字段保留 |
| runs_list | { flowId, limit? } | 历史运行记录 |
| run_get | { id } | 单次运行完整日志与变量快照 |
| templates_list | {} | 模板列表 |
| stats | {} | 运维健康统计 |

## 4. JSON-RPC 示例

```jsonc
// initialize
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}}}
// → {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"checkq-mcp","version":"0.3.17"}}}

// tools/list
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}

// tools/call
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"flow_run","arguments":{"id":"<flow-id>"}}}
```

响应 `result.content[0].text` 为 JSON 字符串，需再 parse。

## 5. Agent 接入模式（dogfood）

1. **先 `flows_list`** 拿到任务 ID 与 nextRunAt；
2. **`flow_run`** 跑一次，读 `logs` 与 `summary`（`今日积分: 100`）；
3. **`runs_list` + `run_get`** 做历史比对；
4. **`flow_update_vars`** 更新凭据（如 wbToken）；
5. 失败时：`run_get` 读 asserts / missing / errorType 做根因定位。

## 6. 安全

- API Key 优先于密码；Key 只存服务端 meta.json，不回显明文；
- MCP 进程只在本机/内网运行，不把密钥写入日志；
- 所有写操作走 REST，MCP 本身无状态。

## 7. 客户端配置示例

### Claude Desktop (claude_desktop_config.json)
```json
{
  "mcpServers": {
    "checkq": {
      "command": "node",
      "args": ["/path/to/CheckQ/mcp/checkq-mcp.cjs"],
      "env": { "CHECKQ_URL": "http://checkq.local:18888", "CHECKQ_API_KEY": "your-key" }
    }
  }
}
```

### Cursor / OpenCode
同上，按对应客户端的 MCP 配置格式填入 command/args/env。

## 8. 扩展工具（规划）

`flow_create` / `flow_update` / `flow_delete` / `template_instantiate` / `import_curl` 等将在后续版本加入；当前 Agent 可通过 `flow_update_vars` + 直接编辑 flow JSON（`flow_get` 读出 → 修改 → PUT `/api/flows/:id`）完成。

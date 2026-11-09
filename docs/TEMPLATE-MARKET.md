# 模板市场索引规范（P2）

> 市场本体不内置业务模板（PRD §1），仅约定索引 JSON 规范 + 一键导入。`POST /api/templates/from-url {url}` 拉取并入库。

```json
{
  "name": "示例签到模板",
  "desc": "可查签到结果",
  "vars": { "cookie": "", "ua": "Mozilla/5.0" },
  "nodes": [{ "id": "n0", "type": "http", "name": "请求", "x": 0, "y": 0, "config": {} }],
  "edges": [],
  "log": { "level": "all", "keywords": [] }
}
```

### 规则

- `name`、`nodes[]` 必备；`vars` 敏感项（cookie/token/password/secret/key）默认留空
- `nodes` 需可通过 `validateFlow`（name 非空、边引用存在）；导入后 `source="market"`，任务刻意停用
- URL 仅限 `http/https`，超时 10s，单索引 ≤ 1MB（框架体限内）
- 接收方入库后成为普通模板：可改名/改默认变量/导出/批量建任务
- 未上线运营站点，社区自发索引文件即可（JSON 托管任意静态源）

# CheckQ — AGENTS.md

> 球球专用快查手册。产品设计权威文档：`docs/PRD.md`（v0.3）。架构与开发模式详见 check-core skill。

## 系统架构

```
浏览器 (React 18 + @xyflow/react + zustand, web/, vite build → dist)
   │  /api/*  (dev: vite proxy → 8888; prod: 同源)
   ▼
Fastify 单进程 (server/src/index.js → api.js:260)
   ├── engine.js     DAG 执行器 (jexl + 模板渲染 {{var}}，fetch|curl 双后端)
   ├── store.js      JSON 文件存储 /data (flows/runs/templates/meta, 原子写+400ms 节流)
   ├── scheduler.js  croner 定时调度 (每 flow 独立 cron+时区, 60s 对账)
   ├── har-import.js HAR / QD 模板导入
   └── 通知: webhook / telegram / bark (flow 级 + notify 节点级)
```

## 当前状态（2026-10-05 实测）

| 组件 | 当前值 |
|---|---|
| 版本 | v0.1.x + 模板系统（git aab53a3，已推送 GitHub） |
| 生产实例 | 路由器 `http://192.168.2.1:18888`（容器 checkq，数据 `/mnt/nvme0n1-4/checkq/data`） |
| 生产数据 | 18 个 QD 迁移任务已实测 |
| 测试 | `cd server && node test/engine.test.js` → 4/4 |
| 本地开发端口 | dev server 用 `PORT=xxxx DATA_DIR=/tmp/xxx ADMIN_PASSWORD=xxx node src/index.js`，勿占 8889/18888 |
| 模板系统 | 已实现：存为模板 / 模板列表(varNames+taskCount) / 实例化(克隆图+变量合并) / CRUD / debugStopId |
| 未实现 | PRD §8 v0.2 P0：retry/proxy/charset/Set-Cookie/random-delay、cURL 导入、模板导出、CSV 批量、Pick Panel、日志系统、列表搜索筛选 |

## 快速排查步骤

1. 生产实例健康：`curl -s http://192.168.2.1:18888/api/health`
2. 跑单测：`cd /opt/data/checkq/server && node test/engine.test.js`
3. API 冒烟（临时实例）：
   ```bash
   cd /opt/data/checkq/server
   PORT=19998 DATA_DIR=/tmp/cq-test ADMIN_PASSWORD=test1234 node src/index.js &
   curl -s -c /tmp/cq_ck -X POST localhost:19998/api/login -H 'Content-Type: application/json' -d '{"password":"test1234"}'
   curl -s -b /tmp/cq_ck localhost:19998/api/templates
   ```
4. 看生产容器日志：`docker logs checkq --tail 50`（宿主机）

## 迁移/更新清单

| 变更 | 需要同步 |
|---|---|
| 引擎新增节点类型 | `server/src/engine.js`（执行逻辑）+ `web/src/stepTypes.js`（调色板）+ `ConfigPanel.jsx`（配置表单）+ `docs/PRD.md §4.1` |
| API 新增端点 | `server/src/api.js` + `web/src/api.js` + `README.md API 表` + `docs/PRD.md §6` |
| 数据模型变更 | `server/src/model.js`（validateFlow）+ `server/src/store.js` + `docs/PRD.md §2` |
| 部署方式变更 | `README.md` + `Dockerfile` + `docker-compose*.yml` |

## 已知拦截点 / 坑

| 位置 | 机制 | 处理方式 |
|---|---|---|
| 目标站 TLS 风控 | Node fetch (undici) 指纹被识别 | http 节点 `backend: 'curl'` |
| 提取失败 | 变量尾随空白（QD init_env 常见） | 引擎统一 trim；新代码不要破坏 |
| 无入口节点 | 成环 / 所有节点有入边 | validateFlow 报错 + 运行时 500 步上限兜底 |
| 敏感日志 | cookie/authorization 头 | 自动脱敏保留前 12 字符；新日志字段必须走同一脱敏层 |
| 端口冲突 | dev 误占生产端口 | 生产 18888（容器内 8888），宿主开发实例勿用 8889/18888 |

## 关联文件

| 文件 | 作用 |
|---|---|
| `docs/PRD.md` | 产品需求文档 v0.3（路线图 P0/P1/P2、验收标准 §9、待决策点 §10） |
| `server/src/engine.js` | DAG 执行器：节点执行、jexl、断言、模板渲染 |
| `server/src/store.js` | JSON 存储：flows/runs/templates CRUD + 原子写 |
| `server/src/api.js` | 全部 REST 端点 + 登录会话 |
| `server/test/engine.test.js` | 引擎单测（mock fetch，4 项） |
| `web/src/components/FlowList.jsx` | 首页：模板区 + 任务列表 |
| `web/src/components/FlowEditor.jsx` | 编辑器：画布 + 顶栏 + 日志抽屉 |
| `web/src/components/ConfigPanel.jsx` | 节点配置表单（7 种节点） |

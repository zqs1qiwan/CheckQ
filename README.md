# CheckQ

可视化 HTTP 自动化流程引擎 —— 签到、监控、定时任务，拖拽积木式搭建。

Docker 一行部署，导入浏览器 HAR 自动生成流程，条件分支 / 变量提取 / 失败重试全可视化，运行日志完整可见（请求、响应、每一步耗时）。

## 特性

- **模板系统** — 调试好的流程一键「存为模板」，列表管理变量名与任务数；从模板创建任务自动克隆节点图，变量（cookie 等）各任务独立填写
- **积木式流程编辑器** — 类似苹果捷径。HTTP 请求、条件分支、变量赋值、正则提取、延迟、日志、通知，拖拽连线即成流程
- **点选生成逻辑** — 运行后点击响应中的任意 JSON 值或划选文字，一键生成提取/断言/关键字/通知节点，自动接入流程链尾；生成物是标准节点配置，可继续编辑（PRD §4.0）
- **HAR / cURL 导入** — 浏览器 DevTools 的 HAR、qiandao(QD) 框架模板、cURL 命令均可导入，自动识别生成流程图
- **关键字提取与日志三档** — flow 级配置 keywords 正则规则（如提取标题），每次运行自动汇总到运行摘要；日志按 all / failure / summary 三档记录，敏感头（cookie/authorization）自动脱敏
- **条件分支** — jexl 表达式，如 `last.json.code == 0`，按响应内容决定走向
- **错误可见** — 每一步的请求、响应、断言结果、耗时全部落日志，失败时直接看到原始响应内容
- **调试** — 编辑器内「调试到此为止」：从头执行到选中节点即停；「单步运行」逐节点验证
- **cron 调度** — 每个流程独立 cron 表达式，支持时区；任务列表直接显示下次运行时间，支持搜索与筛选（全部 / 已启用调度 / 最近失败）
- **通知** — Webhook / Telegram / Bark 推送运行结果
- **模板导出与批量创建** — 模板导出为 JSON（敏感变量脱敏）；CSV 批量导入一键创建多份任务
- **单容器部署** — 无原生编译依赖，`docker compose up -d` 即用
- **框架即框架** — 不内置任何业务模板；模板来自用户创建 / JSON 导入（产品路线图见 docs/PRD.md）

## 快速开始

```bash
mkdir checkq && cd checkq
curl -O https://raw.githubusercontent.com/zqs1qiwan/CheckQ/main/docker-compose.yml
# 或克隆本仓库后:
docker compose up -d --build
```

```yaml
# docker-compose.yml
services:
  checkq:
    build: .
    ports:
      - "8888:8888"
    environment:
      - ADMIN_PASSWORD=changeme        # 首次登录密码（不设则自动生成并打印到容器日志）
      - TZ=Asia/Shanghai
    volumes:
      - ./data:/data
```

打开 `http://localhost:8888`，新建空白流程拖拽搭建，或导入 HAR / JSON。

## 流程步骤类型

| 类型 | 作用 |
|---|---|
| HTTP | 发请求，模板化 URL/头/体，断言成功/失败，保存响应；可选 `fetch` 或 `curl` 执行后端（curl 用于绕开对 Node fetch TLS 指纹的风控） |
| 条件 | jexl 表达式判断，真/假两个分支出口 |
| 赋值 | 文本模板或表达式计算 → 写入变量 |
| 提取 | 正则从响应体/状态码/响应头提取 → 变量 |
| 延迟 | 等待 N 秒 |
| 日志 | 输出信息到运行日志 |
| 通知 | Webhook / Telegram / Bark |

变量模板语法：`{{var}}`、`{{user.email}}`，缺变量渲染为空并在日志记录缺失名。

## API

所有 `/api/*`（除 `/api/login`、`/api/health`）需登录 cookie。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/login | 登录 |
| GET/POST | /api/flows | 列表 / 新建 |
| GET/PUT/DELETE | /api/flows/:id | 详情 / 保存 / 删除 |
| POST | /api/flows/:id/run | 立即运行（可选 `debugStopId` 调试到指定节点） |
| GET | /api/runs?flowId= | 运行历史 |
| GET | /api/runs/:id | 单次运行详情 |
| POST | /api/import/har | HAR/QD 模板导入 → 流程草稿 |
| POST | /api/import/curl | cURL 命令解析 → HTTP 节点配置 |
| GET/POST | /api/templates | 模板列表 / JSON 导入建模板 |
| GET/PUT/DELETE | /api/templates/:id | 模板详情 / 改名改变量 / 删除（不影响已建任务） |
| POST | /api/templates/from-flow/:flowId | 流程另存为模板（敏感变量脱敏导出） |
| POST | /api/templates/:id/instantiate | 实例化 → 新任务（克隆节点图 + 变量合并） |
| POST | /api/flows/batch | CSV 批量创建任务（每行变量独立） |

## 开发

```bash
# server
cd server && npm install && npm run dev
# web (另开终端)
cd web && npm install && npm run dev   # http://localhost:5173，/api 代理到 8888
# 单测
cd server && node test/engine.test.js && node test/engine-v02.test.js && node test/curl-import.test.js && node test/logging.test.js
```

技术栈：Fastify / React 18 / @xyflow/react / zustand / jexl / croner。零数据库依赖，数据落在 `/data`（flows.json、runs.json、templates.json）。

## License

MIT

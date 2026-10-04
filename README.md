# CheckQ

可视化 HTTP 自动化流程引擎 —— 签到、监控、定时任务，拖拽积木式搭建。

Docker 一行部署，导入浏览器 HAR 自动生成流程，条件分支 / 变量提取 / 失败重试全可视化，运行日志完整可见（请求、响应、每一步耗时）。

## 特性

- **积木式流程编辑器** — 类似苹果捷径。HTTP 请求、条件分支、变量赋值、正则提取、延迟、日志、通知，拖拽连线即成流程
- **HAR 导入** — 浏览器 DevTools 导出的 HAR 和 qiandao(QD) 框架模板均可导入，自动识别生成流程图
- **条件分支** — jexl 表达式，如 `last.json.code == 0`，按响应内容决定走向
- **错误可见** — 每一步的请求、响应、断言结果、耗时全部落日志，失败时直接看到原始响应内容
- **cron 调度** — 每个流程独立 cron 表达式，支持时区
- **通知** — Webhook / Telegram Bot / Bark 推送运行结果
- **单容器部署** — 无原生编译依赖，`docker compose up -d` 即用
- **框架即框架** — 不内置任何业务模板；模板由模板市场提供（规划中），当前通过 HAR / JSON 导入获得流程

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
| POST | /api/flows/:id/run | 立即运行 |
| GET | /api/runs?flowId= | 运行历史 |
| GET | /api/runs/:id | 单次运行详情 |
| POST | /api/import/har | HAR/QD 模板导入 → 流程草稿 |
| GET | /api/templates | 模板列表（框架不内置，市场提供） |

## 开发

```bash
# server
cd server && npm install && npm run dev
# web (另开终端)
cd web && npm install && npm run dev   # http://localhost:5173，/api 代理到 8888
```

技术栈：Fastify / React 18 / @xyflow/react / zustand / jexl / croner。零数据库依赖，数据落在 `/data`（flows.json、runs.json）。

## License

MIT

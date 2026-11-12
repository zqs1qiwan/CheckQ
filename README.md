# CheckQ

可视化 HTTP 自动化流程引擎 —— 签到、监控、定时任务，拖拽积木式搭建。

Docker 一行部署，导入浏览器 HAR 自动生成流程，条件分支 / 变量提取 / 失败重试全可视化，运行日志完整可见（请求、响应、每一步耗时）。


## 📖 文档中心（GitHub Pages）

完整文档站：**<https://zqs1qiwan.github.io/checkq/>**

- 入口：面板顶栏「文档中心」图标 → 文档站（面板不再内置重复引导）
- 站点只讲**框架功能**（不含任何具体签到脚本 —— 那属于模板市场）；`tools/build-wiki.cjs` 从 `docs/` 自动生成，带站内搜索与更新日志（`push` 到 main 时由 `.github/workflows/pages.yml` 自动发布）
- 本地预览：`node tools/build-wiki.cjs` → 打开 `wiki/index.html`

> 首次启用需在仓库 **Settings → Pages → Source** 选 **GitHub Actions**（之后每次 push 自动发布）。

## 特性

- **模板系统** — 调试好的流程一键「存为模板」，列表管理变量名与任务数；从模板创建任务自动克隆节点图，变量（cookie 等）各任务独立填写
- **模板联动** — 派生任务 = 模板 + 各自的参数：模板一改，所有派生任务立刻跟着变（无需任何同步操作）；任务里改了脚本内容会自动转成独立任务
- **积木式流程编辑器** — 类似苹果捷径。HTTP 请求、条件分支、变量赋值、正则提取、延迟、日志、通知，拖拽连线即成流程
- **点选生成逻辑** — 运行后点击响应中的任意 JSON 值或划选文字，一键生成提取/断言/关键字/通知节点，自动接入流程链尾；生成物是标准节点配置，可继续编辑（PRD §4.0）
- **HAR / cURL 导入** — 浏览器 DevTools 的 HAR、qiandao(QD) 框架模板、cURL 命令均可导入，自动识别生成流程图；QD 模板的 `api://util/delay` 转 delay 节点、`util/unicode|urldecode` 转 log 节点、变量 URL 放行（兼容性实测矩阵见 docs/QIANDAO-COMPAT.md）
- **关键字提取与日志三档** — flow 级配置 keywords 正则规则（如提取标题），每次运行自动汇总到运行摘要；日志按 all / failure / summary 三档记录，记录内容四开关（请求头/请求体/响应体/变量快照）与响应体截断长度可配，编辑器顶栏「日志配置」可编辑；敏感头（cookie/authorization）自动脱敏
- **调度抖动** — 流级 `jitterMinutes`（0-30，编辑器顶栏可设）：cron 触发后随机延迟 0-N 分钟，避免整点风控指纹；模板管理弹窗可编辑默认变量值
- **条件分支** — jexl 表达式，如 `last.json.code == 0`，按响应内容决定走向
- **run 级 Cookie 罐** — 一次运行内响应 Set-Cookie 自动入罐，后续同域请求自动携带（登录→签到链开箱即用），显式 Cookie 头同名键优先，节点可退出
- **函数式模板表达式** — `{{md5("f=1&s="+id)|upper}}`、`{{x|default('兜底')}}`、`{{multiply(timestamp('float'),1000)|int}}`，对齐 QD jinja 常用写法，白名单求值无 eval
- **错误可见** — 每一步的请求、响应、断言结果、耗时全部落日志，失败时直接看到原始响应内容
- **调试** — 编辑器内「调试到此为止」：从头执行到选中节点即停；「单步运行」逐节点验证
- **cron 调度** — 每个流程独立 cron 表达式，支持时区；任务列表直接显示下次运行时间，支持搜索与筛选（全部 / 已启用调度 / 最近失败）
- **账号与安全** — 用户名 + 密码登录（多用户 / admin·operator·viewer 角色）、TOTP 两步验证 + 一次性恢复码、会话可吊销、scrypt 加盐哈希（明文不落盘）、API Key 只存摘要、审计日志
- **通知** — 12 种渠道原生集成（站内 / Webhook / Bark / Telegram / Server酱 / PushPlus / 钉钉 / 企业微信 / 飞书 / Gotify / ntfy / 邮件SMTP），钉钉/飞书支持加签；首页 🔔 站内通知中心
- **模板导出与批量创建** — 模板导出为 JSON（敏感变量脱敏）；CSV 批量导入一键创建多份任务
- **日/夜/自动 主题** — 顶栏三段切换，「自动」跟随系统即时刻切换；批量操作默认收起（列表页「批量管理」按需开启），按钮/标题不再折行压缩
- **基础信息可改** — 点任务名打开任务详情（备注、调度、变量、通知渠道…），名字与备注当场就能改；进画布是「更多 → 编辑流程」这样的显式动作
- **下拉不丢** — 所有菜单以浮层渲染并自动避让边界，表格底部那几行的「···」也点得到
- **单容器部署** — 无原生编译依赖，`docker compose up -d` 即用
- **框架即框架** — 不内置任何业务模板；模板来自用户创建 / JSON 导入（产品路线图见 docs/PRD.md）

## 快速开始

```bash
mkdir checkq && cd checkq
curl -O https://raw.githubusercontent.com/zqs1qiwan/checkq/main/docker-compose.yml
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
| 通知 | 12 种渠道（站内 / Webhook / Bark / Telegram / Server酱 / PushPlus / 钉钉 / 企业微信 / 飞书 / Gotify / ntfy / 邮件） |

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
| POST | /api/import/har | HAR/QD 模板导入 → 流程草稿（QD `retry_count/retry_interval` 自动映射为 http 节点 `retry`） |
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
# 全量单测
cd server && for f in test/*.test.js; do node $f; done
```

质量护栏（都可用本地命令跑，命中即 exit 1）：

| 工具 | 作用 |
|---|---|
| `node tools/ui-smoke.cjs <baseUrl>` | UI 冒烟检查：无依赖 CDP 驱动真实浏览器，按 7 种视口 × 明暗主题逐项体检（横向溢出 / 顶栏重叠 / 图标按钮框 / 下拉菜单被裁 / 弹窗 ✕·Esc·滚动锁 / 页面出现 undefined·NaN / 控制台报错） |
| `node tools/copy-audit.cjs` | 文案金标准审计：无常驻说明性文字、无说明性副标题、label 无括号说明 |
| `node tools/secret-scan.cjs` | 秘密扫描：工作区 + 完整 git 历史的高危凭据 + 仓库内容政策 |

UI 冒烟检查需要先起一个本地实例（默认 `http://localhost:19998`）：

```bash
cd server && PORT=19998 DATA_DIR=/tmp/cq-ui ADMIN_PASSWORD=test1234 node src/index.js
node tools/ui-smoke.cjs http://localhost:19998
```

技术栈：Fastify / React 18 / @xyflow/react / zustand / jexl / croner。零数据库依赖，数据落在 `/data`（flows.json、runs.json、templates.json）。

## License

MIT

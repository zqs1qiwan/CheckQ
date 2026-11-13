# CheckQ PRD — 可视化 HTTP 自动化流程引擎

版本: 0.4 (PRD) | 基线代码: v0.3.17 | 维护更新: 2026-11-13 | 状态: v0.2/v0.3 P0 全量实现；**v0.4 产品完整度升级**——通知渠道原生集成、日志 record 三档（干净日志）、使用引导系统、首次启动 bootstrap、存储立即 flush + 备份评估、竞品分析与迭代管理（见 docs/ROADMAP.md / docs/COMPETITIVE-ANALYSIS.md）
定位一句话: **像搭积木一样搭建"自动签到/打卡/监控"类 HTTP 流程，一个模板派生多份任务，全程可视化、可调试、可告警。**

> **续建判断依据**：本仓库并非空仓——已有可运行基线（DAG 引擎、节点体系、Pick Panel、模板系统、SSE 日志、cURL/HAR/QD 导入、全量单测、本地实例验证）。产品目标与现状同向，重建只会丢弃已验证资产。决策：**续建**。缺口用兼容性采样收敛（见 docs/QIANDAO-COMPAT.md），持续回归。

> **维护基线（2026-11-13，覆盖后文旧标记）**：后文各章的 ✅/🔶/⬜ 是历史规划快照，**以实现为准**。当前定版：
> - **模板联动**：派生任务 = 模板 + 各自参数，模板一改所有派生任务立刻跟随；无同步按钮、无版本标记；派生任务改脚本内容自动转独立任务（见 §4.3）。
> - **交互模型**：点任务名 → 任务详情（可改名/备注 + 只读概览）；进画布是显式动作「··· → 编辑流程」；任务行 ··· 只有 编辑流程 / 复制副本 / 启用|停用调度 / 删除；通知渠道、日志配置、存为模板、填 Cookie、任务详情均在**编辑器「更多」**。
> - **任务级失败重试**：默认开启，最多 3 次、指数退避 5 秒起、随机抖动、单次上限 5 分钟；跑满次数仍失败才判定最终失败（见 §4.5、§4.7）。
> - **前端基建**：原生 `<dialog>` + Popover API + `color-scheme` + 容器查询 + `content-visibility`，遵循 Modern Web Guidance 1.0；冷中性石墨双主题（见 §4.14）。
> - **窄屏顶栏**：单行四控件（品牌 / 新建 / 更多 / 设置），主题、通知、文档、身份信息收进「更多」；工具条左右分组各自不拆散。
> - **护栏**：`node tools/ui-smoke.cjs`、`copy-audit.cjs`、`secret-scan.cjs`、`project-audit.cjs`；命中即 exit 1。
> - **脱敏**：仓库只放框架本身；具体站点、模板、实例、账号与本地测试数据一律不入库（由 `tools/secret-scan.cjs` 内容级校验）。

---

## 1. 产品定位

| 维度 | 决策 |
|---|---|
| 目标用户 | 自部署的个人/小团队用户（技术背景可弱） |
| 解决的问题 | 定时签到、打卡、抽卡、库存监控等"模拟 HTTP 请求"类自动化 |
| 对标产品 | qiandao（功能覆盖）+ 苹果捷径（交互形态） |
| 形态 | 单容器 Docker 服务；Web 可视化编辑器；无外部数据库依赖 |
| 核心原则 | 框架不内置任何业务模板；模板来自用户创建/导入/市场 |
| 隐私红线 | 公开仓库、文档、代码注释中不得出现任何真实站点业务信息 |

非目标（明确不做）:
- 无头浏览器/Playwright 执行（保持纯 HTTP，轻量是硬约束）
- 验证码识别、OCR（可由用户自行接入第三方 API 节点）
- 多租户隔离（当前是单实例多用户 + 角色，不做租户级数据隔离）
- 分布式执行、集群调度

---

## 2. 核心概念

```
Template（模板）  一段可复用的流程定义（nodes+edges+默认vars），不含调度和真实凭证
   │  实例化（克隆节点图，变量差异化预填/覆盖）
   ▼
Flow / Task（任务） 模板的实例 + cron 调度 + 真实变量（cookie 等）+ 通知配置
   │  触发：手动 / cron / API
   ▼
Run（运行记录）  一次执行的完整日志（每步请求/响应/断言/耗时）
```

- **变量（vars）**: 流程级 KV，任务创建时从模板默认值预填，用户覆盖；运行时只读模板合成 + 节点写入。
- **敏感变量约定**: 变量名匹配 `cookie|token|password|secret|key` 时，日志中自动脱敏（现实现：cookie/authorization 头保留前 12 字符）。

### 数据模型（现状）

```js
Flow = {
  id, name, note, cron: '30 8 * * *', timezone, enabled,
  vars: { cookie: '...', ua: '...' },
  notify: {
    channels: [
      { type: 'webhook|bark|telegram|serverchan|dingtalk|wecom|feishu', ... }
    ],
    onSuccess: true, onFailure: true,
    template: '[CheckQ] {{flow.name}} {{status}}\n{{message}}',
  },
  log: {                                  // 日志内容配置（§4.7.4）
    level: 'all' | 'failure' | 'summary', // 记录条件：全部 / 仅失败 / 仅摘要
    record: 'log' | 'log-final' | 'all',  // 记录范围：仅 log 节点（默认）/ 合并为一条 / 全部步骤（v0.4.1 默认 log）
    debug: false,                         // 调试模式：保留每步请求/响应细节（v0.4.1，日常关闭）
    include: {                            // 记录内容开关
      reqHeaders: true, reqBody: true, resBody: true,
      varsSnapshot: true,                 // 每步执行后的变量快照（脱敏）
    },
    resBodyLimit: 2000,                   // 响应体记录截断长度（0-100000）
    keywords: [                           // 关键字规则（§4.7.4）：命中高亮 + 提取进摘要
      { name: '积分', regex: '积分[:：]\\s*(\\d+)', from: 'response', into: 'summary' }
    ],
  },
  tplId,                        // 来源模板（可空）
  nodes: [Node], edges: [Edge], createdAt, updatedAt
}
Node = { id, type, x, y, name, config }   // type ∈ STEP_TYPES
Edge = { id, source, sourceHandle, target } // sourceHandle: success|failed|true|false|next
Template = { id, name, desc, source: flow|json, varNames, vars(默认值), nodes, edges }
Run = { id, flowId, trigger: manual|cron|debug|api, status, logs[], vars, finalMessage, durationMs }
```

---

## 3. 现状基线（v0.1.0 已实现）

> PRD 后续章节中标注 ✅=已实现 / 🔶=部分实现 / ⬜=规划

**引擎与节点** ✅
- 7 种节点：http / condition / set / extract / delay / log / notify
- DAG 沿边执行；入口=最左侧无入边节点；防环上限 500 步
- 模板渲染 `{{var}}`、jinja 风格 `{{ua or '默认'}}`、过滤器 `urlencode/json/base64`
- jexl 表达式（condition / set `=` 前缀 / 断言），内置 transform: parseInt / parseFloat / includes / length
- 上下文: `vars`（流程变量）、`last`（上一步响应: status/text/json/headers）、`steps.<nodeId>`（历史步骤响应）
- 断言: jexl 表达式式 + QD 风格正则式（`res[]` 任一命中、from=content/status、取反）
- HTTP 节点: method / headers(可启用禁用) / body / timeout / redirect(follow|manual) / 双后端
- **双后端**: `fetch`（Node 原生）与 `curl`（spawn curl，出站 TLS 指纹不同，用于绕开目标站对 undici 指纹的风控）
- 提取节点: 正则第 1 捕获组 → 变量；`optional` 开关（未命中不失败）
- 响应体日志截断 2000 字符（全量只在 curl 后端落盘临时文件，不持久化）

**模板系统** ✅
- 从流程"存为模板"；JSON 导入；列表（步数/变量数/已建任务数）；改名/改描述；删除（不影响已建任务）
- 实例化: 克隆节点图 + 合并默认变量 + 覆盖传入变量 + 自动命名 `模板名 · 序号`；任务与模板用 tplId 关联
- **模板编辑器**: 改名 / 描述 / 变量默认值编辑；改模板后所有派生任务立刻跟随（当前实现见 §4.3）

**任务与运行** ✅
- 列表页: 名称(点开任务详情) / cron / 调度开关 / 最近运行状态(点开连续日志) / 运行 / 日志 / ···(编辑流程·复制副本·启停调度·删除)
- 运行结果弹窗: 步骤列表、每步展开看请求头(脱敏)/body/响应、同步等待（流程通常 <60s）
- 编辑器内 ▶运行 + ConfigPanel "▶ 调试到此为止"（从头执行到所选节点含，trigger=debug）
- 运行历史: 每 flow 保留 500 条；listRuns(limit=30)

**调度** ✅ croner 实现；分钟级 cron + 每流时区（默认 Asia/Shanghai）；enabled 开关；60s 对账自动重建
**通知** ✅ 流级（webhook/telegram/bark × onSuccess/onFailure）+ notify 节点级
**导入** ✅ HAR → 流程；qiandao 模板 → 流程（含 SKIP 变量过滤、init_env → vars）
**认证** ✅ 多用户 + 角色 + TOTP；session cookie + X-API-Key
**存储** ✅ JSON 文件（flows/runs/templates/meta/notifications），原子写 + 变更立即 flush
**部署** ✅ Dockerfile + docker-compose（端口可按需映射）；服务端全量单测 + 浏览器回归

**已知短板（本 PRD 要解决的）**
1. 无每节点自动重试/退避（当前靠流程图手工连"failed→改UA→再试"）✅ v0.2 已实现（retry 配置 + 指数退避）
2. 无代理支持（qiandao 有）✅ v0.2 已实现（http config.proxy，fetch/curl 双后端）
3. 无 GBK/charset 处理（中文 PT 站乱码）✅ v0.2 已实现（charset 字段，TextDecoder/iconv）
4. 无法从响应捕获 Set-Cookie（签到场景高频需求）✅ v0.2 已实现（getSetCookie/头文件解析）
5. 无循环/遍历节点（翻页、批量元素）⬜ v0.3 P1
6. 编辑器 undo/redo、运行状态回显到画布、复制节点 ✅ v0.4.4 已补齐
7. 模板默认变量不可编辑、无导出 JSON、无 CSV 批量建任务 ✅ v0.2 已实现（导出脱敏 + CSV 批量；默认变量编辑 ✅ v0.3.4）
8. 无 cURL 命令导入、无"复制为 curl" ✅ v0.2 已实现（cURL 导入 + 复制为 curl）
9. 登录无防爆破 ✅ v0.3.4（5 次/10 分钟锁定）；无备份/恢复 ✅ v0.3.5；无运行统计 ✅ v0.3.5
10. 列表无搜索/筛选/分组、无下次运行时间显示 ✅ v0.2 已实现（搜索 + 筛选 + nextRunAt）
11. 无 run 级 cookie 罐（登录→签到链断裂）✅ v0.3 已实现（GAP-C1，cookiejar.js，显式头同名优先，节点可 `cookieJar:false` 退出）
12. 模板表达式层弱于 QD jinja（md5 拼接签名/default/striptags 不可用）✅ v0.3 已实现（GAP-C3，白名单函数式求值，无 eval）
13. QD 导入丢弃 api://util/* 步骤、`data` 请求体丢失、变量 URL 被拒 ✅ v0.3 已实现（GAP-C2/C4/C5）

---

## 4. 功能设计

### 4.0 交互范式：点选即逻辑（Pick-to-Logic）★ 核心差异化

> 定位：其他签到项目要求用户"写好逻辑再跑"，CheckQ 让用户"跑一次、点几下、逻辑自动长出来"。
> 全程不写正则、不写 jexl、不看文档。这是产品的上手体验护城河，优先级高于一切锦上添花。

#### 4.0.1 核心循环（流式组装）

```
配置请求(手填/粘cURL/选HAR) → ▶试运行 → 响应到达(Pick Panel)
     ↑                                        ↓
     └── 需要第二个请求? ←── 点选元素 → 选用途(变量/断言/通知/循环)
                                              ↓
                                    画布流式生长(节点自动生成+自动连线)
```

- 整个流程在前端以「试运行 → 点选 → 生长」循环流式组装，画布实时生长，没有"先写完再跑"模式。
- 试运行响应通过 SSE 流式到达（复用 §4.7 实时日志通道），长响应边到边渲染。

#### 4.0.2 Pick Panel（点选面板）✅ v0.2（JSON 树 + 四用途；文本划选/HTML 渲染 ⬜ v0.3）

试运行结果 / 运行日志详情中的响应体，按内容类型智能渲染成三种可点选视图：

| 视图 | 触发条件 | 交互 | 生成物 |
|---|---|---|---|
| **JSON 树** | 响应可解析为 JSON | 树形展开，点击任意叶子值 | 路径 `last.json.data.token`（数组含下标）✅ |
| **文本选择** | 纯文本 / HTML 源码 | 划选一段文字 | 自动泛化正则（见 4.0.3）⬜ v0.3 |
| **渲染 HTML** | HTML 响应 | 沙箱 iframe 渲染，点击元素 | CSS 选择器（v0.3）/ 可见文本正则（v0.2）⬜ v0.3 |

点选后弹出**用途选择器**（popover，五选一）：

| 用途 | 生成的后端逻辑 | 说明 |
|---|---|---|
| 存为变量 | `extract` 节点（json 路径 / 正则），变量名自动起名可改 | 自动插入到产出请求节点之后（沿 success 边）✅ v0.2（接入链尾） |
| 断言成功 | 合并进该 http 节点的 asserts：点选值 → `last.json.status == 'success'` 或正则命中 | 表达式可编辑；多值场景生成 `res[]` 多模式 ✅ v0.2 |
| 记录到日志 | flow.log.keywords 追加规则：`{name, regex, from:'response', into:'summary'}` | 点选时顺带起规则名（默认点选文本前几字）；在 §4.7.4 日志配置面板可改 into 与正则 ✅ v0.2 |
| 加进通知 | extract 存变量 + 流末 notify 节点文本 `积分 {{points}}` | 已有 notify 节点则追加变量；没有则自动创建 ✅ v0.2 |
| 是列表/多项 | 提议 `foreach` 节点（v0.3）：点选数组 → 循环体子流程向导 | 翻页/批量场景 ⬜ v0.3 |

#### 4.0.3 自动泛化规则（文本点选 → 正则）

用户划选 `积分：1234`，生成器做确定性变换：

```
数字序列        → \d+
选区两端各扩 8 字符作为锚定上下文
空白            → \s*
正则元字符      → 转义
生成预览        → 积[分：:]\s*(\d+)   （冒号全半角自动兼容）
```

- 预览即时显示：对当前响应高亮命中位置，匹配 0 处或多处时红色提示并建议扩选上下文。
- 用户可直接编辑生成的正则（生成物只是普通 config，不是黑盒）。
- 多个元素连续点选 → 每个元素一个 extract 节点，按点选顺序排列。

#### 4.0.4 确定性原则（信任基础）

1. **前端只是代码生成器**：所有点选产物都是标准节点 config，用户可在 ConfigPanel 查看/修改/删除，无任何隐藏运行时逻辑。
2. **生成节点带 `genBy: 'pick'` 标记**：节点上显示小标记（如 ✦），点击可"解除生成标记"转为普通手工节点。
3. **引擎只新增提取模式，不新增魔法**：
   - extract 节点新增 `mode: 'json'`（dot-path，P0）与 `mode: 'header'/'setCookie'`（P0，见 4.1/4.2）
   - v0.3 新增 `mode: 'css'`（引擎内嵌轻量 HTML 解析器，候选 htmlparser2+css-select，体积最小）
4. **零新增 API**：点选生成完全在客户端完成；试运行复用 §4.6 单测/§4.7 debug 通道。

#### 4.0.5 从日志长逻辑（Run → Flow 闭环）

日志系统（§4.7 Timeline Inspector）与点选打通：

- **失败重修**：extract/断言失败的步骤详情里放「⟳ 重新点选」按钮 → 载入该步**最新真实响应**进 Pick Panel → 重新点选 → **原位替换**该节点 config（不新建）。站点改版后 30 秒修复。
- **事后补逻辑**：看历史日志时发现"这个字段其实我也想要" → 直接在日志响应上点选 → 补生成节点。
- 由此日志系统升级为第二组装入口：**画布是正向组装，日志是逆向组装**，二者共享同一个 Pick Panel 组件。

#### 4.0.5b HAR 导入进流式组装（Pick-Ready）

> HAR 不再是"导入即完成"的一次性转换，而是流式组装的**原材料加载器**。

**导入流程**

1. 用户拖入 `.har` 文件（或粘贴 HAR JSON）→ 前端解析请求列表（时间排序）
2. **请求选择器**：列表展示方法/URL/状态码/响应类型，默认勾选推断出的"业务请求"（排除静态资源：js/css/图片/字体），支持手动增删勾选
3. 点「生成流程」→ 按 §4.9 HAR 导入规则生成 http 节点链（自动连线，变量占位），画布流式生长
4. **自动进入点选模式**：流程自动以"试运行"方式逐节点执行（或用户手动 ▶），每步响应到达即打开 Pick Panel，用户点选变量/断言/通知（§4.0.2）
5. HAR 中已有的敏感头（Cookie/Authorization）自动转为模板变量预填（`{{cookie}}` 等），用户在变量面板替换真实值

**HAR 离线点选（无第二请求也能组）**

- HAR 里每条请求的响应体已包含 → 生成 http 节点时把响应快照存为节点级 `lastRunSample`（仅内存/编辑态，不持久化、不进模板导出）
- Pick Panel 优先显示试运行的真实响应；节点无试运行时回退显示 `lastRunSample`（标记"来自 HAR 样本"）→ 用户**导入后立刻可点选组逻辑，不等真实跑通**
- 试运行成功后样本自动替换为真实响应

**URL 泛化（多环境复用）**

- 生成节点时对比 HAR 内多条请求，路径中数字 ID、hash 段自动提示泛化为 `{{id}}` 变量（默认关闭，确认才改）
- 域名/协议保持原样；query 参数中疑似凭证（token/sid/sign）自动提示转变量

**边界处理**

- 加密/压缩响应体（HAR 中 `content.encoding: base64`）自动解码为可点选文本
- 超大响应（>2MB）仅保留前 2MB 样本并提示
- HAR 中的 WebSocket/事件流条目跳过（不支持），提示用户
- 一键「清除样本」：模板导出前强制执行（样本绝不入库/入模板）

#### 4.0.6 组装向导（Wizard，v0.3）

全屏引导模式（新手默认入口），画布在向导下方同步生长：

1. **请求**：粘贴 cURL / 上传 HAR / 手填 URL → 自动生成 http 节点（含 §4.9 cURL 导入解析）
2. **点选**：自动试运行 → Pick Panel → 按需多轮点选（变量/断言/通知）
3. **链式请求**（可选）：若提取出 token/cookie，提示"要带去下一个请求吗？" → 新 http 节点模板已预填 `{{token}}`，重复步骤 2
4. **收尾**：通知渠道（TG/Bark/webhook 表单）→ 调度（cron 预设 + 抖动开关）→ 起名
5. **出口**：存为模板 →（可选 CSV 批量建任务）→ 完成，展示任务卡片

随时「返回画布」切换自由模式，已生成内容完整保留。

#### 4.0.7 验收基准（本节独立 DoD）

- 从一段 cURL 到"带通知的签到模板"≤ 5 分钟，全程不写正则/表达式/文档查询
- 点选生成的每个节点，人工在 ConfigPanel 检查后可直接运行（生成即正确）
- 断言失败场景：从日志重新点选 → 原位替换 → 立即重跑成功，全程 ≤ 1 分钟

### 4.1 节点类型全集

现有 7 种保持，扩展以下类型。调色板按四组分类展示：

| 组 | 节点 | 状态 | 说明 |
|---|---|---|---|
| 请求 | http | ✅ | method/url/headers/body/timeout/redirect/backend/asserts |
| 请求 | http-retry | ✅ v0.2 | http 节点内置重试配置（见 4.2），不新增节点类型 |
| 逻辑 | condition | ✅ | jexl 表达式 → true/false 双出口 |
| 逻辑 | foreach | ⬜ | 遍历数组（来自 last.json.xxx 或 vars），循环体=子流程段；出口: next(完) / each(体) |
| 逻辑 | loop | ⬜ | 计数循环 n 次 + 间隔（防检测随机间隔） |
| 逻辑 | random-delay | ✅ v0.2 | 在 [min,max] 秒间随机等待（反风控核心件） |
| 逻辑 | script | ⬜ | 受限 JS 沙箱（无 require/网络/fs，超时 1s），复杂逻辑兜底 |
| 数据 | set | ✅ | 变量赋值（模板串或 `=`表达式） |
| 数据 | extract | ✅ v0.2 | last.text/json/status/vars/headers/setCookie + mode:json(dot-path)/regex/header/setCookie |
| 数据 | log | ✅ | 输出文本到运行日志 |
| 通知 | notify | ✅ | webhook/telegram/bark |
| 高级 | proxy-mark | ⬜ | 不作为独立节点；http 节点 config 增 proxy 字段（见 4.2） |

extract 新增能力细则:
- `from: last.headers` + `name: set-cookie` → 把该响应头数组拼接存入变量（多 cookie 用 `; ` 连接）
- `from: last.setCookie` 快捷项：直接提取 Set-Cookie 头的 `k=v` 对列表，可选"只保留名字匹配 /regex/ 的对"
- 用途闭环: 登录节点 → extract setCookie → 后续请求头 `Cookie: {{cookies}}`

foreach 细则:
- `source`: jexl 表达式，求值结果必须为数组
- `itemVar`: 迭代变量名（如 `item`），循环体内 `{{item.xxx}}` 可用；自动注入 `{{index}}`
- 循环体识别: 从 each 出口沿边走直到汇合点（图算法求 dominator，或简化为"回到 foreach 自身的边即体结束"）
- 防呆: 循环体上限 200 次迭代 × 全局 500 步不变

script 沙箱细则:
- 只注入 `vars`、`last`、`steps`；返回值对象合并回 vars（`return { token: xxx }`）
- 禁网/禁 fs/禁 process；单次执行 50ms 软超时 → 用 `new Function` + 白名单全局实现，失败则该节点失败
- 这是"逃生舱"不是常规路径，UI 上标注"高级"

### 4.2 流程引擎增强

| 能力 | 设计 | 优先级 |
|---|---|---|
| 每节点重试 | config 增 `retry: { times: 0-5, backoffMs: 500-30000, retryOn: 'error'|'assert'|'both' }`；重试期间重渲染模板（UA 轮换场景可用 `{{ua|rotate}}`） | ✅ v0.2（\|rotate P1） |
| UA 轮换过滤器 | 渲染层新增 `|rotate`：每次重试从 vars.uaList（逗号分隔）取下一个 | ⬜ P1 |
| 代理 | http config 增 `proxy: { url }`（http/https/socks5h）；fetch 后端用 undici ProxyAgent，curl 后端映射 `--proxy`；值支持 `{{proxyVar}}` | ✅ v0.2 |
| charset | http config 增 `charset`（默认 utf-8，可选 gbk/gb2312/big5）；fetch 路径: ArrayBuffer → TextDecoder；curl 路径: 管道 iconv | ✅ v0.2 |
| Set-Cookie 捕获 | fetch: `getSetCookie()`；curl: 头文件解析，支持 `-c cookieJar`（可选） | ✅ v0.2 |
| run 级 Cookie 罐 | 一次运行内 http 节点共享：Set-Cookie 自动入罐（Domain 子域共享/空值删除），后续同域请求自动携带；显式 cookie 头同名键优先；节点 `cookieJar:false` 退出；命中落 stepLog `detail.jar` | ✅ v0.3（GAP-C1） |
| 函数式模板表达式 | `{{md5("a"+var+"b")\|upper}}` 白名单函数求值（md5/sha*/multiply/divide/add/sub/int/float/str/timestamp('float')/urlencode/quote_chinese/b64*/upper/lower + 拼接/字面量）；过滤器增 `default()`/`int`/`float`/`striptags`；管道切分尊重引号 | ✅ v0.3（GAP-C3） |
| HTTP/2 | curl 后端 config 增 `http2: true` → `--http2`（TLS 指纹场景常配套） | P1 |
| 失败即停 vs 继续 | http 节点 failed 出口未连线时默认停（现状）；新增流级开关 `onError: stop|continue`（continue 时记录失败继续走入口下一个可走节点，用于"多签到并行"图） | P2 |
| 流级超时 | 流级 `maxDurationMs`（默认 120s），超时 kill 并落日志 | P1 |
| 并发保护 | 同一 flow 同时只允许 1 个运行（第 2 个请求返回 409 或排队，UI 可见"排队中"） | P1 |
| 响应大小上限 | fetch/curl 默认截断 2MB 防内存爆 | P1 |

重试语义（与断言的关系）:
1. 网络错误/超时 → 计入 retry
2. 断言失败且 retryOn 含 assert → 计入 retry（重渲染变量）
3. 重试耗尽仍失败 → 走 failed 出口（未连则流失败，现语义）

### 4.3 模板系统

| 功能 | 设计 | 状态 |
|---|---|---|
| 存为模板 | 流程编辑器一键存（现 prompt 输入名字）→ 改为小弹窗：名字 + 描述 + **勾选哪些变量作为"模板变量"**（未勾选的保留在流程里不抽离） | 🔶 |
| 默认变量编辑 | 模板管理弹窗可编辑每个 varName 的默认值（textarea），实例化时预填 | ✅ v0.3.4 |
| 导出 | 模板卡片"导出 JSON"（下载 .json，含 name/desc/vars/nodes/edges，**不含任何真实凭证——导出前将敏感默认值置空**） | ✅ v0.2 |
| 导入 | 现有 JSON 导入直接进模板库（现进流程 ⬜ 需改）；格式校验 + 报错定位 | 🔶 |
| CSV 批量建任务 | 模板卡片"批量创建"：粘贴 CSV（首行=变量名，一列可映射到任务名），预览表格 → 确认生成 N 个任务 | ✅ v0.2 |
| 模板市场 | 框架内置"从 URL 导入"和"粘贴 JSON"；市场本体是独立仓库/站点（框架不内置业务），提供市场索引 JSON 规范：`{name, desc, url, vars, sha256}`，一键拉取校验后入库 | ⬜ P1 |
| 模板联动 | 派生任务 = 模板 + 各自参数：**模板一改，所有派生任务立刻跟随**（`store.resolveFlow()` 读时取模板当前流程图）；无「更新到模板版本」按钮、无「待更新」标记；模板删除后回退到任务自己保存的最后一份流程图 | ✅ 定版 |
| 派生任务改脚本 | 派生任务改了**脚本内容**（稳定序列化比较、忽略节点坐标）→ 自动转为独立任务并提示一次（`PUT` 返回 `detached`）；变量值、通知渠道保留，日志配置随模板 | ✅ 定版 |
| 删除保护 | 模板删除时若有关联任务，弹窗提示数量；任务不受影响（现语义保持） | ✅ |

CSV 批量创建格式:
```csv
name,example_token,note
task-01,placeholder-a,示例 A
task-02,placeholder-b,示例 B
```
- `name` 列可选（缺省自动 `模板名 · 序号`）；其余列名必须 ⊆ 模板 varNames，多余列报错
- 预览页可勾选跳过某行；生成后跳回列表并高亮新任务

### 4.3.1 模板携带日志配置

模板定义收敛为四要素，确保"拿到模板 + 填变量 = 能跑"：

```
Template = {
  meta: { name, desc, version },
  flow:  { nodes, edges, log },     // 流程结构 + 日志配置（level/include/keywords）
  vars:  { 默认值（敏感项为空） },    // 实例化时预填
  samples: 清空                      // HAR 样本永不入模板（见 §4.0.5b）
}
```

- 模板级 `flow.log`（日志档位/开关/关键字规则）→ 实例化时完整复制，任务各自可改
- 导出模板时**关键字规则保留**（规则不是敏感数据），样本响应与默认变量中的敏感值清空
- 导出 JSON 显式标记 `samplesIncluded: false`，接收方导入时可校验

### 4.4 任务管理

| 功能 | 设计 | 状态 |
|---|---|---|
| 列表 | 列：名称/备注、调度、下次运行、状态、上次运行、操作；只读来源模板标注；表头 sticky、窄屏横滚时操作列固定 | ✅ |
| 搜索/筛选 | 顶部搜索框（名称/备注）；筛选: 全部 / 已启用调度 / 最近失败 | ✅ |
| 批量操作 | 「批量管理」勾选 → 批量运行 / 启用 / 停用 / 删除（`POST /api/flows/batch`） | ✅ |
| 立即运行 | 行内「运行」；运行中显示「运行中…」 | ✅ |
| 运行排队 | 同任务串行队列，第二次请求进入排队；统计里显示排队中任务数 | ✅ |
| 任务详情 | 点任务名打开：改名 / 改备注 + 只读概览（调度、时区、状态、重试策略、下次/上次运行、流程规模、变量（敏感项遮蔽）、通知渠道、来源模板、创建/修改时间） | ✅ 定版 |
| 克隆任务 | 行内"复制"→ 复制为新任务（名字 + ` · 副本`，保留 tplId/jitter/log） | ✅ v0.2 + v0.3.4 修复 |
| 删除确认 | ✅ confirm 弹窗（保持） | ✅ |

### 4.5 调度系统

| 功能 | 设计 | 状态 |
|---|---|---|
| cron 编辑 | 编辑器"调度"卡片：常用预设下拉（每天 8 点/每小时/工作日…）+ 高级 cron 输入 + 即时校验（croner 解析失败即红框提示）+ 显示未来 3 次运行时间 | 🔶 |
| 时区 | 每流时区（现有），默认 Asia/Shanghai | ✅ |
| 随机抖动 | 流级 `jitterMinutes: 0-30`：触发时刻在 cron 点后随机延迟 0-n 分钟（反风控整点指纹；编辑器顶栏可设） | ✅ v0.3.4 |
| 错峰预设 | cron 预设里提供"每天随机时间 8-10 点"这类模板（本质 jitter） | ⬜ P2 |
| 补跑策略 | 容器重启错过的运行：不补跑（保持签到类语义，下次 cron 到点再跑）；页面显示"上次错过的计划时间" | ⬜ P2 |
| 调度健康 | 列表页状态读数条：任务数 / 调度中 / 模板数 / 今日次数 / 成功 / 失败 / 成功率 / 下次调度及任务名 | ✅ |
| **失败重试（任务级）** | 编辑器「调度」里配置：`enabled / maxAttempts / backoff(exponential\|linear\|fixed) / baseDelayMs / maxDelayMs / jitter`；默认开启、3 次、指数退避 5 秒起、上限 5 分钟、equal jitter。**只有最后一次仍失败才判定任务失败**；调试运行不重试；上一次运行/重试未结束时调度跳过下一拍 | ✅ 定版 |

### 4.6 编辑器 UX（ReactFlow 画布）

布局: 顶栏（返回/任务名/保存状态/调度/运行）+ 左侧调色板（分组折叠）+ 中间画布 + 右侧 ConfigPanel（选中节点时）。

交互能力清单:

| 交互 | 设计 | 状态 |
|---|---|---|
| 拖拽建节点 | 调色板拖入画布 ✅；双击调色板项=放置到视口中心 | 🔶 |
| 连线 | 按出口 handle 拖线 ✅；**failed/true/false 出口未连线时节点上显示橙色小圆点提醒** | ⬜ P0 |
| 删节点/删线 | 选中 Del/Backspace；ConfigPanel 删除按钮 ✅ | 🔶 |
| 复制粘贴 | Ctrl/Cmd+C/V 复制选中节点（含两端都在选区内的连线），粘贴偏移 24px；「更多」菜单也有入口 | ✅ 2026-11-13 |
| Undo/Redo | Ctrl+Z / Ctrl+Shift+Z（或 Ctrl+Y），历史 50 步（nodes+edges 快照）；「更多」菜单有按钮 | ✅ |
| 保存 | Ctrl/Cmd+S；顶栏"未保存"橙点提示（现有） | ✅ |
| 画布 | 缩放/平移/fitView ✅；**MiniMap ✅**；**「整理」按连线层级左→右自动布局 ✅**；对齐吸附（P1） | ✅ |
| 运行回显 | 运行中：当前节点蓝色呼吸框；完成：成功绿框/失败红框 + 角标；**点击画布节点 → 日志抽屉滚到对应步骤；点击日志步骤 → 画布选中并居中** | ✅ 2026-11-13 |
| 日志面板 | 编辑器底部抽屉，步骤 ↔ 画布双向联动；支持「导出 HAR」（默认脱敏） | ✅ 2026-11-13 |
| 试运行节点 | ConfigPanel"▶ 单测此节点"：用当前 vars 执行该节点一次（不落 run 历史，结果就地显示） | ⬜ P1 |
| 调试到此 | ✅ 已有（trigger=debug，不计入调度统计但计入 run 历史） | ✅ |
| 变量面板 | 左侧「流程变量」面板：值打码可显隐、未定义变量提示（missing，引擎已收集） | ✅ |
| 快捷键帮助 | `?` 键弹快捷键速查 | ⬜ P2 |
| 空状态引导 | 空画布中央："从左侧拖入第一个节点，或从模板导入" | ✅ |

ConfigPanel 改进:
- 表达式输入旁"可用上下文"速查折叠块（vars 列表实时生成、last.* 字段说明、常用 transform 一览）
- http 节点 URL 长时自动换行；headers 行内启用开关（现有 ✅）
- 断言"正则含"模式支持可视化测试：贴入样例响应 → 即时显示命中与否
- 每个字段错填即时校验（如正则非法、jexl 语法错）红框 + 悬浮原因

### 4.7 运行与日志

> 日志不是"打印几行字"，而是**可交互的执行溯源器**。它是逆向组装入口（§4.0.5），标准是对标 qd 的 Run Results 但交互更现代。

#### 4.7.1 结构：Timeline + Inspector（双侧联动）

**Timeline（左/上，步骤时间轴）**

- 垂直流式布局，按执行顺序排列每步
- 状态视觉：✅绿点（成功）/ ❌红点（失败，附错误简述）/ ⏳呼吸（运行中）/ 灰虚线（分支未走）
- 每步一行：序号、节点名、耗时、结果摘要
- 运行中通过 SSE 实时追加（引擎 logSink 已支持），自动滚动可暂停

**Inspector（右/下，详情检查器）**

选中任一步骤，详情窗按 Tab 切换：

| Tab | 内容 |
|---|---|
| 请求 | method、URL（变量已渲染+原始对照）、headers（脱敏）、body（JSON 语法高亮） |
| 响应 | status、headers、body（JSON/HTML/文本高亮，2MB 内）、大小、耗时；**此视图即 Pick Panel（§4.0.2）** |
| 断言 | 表格：每条断言「预期 vs 实际」+ 红/绿命中标记；失败时显示差异 diff |
| 上下文 | 该步执行后的 vars 快照 + 本步新增/修改的变量高亮（变量 diff） |

**运行概览头**：状态大图标、总耗时、步骤数（如 18/20）、触发方式、开始/结束时间、最终消息。

#### 4.7.2 联动行为

| 功能 | 设计 | 状态 |
|---|---|---|
| 画布 ↔ 时间轴双向 | 时间轴点击步骤 → 画布选中并居中；画布点击节点 → 日志抽屉滚到该步并短暂高亮 | ✅ 2026-11-13 |
| 失败重修 | 失败步骤详情「⟳ 用真实响应重选修复」→ Pick Panel → 原位替换该节点 config | ✅ |
| 复制为 curl | 请求 Tab 一键复制完整 curl（敏感值完整还原，仅本机调试用） | ✅ |
| 重跑 | 运行详情「重跑」按钮（同 vars 再执行） | ⬜ P1 |
| 导出 | 单次运行导出 HAR（默认脱敏，响应体沿用日志截断） | ✅ 2026-11-13 |

#### 4.7.3 数据与安全

| 功能 | 设计 | 状态 |
|---|---|---|
| 运行历史页 | 任务详情：运行列表（时间/触发/状态/耗时/最终消息），筛选触发方式 | 🔶 |
| 日志详情 | 每步请求(脱敏)/body/响应(截断 2k)/断言结果/耗时 | ✅ |
| 敏感脱敏 | 头部 cookie/authorization 前 12 字符（现有）；**扩展：所有值中命中敏感变量名（cookie/token/password/secret/key）的片段替换 `***`；vars 快照同样脱敏** | ✅ v0.2 |
| 错误分类 | 每步错误标注类型：`network` / `assert` / `engine`，运行抽屉按类过滤 | ✅ |
| 保留策略 | 每 flow 500 条（现有）；runs.json > 50MB 提示清理 | 🔶 |
| 实时推送 | `POST /api/flows/:id/run { "stream": true }` → SSE（start / log / done），引擎 `logSink` 边执行边推 | ✅ |

#### 4.7.4 日志内容配置（记录什么、记多少、提炼什么）

> 日志的记录范围不再是固定值，而是流程级可配置 + 关键字规则提炼摘要。配置存于 Flow.log（见 §2 数据模型），随模板一起复制（模板含默认日志配置）。

**记录条件（`log.level`）**

| 档位 | 记录范围 | 适用场景 |
|---|---|---|
| `all`（默认） | 全部步骤完整记录 | 调试期 |
| `failure` | 成功步骤只记标题行+耗时；失败步骤完整记录（req/res/断言/vars 快照） | 稳定运行期，省空间 |
| `summary` | 不记 req/res，仅记录：最终状态、关键字提取结果、耗时、错误信息 | 长期免维护运行 |

**记录范围（`log.record`，v0.4 新增 / v0.4.1 默认改为 `log`）— 决定日志里出现哪些步骤**

| 档位 | 记录范围 | 适用场景 |
|---|---|---|
| `log`（**默认**） | **仅 log 节点**（+ 失败步骤，失败必须可见） | qinglong/qiandao 风格：只看调教好的干净日志 |
| `log-final` | 所有 log 节点合并为**一条**汇总日志（+ 失败步骤） | 日报式一条结果 |
| `all` | 所有步骤（每个节点一行，含 http/script/条件） | 调试期 |

> 例外保护：流程里**没有 log 节点**时自动退回 `all`，避免"运行成功但日志空白"。

**调试模式（`log.debug`，v0.4.1 新增）— 保留每步请求/响应细节**

| 位置 | 行为 |
|---|---|
| 任务级 | 日志配置里勾选「调试模式」→ 该任务每次运行都记录每步 req/res 细节（日常关闭） |
| 单次级 | 编辑器日志坞勾选「调试」→ **本次**运行临时记录细节（`POST /api/flows/:id/run {debug:true}`），不影响后续计划运行 |
| 关闭时 | 干净模式只留 log 节点输出 + 失败步骤；失败步骤始终保留详情便于排障 |

> 说明：`record` 与 `level` 正交——`record` 决定"哪些步骤出现"，`level` 决定"出现多少细节"。SSE 实时日志与最终保存日志使用同一过滤规则，流式输出即最终结果。

**连续日志流（v0.4.1 新增）— 整个面板一屏滚动看历史**

- `GET /api/flows/:id/logs?limit=&before=` 把该任务**多次运行**的日志拍平成一条时间线；
- 首页任务行「日志」按钮直接打开该视图：按运行分组（旧 → 新，最新在最下），可「加载更早的记录」继续上翻；
- 每组可点「调试」展开该次运行的每步细节；顶部可切「全部 / 仅错误」；
- 编辑器日志坞默认也是简洁人话视图，勾选「调试」才展开每步。

**界面提示级别（v0.4.1 新增，`GET/PUT /api/system/ui`）**

| 级别 | 行为 |
|---|---|
| `error`（默认） | 只在出错时弹右上角提示 |
| `success` | 成功与错误都提示 |
| `all` | 全部提示（含信息类） |

面板上的「今日汇总」始终是**实时数据**（`GET /api/system/stats`），打开首页即见；定时推送是**独立可选**项（「每日汇总推送」，默认关），见 §4.8。

**记录内容开关（`log.include`）**

reqHeaders / reqBody / resBody / varsSnapshot 四项独立开关；resBodyLimit 控制响应体截断长度（默认 2000，0-100000）。低档位（failure/summary）强制忽略更细的 include 开关。

**关键字规则（`log.keywords`）— 从日志中提取关键字**

用户定义 regex 规则，每次运行引擎对响应文本执行提取：

```
{ name: '积分',                    // 规则名（展示用）
  regex: '积分[:：]\\s*(\\d+)',     // 正则，第 1 捕获组为值（无捕获组则取全匹配）
  from: 'response' | 'headers' | 'status',   // 提取来源
  stepId: '<可选，限定节点>',        // 不填 = 对每步响应都尝试
  into: 'summary' | 'var' | 'notify',        // 提取结果的去向
  varName: 'points' }              // into=var 时写入的变量名（供后续节点/通知使用）
```

行为细则：

- **命中即展示**：Timeline 每步行内高亮显示提取值（如 `积分: 1234`），运行概览头汇总展示全部提取结果——"每次运行关心什么值，一眼可见"
- **into=var**：写入流程变量（等价于自动生成 extract 节点的效果，但只影响日志与通知，不影响流程执行——**流程内取值仍用 extract 节点**，规则清晰不混淆）
- **into=notify**：结果自动拼入通知消息（`积分: 1234`），不用手动改 notify 模板
- **into=summary**：仅出现在日志摘要与运行概览
- 命中多个捕获组/多次匹配：全部记录（数组展示）；未命中显示 `—` 不报错
- 正则非法：编辑器即时红框提示（复用 ConfigPanel 校验）；运行时非法规则跳过并记 warning
- **创建方式三种**：① Pick Panel 划选文字→"记录到日志"（自动生成规则，同 §4.0.3 泛化）；② 日志详情查看响应时点选→补规则；③ 编辑器"日志配置"面板手填 regex

**日志配置面板（编辑器）** ✅ v0.2（v0.3.4 补：引擎真正执行 include 四开关 + resBodyLimit；编辑器顶栏日志配置可编辑）

- 编辑器顶栏"日志"按钮 → 抽屉：level 三档选择 + include 四开关 + resBodyLimit + 关键字规则表格（name/regex/from/into 增删改，regex 输入框旁"测试"按钮贴样例即时验证）
- 该面板配置属于流程（模板携带），任务实例化后可各自微调

**关键字规则与 Pick 的关系（防混淆说明）**

- Pick"存为变量" → 生成 **extract 节点** → 影响流程执行（后续请求可用）
- Pick"记录到日志" → 生成 **keywords 规则** → 只影响日志展示/摘要/通知内容
- 两者可一键互转（extract 节点↔keywords 规则，语义对齐时）

#### 4.7.5 任务级失败重试（定版）

一次「运行」= 最多 `retry.maxAttempts` 次**整流尝试**，与 http 节点内的节点级重试互补：

| 层 | 触发 | 粒度 | 默认 |
|---|---|---|---|
| 节点级 `config.retry` | 单请求网络错误 / 断言失败 | 同一次执行内立刻重发 | 关闭 |
| 任务级 `flow.retry` | 整条流程跑完仍失败 | 从头再跑，间隔按退避策略 | **开启，最多 3 次** |

- 退避：`exponential`（5s → 10s → 20s …）、`linear`、`fixed`；`jitter=true` 用 equal jitter 避免多任务同时重试；单次等待封顶 `maxDelayMs`。
- **最终失败判定**：只有第 N 次尝试仍失败，`run.status` 才为 `failed`；前几次失败不算任务失败。
- 记录：`run.attempts[]`（次数、开始时间、耗时、成功与否、下次等待毫秒）、`run.attempt`、`run.maxAttempts`；日志插入「第 N/M 次尝试」分隔行；`finalMessage` 与通知模板都带尝试次数。
- UI：调度弹窗可开关与调参并预览等待序列；任务详情显示策略摘要（悬停看完整）；运行抽屉显示「共 N 次尝试」与每次的成败/等待。
- 边界：调试运行（`debugStopId`）不重试；cron 触发时若上一次运行/退避尚未结束则跳过这一拍；老数据启动自动迁移到默认配置；非法值由 `normalizeRetry()` 收敛。

### 4.8 通知（v0.4：qinglong 标准原生集成）

| 功能 | 设计 | 状态 |
|---|---|---|
| 渠道 | **站内 / webhook / bark / telegram / serverchan / pushplus / dingtalk / wecom / feishu / gotify / ntfy / 邮件SMTP**（12 种原生集成，无外部脚本） | ✅ v0.4.1 |
| 站内通知 | `inbox` 渠道零依赖：消息落库 notifications.json（上限 200），首页 🔔 未读角标 + 通知弹窗（全部已读/清空） | ✅ v0.4.1 |
| 邮件 | 零依赖 SMTP：465 隐式 TLS / 587 STARTTLS / AUTH LOGIN，支持多收件人、UTF-8 主题 | ✅ v0.4.1 |
| 加签 | 钉钉/飞书机器人 `secret` → HMAC-SHA256 签名（timestamp+sign 拼 URL） | ✅ v0.4 |
| 流级开关 | onSuccess / onFailure | ✅ |
| 消息模板 | 流级 `notify.template`，可用变量: flow.name/status/message/duration/time | ✅ v0.4 |
| 配置 UI | 编辑器 ··· →「通知渠道」：渠道卡片、字段按类型动态显示、保存/测试发送 | ✅ v0.4 |
| 发送测试 | 「测试发送」立即向所有渠道发测试消息并回显成功/失败 | ✅ v0.4 |
| 每日汇总 | 面板上的汇总**始终实时**（`GET /api/system/stats`，打开首页即见）；**定时推送是独立可选项**「每日汇总推送」（默认关）：可选时间 + 目标任务，把"今日 N 次 / 成功 / 失败 / 下次调度"推到该任务的通知渠道；也可「立即推送今日汇总」手动发一次 | ✅ v0.4.1 |
| 界面提示级别 | 右上角提示默认**只报错误**；设置里可切「仅错误 / 成功+错误 / 全部」（`GET/PUT /api/system/ui`） | ✅ v0.4.1 |
| 静默时段 | 失败通知勿扰 23:00-7:00（汇总里合并） | ⬜ P2 |
| 通知节点 | 流程内 notify 节点（webhook/telegram/bark），用于自定义推送内容 | ✅ |

### 4.9 导入 / 导出 / 迁移

| 功能 | 设计 | 状态 |
|---|---|---|
| HAR 导入 | ✅（进流程） | ✅ |
| QD 模板导入 | ✅（含 SKIP 过滤、init_env→vars、api://util/delay→delay 节点、util/unicode|urldecode→log 节点、data 字段→body、变量 URL 放行、retry_count/retry_interval→节点 retry；兼容性实测见 docs/QIANDAO-COMPAT.md） | ✅ v0.3 + v0.3.4 |
| cURL 导入 | 粘贴 curl 命令 → 自动解析 method/url/headers/body 生成 http 节点（覆盖 -H/--data/-b/--compressed/--http2） | ✅ v0.2（12 项单测） |
| 流程导出 | 任务 JSON 导出（含 vars 时警告含敏感信息） | 🔶 v0.2（模板导出已有，任务导出 ⬜） |
| 全量备份 | 设置页"导出全部"（flows/runs/templates/meta 打包 JSON）；"导入恢复"；建议 cron 外部备份 data 目录 | ⬜ P1 |
| 从其他 CheckQ 迁移 | 备份 JSON 互相导入即完成 | 同上 |

### 4.10 账号与安全（v0.4.3：多用户 + TOTP 两步验证 + 会话管理）

| 功能 | 设计 | 状态 |
|---|---|---|
| 账号体系 | 多用户（用户名 + 显示名 + 角色），存 `meta.users[]`；旧版单密码启动时自动迁移为 `admin` | ✅ v0.4.3 |
| 角色 | admin（全部）/ operator（无账号管理）/ viewer（只读，写操作一律 403） | ✅ v0.4.3 |
| 登录 | 用户名 + 密码（+ 可选两步码）；只传密码也兼容；防用户枚举（同文案 + 等价 scrypt） | ✅ v0.4.3 |
| 密码存储 | scrypt(N=16384, r=8, p=1) + 16 字节随机盐，`salt:hash`，常量时间比较；**明文永不落盘** | ✅ v0.4.3 |
| 修改用户名 / 显示名 | 设置 → 账号安全：改用户名需当前密码，改完**吊销全部会话强制重新登录**（对齐 qinglong「修改用户名密码」）；显示名可随时改 | ✅ v0.4.3 |
| 密码策略 | ≥10 位 + 至少两类字符 + 弱口令库 + 不含用户名；改密后其它设备会话失效 | ✅ v0.4.3 |
| 两步验证 | TOTP(RFC 6238, SHA1/30s/6 位) + 10 个一次性恢复码（只存 sha256）；绑定/关闭/重置均需「密码 + 动态码」 | ✅ v0.4.3 |
| 会话 | httpOnly + SameSite=Strict；绝对 7 天 + 空闲 24h；按用户记录，可列出/吊销/退出全部设备 | ✅ v0.4.3 |
| API Key | 多把可命名，服务端只存 sha256 摘要，明文只显示一次，可吊销 | ✅ v0.4.3 |
| 用户管理 | 建号 / 改角色 / 停用 / 重置密码 / 重置 2FA / 删除（管理员）；全部进审计 | ✅ v0.4.3 |
| 审计日志 | 登录、登出、改密、2FA、用户管理、API Key 等关键动作留痕（保留 500 条） | ✅ v0.4.3 |
| 凭据静态加密 | 流程变量 / 通知渠道里的 cookie、token、SMTP 密码等用 **AES-256-GCM** 加密后落盘（`enc:v1:`），密钥在 `data/.secret`(600) 或 `CHECKQ_SECRET`；读盘自动解密、写盘自动加密，旧明文渐进迁移 | ✅ v0.4.3 |
| 备份脱敏 | 「备份」默认脱敏（敏感值清空、渠道密钥 ***）；「完整备份」需再输当前密码才导出明文包 | ✅ v0.4.3 |
| 安全响应头 | CSP / X-Frame-Options / nosniff / Referrer-Policy / Permissions-Policy | ✅ v0.4.3 |
| CSRF 防护 | 写操作校验 `Origin` 同源 + Cookie SameSite=Strict | ✅ v0.4.3 |
| 登录限流 | 按 IP 5 次/10 分钟；按账号 8 次锁定 15 分钟 | ✅ v0.4.3 |
| Passkey / WebAuthn | 免密登录（P2） | ⬜ P2 |

> 安全自查、已知风险与运维手册见 `docs/SECURITY.md`；实现见 `server/src/auth.js`（哈希/策略）、`server/src/totp.js`（TOTP）。

### 4.11 运维与部署

| 项 | 设计 | 状态 |
|---|---|---|
| 部署 | docker compose up -d；镜像发布 ghcr | 🔶 |
| 数据卷 | data 目录挂载；升级只换镜像不动数据 | ✅ |
| 健康检查 | /api/health + compose healthcheck | 🔶 |
| 统计面板 | 首页顶部小卡：任务/调度/今日成功率/**下次调度**（label 明确为"所有已启用任务中最近的一次"） | ✅ v0.4 |
| 存储可靠性 | 每次变更**立即 flush**（原子写 tmp+rename）+ SIGTERM/SIGINT flush；评估见 docs/STORAGE-BACKUP.md | ✅ v0.4 |
| 备份/恢复 | `GET/POST /api/system/backup|restore`（恢复新 ID 停用） | ✅（自动定时备份 ⬜ P1） |
| 日志 | 服务自身 stdout 精简日志；业务日志全在 runs | ✅ |

### 4.12 使用引导（v0.4）

| 功能 | 设计 | 状态 |
|---|---|---|
| 入口 | 顶栏 `?` 按钮（首页 + 编辑器）；首次访问自动打开一次（localStorage `checkq-guide-seen`） | ✅ v0.4 |
| 内容 | 6 节：3 步上手 / 任务列表 / 编辑器 / 日志配置（重要）/ 通知渠道 / 常见问题 | ✅ v0.4 |
| 形态 | 左导航 + 右内容，一屏无滚动；文案全部中文、去技术黑话 | ✅ v0.4 |
| 上下文引导 | 编辑器空画布引导、变量面板「运行日志里出现过未定义的变量」提示 | ✅ |

### 4.13 多步骤事件链（通用能力）

> 框架不内置任何业务事件；下述能力用于把「上报 → 回读进度 → 条件领取 → 幂等重跑」这类多步骤链路搭成流程。

| 能力 | 实现方式 | 状态 |
|---|---|---|
| 事件体生成 | `script` 沙箱或 `set` 节点用表达式拼装请求体；支持时间戳、哈希、随机值 | ✅ |
| 批量上报 | http 节点支持自定义方法 / 头 / body；可用 `foreach` 遍历数组逐项上报 | ✅ |
| 会话与令牌 | run 级 cookie 罐 + `extract` 提取响应里的 token / id，后续步骤引用 | ✅ |
| 进度回读与条件分支 | 再发一个 http 请求 → `condition` 用 jexl 判断是否达标 → 双出口分流 | ✅ |
| 幂等 | 条件判断 + 变量记录「已完成」标记；重复运行不会重复执行副作用步骤 | ✅ 由流程编排保证 |
| 失败可恢复 | 任务级退避重试（默认 3 次）+ 节点级重试；每次尝试有日志与通知 | ✅ |
| 调试 | 调试运行 / 调试到此为止 / 连续日志流，逐步查看请求与响应 | ✅ |

边界：具体接口路径、事件名、进度判定规则都属于**用户自己的业务流程**，通过画布配置，不写进框架、不写进公开文档。

---

### 4.14 UI/UX 规范（2026-11-13 定版）

> 目标：交互「少按钮、强一致、可预期」。本节是所有页面的实现约束，新增页面必须遵守。

#### 4.14.1 弹窗（原生 `<dialog>`）统一骨架

| 元素 | 规范 |
|---|---|
| 头部 | 标题（必填）+ 动态副标题（可选）；**右上角固定 ✕ 关闭按钮**（26×26，hover 描边） |
| 关闭方式 | ✕ / `Esc` / 点击遮罩，三者等价；**底部不再堆「关闭」按钮**（任务详情的「关闭」是次要操作，与保存并列，属例外） |
| 正文 | 独立滚动区（头部与底部操作区固定）；`overscroll-behavior: contain` 阻止滚动链穿透 |
| 底部操作区 | 固定在底部、右对齐；**主操作在最右**，次操作在左；破坏性操作用 danger 样式 |
| 实现 | 统一用 `web/src/components/Modal.jsx`：`showModal()` + `closedby="any"` + `aria-labelledby`；**禁止**手写 `role="dialog"` / `aria-modal` / 焦点陷阱 / `body` 滚动锁 / 自建 `modal-mask` |
| 定位 | 显式 `position: fixed; inset: 0; margin: auto; height: fit-content`，跨浏览器都居中；`dialog.modal:not([open]) { display: none }` 兜底 |
| 焦点 | 首表单控件优先；无表单控件时聚焦 dialog 本身（不要落到右上角 ✕）；关闭后焦点回到触发按钮 |

#### 4.14.2 日志与运行结果

- **唯一日志入口**：任务行的「日志」、状态徽章、运行结束后的提示，都打开同一个「连续日志流」（`LogStream`）；
- 不再保留独立的「运行结果」弹窗，避免同一份数据两种视图；
- 编辑器底部日志坞同样用右上角 ✕ 关闭（并支持 `Esc`）。

#### 4.14.3 触达面积与文案

| 项 | 规范 |
|---|---|
| 图标按钮 | ≥ 30×30px（桌面 32、移动端 38，幽灵边框 + hover 底色）；顶栏 `?` / 主题 / 🔔 / 文档 / 设置 / 日志坞 ✕ |
| 小按钮 | ≥ 26px 高；文字型链接按钮 ≥ 22px 高 |
| 危险操作 | 必须二次确认（`confirm` 或删除态样式），文案说明对象 |
| 文案 | 按钮用动词短语（取消 / 保存 / 创建任务 / 测试发送）；不用 emoji 代替文字（去 emoji 化） |
| 冗余 | 同一动作在弹窗里只出现一次（✕ 与底部「关闭」不共存） |

#### 4.14.4 功能归属

| 功能 | 位置 | 说明 |
|---|---|---|
| 每日汇总推送（定时） | 设置 → 通知与推送 | 默认关；可选时间 + 推送单位（任务） |
| 立即推送今日汇总 | 设置 → 通知与推送 | 面板汇总本身始终实时 |
| 通知渠道 / 日志配置 / 存为模板 / 填 Cookie / 任务详情 | **编辑器「更多」** | 任务级配置；编辑器「更多 → 任务详情…」复用首页同一个 `TaskDetailModal` |
| 点任务名 | 任务详情弹窗 | 改名 / 改备注 + 只读概览；**进画布必须走「··· → 编辑流程」** |
| 任务行 ··· | 编辑流程 / 复制副本 / 启用\|停用调度 / 删除 | 不再有单独的基础信息入口 |
| 任务级「发送每日汇总」 | ❌ 已移除 | 避免与全局推送设置重复 |

#### 4.14.5 布局底线

- 编辑器与首页在 1440×900 下一屏放下，无横向溢出；表格 sticky 表头 + 容器查询，数字等宽 `tabular-nums`；
- 桌面顶栏：`品牌 / 新建 / 更多 / 身份（纯文字） / 动作组（主题·通知·文档） / 设置`，**全部等高、单行、垂直居中**；
- 窄屏（≤640px）：顶栏 `flex-wrap: nowrap`，只保留 `品牌 / + / ⋯ / 设置` 四个 38px 控件；主题、站内通知、文档中心、登录身份收进「更多」菜单（`.mobile-only`）；
- 工具条拆成 `.toolbar-left` / `.toolbar-right` 两组：组内不拆散，组间才折行；搜索框可伸缩，所有控件同高（`--toolbar-h`）；
- 弹窗宽度自适应、内容区独立滚动；日志坞移动端接近全屏；
- 护栏：`node tools/ui-smoke.cjs` 在 7 视口 × 明暗主题下机器检查溢出、重叠、换行、菜单裁剪、弹窗居中与控制台报错。

#### 4.14.6 调试运行 vs 正常运行（v0.4.2）

| 入口 | 行为 | 日志 |
|---|---|---|
| 编辑器「运行」 | 正常执行 | **只输出配置好的日志**（默认 `record=log`：log 节点输出 + 失败步骤）；多余细节不落库 |
| 编辑器「调试运行」/ 节点「调试到此为止」 | 正常执行，但强制记录每步请求/响应 | 展开运行过程窗口（含请求头/体、响应体），可展开每步细节 |
| 任务行「日志」/ 状态徽章 | 不执行 | 打开**连续日志流**（历史多次运行），多余日志在这里查 |

- 日志坞里的「调试」开关只是**视图开关**（看已记录的每步细节），不会改变后续运行记录什么；
- 流程里没有 log 节点时，正常运行会自动退回「记录全部步骤」，避免日志空白。

#### 4.14.7 每日汇总推送的「推送单位」

- 推送单位 = **任务**（用该任务自己的通知渠道发）；
- 设置 →「每日汇总推送」里勾选哪些任务要收汇总（可多选），没有通知渠道的任务不出现；
- 接口：`GET /api/system/push-targets`（可推送单位列表）、`GET/PUT /api/system/daily-summary-config`（`targetFlowIds` 数组）、`POST /api/system/daily-summary`（`flowIds` 或 `flowId`）。

#### 4.14.8 品牌与设计令牌（2026-11-13 定版）

全站尺寸只认一套令牌（`web/src/styles.css` 顶部 `:root`）：

| 令牌 | 值 | 用途 |
|---|---|---|
| `--ctl-h` / `--ctl-h-sm` / `--ctl-h-lg` | 32 / 26 / 38px | 标准 / 小号 / 移动端控件高度 |
| `--ctl-px` / `--ctl-px-sm` | 14 / 11px | 横向内边距 |
| `--r-xs` … `--r-xl` | 2 / 4 / 6 / 8 / 12px | 圆角梯度（收敛，不再处处同圆角） |
| `--fs-xs` … `--fs-xl` | 11 … 17px | 字号梯度 |
| `--sp-1` … `--sp-6` | 4 … 24px | 间距梯度 |
| `--icon-sm/md/lg` | 13 / 16 / 20px | 图标尺寸 |
| `--bg` / `--panel` / `--border` / `--accent` | 夜 `#0b0e11` / `#11151a` / `#232a32` / `#3fa7ad`；日 `#f3f5f6` / `#fff` / `#d9dfe3` / `#14707a` | 冷中性石墨 + 低饱和汽油蓝绿双主题 |

规范：
- 所有按钮（主/次/小/图标/菜单项）走同一高度与圆角，**不得再写行内 padding/height**；
- 状态用「小圆点 + 文字」，不用彩色药丸；`.chip` 是小号方角标签；元信息用 `.meta` 细竖线分隔；
- 图标统一用 `web/src/components/Icons.jsx` 的线性 SVG，**禁止 emoji 充当图标**；设置按钮用滑块式图标（16px 下比多齿齿轮干净）；
- 危险操作统一走应用内确认弹窗（`web/src/confirm.jsx` 的 `confirmDialog`），不再用浏览器 `confirm`；
- 日志坞高度可拖拽（把手 `drawer-grip`），移动端接近全屏。

#### 4.14.9 现代 Web 原生能力（Modern Web Guidance 1.0）

| 能力 | 落地 |
|---|---|
| 弹窗 | 原生 `<dialog>` + `showModal()` + `closedby="any"`；浏览器负责焦点、Esc、背景 inert、顶层渲染 |
| 滚动 | `dialog:modal` / `dialog::backdrop` 的 `overscroll-behavior: contain`（不再给 `html/body` 上锁） |
| 菜单 | Popover API + 顶层渲染；**弹窗内的菜单必须 Portal 到该 `<dialog>` 内部**，否则被 inert 拦住点不到 |
| 主题 | `<meta name="color-scheme" content="dark light">` + `:root` 上的 `color-scheme`；`prefers-reduced-motion` 降级动效 |
| 表格 | 语义 `<table>/<thead>/<th scope>` + `<caption class="sr-only">` + sticky 表头 + `container-type: inline-size`；可聚焦横滚区 |
| 表单 | `autocomplete="current-password" / "new-password" / "one-time-code"`、`:user-invalid`、`aria-label`、`role="alert"` |
| 性能 | 长日志 `content-visibility: auto` + `contain-intrinsic-size` |
| 机械校验 | `npx modern-web-guidance@latest legacy-scan web/src --json`（当前 0 命中）；规范包 `.agents/` 本地留存不入库 |

#### 4.14.10 文案金标准（v0.4.3）

> 用户是**终端用户**，不是需要被科普的开发者。面板里不写"给你讲道理"的说明文字。

| 规则 | 做法 | 反例 → 正例 |
|---|---|---|
| 说明不常驻 | 需要解释的点做成 **label 的 title（悬停标注）** | 「改用户名后所有设备会被登出，需要用新用户名重新登录」常驻 → 移到「新用户名」label 悬停 |
| 只在触发时提示 | 锁定、失败、生成成功等**条件出现**时再给信息 | 「连续失败会临时锁定；忘记两步验证码可用恢复码」常驻 → 锁定时错误显示「账号已锁定，请 N 分钟后重试」；两步验证错误时显示「请输入验证码或恢复码」 |
| 弹窗不带说明性副标题 | 标题已说明的就不要再副标题；只允许**动态信息**（如「13 个节点 · 2 个变量」） | 「日常用「仅 log 节点」；排障时再打开调试模式」→ 删除（默认值本就是它） |
| 保留什么 | 空状态、结果反馈、错误信息、操作必需的一句提示 | 「还没有可推送的任务」「已加入黑名单」「权限不足：需要 write」 |
| 文案给谁看 | 面向终端用户的操作语言，不出现实现细节（scrypt / meta.json / Docker 网关等） | 「密码用 scrypt 加盐哈希保存」→ 删除（属运维文档） |

**机械校验**：`node tools/copy-audit.cjs` —— 扫描 `web/src` 里的常驻说明性文字、说明性副标题、login-hint 与超长中文句子，有则 exit 1（可挂 CI）。

## 5. 签到场景覆盖矩阵（验收核心）

> 要求达到 qiandao 同级的"常见签到都能搭出来"覆盖度。

| 场景 | 需要的能力 | 现状 | 缺口 |
|---|---|---|---|
| JSON API 签到（cookie 头直接带） | http + 断言 code==0 | ✅ | — |
| 表单登录后签到（两步请求） | http 登录 → extract 取 token → http 签到 | ✅ | — |
| 需捕获下发的 cookie | 登录响应 Set-Cookie → 后续请求复用 | ✅ | extract last.setCookie (P0)；v0.3 起另有 run 级 cookie 罐自动携带（GAP-C1） |
| 目标站对 Node TLS 指纹风控 | curl 后端 | ✅ | http2 配套 (P1) |
| GBK 编码站点（老 PT 论坛） | charset 转码 | ✅ v0.2 | — |
| 需代理出口 | proxy | ✅ v0.2 | — |
| 偶发失败需重试 | 节点级重试 + **任务级退避重试（默认 3 次）** | ✅ | — |
| 反自动化风控（整点高峰、固定间隔指纹） | 随机延迟 + cron 抖动 | 🔶 | random-delay 节点 ✅ v0.2；cron jitter ⬜ (P1) |
| 翻页/列表批量操作（如批量保种页面遍历） | foreach | ⬜ | foreach (P1) |
| 多账号同站 | 模板 → CSV 批量建任务 | ✅(手动逐个) | CSV 批量 (P0) |
| 签到结果通知 | TG/Bark/webhook | ✅ | 消息模板 (P1) |
| 签到成功但页面文案变化（如"已签到"双态） | 正则断言多模式 res[] 任一命中 | ✅ | — |
| 复杂签名/加密参数 | 函数式模板表达式（md5/sha* 拼接签名）✅ v0.3；script 沙箱兜底 | 🔶 | script (P1) |
| 302 重定向中转 token | redirect: manual + extract Location | ✅ | — |

---

## 6. API 规格

全部 JSON；除 `login` / `health` / `bootstrap` / `openapi.json` 外需要会话 Cookie 或 `X-API-Key`；写操作校验同源 `Origin`。
完整端点表见 `docs/API.md` 与 `GET /api/openapi.json`，以下为**当前实现基线**（不是规划）：

```
# 任务
GET    /api/flows                        列表（摘要含 lastRun / nextRunAt / retry / template）
POST   /api/flows                        创建（显式 enabled:true 且给 cron 才启用）
GET    /api/flows/:id                    详情（派生任务返回模板当前流程图）
PUT    /api/flows/:id                    部分更新（改脚本内容会自动脱离模板，返回 detached）
DELETE /api/flows/:id                    删除
POST   /api/flows/:id/run               { stream?, debugStopId?, debug? }；失败按 retry 退避重试
POST   /api/flows/:id/clone             复制副本
POST   /api/flows/:id/curl              生成等价 curl
POST   /api/flows/:id/notify-test       测试通知渠道
POST   /api/flows/batch                  batch: run | enable | disable | delete
GET    /api/flows/:id/logs              连续日志流
POST   /api/import/curl / har           cURL / HAR 解析为节点草稿

# 模板
GET/POST /api/templates                 列表 / 新建
GET/PUT/DELETE /api/templates/:id       详情 / 更新（改了模板，派生任务立刻跟随）/ 删除
POST   /api/templates/from-flow/:flowId 从任务存为模板
POST   /api/templates/from-url          从索引 URL 导入
POST   /api/templates/:id/instantiate   实例化
POST   /api/templates/:id/instantiate-csv CSV 批量实例化
GET    /api/templates/:id/export        脱敏导出（samplesIncluded:false）

# 运行记录
GET    /api/runs?flowId=&limit=         历史
GET    /api/runs/:id                    单次完整记录（含 attempts[]）
GET    /api/runs/:id/har                导出单次运行 HAR（默认脱敏，响应体沿用日志截断）

# 系统 / 账号 / 安全
GET    /api/health  /api/me  /api/system/stats  /api/openapi.json
GET/POST /api/system/bootstrap           首次启动建管理员
GET/POST /api/system/backup              脱敏 / 完整备份
POST   /api/system/restore               恢复（新 ID、停用）
GET/PUT /api/system/account | password | users | apikeys | ip-blocklist | audit
GET/PUT /api/system/ai | /api/system/ui | /api/system/2fa/* | /api/system/sessions/*
GET/PUT /api/system/daily-summary-config
GET    /api/system/push-targets
POST   /api/system/daily-summary        立即推送汇总
GET    /api/notifications | POST /api/notifications/read | DELETE /api/notifications
```

**关键数据形状**：`Flow.retry = { enabled, maxAttempts, backoff, baseDelayMs, maxDelayMs, jitter }`（默认开启 / 3 次 / 指数 / 5s / 5min / 抖动）；
`Run.attempts[] = { attempt, startedAt, durationMs, ok, message, nextDelayMs? }`，`Run.attempt / maxAttempts` 供列表与通知展示。

错误约定: 400 参数/校验（附 `error` 中文消息）；401 未登录；403 跨站或权限不足；404 不存在。

---

## 7. 非功能需求

| 项 | 要求 |
|---|---|
| 性能 | 单容器 2 核 1GB 内存可稳定跑 100 任务；JSON 存储在 <10k runs 时无卡顿 |
| 可靠性 | 原子写文件（现有）；进程重启后调度自动恢复（现有）；调度器 60s 对账（现有） |
| 兼容 | 现代 Chrome / Edge / Firefox；移动端可看列表、日志与设置；编辑器窄屏纵向布局 |
| 可观测 | 每步日志含耗时；失败必含失败原因与响应片段；多次尝试逐条记录 | 
| 测试 | 服务端 `node --test "test/*.test.js"`（368 项断言）；每新增能力配单测；关键路径真实浏览器 E2E |
| 文档 | README 部署/快速上手；`docs/` 下 API、MCP、安全、存储、兼容性与 PRD；`wiki/` 由 `tools/build-wiki.cjs` 生成 |
| 护栏 | `ui-smoke`（7 视口 × 明暗 + 弹窗居中/顶栏对齐/菜单裁剪）、`copy-audit`、`secret-scan`（含内容级私有词）、`project-audit`（组件/链接/端点/CSS 契约）；命中即 exit 1 |

---

## 8. 版本路线图

> 迭代状态、优先级与待办见 `docs/ROADMAP.md`；竞品对比见 `docs/COMPETITIVE-ANALYSIS.md`。

**v0.2 — 引擎补课 + 点选即逻辑 MVP（P0 全量）**
- 交互核心：Pick Panel（JSON 树/文本划选/HTML 点击）+ 用途选择器（变量/断言/通知/日志记录）+ 正则自动泛化 + 画布流式生长；日志失败步骤「重新点选」原位修复；试运行单节点（Pick 的数据来源）
- **HAR 进组装**：请求选择器 → 自动生成节点链 + 变量占位 → 自动进入点选模式；HAR 响应快照离线点选（不落地）；URL 泛化提示；模板导出强制清样本
- **日志系统**：Timeline + Inspector 双栏；log.level 三档记录条件 + include 开关；keywords 关键字规则（regex 提取 → 高亮/摘要/通知）；日志配置面板
- 引擎：每节点重试+退避；代理；charset(gbk)；Set-Cookie 捕获；extract json/header 模式；random-delay 节点
- 模板：默认变量编辑；导出(脱敏，含 log 配置)；CSV 批量建任务
- 任务：列表搜索/筛选/下次运行时间；变量弹窗(打码显隐)
- 日志：全量脱敏扩展；复制为 curl；画布↔时间轴双向联动
- 其他：cURL 导入；未连线出口提醒；编辑器变量面板；登录防爆破

**v0.3 — 体验补课（P1 全量）**
- 交互：组装向导 Wizard；HTML 渲染视图点选（CSS 选择器）；foreach 提议流；rendered-HTML 点选
- 节点：foreach/loop/script 沙箱；extract css 模式
- 编辑器：undo/redo/复制粘贴；运行状态回显画布
- 实时：SSE 实时日志（试运行与正式运行共用）；错误分类
- 日志：keywords 与 extract 一键互转；into=var 联动变量面板
- 调度/运行：cron 预设+校验+未来 3 次；jitter；UA 轮换；流级超时/并发排队；单测节点；失败重跑
- 数据：备份/恢复；vars 上下文快照（Inspector 上下文 Tab）
- 通知：消息模板；发送测试
- 任务：批量操作；克隆任务；空状态引导；统计卡(轻量)

**v0.4 — 产品完整度（P0）**
- 通知：多类型渠道原生集成（含加签）+ 配置 UI + 测试发送；
- 日志：`log.record` 三档（all / log / log-final）——干净日志；
- 引导：顶栏 `?` + 分节使用引导，首次自动打开；
- 账号：首次启动 bootstrap 创建管理员；API Key 管理完善；
- 存储：每次变更立即 flush + SIGTERM/SIGINT flush；备份/恢复 API；STORAGE-BACKUP.md；
- UI：「下次触发」→「下次调度」；设置逐项走查（设置/日志/通知/引导一屏无滚动）。

**v0.4.4 — 交互与可靠性（2026-11-13）**
- 任务级失败退避重试（默认 3 次、跑满才判定最终失败）；模板自动跟随；点任务名打开任务详情；
- 原生 `<dialog>` / Popover API / `color-scheme` / 容器查询，遵循 Modern Web Guidance 1.0；冷中性石墨双主题；
- 窄屏顶栏单行四控件、工具条分组、弹窗显式居中；全量交互巡检与 4 个机械护栏；
- 文档与 wiki 同步（PRD / API / 交互规范页 / 上手页），全程脱敏。

**v0.5 — 生态（P2）**
模板市场索引规范 + 从 URL 导入；每日汇总静默时段；错峰预设；补跑提示；MCP 扩展工具已全部落地（flow_create/update/delete/template_instantiate/import_curl）。

**v1.0 — 收敛**
文档完备（节点手册/表达式手册）；镜像发布；性能与压力验证；安全复查。

---

## 9. 验收标准（Definition of Done）

1. **体验验收**: 点选生成逻辑三条基准——导入请求到可用流程无需手写正则；生成节点能直接跑；日志点选可修复断言/提取，全程在浏览器内完成。
2. **导入验收**: 拖入 HAR 或粘贴 cURL → 勾选请求 → 自动生成节点链；不发起真实请求即可基于响应快照配置变量点选与日志规则 → 存为模板 → 实例化填变量可运行。
3. **日志验收**: `log.level` 三档行为符合 §4.7.4；关键字规则命中值进运行摘要与通知消息；Pick「记录到日志」生成的规则可直接使用；长日志不阻塞主线程。
4. **功能验收**: 第 5 节矩阵中已实现项全部有单测或真实浏览器回归证据；新增能力必须补单测。
5. **回归**: 服务端全量单测 368 项断言全绿；`docker commit` 后的镜像重建数据无损。
6. **交互验收**: 新用户 10 分钟内完成「导入模板 → 建 2 个任务 → 启用调度 → 收到通知」，无需看文档；点任务名 = 详情，进画布 = 显式动作。
7. **安全验收**: 日志 / 导出 / 模板导出中搜不到完整 cookie/token；登录爆破被锁定；HAR 样本不入库不入模板。
8. **脱敏红线**: `git grep` 与 `tools/secret-scan.cjs` 均无真实站点、实例、账号或本地测试样例；`tools/project-audit.cjs` 通过。
9. **通知验收**: 各渠道模板变量正确渲染；失败渠道在 UI 明确报错；每日汇总推送单位可勾选。
10. **日志验收（干净日志）**: `record=log` 只含 log 节点（+失败步骤），技术步骤不可见；`record=log-final` 输出一条合并日志。
11. **引导验收**: 首次访问自动打开引导；`?` 在首页与编辑器均可打开；内容一屏可读。
12. **账号与存储验收**: 全新数据目录启动 → 「创建管理员账号」→ 可登录；`kill -TERM` 后配置不丢；备份 JSON 可恢复。
13. **重试验收**: 失败任务按退避策略跑满 N 次才最终失败；`attempts[]`、日志分隔行、通知结论、运行抽屉四处都能看到第几次尝试；调试运行不重试；调度不会在重试期间重复触发。
14. **UI 验收**: `node tools/ui-smoke.cjs` 在 7 视口 × 明暗主题 0 问题；弹窗居中、顶栏单行等高、菜单不被裁、控制台无报错；`npx modern-web-guidance@latest legacy-scan web/src` 0 命中。
15. **文档一致性验收**: `node tools/project-audit.cjs` 通过——组件引用、文档链接、wiki 来源、API 端点、MCP 工具、CSS 契约一致，且无陈旧交互说法。
16. **编辑器效率验收**: 撤销/重做 50 步；复制粘贴保留内部连线并偏移；「整理」按层级排列后无重叠；MiniMap 可见；点击日志步骤能定位画布节点，点击节点能定位日志行。
17. **HAR 验收**: `GET /api/runs/:id/har` 返回 HAR 1.2；只含 http 步骤；cookie/token/密码替换为 `***`；运行抽屉「导出 HAR」能下载 `checkq-run-<id>.har`。

---

## 10. 决策记录与待定项

**已定版（勿回退）**

1. 模板联动 = 自动跟随，不做手动同步 / 版本标记；派生任务改脚本内容自动转独立任务。
2. 点任务名 = 任务详情；进画布 = 「··· → 编辑流程」；任务行 ··· 只有 4 项；编辑器「更多 → 任务详情…」复用同一组件。
3. 弹窗用原生 `<dialog>`，菜单用 Popover API；弹窗内菜单必须挂到该 dialog 内部。
4. 任务级失败重试默认开启（3 次 / 指数退避 / 抖动），跑满次数才判定最终失败。
5. 窄屏顶栏单行四控件，次要动作收进「更多」；工具条分组、弹窗显式居中。
6. 公开仓库只放框架；具体站点、模板、实例、账号、本地测试样例一律不入库。

**待用户决策 / 后续评估**

7. HTML 渲染点选（沙箱 iframe + CSS 选择器）是否投入；当前 JSON 树 + 文本划选已覆盖主流接口。
8. `failed` 出口未连线时默认「停」还是「继续」：建议保持停，`onError: continue` 后续再评估。
9. CSV 单次批量上限：建议 ≤ 50 任务。
10. 模板市场：建议只约定索引 JSON 规范、社区自建，框架不内置业务模板。
11. 列表「标签/分组」与「按模板筛选」优先级：建议先做模板筛选。
12. 生成节点的变量命名策略：建议中英文小词表映射 + 冲突加后缀，用户随时可改。
13. 通知渠道是否继续扩展：按需求追加，保持内核轻量。
14. 多租户隔离：当前单实例多用户 + 角色已足够，租户级隔离留到 v1.0 后评估。
15. ~~编辑器能力缺口~~：本轮已补齐 Undo/Redo（Ctrl+Z / Ctrl+Y）、节点复制粘贴（Ctrl+C / Ctrl+V，含内部连线）、画布↔日志双向联动、单次运行 HAR 导出（默认脱敏）、MiniMap、按层级自动整理布局。
16. 维护文档：`docs/GAP-ANALYSIS*.md` 已删除（内容与 PRD/ROADMAP/COMPETITIVE-ANALYSIS 重复且部分过时）；`FlowList.jsx` 已拆到 `flow-list/`（562 行）、`FlowEditor.jsx` 已拆到 `editor/`（646 行），后续可按同样方式继续下沉 hooks。

## 11. 功能全量测试矩阵（2026-11-13）

> 目标：PRD 里的每个已实现能力都能对应到**代码位置 + 自动化测试 + UI 检测**。
> 自动化命令：`cd server && node --test "test/*.test.js"`；UI：`node tools/ui-smoke.cjs <baseUrl>`、`node tools/ui-interaction-audit.cjs <baseUrl>`；一致性：`node tools/project-audit.cjs`。

### 11.1 引擎与节点

| 功能 | 实现 | 自动化 / 检测 | 状态 |
|---|---|---|---|
| HTTP 请求（fetch / curl 双后端） | `server/src/engine.js` | `engine.test.js`、`engine-v02.test.js`、`qd-compat-e2e.test.js` | ✅ |
| 条件分支（jexl 双出口） | `engine.js` | `engine-v02.test.js` | ✅ |
| 赋值 / 提取（正则 / JSON / 头 / Set-Cookie） | `engine.js` | `engine-v02.test.js`、`filters.test.js` | ✅ |
| 延迟 / 随机延迟 | `engine.js` | `engine-v02.test.js` | ✅ |
| 日志 / 通知节点 | `engine.js` | `logging.test.js`、`notify.test.js` | ✅ |
| 脚本沙箱（1s 超时、只读上下文） | `engine.js` | `script.test.js` | ✅ |
| 遍历 foreach（each/next、50 轮） | `engine.js` | `engine-v02.test.js` | ✅ |
| 变量渲染 / 表达式 / 过滤器 | `render.js` | `filters.test.js`、`text-regex.test.js` | ✅ |
| 断言（jexl + 正则 / 取反） | `engine.js` | `engine.test.js`、`qd-compat.test.js` | ✅ |
| run 级 Cookie 罐 | `cookiejar.js` | `engine-v02.test.js` | ✅ |
| 节点级重试 / 退避 | `engine.js` | `engine-v02.test.js` | ✅ |
| 任务级失败重试（次数 / 最终失败 / 尝试记录） | `retry.js` + `api.js` | `retry.test.js`（含 Store 迁移）+ `har-export` 无关；E2E 已实测 | ✅ |

### 11.2 任务 / 模板 / 调度

| 功能 | 实现 | 自动化 / 检测 | 状态 |
|---|---|---|---|
| 任务 CRUD / 克隆 / 批量 | `api.js` + `store.js` | `p1.test.js`、`batch.test.js`、`api-surface.test.js` | ✅ |
| 任务详情（改名 / 备注 / 只读概览） | `TaskDetailModal.jsx` | UI 冒烟「点任务名开详情」+ 交互巡检 | ✅ |
| 模板自动跟随 / 脚本改动自动脱离 | `store.resolveFlow/sameLogic` | `template-link.test.js` | ✅ |
| 模板导出（脱敏）/ CSV 批量 / URL 导入 | `api.js` | `api-surface.test.js`、`p1.test.js` | ✅ |
| cron / 时区 / 抖动 / 启停 | `scheduler.js` + 调度弹窗 | `p2b.test.js`、UI 冒烟「调度弹窗」 | ✅ |
| 同任务串行排队 / 状态徽章 | `api.js` + `stats` | `p2.test.js`、`p2b.test.js` | ✅ |
| 运行历史 / 连续日志流 | `api.js` + `LogStream.jsx` | `logging.test.js`、UI 冒烟 | ✅ |
| 运行抽屉（重试尝试条 / 变量快照 / 历史） | `RunDrawer.jsx` | 交互巡检 + E2E | ✅ |
| 派生任务来源标注 | `store.templateInfo` | `template-link.test.js` | ✅ |

### 11.3 日志 / 通知

| 功能 | 实现 | 自动化 / 检测 | 状态 |
|---|---|---|---|
| `log.level` 三档 / `log.record` 三档 | `engine.js` + `LogConfigModal` | `log-config.test.js`、`log-clean.test.js` | ✅ |
| 关键字规则 / 运行摘要 | `engine.js` | `log-config.test.js` | ✅ |
| 敏感头与变量脱敏 | `engine.js` + `secret.js` | `logging.test.js`、`secrets.test.js` | ✅ |
| 12 种通知渠道 / 加签 | `api.js` + `NotifyModal` | `notify.test.js`、`email-smtp.test.js` | ✅ |
| 站内通知 / 未读角标 | `api.js` + `FlowList` | `api-surface.test.js`、UI 冒烟 | ✅ |
| 每日汇总推送 / 推送单位 | `api.js` + `SettingsFlow` | `push-units.test.js`、`api-surface.test.js` | ✅ |
| 界面提示级别 | `api.js` + `toast.js` | `api-surface.test.js` | ✅ |

### 11.4 导入 / 导出 / 备份

| 功能 | 实现 | 自动化 / 检测 | 状态 |
|---|---|---|---|
| HAR 导入 | `har-import.js` | `qd-compat.test.js`、`p1.test.js` | ✅ |
| cURL 导入 / 生成 curl | `curl-import.js` + `api.js` | `curl-import.test.js`、`api-surface.test.js` | ✅ |
| QD 模板导入（util / 表达式 / 变量 URL / retry） | `har-import.js` + `render.js` | `qd-compat.test.js`、`qd-compat-e2e.test.js` | ✅ |
| 单次运行导出 HAR（默认脱敏） | `har-export.js` + `api.js` + `RunDrawer` | `har-export.test.js`、`api-surface.test.js`、E2E 下载 | ✅ |
| 脱敏备份 / 完整备份 / 恢复 | `api.js` + 备份弹窗 | `secrets.test.js`、`api-surface.test.js` | ✅ |
| 数据目录 / 原子写 / 立即 flush | `store.js` | `p1.test.js`、`p2.test.js` | ✅ |

### 11.5 账号 / 安全 / API / MCP

| 功能 | 实现 | 自动化 / 检测 | 状态 |
|---|---|---|---|
| 多用户 / 角色 / 禁用 | `auth.js` + `UsersPanel` | `auth.test.js` | ✅ |
| 密码策略 / 限流 / 锁定 | `auth.js` + `api.js` | `auth.test.js`、`login-lockout.test.js` | ✅ |
| TOTP / 恢复码 / 重置 2FA | `totp.js` | `auth.test.js` | ✅ |
| 会话列表 / 吊销 / 退出所有设备 | `api.js` | `auth.test.js`、`api-surface.test.js` | ✅ |
| API Key 作用域 / 回收 / IP 名单 | `auth.js` + `iprange.js` | `agent-access.test.js`、`ip-acl.test.js` | ✅ |
| 凭据静态加密 / 备份脱敏 | `secret.js` | `secrets.test.js` | ✅ |
| REST / OpenAPI 3.1 | `api.js` + `openapi.js` | `api-surface.test.js`（含 HAR 路径） | ✅ |
| MCP 20 工具 | `mcp/checkq-mcp.cjs` | MCP E2E（tools/list + 新增 3 工具） | ✅ |

### 11.6 UI / UX

| 功能 | 实现 | 自动化 / 检测 | 状态 |
|---|---|---|---|
| 原生 `<dialog>` / Popover / 居中 / inert | `Modal.jsx`、`Dropdown.jsx`、`styles.css` | `ui-smoke`（弹窗居中/菜单裁剪）+ 交互巡检 | ✅ |
| 冷中性石墨双主题 / 令牌 | `styles.css` | 交互巡检 9 视口 × 明暗 | ✅ |
| 首页任务表 / 表头 sticky / 窄屏操作列 | `FlowList.jsx` | `ui-smoke`、交互巡检 | ✅ |
| 窄屏顶栏单行四控件 / 更多菜单 | `FlowList.jsx` + CSS | 交互巡检（320/360/390） | ✅ |
| 工具条分组 / 控件等高 | `FlowList.jsx` + CSS | 交互巡检（全视口） | ✅ |
| 设置 5 分区 / API Key 菜单 | `flow-list/settings.jsx` | `ui-smoke`（5 分区 + 菜单）+ 交互巡检 | ✅ |
| 任务详情 / 调度 / 通知 / 日志配置 | `TaskDetailModal.jsx`、`editor/modals.jsx` | `ui-smoke` 弹窗矩阵 | ✅ |
| 编辑器撤销/重做 / 复制粘贴 / 整理 / MiniMap | `FlowEditor.jsx`、`layout.js` | `layout.test.js` + E2E | ✅ |
| 画布 ↔ 日志双向联动 | `FlowEditor.jsx`、`RunDrawer.jsx` | E2E（focus-flash） | ✅ |
| 可访问性（skip link / aria / focus / reduced-motion） | 各组件 + CSS | `ui-smoke` 交互契约 + 手动键盘走查 | ✅ |
| 长日志 `content-visibility` | `styles.css` | 交互巡检无溢出/无报错 | ✅ |
| 二次确认弹窗生命周期（取消 / 确认 / Esc / ✕ 都真正关闭） | `confirm.jsx`（订阅者模型，resolve 同步清 state） | UI 冒烟 4 项 + 交互巡检嵌套确认 | ✅ |
| 提交型弹窗保存后关闭 | `editor/modals.jsx`、各 Modal | UI 冒烟「保存后关闭」 | ✅ |
| 全局提示条自动消失 | `toast.js` | UI 冒烟 2 项（出现 + 5s 后消失） | ✅ |

### 11.7 文档 / 护栏

| 功能 | 实现 | 自动化 / 检测 | 状态 |
|---|---|---|---|
| README / API / MCP / SECURITY / STORAGE / ROADMAP | `README.md`、`docs/` | `project-audit`（链接/端点/MCP/陈旧说法） | ✅ |
| PRD 与实现同步 | `docs/PRD.md` | 本矩阵 + 维护基线 | ✅ |
| 文档站 wiki（含交互规范页） | `tools/build-wiki.cjs`、`wiki/` | `build-wiki` + Pages CI | ✅ |
| 文案金标准 | `web/src` | `copy-audit` | ✅ |
| 秘密 / 私有资产 / 本地测试样例 | 仓库 | `secret-scan`（内容级 + 历史） | ✅ |
| 组件 / 链接 / CSS 契约 | 仓库 | `project-audit` | ✅ |

---

## 12. 迭代记录：连续 3 轮全量验收（2026-11-13）

> 本轮以「PRD 功能全量测试矩阵」为基线，对**每个已实现功能**做回归，连续 3 轮全绿、0 错误。
> 执行方式：`node tools/verify-round.cjs http://localhost:19998`（本地 18 个泛型任务 + 1 个模板，全程只读）。

| 项 | 第 1 轮 | 第 2 轮 | 第 3 轮 |
|---|---|---|---|
| 前端构建（`npm run build`） | ✅ | ✅ | ✅ |
| 服务端全量单测（29 文件 / 431 断言） | ✅ | ✅ | ✅ |
| 文案审计（`copy-audit`） | ✅ | ✅ | ✅ |
| 秘密扫描（`secret-scan`） | ✅ | ✅ | ✅ |
| 项目一致性（`project-audit`） | ✅ | ✅ | ✅ |
| UI 冒烟（`ui-smoke`，60 项 / 0 问题） | ✅ | ✅ | ✅ |
| UI 交互巡检（`ui-interaction-audit`，9 视口 × 明暗，0 findings） | ✅ | ✅ | ✅ |

- 覆盖面：§11 矩阵中全部 ✅ 能力；未实现项（§10 待定）不纳入验收。
- 本轮新增：`server/test/api-surface.test.js`（41 项断言，每个公开端点至少命中一次，含 HAR 路径）、`tools/ui-interaction-audit.cjs`（仓库护栏，固化 9 视口交互巡检）、`tools/verify-round.cjs`（一轮全量验收执行器）。
- **回归复验（用户报「删除确认弹窗不消失」后）**：修复 `confirm.jsx` / `toast.js` / `NotifyModal` 三类弹窗生命周期问题，并补 UI 冒烟 8 项（68 项 / 0 问题）；重新连续 3 轮 `verify-round` 全绿，生产实例只读复验全绿（66 项 / 0 问题）。
- 结论：**当前 PRD 描述的能力集在 3 轮连续验收中均无错误**；后续变更必须按本节基线回归。

---


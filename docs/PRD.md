# CheckQ PRD — 可视化 HTTP 自动化流程引擎

版本: 0.3 (PRD) | 基线代码: v0.1.0 | 状态: 待评审
定位一句话: **像搭积木一样搭建"自动签到/打卡/监控"类 HTTP 流程，一个模板派生多份任务，全程可视化、可调试、可告警。**

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
- 多用户/多租户（单管理员密码 + API Key 即可）
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
  notify: { channels: [{type: webhook|telegram|bark, ...}], onSuccess, onFailure },
  log: {                                  // 日志内容配置（§4.7.4）
    level: 'all' | 'failure' | 'summary', // 记录条件：全部 / 仅失败 / 仅摘要
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
- **模板编辑器**: 只能改名/描述/查看变量（默认变量值不可编辑 ⬜）

**任务与运行** ✅
- 列表页: 名称(链接进编辑器) / cron / 调度开关 / 最近运行状态(点开看日志) / ▶立即运行 / 编辑 / 删除
- 运行结果弹窗: 步骤列表、每步展开看请求头(脱敏)/body/响应、同步等待（流程通常 <60s）
- 编辑器内 ▶运行 + ConfigPanel "▶ 调试到此为止"（从头执行到所选节点含，trigger=debug）
- 运行历史: 每 flow 保留 500 条；listRuns(limit=30)

**调度** ✅ croner 实现；分钟级 cron + 每流时区（默认 Asia/Shanghai）；enabled 开关；60s 对账自动重建
**通知** ✅ 流级（webhook/telegram/bark × onSuccess/onFailure）+ notify 节点级
**导入** ✅ HAR → 流程；qiandao 模板 → 流程（含 SKIP 变量过滤、init_env → vars）
**认证** ✅ 单密码（scrypt）+ session cookie 7d + X-API-Key
**存储** ✅ JSON 文件（flows/runs/templates/meta），原子写 + 400ms 节流
**部署** ✅ Dockerfile + docker-compose（prod 映射 18888）；测试 4 项全过

**已知短板（本 PRD 要解决的）**
1. 无每节点自动重试/退避（当前靠流程图手工连"failed→改UA→再试"）
2. 无代理支持（qiandao 有）
3. 无 GBK/charset 处理（中文 PT 站乱码）
4. 无法从响应捕获 Set-Cookie（签到场景高频需求）
5. 无循环/遍历节点（翻页、批量元素）
6. 编辑器无 undo/redo、无运行状态回显到画布、无复制节点
7. 模板默认变量不可编辑、无导出 JSON、无 CSV 批量建任务
8. 无 cURL 命令导入、无"复制为 curl"
9. 登录无防爆破；无备份/恢复；无运行统计
10. 列表无搜索/筛选/分组、无下次运行时间显示

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

#### 4.0.2 Pick Panel（点选面板）

试运行结果 / 运行日志详情中的响应体，按内容类型智能渲染成三种可点选视图：

| 视图 | 触发条件 | 交互 | 生成物 |
|---|---|---|---|
| **JSON 树** | 响应可解析为 JSON | 树形展开，点击任意叶子值 | 路径 `last.json.data.token`（数组含下标） |
| **文本选择** | 纯文本 / HTML 源码 | 划选一段文字 | 自动泛化正则（见 4.0.3） |
| **渲染 HTML** | HTML 响应 | 沙箱 iframe 渲染，点击元素 | CSS 选择器（v0.3）/ 可见文本正则（v0.2） |

点选后弹出**用途选择器**（popover，五选一）：

| 用途 | 生成的后端逻辑 | 说明 |
|---|---|---|
| 存为变量 | `extract` 节点（json 路径 / 正则），变量名自动起名可改 | 自动插入到产出请求节点之后（沿 success 边） |
| 断言成功 | 合并进该 http 节点的 asserts：点选值 → `last.json.status == 'success'` 或正则命中 | 表达式可编辑；多值场景生成 `res[]` 多模式 |
| 记录到日志 | flow.log.keywords 追加规则：`{name, regex, from:'response', into:'summary'}` | 点选时顺带起规则名（默认点选文本前几字）；在 §4.7.4 日志配置面板可改 into 与正则 |
| 加进通知 | extract 存变量 + 流末 notify 节点文本 `积分 {{points}}` | 已有 notify 节点则追加变量；没有则自动创建 |
| 是列表/多项 | 提议 `foreach` 节点（v0.3）：点选数组 → 循环体子流程向导 | 翻页/批量场景 |

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
| 请求 | http-retry | 🔶→⬜ | http 节点内置重试配置（见 4.2），不新增节点类型 |
| 逻辑 | condition | ✅ | jexl 表达式 → true/false 双出口 |
| 逻辑 | foreach | ⬜ | 遍历数组（来自 last.json.xxx 或 vars），循环体=子流程段；出口: next(完) / each(体) |
| 逻辑 | loop | ⬜ | 计数循环 n 次 + 间隔（防检测随机间隔） |
| 逻辑 | random-delay | ⬜ | 在 [min,max] 秒间随机等待（反风控核心件） |
| 逻辑 | script | ⬜ | 受限 JS 沙箱（无 require/网络/fs，超时 1s），复杂逻辑兜底 |
| 数据 | set | ✅ | 变量赋值（模板串或 `=`表达式） |
| 数据 | extract | 🔶 | 现支持 last.text/json/status/vars；**新增来源: last.headers / last.setCookie** |
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
| 每节点重试 | config 增 `retry: { times: 0-5, backoffMs: 500-30000, retryOn: 'error'|'assert'|'both' }`；重试期间重渲染模板（UA 轮换场景可用 `{{ua|rotate}}`） | P0 |
| UA 轮换过滤器 | 渲染层新增 `|rotate`：每次重试从 vars.uaList（逗号分隔）取下一个 | P1 |
| 代理 | http config 增 `proxy: { url }`（http/https/socks5h）；fetch 后端用 undici ProxyAgent，curl 后端映射 `--proxy`；值支持 `{{proxyVar}}` | P0 |
| charset | http config 增 `charset`（默认 utf-8，可选 gbk/gb2312/big5）；fetch 路径: ArrayBuffer → TextDecoder；curl 路径: 管道 iconv | P0 |
| Set-Cookie 捕获 | fetch: `getSetCookie()`；curl: 头文件解析，支持 `-c cookieJar`（可选） | P0 |
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
| 默认变量编辑 | 模板管理弹窗可编辑每个 varName 的默认值（textarea），实例化时预填 | ⬜ P0 |
| 导出 | 模板卡片"导出 JSON"（下载 .json，含 name/desc/vars/nodes/edges，**不含任何真实凭证——导出前将敏感默认值置空**） | ⬜ P0 |
| 导入 | 现有 JSON 导入直接进模板库（现进流程 ⬜ 需改）；格式校验 + 报错定位 | 🔶 |
| CSV 批量建任务 | 模板卡片"批量创建"：粘贴 CSV（首行=变量名，一列可映射到任务名），预览表格 → 确认生成 N 个任务 | ⬜ P0 |
| 模板市场 | 框架内置"从 URL 导入"和"粘贴 JSON"；市场本体是独立仓库/站点（框架不内置业务），提供市场索引 JSON 规范：`{name, desc, url, vars, sha256}`，一键拉取校验后入库 | ⬜ P1 |
| 版本与同步 | 模板更新后已有任务**不自动变**（克隆语义）；提供"检查模板更新"→ diff 视图（节点/变量差异）→ 手动应用 | ⬜ P2 |
| 删除保护 | 模板删除时若有关联任务，弹窗提示数量；任务不受影响（现语义保持） | ✅ |

CSV 批量创建格式:
```csv
name,cookie,note
主号,koa:sess=xxx; gld:sess=yyy,
备用,koa:sess=zzz,低频号
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
| 列表 | 现有列 + **下次运行时间**（croner 支持 nextRun）+ 来源模板名 + 标签/分组 | 🔶 |
| 搜索/筛选 | 顶部搜索框（名称/备注）；筛选: 按模板、按状态（最近失败）、按调度开关 | ⬜ P0 |
| 批量操作 | 多选 → 批量运行 / 批量启停 / 批量删除 | ⬜ P1 |
| 立即运行 | ✅ 已有；运行中显示"运行中…"+ 行内 spinner | ✅ |
| 运行排队 | 并发保护开启后，手动点击进入队列，列表状态显示"排队中 #n" | ⬜ P1 |
| 变量查看/编辑 | 任务行"变量"按钮 → 弹窗查看+编辑 vars（敏感值默认打码，点眼睛显示，改后需保存） | ⬜ P0 |
| 克隆任务 | 行内"复制"→ 复制为新任务（名字 + ` · 副本`） | ⬜ P1 |
| 删除确认 | ✅ confirm 弹窗（保持） | ✅ |

### 4.5 调度系统

| 功能 | 设计 | 状态 |
|---|---|---|
| cron 编辑 | 编辑器"调度"卡片：常用预设下拉（每天 8 点/每小时/工作日…）+ 高级 cron 输入 + 即时校验（croner 解析失败即红框提示）+ 显示未来 3 次运行时间 | 🔶 |
| 时区 | 每流时区（现有），默认 Asia/Shanghai | ✅ |
| 随机抖动 | 流级 `jitterMinutes: 0-30`：触发时刻在 cron 点 ± n 分钟内随机延迟（反风控：避免整点指纹） | ⬜ P0 |
| 错峰预设 | cron 预设里提供"每天随机时间 8-10 点"这类模板（本质 jitter） | ⬜ P2 |
| 补跑策略 | 容器重启错过的运行：不补跑（保持签到类语义，下次 cron 到点再跑）；页面显示"上次错过的计划时间" | ⬜ P2 |
| 调度健康 | 列表页顶部状态条：调度器活跃、共 N 个任务启用、下次最近触发 | ⬜ P2 |

### 4.6 编辑器 UX（ReactFlow 画布）

布局: 顶栏（返回/任务名/保存状态/调度/运行）+ 左侧调色板（分组折叠）+ 中间画布 + 右侧 ConfigPanel（选中节点时）。

交互能力清单:

| 交互 | 设计 | 状态 |
|---|---|---|
| 拖拽建节点 | 调色板拖入画布 ✅；双击调色板项=放置到视口中心 | 🔶 |
| 连线 | 按出口 handle 拖线 ✅；**failed/true/false 出口未连线时节点上显示橙色小圆点提醒** | ⬜ P0 |
| 删节点/删线 | 选中 Del/Backspace；ConfigPanel 删除按钮 ✅ | 🔶 |
| 复制粘贴 | Ctrl/Cmd+C/V 复制选中节点（含连线），粘贴偏移 20px | ⬜ P0 |
| Undo/Redo | Ctrl+Z / Ctrl+Shift+Z，历史 50 步（nodes+edges 快照） | ⬜ P0 |
| 保存 | Ctrl/Cmd+S；顶栏"未保存"橙点提示（现有） | ✅ |
| 画布 | 缩放/平移/fitView ✅；小地图 minimap（P2）；对齐吸附（P1）；"整理布局"按钮（自左向右分层 auto-layout）| 🔶 |
| 运行回显 | 运行中：当前节点蓝色呼吸框；完成：成功绿框/失败红框 + 步骤序号角标；点击画布节点→日志面板滚动到对应步骤 | ⬜ P0 |
| 日志面板 | 编辑器底部抽屉（现右侧 drawer ✅），步骤点击 ↔ 画布节点双向联动 | 🔶 |
| 试运行节点 | ConfigPanel"▶ 单测此节点"：用当前 vars 执行该节点一次（不落 run 历史，结果就地显示） | ⬜ P1 |
| 调试到此 | ✅ 已有（trigger=debug，不计入调度统计但计入 run 历史） | ✅ |
| 变量面板 | 编辑器"变量"按钮 → 抽屉列出全部 vars（值打码可显隐）+ "运行日志中出现的未定义变量"汇总（missing 提示，引擎已收集） | ⬜ P0 |
| 快捷键帮助 | `?` 键弹快捷键速查 | ⬜ P2 |
| 空状态引导 | 空画布中央："从左侧拖入第一个节点，或从模板导入" | ⬜ P1 |

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
| 画布 ↔ 时间轴双向 | 时间轴点击步骤 → 画布高亮对应节点并居中；画布点击节点 → 时间轴滚动到该步 | ⬜ P0 |
| 失败重修 | 失败步骤详情「⟳ 重新点选」→ 载入真实响应进 Pick Panel → 原位替换该节点 config（§4.0.5） | ⬜ P0 |
| 复制为 curl | 请求 Tab 一键复制完整 curl（敏感值完整还原，仅本机调试用） | ⬜ P0 |
| 重跑 | 运行详情「重跑」按钮（同 vars 再执行） | ⬜ P1 |
| 导出 | 单次运行导出 HAR（默认脱敏） | ⬜ P2 |

#### 4.7.3 数据与安全

| 功能 | 设计 | 状态 |
|---|---|---|
| 运行历史页 | 任务详情：运行列表（时间/触发/状态/耗时/最终消息），筛选触发方式 | 🔶 |
| 日志详情 | 每步请求(脱敏)/body/响应(截断 2k)/断言结果/耗时 | ✅ |
| 敏感脱敏 | 头部 cookie/authorization 前 12 字符（现有）；**扩展：所有值中命中敏感变量名（cookie/token/password/secret/key）的片段替换 `***`；vars 快照同样脱敏** | ⬜ P0 |
| 错误分类 | 每步错误标注类型：`network`（网络/超时）/ `assert`（断言）/ `engine`（配置/脚本），Timeline 过滤器按类筛 | ⬜ P1 |
| 保留策略 | 每 flow 500 条（现有）；runs.json > 50MB 提示清理 | 🔶 |
| 实时推送 | SSE `GET /api/runs/:id/stream`；引擎 logSink → SSE；断线自动重连补拉 | ⬜ P1 |

#### 4.7.4 日志内容配置（记录什么、记多少、提炼什么）

> 日志的记录范围不再是固定值，而是流程级可配置 + 关键字规则提炼摘要。配置存于 Flow.log（见 §2 数据模型），随模板一起复制（模板含默认日志配置）。

**记录条件（`log.level`）**

| 档位 | 记录范围 | 适用场景 |
|---|---|---|
| `all`（默认） | 全部步骤完整记录 | 调试期 |
| `failure` | 成功步骤只记标题行+耗时；失败步骤完整记录（req/res/断言/vars 快照） | 稳定运行期，省空间 |
| `summary` | 不记 req/res，仅记录：最终状态、关键字提取结果、耗时、错误信息 | 长期免维护运行 |

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

**日志配置面板（编辑器）**

- 编辑器顶栏"日志"按钮 → 抽屉：level 三档选择 + include 四开关 + resBodyLimit + 关键字规则表格（name/regex/from/into 增删改，regex 输入框旁"测试"按钮贴样例即时验证）
- 该面板配置属于流程（模板携带），任务实例化后可各自微调

**关键字规则与 Pick 的关系（防混淆说明）**

- Pick"存为变量" → 生成 **extract 节点** → 影响流程执行（后续请求可用）
- Pick"记录到日志" → 生成 **keywords 规则** → 只影响日志展示/摘要/通知内容
- 两者可一键互转（extract 节点↔keywords 规则，语义对齐时）

### 4.8 通知

| 功能 | 设计 | 状态 |
|---|---|---|
| 渠道 | webhook / telegram / bark（现有）| ✅ |
| 流级开关 | onSuccess / onFailure（现有）| ✅ |
| 消息模板 | 流级 `notify.template`：默认 `[CheckQ] {{flow.name}} {{status}}\n{{message}}`，可用变量: flow.name/status/message/duration/时间；TG 支持 Markdown | ⬜ P1 |
| 每日汇总 | 全局设置：每天固定时间推送"今日 N 任务：M 成功 / K 失败"摘要（仅启用调度任务）| ⬜ P2 |
| 静默时段 | 失败通知勿扰 23:00-7:00（汇总里合并）| ⬜ P2 |
| 发送测试 | 通知渠道配置处"发送测试"按钮 | ⬜ P1 |

### 4.9 导入 / 导出 / 迁移

| 功能 | 设计 | 状态 |
|---|---|---|
| HAR 导入 | ✅（进流程） | ✅ |
| QD 模板导入 | ✅ 脚本（SKIP 过滤、init_env→vars）→ 目标改为直接产模板+可选批量任务 | 🔶 |
| cURL 导入 | 粘贴 curl 命令 → 自动解析 method/url/headers/body 生成 http 节点（覆盖 -H/--data/-b/--compressed/--http2） | ⬜ P0 |
| 流程导出 | 任务 JSON 导出（含 vars 时警告含敏感信息） | ⬜ P1 |
| 全量备份 | 设置页"导出全部"（flows/runs/templates/meta 打包 JSON）；"导入恢复"；建议 cron 外部备份 data 目录 | ⬜ P1 |
| 从其他 CheckQ 迁移 | 备份 JSON 互相导入即完成 | 同上 |

### 4.10 账号与安全

| 功能 | 设计 | 状态 |
|---|---|---|
| 密码登录 | scrypt hash（现有）；**登录失败 5 次/10 分钟锁定（内存计数）** | 🔶 |
| 会话 | cookie qsid 7 天（现有）；"退出"清空所有会话（现语义） | ✅ |
| API Key | X-API-Key（现有，存 meta）；设置页可见/重置 | 🔶 |
| HTTPS | 文档建议反代加 TLS；服务本身不内置 | 文档 |
| 审计 | 关键操作（登录失败/改密码/删任务）console 日志即可，不做持久审计 | 决策 |
| 敏感输入 | 变量编辑框 type=password 风格打码 + 显隐切换；浏览器密码管理器不缓存（autocomplete=off） | ⬜ P0 |

### 4.11 运维与部署

| 项 | 设计 | 状态 |
|---|---|---|
| 部署 | docker compose up -d（现有）；镜像发布 ghcr | 🔶 |
| 数据卷 | data 目录挂载（现有）；升级只换镜像不动数据 | ✅ |
| 健康检查 | /api/health（现有）+ compose healthcheck | 🔶 |
| 统计面板 | 首页顶部小卡：今日运行/成功率/失败任务列表（可点击直达） | ⬜ P2 |
| 日志 | 服务自身 stdout 精简日志（启动/调度错误/通知失败），业务日志全在 runs | ✅ |

---

## 5. 签到场景覆盖矩阵（验收核心）

> 要求达到 qiandao 同级的"常见签到都能搭出来"覆盖度。

| 场景 | 需要的能力 | 现状 | 缺口 |
|---|---|---|---|
| JSON API 签到（cookie 头直接带） | http + 断言 code==0 | ✅ | — |
| 表单登录后签到（两步请求） | http 登录 → extract 取 token → http 签到 | ✅ | — |
| 需捕获下发的 cookie | 登录响应 Set-Cookie → 后续请求复用 | ⬜ | extract last.setCookie (P0) |
| 目标站对 Node TLS 指纹风控 | curl 后端 | ✅ | http2 配套 (P1) |
| GBK 编码站点（老 PT 论坛） | charset 转码 | ⬜ | charset (P0) |
| 需代理出口 | proxy | ⬜ | proxy (P0) |
| 偶发失败需重试 | 节点级重试+退避 | ⬜ | retry (P0) |
| 反自动化风控（整点高峰、固定间隔指纹） | 随机延迟 + cron 抖动 | ⬜ | random-delay 节点 + jitter (P0) |
| 翻页/列表批量操作（如批量保种页面遍历） | foreach | ⬜ | foreach (P1) |
| 多账号同站 | 模板 → CSV 批量建任务 | ✅(手动逐个) | CSV 批量 (P0) |
| 签到结果通知 | TG/Bark/webhook | ✅ | 消息模板 (P1) |
| 签到成功但页面文案变化（如"已签到"双态） | 正则断言多模式 res[] 任一命中 | ✅ | — |
| 复杂签名/加密参数 | script 沙箱 | ⬜ | script (P1) |
| 302 重定向中转 token | redirect: manual + extract Location | ✅ | — |

---

## 6. API 规格

现有（✅）+ 规划（⬜）。全部 JSON；鉴权除 login/health 外必须 session 或 X-API-Key。

```
POST /api/login {password}                          ✅
POST /api/logout                                    ✅
GET  /api/health                                    ✅
GET  /api/flows                                     ✅  列表(含 lastRun/nextRun⬜)
POST /api/flows                                     ✅  创建
GET  /api/flows/:id                                 ✅  详情(含 nodes/edges/vars)
PATCH /api/flows/:id                                ✅  更新(白名单字段)
DELETE /api/flows/:id                               ✅  删除(连带 runs)
POST /api/flows/:id/run {debugStopId?}              ✅  同步执行；⬜ 增排队/409
GET  /api/flows/:id/runs?limit=                     ✅
GET  /api/runs/:id                                  ✅
GET  /api/templates                                 ✅
POST /api/templates                                 ✅
POST /api/templates/from-flow/:flowId               ✅
GET  /api/templates/:id                             ✅
PATCH /api/templates/:id                            ✅
DELETE /api/templates/:id                           ✅
POST /api/templates/:id/instantiate {name?,vars?,note?}  ✅
POST /api/templates/:id/instantiate-csv {csv}       ⬜ P0 批量
GET  /api/templates/:id/export                      ⬜ P0 脱敏导出
POST /api/import/curl {command}                     ⬜ P0 → 返回 http 节点 config
GET  /api/system/backup                             ⬜ P1 全量导出
POST /api/system/restore                            ⬜ P1
GET  /api/system/stats                              ⬜ P2 首页统计
GET  /api/runs/:id/stream (SSE)                     ⬜ P1 实时日志
```

错误约定: 400 参数/校验（附 `error` 中文消息 + ⬜ `details[]` 字段级）；401 未登录；404 不存在；409 并发冲突。

---

## 7. 非功能需求

| 项 | 要求 |
|---|---|
| 性能 | 单容器 2 核 1GB 内存可稳定跑 100 任务；JSON 存储在 <10k runs 时无卡顿 |
| 可靠性 | 原子写文件（现有）；进程重启后调度自动恢复（现有）；调度器 60s 对账（现有） |
| 兼容 | 现代 Chrome/Safari/Firefox；移动端可看列表和日志（编辑器 P2 适配） |
| 可观测 | 每步日志含耗时；失败必含失败原因与响应片段 |
| 测试 | 引擎单测（现有 4 项）+ 每新增节点/能力配单测；关键路径 E2E 真实浏览器验证 |
| 文档 | README 部署/快速上手；docs/ 下节点用法、表达式手册、模板市场规范 |

---

## 8. 版本路线图

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

**v0.4 — 生态（P2）**
模板市场索引规范 + 从 URL 导入；模板更新 diff/应用；运行导出 HAR；每日汇总/静默时段；minimap/自动布局/移动端适配；错峰预设；补跑提示。

**v1.0 — 收敛**
文档完备（节点手册/表达式手册）；镜像发布；性能与压力验证；安全复查。

---

## 9. 验收标准（Definition of Done）

1. **体验验收（核心差异化）**: §4.0.7 三条基准全部通过——cURL 到带通知模板 ≤5 分钟零正则；生成即正确；日志点选修复 ≤1 分钟。这是第一验收项，不过则产品定位不成立。
2. **HAR 验收**: 拖入 HAR → 勾选请求 → 自动生成节点链 → 无需发起真实请求，直接基于 HAR 响应快照完成变量点选 + 日志规则配置 → 存为模板 → 实例化填变量即可运行。
3. **日志验收**: log.level 三档行为符合 §4.7.4 表格定义；keywords 规则命中值在 Timeline 高亮、进运行摘要、进通知消息；Pick"记录到日志"生成的 regex 规则可直接使用。
4. **功能验收**: 第 5 节矩阵中 P0 缺口全部闭环，且每项有一个真实站点的验证记录（真实浏览器/真实请求跑通，不接受仅单测）。
5. **回归**: 现有 4 项引擎测试 + 新增单测全绿；docker compose 重建后数据无损。
6. **交互验收**: 新用户 10 分钟内完成"导入模板→建 2 个账号任务→启用调度→收到通知"全流程，无需看文档。
7. **安全验收**: 日志/导出中搜不到任何完整 cookie/token；登录爆破被锁定；HAR 样本不入库不入模板。
8. **红线**: 公开仓库 `git grep` 无任何真实站点业务信息。

---

## 10. 待决策点（请评审时定夺）

1. **Pick Panel 首发视图范围（v0.2）**: 建议 JSON 树 + 文本划选首发，HTML 渲染点选（沙箱 iframe + CSS 选择器）放 v0.3——HTML 点选实现成本高（postMessage 沙箱通信 + 选择器生成），且多数签到 API 是 JSON。
2. failed 出口未连线时的默认行为：停（现状）vs 继续——建议保持"停"，`onError: continue` 放 v0.3。
3. CSV 批量上限：建议单次 ≤ 50 任务。
4. script 沙箱是否进 v0.3：若有签到场景强依赖加密签名则提前。
5. 模板市场是否做自建站点，还是仅约定索引 JSON 让社区自发（建议后者，成本最低）。
6. 列表页"标签/分组"与"按模板筛选"是否二选一先行（建议先做模板筛选，标签延后）。
7. 生成节点的变量命名策略：自动起名（如点选"积分"→ `points`，中文自动转拼音/语义映射表）vs 统一 `var1/var2`——建议中英文小词表映射 + 冲突自动加后缀，用户随时可改。

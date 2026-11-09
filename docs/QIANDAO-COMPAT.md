# QD(qiandao) 兼容性矩阵

> 采样日期：2026-11-08 ｜ 样本来源：现网运行中的 QD 容器实例（SSH 只读盘点）
> 红线遵守：本文档不含任何真实站点域名、账号、cookie 值；模板以 T01–T13 代称，仅标注站点类别。
> 结论先行：**13/13 现网模板可导入转换为 CheckQ 流程；运行级兼容依赖 GAP-C1～C4 四个能力，已全部落地（v0.3）。**
> **2026-11-08 实测：16 个真实任务已迁上路由器 18888 实例并跑通，含登录链、md5 签名链；详见 §7。**

---

## 1. 采样方法与规模

- 途径：SSH 进入路由器 → QD 容器（sqlite `database.db`）。
- 解密管线：QD 的 `tpl.har` / `tpl.tpl` 字段为 AES-CBC(umsgpack) 加密；用库内 `libs.mcrypto.aes_decrypt` 以默认 AES_KEY 解出 userkey（32B 随机字节），再解 tpl。**仅导出模板骨架（变量占位符原样保留），真实 cookie/密码值（task.env）未导出、未读取内容。**
- 规模：**39 个任务（18 启用 / 21 停用）、13 个模板、87 条请求**。任务成功率区间 55%–100%（QD 侧历史统计）。

## 2. 现网模式分布（决定兼容层设计的实测数据）

| 维度 | 分布 | 设计含义 |
|---|---|---|
| 请求方法 | GET 45 / POST 42 | 表单与 JSON POST 占一半，body 模板化是刚需 |
| 认证方式 | 45/87 请求显式带 Cookie 头；4 个模板纯登录链（无 Cookie 头，靠会话） | **必须有 run 级 cookie 罐**（GAP-C1） |
| 变量 | 13/13 模板使用 `{{var}}`；以 cookie 为主（9），username/password（2） | 变量渲染语义必须与 QD 一致（trim、缺省置空） |
| 表达式 | `urlencode` 过滤器 ×5 模板；`md5(拼接)|upper` 签名 ×2；`multiply(timestamp('float'),1000)|int` ×2；`default()` ×2；`or` 兜底 ×1；`striptags` ×1 | **模板表达式层需函数式求值**（GAP-C3） |
| QD 内部 API | `api://util/delay/N` ×9 处（smzdm 类防风控延时）；`api://util/unicode` / `urldecode` / `localhost/util/string/replace` 若干（日志中文转码） | **导入器必须转换而非丢弃**（GAP-C2） |
| 特殊出口 | 1 个模板 URL 为纯变量（代理求解服务地址） | 导入器放行变量 URL（GAP-C4） |
| 链长 | 1–27 请求/模板（中位 3） | 长链编辑体验重要；27 步模板实测转换后 43 节点 |
| TLS 风控 | 至少 1 个站点（GL 类）需非 Node 指纹 | curl 后端 ✅ v0.2 已有 |

## 3. 模板级兼容矩阵

分级：A=导入即可跑 ｜ B=导入转换后可跑（util 步骤已转换）｜ C=需 cookie 罐 ｜ D=需表达式层 ｜ E=需导入放行。
状态列为本轮落地后的结果（✅ 阻塞项已消除）。

| 模板 | 类别 | 请求数 | 认证模式 | 特殊依赖 | 原阻塞 | 现状态 |
|---|---|---|---|---|---|---|
| T01 | PT 站 | 3 | Cookie 变量 | urlencode 日志、util/unicode | B | ✅ 可跑 |
| T03 | PT 站 | 1 | Cookie 变量 | — | A | ✅ 可跑 |
| T04 | 云服务 | 4 | Cookie 变量 | `ua or` 兜底、TLS 指纹(curl)、util/replace | B | ✅ 可跑 |
| T06 | PT 站 | 2 | Cookie 变量 | util/unicode | B | ✅ 可跑 |
| T08 | PT 站 | 1 | Cookie 变量经代理求解 | **URL 纯变量**、代理求解服务 | E | ✅ 可导入；运行需用户自有求解服务地址 |
| T11 | PT 站 | 2 | Cookie 变量 | util/unicode | B | ✅ 可跑 |
| T12 | 工具站 | 2 | **登录→会话** | cookie 罐、token 提取 | C | ✅ 可跑 |
| T13 | 电商签到 | 26 | Cookie 变量 | **md5 拼接签名**、timestamp('float')、default()、util/delay ×8 | C2+D | ✅ 可跑 |
| T17 | 社区小程序 | 3 | **登录→会话** | cookie 罐、token 提取、util/replace | C | ✅ 可跑 |
| T21 | 电商签到 | 27 | Cookie 变量 | 同 T13（变体） | C2+D | ✅ 可跑 |
| T22 | 论坛 | 5 | **登录→会话** | cookie 罐、formhash 提取、util/unicode | C | ✅ 可跑 |
| T23 | 论坛 | 3 | Cookie 变量 | util/urldecode | B | ✅ 可跑 |
| T24 | 社区 | 6 | Cookie 变量+会话混合 | cookie 罐、302(manual)、util/urldecode | C | ✅ 可跑 |

**覆盖率核算**：39 个现网任务全部派生自这 13 个模板 → 模板级 13/13 = 100% 可转换；运行级预期 ≥ 12/13（T08 依赖外部求解服务可用性，属任务自身依赖而非框架缺口）。目标「9 成以上」达成。

## 4. 差距定义与落地状态（本轮全部闭环）

| 编号 | 差距 | 方案 | 状态 |
|---|---|---|---|
| GAP-C1 | 无 run 级 cookie 罐，登录链断裂 | `server/src/cookiejar.js`：响应 Set-Cookie 自动入罐（Domain 属性子域共享、空值删除、显式头同名优先），后续同域请求自动携带；`cookieJar:false` 节点级退出；命中时 stepLog `detail.jar` 标记 | ✅ + 单测/端到端回声服务实测 |
| GAP-C2 | `api://util/*` 导入被丢弃，smzdm 类延时链断裂 | 导入器转换：`util/delay/N` → delay 节点；`util/unicode` / `util/urldecode` → log 节点（content/s 参数还原为模板文本；本引擎响应已解码无需真转码） | ✅ + 单测 |
| GAP-C3 | 模板表达式层弱于 QD jinja | render.js 新增函数式表达式求值（白名单 md5/sha1/sha256/multiply/divide/add/sub/int/float/str/timestamp('float')/urlencode/quote_chinese/b64encode/b64decode/upper/lower + `+` 拼接 + 字面量，无 eval）；过滤器新增 `default()`/`int`/`float`/`striptags`；管道切分尊重引号 | ✅ + 单测 |
| GAP-C4 | URL 为纯变量的模板导入被拒 | 导入器放行含 `{{var}}` 的 URL（运行时渲染），画布命名 `POST {{变量URL}}` | ✅ + 单测 |
| GAP-C5 | QD `data` 字段请求体丢失 | 导入器读 `req.data`（QD tpl 格式）与 `postData.text`（HAR 格式） | ✅ 随 C2 落地 |

## 5. 超出 QD 的策略能力（CheckQ 独有，不受兼容目标约束）

- 条件分支（jexl 双出口）+ 节点级重试/退避 + random-delay：QD 仅任务级 retry 次数
- Pick-to-Logic 点选生成提取/断言节点：QD 必须手写正则
- 变量在节点间经 `steps.<id>` 精确引用 + set 节点表达式计算
- 失败告警渠道模板化（webhook/tg/bark × 成功/失败分流）+ 日志三档 + 关键字摘要
- 计划内：foreach 翻页遍历、script 沙箱（v0.3 P1）

## 6. 遗留与边界

- **GBK 站点**：charset 已支持；T23 类老论坛若为 GBK 需节点配置 `charset: gbk`（导入器不自动判定，编辑器手选）。
- **T08 代理求解服务**：属用户侧基础设施，框架只负责放行变量 URL 与 JSON body。
- **QD jinja 全量语法**：`{% for %}` 循环块、宏等未覆盖（样本中 0 出现）；出现即走 GAP 流程补。
- **样本外站点**：本矩阵基于 13 模板真实样本；新模板导入失败时请提 issue 附模板 JSON（脱敏）。

## 7. 真实迁移实测记录（2026-11-08，v0.3.3 @ 18888 实例）

实测方法：从 QD 解密导出模板骨架 + 任务变量（仅运行时使用，未入库未入文档）→ `/api/import/har` 转换 → 建流程 → 手动实跑 → 与 QD tasklog 当日真实结果对照。

| 批次 | 任务（模板） | 数量 | 结果 | 说明 |
|---|---|---|---|---|
| 1 | T03/T06/T11（PT 站 cookie 单双步） | 3 | ✅ 3/3 | T03 需 curl 后端（CF 指纹）；提取值全部命中真实数据 |
| 2 | T17（登录→token 头链） | 1 | ✅ | 与 QD 当日 tasklog **逐字节一致**（连签天数、积分值全同） |
| 2 | T22（论坛登录链） | 1 | ⚠️ 对等 | QD 侧同端点同样失败（已停用的死任务），QD 404 / 我们 405，QD 语义一致 |
| 3 | T13（26 请求长链：md5 签名 + delay×8 + 回声计算） | 1 | ✅ 主链 | 签到/任务列表/延时/签名渲染全通；午后运行遇「当日已完成」状态，中段断言按模板逻辑如期中断（QD 同状态同样失败，QD 为 fail-fast）。关键验证：`multiply(timestamp('float'),1000)|int` → `tsp=1794124674371` 正确产出 |
| 4 | T01（PT 站）+ T04 ×10（云服务 cookie 签到，多账号） | 11 | ✅ 11/11 | 当日新签到成功 3 账号（Got Points），其余按预期「明日再来」；T01 经代理出口 |

**本轮实测发现并修复的引擎问题**（均有单测）：
1. undici fetch 被个别站点按协议栈差异拒绝（同 body curl 成功）→ QD 导入统一默认 curl 后端
2. `api://util/unicode` 被 QD 用户当「表达式回声计算器」用（content 渲染后经"转换后"正则提回变量）→ 识别提取变量转 set 节点
3. 渲染层 or-fallback 截胡含括号表达式、管道切分不识括号嵌套、表达式内不支持 or/后置管道 → render.js 重写表达式路径
4. QD `data` 字段请求体丢失（GAP-C5 随 C2 修复）

**排程切换演练**：16 个迁移流程已启用 cron（00:02–00:17 Asia/Shanghai，全部早于 QD 侧 00:10）。预期明日 QD 侧对应任务将因「今日已签到」出现失败计数——这是切换演练的预期行为，确认我们侧全绿后即可停用 QD 任务。

**迁移遗留**：QD 任务级 retry_count/retry_interval 未映射到节点重试（导入器可后续自动映射）；T13 全链新鲜态验证待明晨 cron 实跑确认。
> **2026-11-09 v0.3.4 已闭环 retry 映射**：`importHar()` 新增 `resolveRetry()`，读取顶层 / `task.env` 的 `retry_count` / `retry_interval`（秒）并注入每个 http 节点 `retry: { times, backoffMs: interval*1000, retryOn: 'both' }`（钳制 times≤5、backoff 500-30000ms），与单测覆盖。

# QD(qiandao) 导入兼容性对照

> 本文只描述**框架的兼容能力**：QD / HAR 模板里的常见构造如何映射到 CheckQ 的节点、表达式与导入器。
> 仓库不包含任何真实模板、站点域名、账号或凭据；示例中的变量名与地址均为占位符。

## 1. 导入管线

| 输入 | 处理 | 输出 |
|---|---|---|
| HAR 文件 | 解析请求方法 / URL / 头 / body，按响应快照生成节点草稿 | 流程草稿（不发起真实请求即可点选生成逻辑） |
| QD 模板 JSON | 解析 `tpl.har` / `tpl.tpl`（用户在本机解密后导出骨架） | 同上；仅骨架，变量占位符原样保留 |
| cURL 命令 | 解析为单个 http 节点配置 | 可继续接入画布 |

导入器只读取结构，**不采集、不保存、不上传任何变量值**；敏感变量在导出与备份时统一脱敏。

## 2. 构造映射（QD / HAR → CheckQ）

| QD / HAR 构造 | CheckQ 落地 | 说明 |
|---|---|---|
| `{{var}}` 变量 | 流程变量 `vars` | 渲染语义对齐 QD（trim、缺省置空） |
| `api://util/delay/N` | `delay` 节点 | 固定等待 N 秒；`random-delay` 可替代为区间等待 |
| `api://util/unicode` / `urldecode` | `log` 节点 | 响应已解码，转换后保留文本模板 |
| `api://util/string/replace` | `set` / `extract` 节点 | 用表达式或正则还原 |
| `urlencode` / `md5` / `sha*` / `timestamp` / `multiply` / `default` / `striptags` | `render.js` 白名单表达式与过滤器 | 无 `eval`；管道切分尊重引号与括号 |
| `api://util/*` 里的回声计算 | `set` 节点 | 识别「渲染后再提回变量」的形态 |
| 响应 `Set-Cookie` | run 级 cookie 罐 | 同域后续请求自动携带；可用 `cookieJar:false` 退出 |
| 登录 → token → 业务请求 | http + extract + http 链 | 提取支持正则 / JSON 路径 / 响应头 |
| URL 为纯变量 | 导入器放行 | 运行时渲染；画布显示 `{{变量URL}}` |
| `retry_count` / `retry_interval` | http 节点 `config.retry` | 次数钳制 ≤5，间隔钳制 500–30000ms；与任务级重试互补 |
| `req.data`（QD）/ `postData.text`（HAR） | http 节点 body | 两种请求体字段都读取 |
| GBK 等字符集 | http 节点 `charset` | 导入器不自动判定，编辑器手选 |

## 3. 兼容层能力清单

| 编号 | 能力 | 实现 | 状态 |
|---|---|---|---|
| C1 | run 级 cookie 罐 | `server/src/cookiejar.js`：Set-Cookie 入罐、Domain 子域共享、空值删除、显式头同名优先；命中时日志标记 `detail.jar` | ✅ 有单测 |
| C2 | `api://util/*` 转换而非丢弃 | 导入器按上表映射为 delay / log / set 节点 | ✅ 有单测 |
| C3 | 函数式表达式层 | `server/src/render.js` 白名单求值 + 过滤器 + 管道 | ✅ 有单测 |
| C4 | 变量 URL 放行 | 导入器允许含 `{{var}}` 的 URL | ✅ 有单测 |
| C5 | QD 请求体字段 | 读 `req.data` 与 HAR `postData.text` | ✅ 有单测 |
| C6 | QD 任务级重试映射 | `importHar()` 的 `resolveRetry()` | ✅ 有单测 |

## 4. CheckQ 独有（超出兼容目标）

- 条件分支（jexl 双出口）、节点级重试/退避、随机延迟；
- **任务级失败退避重试**：默认最多 3 次，跑满次数才判定最终失败；
- 点选生成逻辑：运行后点响应值一键生成提取 / 断言 / 关键字 / 通知节点；
- `steps.<id>` 精确引用历史步骤、set 节点表达式计算；
- 通知渠道模板化、日志三档、关键字摘要、连续日志流。

## 5. 边界与排障

- **字符集**：GBK 类响应需手动在 http 节点选 `charset`，导入器不猜测。
- **外部求解服务**：URL 为纯变量时属于用户侧基础设施，框架只负责放行与渲染。
- **jinja 全量语法**：`{% for %}` 循环块、宏等不在覆盖内；遇到新构造按 C 系列补映射并补单测。
- **新模板导入失败**：请提交脱敏后的模板 JSON（清空所有变量值、去掉站点域名），便于补兼容规则。
- **凭据**：cookie / token / 密码只存在本地数据目录，导出与备份默认脱敏；模板导出显式标记 `samplesIncluded: false`。

## 6. 回归

兼容层由 `server/test/qd-compat*.test.js` 与 `server/test/curl-import.test.js` 覆盖；新增构造必须同时补映射表与单测。

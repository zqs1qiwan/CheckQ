# CheckQ vs QD 功能对比与差距清单

> 基于上游 QD (qd-today/qd) CHANGELOG 到 20250803 版本的分析。
> 结论: CheckQ 定位为"可视化 + 单用户 + 点选生成逻辑",不追 QD 的多用户/公共模板生态。
> 本清单只列对单用户签到场景有实际影响的差距。

## 已覆盖(不输 QD)

| 能力 | CheckQ 实现 |
|---|---|
| 可视化流程编排 | ReactFlow 画布(比 QD 文本模板直观) |
| 点选生成逻辑 | Pick Panel(QD 无此能力) |
| 请求引擎 | fetch + curl 双后端(TLS 指纹绕过比 QD 的 Ja3 容器更轻) |
| 代理 | http/https/socks5h,支持认证,`{{proxyVar}}` |
| GBK/charset | gbk/gb2312/big5 + curl 管道 iconv |
| Set-Cookie 捕获 | fetch getSetCookie + curl 头文件 |
| 重试 | 节点级 retry(次数/退避/条件),指数退避 |
| 条件分支 | jexl 表达式 |
| 变量提取 | 正则/json 路径/header/setCookie |
| 定时 | cron(分钟级,6 字段支持)+ 时区 |
| 随机化 | random-delay 节点 + jitterMinutes(P1) |
| 通知 | webhook/telegram/bark |
| 模板复用 | 模板系统 + CSV 批量(差异化能力,QD 单任务手动复制) |
| 导入 | HAR/QD 模板/cURL |
| 日志 | 三档记录 + keywords 提取 + 脱敏 |
| 失败可见 | 每步请求/响应/断言/耗时全记录 |

## 差距清单(按单用户签到场景优先级排序)

### P0 — 高频刚需

| # | 差距 | QD 做法 | CheckQ 计划 |
|---|---|---|---|
| 1 | ~~SSE 实时日志推送~~ | WebSocket | ✅ POST /api/flows/:id/run stream:true + 前端 runFlowStream |
| 2 | ~~运行回显到画布~~ | 无(文本界面) | ✅ data.runStatus 驱动节点样式+角标 |
| 3 | **更多过滤器** | jinja2 全套 | ✅ 第一批完成:urlencode(带编码参数)/urldecode、md5/sha1/sha256、base64decode、hex、upper/lower/trim、timestamp[:ms]、now[:strftime格式]; 待补:re_replace、replace、unicode转义
| 4 | ~~日期时间函数~~ | 时间戳 API | ✅ now[:fmt](strftime: %Y%m%d%H%M%S%f%s)、timestamp[:ms]; date_add/diff 待补 |
| 5 | **失败重试间隔** | 任务级可配间隔(>12h) | 节点 retry.backoffMs 已有;补最大退避上限 |
| 6 | **分组管理** | 任务分组+折叠 | 任务加 group 字段 + 列表按组折叠 |

### P1 — 有用

| # | 差距 | 说明 |
|---|---|---|
| 7 | 企业微信通知 | webhook 已可覆盖,补专用的 bot key 模板 |
| 8 | 钉钉机器人通知 | 加签安全设置 |
| 9 | Server酱/WXPusher | 国内推送主流 |
| 10 | 每日汇总推送 | 全局定时把当天运行结果汇总推送(已在 PRD P2) |
| 11 | 邮箱通知 | SMTP 发送(低优先级,webhook 可转发) |
| 12 | 全局代理黑名单 | proxy_direct 列表,匹配 URL 直连(少量内网场景) |
| 13 | 不验证 SSL 选项 | rejectUnauthorized: false 开关 |
| 14 | 日志保留天数 | 超期自动清理(现固定 500 条/flow) |
| 15 | 备份/恢复 | 导出全部 JSON + 导入(手动拷 data 目录可替代) |

### P2 — 场景性需求

| # | 差距 | 说明 |
|---|---|---|
| 16 | OCR 滑块验证码 | ddddocr 不易在 Node 生态复刻;签到场景多为 cookie 免验证,暂缓 |
| 17 | getcookie 浏览器插件协作 | Pick Panel 已从根源解决"怎么拿到 cookie"问题 |
| 18 | 公共模板市场 | 单用户场景弱需求;JSON 导入已够 |
| 19 | 记事本 | 用备注/变量即可 |
| 20 | 多用户/邮箱验证 | 明确不做(单用户定位) |
| 21 | MySQL | 明确不做(单文件 JSON 足够) |

## 结论

CheckQ 的核心差异化(可视化 + 点选生成)已完成。差距集中在:
1. **表达式函数库广度**(QD 的 jinja2 过滤器) — P0#3/#4,影响"复杂签到逻辑"能否不写代码
2. **实时性体验**(SSE/回显) — P0#1/#2
3. **国内通知渠道** — P1,webhook 可过渡
4. OCR 是唯一实质差距,但对 cookie 型签到无影响

建议下一轮:P0#1+#2(体验闭环) → P0#3+#4(函数库) → P1 国内通知。

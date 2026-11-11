# CheckQ 安全说明（v0.4.3）

> 覆盖：账号体系、密码存储、TOTP 两步验证、会话、权限、已知风险与自查结论、运维手册。

## 1. 账号体系

| 项 | 说明 |
|---|---|
| 账号 | 多用户，存 `meta.json` 的 `users[]`；每账号含用户名 / 显示名 / 角色 / 密码哈希 / 2FA / 恢复码 / 失败计数 / 最后登录 |
| 角色 | `admin`（全部，含用户管理）/ `operator`（不能管账号与用户）/ `viewer`（**只读**，任何写操作 403） |
| 登录 | 用户名 + 密码；启用了 2FA 的账号再要 6 位动态码或一次性恢复码 |
| 兼容 | 只传密码也能登录（唯一账号时自动匹配）；旧版 `meta.passwordHash` 在启动时**自动迁移**为 `admin` 用户 |
| 首次启动 | 无任何账号时进入「创建管理员」：用户名 + 强密码（≥10 位、两类字符、不在弱口令表、不含用户名） |

## 2. 密码存储

- 算法：**scrypt**（N=16384, r=8, p=1, 32 字节输出），每账号 **16 字节随机盐**，存储格式 `salt:hash`（hex）；
- 比较：`crypto.timingSafeEqual` 常量时间；**用户不存在时也会执行一次等价 scrypt**，避免用响应时间枚举用户名；
- **明文密码永不落盘**：旧版的 `meta.plainHint`（曾把随机生成的初始密码明文写进 meta.json）已删除，初始密码只在启动日志里打印一次；
- 改密后：其它设备的会话立即失效；新密码不能与当前密码相同；
- 生产实测：`meta.json` 内 `root has passwordHash: false | plainHint: false`，`passwordHash 格式: scrypt salt:hash ✓`，`明文密码出现在 meta: false`。

## 3. 两步验证（TOTP，RFC 6238）

- 参数：HMAC-SHA1 / 30 秒 / 6 位，兼容 Google Authenticator、Authy、Aegis、1Password 等；
- 实现：`server/src/totp.js`（零依赖，含 base32 编解码与 `otpauth://` URI 生成）；
- 绑定流程：**账号密码 → 生成密钥（此时未启用）→ 验证器录入 → 输入 6 位码确认 → 启用**；
- 恢复码：启用时生成 10 个一次性码，**明文只显示一次**，服务端只存 sha256 摘要，用后即废；
- 关闭 / 重置恢复码：都需要「账号密码 + 当前动态码」；
- 管理员可在「用户管理」重置他人 2FA（用户丢失验证器时用），该动作进审计。

## 4. 会话与鉴权

| 项 | 说明 |
|---|---|
| 会话 Cookie | `qsid`，**httpOnly + SameSite=Strict**，7 天绝对有效期 + 24 小时空闲失效 |
| 服务端存储 | 按用户记录（创建时间 / 最近活跃 / IP / UA），可列出、可吊销、可「退出所有设备」 |
| 停用 / 删号 / 改密 / 重置 2FA | 立即吊销该用户所有会话 |
| API Key | 多把、可命名；**服务端只存 sha256 摘要**，明文只在创建时返回一次；可单独吊销；带 `x-api-key` 头访问 |
| 登录限流 | 按 IP：10 分钟内 5 次失败即 429；按账号：连续 8 次失败锁定 15 分钟 |

## 5. 权限矩阵

| 能力 | admin | operator | viewer | API Key |
|---|---|---|---|---|
| 查看任务 / 运行记录 / 统计 | ✅ | ✅ | ✅ | ✅ |
| 增删改任务、运行、导入导出 | ✅ | ✅ | ❌ | ✅ |
| 通知渠道 / 模板 / 批量操作 | ✅ | ✅ | ❌ | ✅ |
| 系统设置（AI、提示级别、每日总推送） | ✅ | ✅ | ❌ | ✅ |
| 账号安全（自己的密码 / 2FA / 会话） | ✅ | ✅ | ❌ | ❌ |
| 用户管理（建号 / 角色 / 停用 / 重置密码与 2FA / 删除） | ✅ | ❌ | ❌ | ❌ |
| 审计日志 | ✅ | ❌ | ❌ | ❌ |

## 6. Web 安全加固

- **响应头**（每个响应）：`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: same-origin`、`Permissions-Policy`、`Cross-Origin-Opener-Policy: same-origin`、CSP（`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`）；
- **CSRF**：写操作（POST/PUT/DELETE）校验 `Origin` 必须同源，跨站一律 403（浏览器表单/图片攻击不带同源 Origin）；会话 Cookie 同时 `SameSite=Strict`；
- **CSP 与内联样式**：组件里存在少量内联 `style`，因此 `style-src` 保留 `'unsafe-inline'`；`script-src` 严格 `'self'`（无内联脚本、无第三方 CDN）；
- **注入面**：HTTP 节点的 URL/头/体为用户自有配置，属于「用户对自己目标的主动请求」，不属于服务端注入；引擎内不使用 `eval` 渲染模板（表达式走白名单函数 + jexl 沙箱，1s 超时）；
- **敏感信息脱敏**：运行日志里的 cookie / authorization 头自动脱敏（保留前 12 字符），变量快照同样脱敏。


### 6.1 IP 访问控制（v0.4.3）

| 能力 | 说明 |
|---|---|
| Key 级 **IP 允许名单** | 每把 API Key 可设来源 IP / CIDR 列表（空=不限）；名单外 → 403「IP 不在该 API Key 的允许名单内」 |
| 全局 **IP 黑名单** | 设置 → 账号安全 →「访问控制」；被拉黑的 IP **登录与 API Key 同时被拦**（403） |
| 实现 | `server/src/iprange.js`：IPv4/IPv6 + CIDR 解析匹配，IPv4-mapped IPv6 归一，非法条目忽略 |
| 来源 IP 判定 | 优先 `X-Forwarded-For` 第一个地址，其次 `req.ip`；⚠️ Docker 端口映射下容器只看到网关地址，需调用方带 XFF 或改用 `--network host` |

## 7. 自查：已发现并修复的问题

| # | 问题 | 严重度 | 处理 |
|---|---|---|---|
| 1 | `meta.plainHint` 明文保存初始密码 | 高 | 已删除；初始密码只在启动日志打印一次 |
| 2 | 单一共享密码（无身份、无法单独吊销） | 高 | 已升级为多用户 + 角色 + 会话吊销 |
| 3 | 改密码不清除会话 | 高 | 已改为「改密后其它设备立即失效」 |
| 4 | `POST /api/logout` 清空**所有**用户的会话 | 中 | 已改为只登出当前会话；另提供「退出所有设备」 |
| 5 | API Key 明文存盘 | 中 | 改为只存 sha256 摘要 + 前缀展示 |
| 6 | 无 2FA | 中 | 已实现 TOTP + 恢复码 |
| 7 | 无安全响应头 / 无 CSRF 防护 | 中 | 已加 CSP/XFO/nosniff + Origin 同源校验 |
| 8 | 用户名可被枚举（错误信息 + 响应时间不同） | 中 | 统一错误文案 + 用户不存在时同样执行 scrypt |
| 9 | 登录失败只按 IP 限流，可绕过 | 低 | 增加账号级失败计数与锁定 |
| 10 | 会话无过期/无空闲超时 | 低 | 绝对 7 天 + 空闲 24 小时 |
| 11 | `verifyPwd` 对畸形 hash 可能抛异常 | 低 | 改为安全兜底（假比较后返回 false） |
| 12 | 无审计日志 | 低 | 新增审计（登录/改密/2FA/用户/API Key 等，保留 500 条） |
| 13 | 密码策略仅 8 位 | 低 | 提升为 ≥10 位 + 两类字符 + 弱口令库 + 禁含用户名 |
| 14 | Cookie `sameSite=lax` | 低 | 改为 `strict` + `httpOnly` |

## 8. 与 qinglong / qiandao 的做法对照（2026-11 调研）

> 调研对象：`whyour/qinglong`（develop 分支 `back/api/user.ts`、`back/services/user.ts`、`back/shared/password.ts`、`src/pages/setting/security.tsx`）与 `binux/qiandao`（`web/handlers/login.py`、`libs/mcrypto.py`）。

### 7.1 qinglong（青龙）

| 能力 | qinglong 做法 | CheckQ 做法 |
|---|---|---|
| 账号模型 | **单账号**：用户名密码存在系统配置里（`authConfig`） | **多用户 + 角色**（admin/operator/viewer），存在 `meta.users[]` |
| 改用户名密码 | 设置 → 安全设置 →「修改用户名密码」表单（用户名 + 新密码，**不校验旧密码**），保存后清空 token 强制重新登录 | 设置 → 账号安全 →「修改用户名 / 显示名」（改用户名**需当前密码**）+「修改密码」（需旧密码）；改用户名后吊销全部会话强制重新登录 |
| 密码哈希 | scrypt，格式 `scrypt$salt$hash`，64 字节输出（`shared/password.ts`） | scrypt N=16384 + 16 字节盐，`salt:hash`，32 字节输出（`server/src/auth.js`） |
| 两步验证 | `/user/two-factor/init` 返回 `{secret, url}`，前端显示 **QR Code** + 密钥，三步向导（装 App → 扫码 → 输 6 位码）；启用/禁用 | `/api/system/2fa/enroll` 返回 `{secret, uri}` + 一次性恢复码；**不显示二维码**（避免把密钥交给第三方二维码服务），提供 `otpauth://` 链接与 Base32 密钥，可被 Aegis/Authy 手动粘贴导入 |
| 2FA 登录 | 两步式：先登录返回 420，再调 `/user/two-factor/login` 带 code；用 `lastTwoFactorStep` 防同一 30 秒窗口重放 | 单次登录请求里带 `code`；恢复码一次性消费；窗口 ±30s 校验 |
| 登录限流 | `LoginThrottle`：失败次数 + 退避秒数，返回 410 + 等待时间 | IP 5 次/10 分钟 + 账号 8 次锁定 15 分钟，返回 429 |
| 登录日志 | 独立页面「登录日志」（时间/IP/归属地/平台/成败） | 审计日志（含 login.ok / login.fail），管理员可看 |
| IP 黑名单 | `GET/PUT/DELETE /user/ip-blacklist` | 未做（局域网单用户场景，暂不需要） |
| 通知 | 登录成功/失败也会推送到通知渠道 | 任务成功/失败推送；**登录事件尚未推送**（可作为下一步） |
| 头像 | 支持上传裁剪 | 未做（不影响安全） |

### 7.2 qiandao（签到）

| 能力 | qiandao 做法 | CheckQ 做法 |
|---|---|---|
| 账号标识 | **邮箱**（注册 + 邮箱验证链接，30 天有效） | 用户名（3-32 位）；无邮件服务，故不做邮箱验证 |
| 找回密码 | 邮件发重置链接（1 小时有效，带加密签名 + mtime 校验） | 无邮件服务 → **当前密码确认**；或管理员在「用户管理」重置；或容器内命令重置（见 §9） |
| 密码哈希 | PBKDF2 + 16 字节随机盐，输出 32 字节 | scrypt（更强、更抗 GPU），盐 16 字节，输出 32 字节 |
| Cookie | httponly，https 下加 secure | httponly + SameSite=Strict，https 需在反代层加 secure |
| 失败处理 | 登录失败计数 `evil(+5)`，有次数限制 | IP + 账号双层限流/锁定 |
| 角色 | user 表有 role 字段 | admin / operator / viewer，viewer 写操作直接 403 |

### 7.3 结论与取舍

- **我们比两者多**：多用户 + 角色、只读账号、审计日志、会话可吊销、CSRF/安全头、API Key 只存摘要、一次性恢复码；
- **我们少（有意为之）**：邮箱验证/找回（无邮件服务）、二维码（避免密钥外泄）、IP 黑名单、头像；
- **已按 qinglong 的交互补齐**：可自助修改用户名（原本只有改密码），改用户名后强制重新登录；
- **可借鉴的后续项**：登录成功/失败也走通知渠道（qinglong 有）、API Key 分平台（qinglong 按平台分组 token）。

## 9. 修改用户名 / 密码怎么做（面板操作）

| 想做什么 | 面板路径 | 说明 |
|---|---|---|
| 改用户名 | 设置 → 账号安全 → 「修改用户名 / 显示名」 | 填新用户名 + 当前密码 → 保存；**所有设备立即登出**，需用新用户名重新登录 |
| 改显示名 | 同上 | 只影响面板展示，可随时改，不需密码 |
| 改密码 | 设置 → 账号安全 → 「修改密码」 | 需当前密码 + 新密码（≥10 位、两类字符）；其它设备会话立即失效 |
| 开启两步验证 | 设置 → 账号安全 → 「两步验证」→ 开始绑定 | 复制密钥或 `otpauth://` 链接到验证器 App → 输入 6 位码 → 保存恢复码 |
| 忘了两步验证码 | 恢复码登录；或管理员在 设置 → 用户管理 → 重置2FA | 管理员重置后该用户需重新绑定 |
| 忘了密码（仍已登录） | 设置 → 账号安全 → 修改密码 | — |
| 忘了密码（已登出） | 管理员重置；或用容器命令重置（见 §9） | 局域网部署无公网找回通道 |

API 对照：

| 需求 | 方法 | 路径 | 请求体 |
|---|---|---|---|
| 改用户名/显示名 | PUT | `/api/system/account` | `{ username?, displayName?, currentPassword? }` |
| 改密码 | POST | `/api/system/password` | `{ oldPassword, newPassword }` |
| 当前身份 | GET | `/api/me` | — |
| 开启 2FA | POST | `/api/system/2fa/enroll` → `/api/system/2fa/confirm` | `{ password }` → `{ code }` |
| 关闭 2FA | POST | `/api/system/2fa/disable` | `{ password, code }` |


## 10. 仍存在的风险与建议（需要你决策/外部动作）

| 风险 | 说明 | 建议 |
|---|---|---|
| 明文 HTTP 传输 | 生产是局域网 `http://checkq.local:18888`，Cookie 与密码在链路上是明文 | 上 HTTPS（反代 + 自签或内网证书），并在反代层加 HSTS |
| 单机 JSON 存储 | `meta.json` 明文可读（只有哈希），但**拥有该文件 = 可离线爆破哈希** | 限制文件权限（600）、对 `meta.json` 加密或用系统 keyring；同时 `data/` 目录不进版本库 |
| 无 Passkey / WebAuthn | 目前是密码 + TOTP | 下一步可加 WebAuthn（PRD P2） |
| 无异地备份 | `data/` 目录是唯一数据源 | 用「设置 → 备份」定期导出并加密保存到别处 |
| 审计日志只在本机 | 可被有 root 的人改 | 严重场景可外送到日志系统 |
| 会话存内存 | 重启容器后所有会话失效（需重新登录） | 这是刻意的取舍（无会话落盘）；如需常驻可改为持久化会话表 |

## 11. 运维手册

```powershell
# 忘记密码 / 忘记 2FA（容器内直接重置管理员密码）
ssh root@checkq.local 'docker exec checkq node -e "
  const fs=require(\"fs\"); const p=\"/data/meta.json\";
  const m=JSON.parse(fs.readFileSync(p,\"utf8\"));
  const {hashPwd}=require(\"/app/src/auth.js\");
  const u=m.users.find(x=>x.username===\"admin\");
  u.passwordHash=hashPwd(\"NewStrongPassword#2026\");
  u.totp=null; u.recoveryCodes=[]; u.failedLogins=0; u.lockedUntil=null;
  fs.writeFileSync(p, JSON.stringify(m));
  console.log(\"admin password reset; 2fa cleared\");
" && docker restart checkq'
```

其它常见操作：

- **改自己的密码**：设置 → 账号安全 → 修改密码（需旧密码，改后其它设备失效）；
- **给同事建号**：设置 → 用户管理 → 新建账号（选角色 operator/viewer）；
- **同事离职**：用户管理 → 停用（会话立即失效）；
- **绑定 2FA**：设置 → 账号安全 → 两步验证 → 开始绑定（保存密钥与恢复码）；
- **加 API Key 给外部脚本**：设置 → API Key → 生成（明文只显示一次）。

## 12. 签到凭据（cookie / token / 脚本）怎么存、怎么保安全

> 调研对象：`binux/qiandao`（`db/user.py`、`db/task.py`、`web/handlers/task.py`、`libs/mcrypto.py`）、`whyour/qinglong`（`back/services/env.ts`、`back/config/index.ts`）。

### 13.1 三个产品怎么存「签到资源」

| 维度 | qiandao（签到） | qinglong（青龙） | CheckQ（本项目） |
|---|---|---|---|
| 凭据载体 | 每个任务的 `init_env`（cookie/变量） | 「环境变量」表（JD_COOKIE 等）+ 导出 `.env` | 流程变量 `flow.vars` + 通知渠道 `flow.notify.channels` |
| **静态加密** | ✅ **AES-CBC 加密入库**；密钥 = 用户 `userkey`（由密码 PBKDF2 派生，再用全局 `aes_key` 加密保存） | ❌ **明文入库**，并额外导出明文 `shell/preload/env.sh` / `env.js` / `env.py` 给脚本 `source` | ✅ **AES-256-GCM 加密落盘**（`enc:v1:`），密钥在 `data/.secret`（600）或环境变量 `CHECKQ_SECRET` |
| 密钥与密码绑定 | ✅ 绑定（改密码 ⇒ 旧 cookie 密文解不开，需重填） | ❌ 无（明文） | ❌ 不绑定（改密码不影响凭据），但**改密码会吊销全部会话** |
| 脚本/代码 | 模板 `tpl['tpl']` 也加密存储 | 脚本是**文件**（`data/scripts/`），非秘密 | 脚本节点代码在 `flows.json`（明文，代码不是秘密） |
| 共享模板 | 公共模板用**全局同一把**密钥（弱一点） | 公共 env 明文 | 模板默认变量导出时**脱敏** |
| 日志脱敏 | 失败信息入库（`tasklog.msg`） | 有日志系统 | ✅ 运行日志/变量快照自动脱敏（cookie/authorization 保留前 12 字符） |
| 备份 | DB 备份 | `data.tgz`（含明文 env） | ✅ **备份默认脱敏**；完整备份需再输一次当前密码 |
| 密钥文件保护 | `userkey` 用全局 `aes_key` 加密 | `auth.json`/`env.sh` 在 `blackFileList`（脚本不可读写） | `data/.secret` 600 权限，不在任何 API 返回里 |

### 13.2 我们的做法（已实现）

**加密范围**（`server/src/secret.js`）：
- **变量**：名字命中 `cookie|token|sess|auth|password|passwd|secret|api_key|credential|jwt|bearer|refresh`，或值形态像凭据（长 base64/hex、JWT `eyJ…`、含 `sess=`/`token=` 的 cookie 串）→ 加密；
- **通知渠道**：`token / key / pass / password / secret / url / user` 等字段 → 加密（Telegram bot token、SMTP 密码、webhook URL 里的签名都在内）；
- **不加密**：普通变量（如 `ua`、`site`）、流程图、脚本代码、日志记录 —— 保持可读、可 diff、可 grep。

**工作方式**：
- 内存里保持**明文**（面板要能编辑、引擎要能渲染 `{{var}}`），**写盘前加密、读盘自动解密**；
- 旧版本数据是明文 → 读入时原样读出，下次写入自动变成密文（**渐进迁移**，无需手工迁移）；
- AES-256-GCM 带认证标签：密文被篡改会解密失败（返回空值而不是泄露密文）。

**密钥管理**：
- 优先用环境变量 `CHECKQ_SECRET`（≥8 位，内部按 sha256 派生 32 字节密钥）；
- 否则首次启动生成 `data/.secret`（32 字节随机，权限 600），**永不入库、不进备份、不出现在任何 API 响应里**；
- ⚠️ 换密钥后旧密文解不开（返回空值）→ 需要重新填一次 cookie；换密钥前请先用「完整备份」留档。

**导出与分享**：
- `GET /api/system/backup` → **脱敏**（敏感变量清空、渠道密钥 `***`），可安全分享/存档；
- `POST /api/system/backup { password }` → **含明文凭据**的完整包，用于自己迁移（需再次输密码，防误下载/误分享）；
- `GET /api/templates/:id/export` → 模板变量里的敏感项清空；
- 面板「备份 / 完整备份」两个按钮对应上面两档。

**运行时保护**：
- 运行日志与变量快照对 `cookie`/`authorization` 等头自动脱敏；
- 登录日志不记录凭据；审计日志只记动作与账号，不记值；
- 数据目录文件权限已收紧为 `600`（`meta.json / flows.json / runs.json / templates.json / notifications.json`）。

### 13.3 与两者相比，我们更强 / 更弱的地方

**更强**：
1. 凭据静态加密（AES-256-GCM）+ 认证标签 —— qiandao 用的是 AES-CBC（无认证标签），qinglong 干脆明文；
2. 备份默认脱敏，完整备份需二次密码 —— 两者的备份都含明文凭据；
3. 密钥独立于用户密码（改密码不会作废 cookie），并可从环境注入（便于集中管理）；
4. 密钥文件 600 且不暴露在任何接口。

**更弱 / 取舍**：
1. 不做邮箱验证与邮件找回（没有邮件服务）；
2. 不显示 2FA 二维码（避免把 TOTP 密钥交给第三方二维码服务）；
3. 加密只覆盖「流程变量 + 通知渠道」，**运行历史里的响应体仍可能有站点返回的凭据**（如某些站点在响应里回显 token）—— 已做日志级脱敏，但不是全量加密；
4. 加密发生在应用层，**磁盘备份/快照工具（如 NAS 快照）仍能看到密文**，只有拿到 `.secret` 才能解 —— 这一点与 qiandao 相同（密钥与密文同机）。

### 13.4 建议的后续动作（可选）

| 建议 | 价值 | 成本 |
|---|---|---|
| 独立「凭据中心」：把 cookie/token 抽成全局凭据库，流程只引用凭据名 | 多任务共用一份 cookie、轮换一处生效 | 中（需改引擎变量解析 + 面板） |
| 凭据轮换提醒（按创建时间提示"该换 cookie 了"） | 减少签到突然失败 | 小 |
| 登录成功/失败也走通知渠道（qinglong 的做法） | 安全可观测 | 小 |
| 加密范围扩到 `runs.json` 里的响应体 | 全链路静态加密 | 中（大文件加密开销 + 检索变难） |
| 密钥托管到系统 keyring / KMS | 密钥与数据分离 | 高（部署形态相关） |


## 13. 自测

```bash
cd server && node test/auth.test.js     # 39 项：登录/2FA/会话/用户管理/安全头/CSRF/审计
cd server && for f in test/*.test.js; do node $f; done   # 全量 272 项
```

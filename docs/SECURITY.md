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

## 8. 仍存在的风险与建议（需要你决策/外部动作）

| 风险 | 说明 | 建议 |
|---|---|---|
| 明文 HTTP 传输 | 生产是局域网 `http://checkq.local:18888`，Cookie 与密码在链路上是明文 | 上 HTTPS（反代 + 自签或内网证书），并在反代层加 HSTS |
| 单机 JSON 存储 | `meta.json` 明文可读（只有哈希），但**拥有该文件 = 可离线爆破哈希** | 限制文件权限（600）、对 `meta.json` 加密或用系统 keyring；同时 `data/` 目录不进版本库 |
| 无 Passkey / WebAuthn | 目前是密码 + TOTP | 下一步可加 WebAuthn（PRD P2） |
| 无异地备份 | `data/` 目录是唯一数据源 | 用「设置 → 备份」定期导出并加密保存到别处 |
| 审计日志只在本机 | 可被有 root 的人改 | 严重场景可外送到日志系统 |
| 会话存内存 | 重启容器后所有会话失效（需重新登录） | 这是刻意的取舍（无会话落盘）；如需常驻可改为持久化会话表 |

## 9. 运维手册

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

## 10. 自测

```bash
cd server && node test/auth.test.js     # 39 项：登录/2FA/会话/用户管理/安全头/CSRF/审计
cd server && for f in test/*.test.js; do node $f; done   # 全量 272 项
```

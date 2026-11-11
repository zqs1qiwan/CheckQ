/**
 * 认证与账号模型（v0.4.3 安全加固）
 * - 多用户：用户名 + 密码（scrypt + 随机盐 + 定时安全比较）
 * - 角色：admin（全部）/ operator（无账号管理）/ viewer（只读）
 * - 两步验证：TOTP（server/src/totp.js）+ 一次性恢复码
 * - 会话：按用户记录（可列出/吊销/改密后失效）
 * - 审计：登录、改密、2FA、用户管理、API Key 等关键动作留痕
 * - 兼容：旧的 meta.passwordHash 自动迁移为 admin 用户
 */
import crypto from 'node:crypto';

export const ROLES = ['admin', 'operator', 'viewer'];
export const PASSWORD_MIN = 10;

/** 弱口令黑名单（大小写无关） */
const WEAK = new Set([
  'password', 'password1', '12345678', '123456789', '1234567890', 'qwertyuiop',
  'admin', 'admin123', 'adminadmin', 'checkq', 'checkq123', 'letmein', 'welcome',
  'iloveyou', 'abc123456', '11111111', '00000000', 'passw0rd', 'root', 'toor',
]);

/** 密码强度校验：长度 + 字符类型 + 黑名单 + 不含用户名 */
export function checkPassword(pwd, username = '') {
  const p = String(pwd || '');
  if (p.length < PASSWORD_MIN) return `密码至少 ${PASSWORD_MIN} 位`;
  if (p.length > 200) return '密码过长';
  if (WEAK.has(p.toLowerCase())) return '这个密码太常见，请换一个';
  if (username && p.toLowerCase().includes(String(username).toLowerCase()) && String(username).length >= 3) {
    return '密码不要包含用户名';
  }
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(p)).length;
  if (kinds < 2) return '密码需至少包含两类字符（大小写字母 / 数字 / 符号）';
  return null;
}

/** 密码哈希：scrypt(N=16384,r=8,p=1) + 16 字节随机盐 */
export function hashPwd(pwd, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(pwd), salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `${salt}:${hash}`;
}

/** 校验密码（常量时间；格式非法时也走一次假比较，避免时序泄露） */
export function verifyPwd(pwd, stored) {
  const parts = String(stored || '').split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    // 兜底：仍然做一次 scrypt，抹平时序差异
    crypto.scryptSync(String(pwd || ''), 'invalid-salt', 32, { N: 16384, r: 8, p: 1 });
    return false;
  }
  const [salt, hash] = parts;
  let calc = '';
  try {
    calc = crypto.scryptSync(String(pwd || ''), salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex');
  } catch {
    return false;
  }
  const a = Buffer.from(calc, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** API Key：只存摘要（sha256），明文仅在创建时返回一次 */
export function hashApiKey(key) {
  return crypto.createHash('sha256').update(String(key || '')).digest('hex');
}

export function newApiKey() {
  const key = 'cq_' + crypto.randomBytes(24).toString('base64url');
  return { key, hash: hashApiKey(key), prefix: key.slice(0, 10) };
}

/** 用户名规则：3-32 位，字母数字下划线点 */
export function checkUsername(name) {
  const u = String(name || '').trim();
  if (u.length < 3 || u.length > 32) return '用户名长度需 3-32 位';
  if (!/^[A-Za-z0-9_.-]+$/.test(u)) return '用户名只能含字母、数字、下划线、点、短横线';
  return null;
}

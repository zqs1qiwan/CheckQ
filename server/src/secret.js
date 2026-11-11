/**
 * 敏感凭据静态加密（v0.4.3）
 * 借鉴：qiandao（任务 env 用用户密钥 AES 加密入库）、qinglong（明文 DB + 明文 .env，我们做得更严）
 *
 * - 算法：AES-256-GCM（带认证标签，防止密文被篡改后仍被解密）
 * - 密钥：环境变量 CHECKQ_SECRET 优先；否则首次启动生成 data/.secret（权限 600，永不入库/不进备份）
 * - 格式：enc:v1:<base64(iv|tag|cipher)>
 * - 迁移：磁盘上的旧明文值会被识别并原样读出，写回时自动加密（渐进迁移）
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PREFIX = 'enc:v1:';
const IV_LEN = 12;
const TAG_LEN = 16;

let cachedKey = null;

/** 取（或生成）数据加密密钥 */
export function secretKey(dataDir) {
  if (cachedKey) return cachedKey;
  const fromEnv = process.env.CHECKQ_SECRET;
  if (fromEnv && fromEnv.length >= 8) {
    cachedKey = crypto.createHash('sha256').update(String(fromEnv)).digest();
    return cachedKey;
  }
  const file = path.join(dataDir, '.secret');
  try {
    const hex = fs.readFileSync(file, 'utf8').trim();
    if (hex.length >= 64) {
      cachedKey = Buffer.from(hex, 'hex');
      return cachedKey;
    }
  } catch { /* 不存在则生成 */ }
  const key = crypto.randomBytes(32);
  try {
    fs.writeFileSync(file, key.toString('hex'), { mode: 0o600 });
    fs.chmodSync(file, 0o600);
  } catch (e) {
    console.warn('[CheckQ] 无法写入 data/.secret，敏感凭据将不做静态加密:', e.message);
    return (cachedKey = crypto.randomBytes(32)); // 退化为内存密钥（重启后旧密文解不开）
  }
  cachedKey = key;
  console.log('[CheckQ] 已生成 data/.secret（600 权限）：敏感凭据（cookie/token/密码）静态加密存储');
  return cachedKey;
}

export function isEncrypted(v) {
  return typeof v === 'string' && v.startsWith(PREFIX);
}

export function encryptValue(key, plain) {
  if (plain === undefined || plain === null) return plain;
  const s = String(plain);
  if (!s || isEncrypted(s)) return s;
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(s, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, body]).toString('base64');
}

export function decryptValue(key, stored) {
  if (!isEncrypted(stored)) return stored; // 旧明文，渐进迁移
  try {
    const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
    const iv = raw.subarray(0, IV_LEN);
    const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const body = raw.subarray(IV_LEN + TAG_LEN);
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(body), d.final()]).toString('utf8');
  } catch {
    return ''; // 密钥变更/密文损坏：返回空而不是密文，避免泄露
  }
}

/** 变量名是否敏感 */
export function isSensitiveName(name) {
  return /cookie|token|sess|auth|password|passwd|secret|api[_-]?key|credential|jwt|bearer|refresh/i.test(String(name || ''));
}

/** 值是否长得像凭据（cookie / JWT / 长 base64） */
export function looksSensitiveValue(v) {
  const s = String(v || '');
  if (s.length < 24) return false;
  if (/=(sess|session|token|auth|jwt)/i.test(s)) return true;
  if (/^eyJ[A-Za-z0-9_-]{10,}\./.test(s)) return true;       // JWT
  if (/^[A-Za-z0-9_-]{40,}$/.test(s)) return true;            // 长 base64/hex
  if (/\b(gld|sess|sid|uid|auth)[=:;]/.test(s)) return true; // cookie 串
  return false;
}

/** 渠道里需要加密的字段 */
export const SENSITIVE_CHANNEL_FIELDS = new Set(['token', 'key', 'pass', 'password', 'secret', 'url', 'user', 'chat_id', 'chatid']);

/** 加密一个 flow/template 的敏感部分（返回新对象，不改原对象） */
export function encryptSecrets(key, obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };
  if (out.vars && typeof out.vars === 'object') {
    const vars = {};
    for (const [k, v] of Object.entries(out.vars)) {
      const sensitive = isSensitiveName(k) || looksSensitiveValue(v);
      vars[k] = sensitive ? encryptValue(key, v) : v;
    }
    out.vars = vars;
  }
  if (out.notify && Array.isArray(out.notify.channels)) {
    out.notify = {
      ...out.notify,
      channels: out.notify.channels.map((c) => {
        const cc = { ...c };
        for (const [k, v] of Object.entries(cc)) {
          if (SENSITIVE_CHANNEL_FIELDS.has(String(k).toLowerCase()) && typeof v === 'string' && v) {
            cc[k] = encryptValue(key, v);
          }
        }
        return cc;
      }),
    };
  }
  return out;
}

/** 解密一个 flow/template 的敏感部分 */
export function decryptSecrets(key, obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };
  if (out.vars && typeof out.vars === 'object') {
    const vars = {};
    for (const [k, v] of Object.entries(out.vars)) {
      vars[k] = isEncrypted(v) ? decryptValue(key, v) : v;
    }
    out.vars = vars;
  }
  if (out.notify && Array.isArray(out.notify.channels)) {
    out.notify = {
      ...out.notify,
      channels: out.notify.channels.map((c) => {
        const cc = { ...c };
        for (const [k, v] of Object.entries(cc)) {
          if (isEncrypted(v)) cc[k] = decryptValue(key, v);
        }
        return cc;
      }),
    };
  }
  return out;
}

/** 导出/备份时的脱敏（保留结构，敏感值替换为占位） */
export function maskSecrets(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };
  if (out.vars && typeof out.vars === 'object') {
    const vars = {};
    for (const [k, v] of Object.entries(out.vars)) {
      vars[k] = isSensitiveName(k) || looksSensitiveValue(v) ? '' : v;
    }
    out.vars = vars;
  }
  if (out.notify && Array.isArray(out.notify.channels)) {
    out.notify = {
      ...out.notify,
      channels: out.notify.channels.map((c) => {
        const cc = { ...c };
        for (const f of SENSITIVE_CHANNEL_FIELDS) {
          if (cc[f]) cc[f] = '***';
        }
        return cc;
      }),
    };
  }
  return out;
}

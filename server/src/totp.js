/**
 * TOTP（RFC 6238）两步验证 —— 零依赖实现
 * - HMAC-SHA1 / 30 秒窗口 / 6 位数字（与 Google Authenticator、Authy、Aegis 等兼容）
 * - base32（RFC 4648）密钥编解码
 * - 恢复码：随机 10 位，存 sha256 摘要，用一次即废
 */
import crypto from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  while (out.length % 8 !== 0) out += '=';
  return out;
}

export function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error('非法 base32 字符');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 生成 20 字节随机密钥（base32 展示） */
export function generateSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

/** 计算某个时间步的验证码 */
export function totpAt(secret, counter, digits = 6) {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);
  return String(code % 10 ** digits).padStart(digits, '0');
}

/** 当前验证码 */
export function totpNow(secret, offset = 0) {
  return totpAt(secret, Math.floor((Date.now() / 1000 + offset) / 30));
}

/** 校验验证码（允许 ±window 个时间步，容网络/时钟漂移） */
export function verifyTotp(secret, code, window = 1) {
  const input = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(input)) return false;
  for (let i = -window; i <= window; i++) {
    const expected = totpNow(secret, i * 30);
    if (expected.length === input.length
      && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(input))) return true;
  }
  return false;
}

/** 生成一次性恢复码（10 个） */
export function generateRecoveryCodes(count = 10) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(8).toString('hex').toUpperCase();
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`);
  }
  return codes;
}

/** 恢复码摘要（存库用，不落明文） */
export function hashRecoveryCode(code) {
  return crypto.createHash('sha256').update(String(code || '').trim().toUpperCase()).digest('hex');
}

export function verifyRecoveryCode(code, hash) {
  const h = hashRecoveryCode(code);
  if (h.length !== hash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(hash));
}

/** otpauth:// URI（可直接被验证器 App 扫码/导入） */
export function otpauthUri({ secret, account, issuer = 'CheckQ' }) {
  const label = encodeURIComponent(`${issuer}:${account || 'admin'}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${params.toString()}`;
}

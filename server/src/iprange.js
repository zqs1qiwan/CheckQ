/**
 * IP 允许名单 / 黑名单工具（IPv4 + IPv6，CIDR）
 * - 精确 IP：1.2.3.4（等价 /32）、::1（等价 /128）
 * - 网段：10.0.0.0/8、192.168.1.0/24、fd00::/8
 * - 归一化：IPv4-mapped IPv6（::ffff:1.2.3.4）按 IPv4 处理
 */
import net from 'node:net';

function toBigInt(ip) {
  const fam = net.isIP(ip);
  if (fam === 4) {
    const p = ip.split('.').map((x) => Number(x));
    let v = 0n;
    for (const b of p) v = (v << 8n) | BigInt(b);
    return { big: v, bits: 32, fam: 4 };
  }
  if (fam === 6) {
    // 去掉 ::ffff: 前缀 → 按 IPv4 处理
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped) return toBigInt(mapped[1]);
    const parts = ip.split('::');
    const head = parts[0] ? parts[0].split(':') : [];
    const tail = parts.length > 1 && parts[1] ? parts[1].split(':') : [];
    const total = 8;
    const groups = [];
    const headN = head.filter(Boolean).length;
    const tailN = tail.filter(Boolean).length;
    const zeros = new Array(Math.max(0, total - headN - tailN)).fill('0');
    const all = [...head.filter(Boolean), ...zeros, ...tail.filter(Boolean)];
    let v = 0n;
    for (const g of all.slice(0, 8)) v = (v << 16n) | BigInt(parseInt(g || '0', 16));
    return { big: v, bits: 128, fam: 6 };
  }
  return null;
}

/** 前缀掩码：保留高 bits 位（/8 = 255.0.0.0） */
function prefixMask(bits, totalBits) {
  if (bits <= 0) return 0n;
  const all = (1n << BigInt(totalBits)) - 1n;
  return (all << BigInt(totalBits - bits)) & all;
}

/** 解析 CIDR / 单 IP → { big, bits, fam } */
export function parseCidr(spec) {
  const s = String(spec || '').trim();
  if (!s) return null;
  const [ipPart, bitsPart] = s.split('/');
  const ip = ipPart.trim();
  const parsed = toBigInt(ip);
  if (!parsed) return null;
  let bits = parsed.bits;
  if (bitsPart !== undefined) {
    const n = Number(bitsPart);
    if (!Number.isInteger(n) || n < 0 || n > parsed.bits) return null;
    bits = n;
  }
  const mask = prefixMask(bits, parsed.bits);
  const base = parsed.big & mask;
  return { big: base, bits, fam: parsed.fam, mask };
}

/** 判断 ip 是否落在 cidr 列表内（支持 IPv4 / IPv6；v4-mapped 归一） */
export function ipAllowed(ip, cidrList) {
  const list = Array.isArray(cidrList) ? cidrList : String(cidrList || '').split(/[\s,;]+/);
  const rules = list.map((x) => String(x || '').trim()).filter(Boolean);
  if (!rules.length) return true; // 空 = 不限制
  const target = toBigInt(String(ip || '').trim());
  if (!target) return false;
  for (const rule of rules) {
    const c = parseCidr(rule);
    if (!c) continue;
    if (c.fam !== target.fam) continue;
    if ((target.big & c.mask) === c.big) return true;
  }
  return false;
}

/** 规范化（用于展示） */
export function normalizeIp(ip) {
  const s = String(ip || '').trim();
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return mapped ? mapped[1] : s;
}

/** 共享小工具：时间格式化、敏感字段判定（全站唯一来源，避免各组件各写一份） */

const p2 = (n) => String(n).padStart(2, '0');

/** 完整日期时间：2026-11-13 08:30 */
export function fmtDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/** 当天时刻：08:30:15 */
export function fmtClock(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

/** 相对时间：刚刚 / 12 分钟前 / 3 小时前 / 2 天前 */
export function fmtAgo(ts) {
  if (!ts) return '—';
  const diff = Date.now() - Number(ts);
  if (!Number.isFinite(diff)) return '—';
  if (diff < 0) return fmtDateTime(ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  return fmtDateTime(ts);
}

/** 变量名是否敏感（与后端 secret.js 的 isSensitiveName 同口径） */
export function isSensitiveName(name) {
  return /cookie|token|sess|auth|password|passwd|secret|api[_-]?key|credential|jwt|bearer|refresh/i.test(String(name || ''));
}

/** 渠道类型 → 中文名（与编辑器通知面板一致） */
export const CHANNEL_LABELS = {
  inbox: '站内通知',
  webhook: 'Webhook',
  bark: 'Bark',
  telegram: 'Telegram',
  serverchan: 'Server酱',
  pushplus: 'PushPlus',
  dingtalk: '钉钉',
  wecom: '企业微信',
  feishu: '飞书',
  gotify: 'Gotify',
  ntfy: 'ntfy',
  email: '邮件',
};

/** 角色 → 中文名 */
export const ROLE_LABELS = { admin: '管理员', operator: '操作员', viewer: '只读' };

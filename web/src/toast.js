/**
 * 全局轻提示（toast）总线 + 提示级别策略。
 * 级别：
 *   error   仅错误提示（默认，日常最安静）
 *   success 成功 + 错误
 *   all     全部提示（含信息类）
 * 级别可由用户在「设置 → 通知与汇总」里切换，服务端与 localStorage 双存。
 */
const LEVELS = ['error', 'success', 'all'];
const KEY = 'checkq-toast-level';

let level = (typeof localStorage !== 'undefined' && localStorage.getItem(KEY)) || 'error';
const listeners = new Set();
const queue = [];

function notify() {
  for (const fn of listeners) fn(level);
}

export function getToastLevel() {
  return level;
}

export function setToastLevel(next) {
  level = LEVELS.includes(next) ? next : 'error';
  try { localStorage.setItem(KEY, level); } catch { /* ignore */ }
  notify();
  return level;
}

export function onToastLevelChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 是否应当显示该类型的提示 */
export function shouldShow(kind) {
  if (kind === 'fail' || kind === 'error') return true;
  if (level === 'error') return false;
  if (level === 'success') return kind === 'ok' || kind === 'success';
  return true;
}

/** 触发一条全局提示（level 不满足时静默丢弃） */
export function toast(text, kind = 'info') {
  if (!text) return;
  if (!shouldShow(kind)) return;
  const item = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text: String(text), kind };
  queue.push(item);
  notify();
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('checkq-toast', { detail: item }));
}

export function toastQueue() {
  return queue;
}

export function dismissToast(id) {
  const i = queue.findIndex((t) => t.id === id);
  if (i >= 0) queue.splice(i, 1);
  notify();
}

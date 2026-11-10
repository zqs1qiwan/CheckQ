// CheckQ 主题：日 / 夜 / 自动（跟随系统）。持久化于 localStorage('checkq-theme')，
// DOM 状态落在 <html data-theme="auto|light|dark" data-mode="light|dark">，
// 样式层只读 data-mode（styles.css 双 token 块）。canvas 等需要真实色值的
// 第三方属性（xyflow Background）用 onMode() 订阅解析结果。
const KEY = 'checkq-theme';
const mm = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
const listeners = new Set();
let mode = 'dark';

export function getTheme() {
  try { return localStorage.getItem(KEY) || 'auto'; } catch { return 'auto'; }
}

function resolveMode(t) {
  if (t === 'dark' || t === 'light') return t;
  return mm && mm.matches ? 'dark' : 'light';
}

export function currentMode() { return mode; }

function apply(t) {
  mode = resolveMode(t);
  const root = document.documentElement;
  root.dataset.theme = t;   // auto | light | dark（用户选择）
  root.dataset.mode = mode; // 解析后的明暗（CSS 用）
  listeners.forEach((cb) => cb(mode));
}

export function setTheme(t) {
  try { localStorage.setItem(KEY, t); } catch { /* 隐私模式忽略 */ }
  apply(t);
}

// 自动模式下跟随系统切换（OS 换日/夜即时生效）
if (mm && typeof mm.addEventListener === 'function') {
  mm.addEventListener('change', () => { if (getTheme() === 'auto') apply('auto'); });
}

/** main.jsx 顶部调用；index.html 内联脚本已先置 data-mode（防闪） */
export function initTheme() { apply(getTheme()); }

/** 订阅解析后的明暗模式（'dark' | 'light'）；回调会立即收到当前值；返回取消函数 */
export function onMode(cb) { listeners.add(cb); cb(mode); return () => listeners.delete(cb); }

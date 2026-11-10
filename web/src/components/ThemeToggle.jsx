import React, { useState } from 'react';
import { getTheme, setTheme } from '../theme.js';

/** 单按钮主题切换：点击循环 日间 ☀ → 夜间 ☾ → 自动 ◐（跟随系统） */
const MODES = [
  ['light', '☀', '日间（亮色）'],
  ['dark', '☾', '夜间（暗色）'],
  ['auto', '◐', '自动（跟随系统）'],
];
export default function ThemeToggle() {
  const [t, setT] = useState(getTheme());
  const idx = Math.max(0, MODES.findIndex(([v]) => v === t));
  const [, icon, label] = MODES[idx];
  const next = MODES[(idx + 1) % MODES.length];
  return (
    <button
      type="button"
      className="iconbtn theme-btn"
      title={`主题：${label} · 点击切到${next[2]}`}
      aria-label={`主题：${label}，点击切换`}
      onClick={() => { setT(next[0]); setTheme(next[0]); }}
    >{icon}</button>
  );
}

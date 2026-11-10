import React, { useState } from 'react';
import { getTheme, setTheme } from '../theme.js';

/** 顶栏三段切换：日 ☀ / 夜 ☾ / 自动 ◐（跟随系统），图标点击 */
const OPTS = [
  ['light', '☀', '切到日间（亮色）主题'],
  ['dark', '☾', '切到夜间（暗色）主题'],
  ['auto', '◐', '自动：跟随系统明暗'],
];
export default function ThemeToggle() {
  const [t, setT] = useState(getTheme());
  const pick = (v) => { setT(v); setTheme(v); };
  return (
    <div className="theme-seg" role="group" aria-label="主题：日间 / 夜间 / 跟随系统">
      {OPTS.map(([v, icon, tip]) => (
        <button key={v} type="button" className={t === v ? 'active' : ''}
          title={tip} aria-label={tip} aria-pressed={t === v} onClick={() => pick(v)}>{icon}</button>
      ))}
    </div>
  );
}

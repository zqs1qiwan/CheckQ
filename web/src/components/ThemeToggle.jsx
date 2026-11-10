import React, { useState } from 'react';
import { getTheme, setTheme } from '../theme.js';

/** 顶栏三段切换：日 / 夜 / 自动（跟随系统） */
export default function ThemeToggle() {
  const [t, setT] = useState(getTheme());
  const pick = (v) => { setT(v); setTheme(v); };
  return (
    <div className="theme-seg" role="group" aria-label="主题：日 / 夜 / 自动">
      {[['light', '日'], ['dark', '夜'], ['auto', '自动']].map(([v, label]) => (
        <button key={v} type="button" className={t === v ? 'active' : ''}
          aria-pressed={t === v} onClick={() => pick(v)}>{label}</button>
      ))}
    </div>
  );
}

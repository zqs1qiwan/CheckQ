import React, { useEffect, useState } from 'react';
import { toastQueue, dismissToast } from '../toast.js';

/** 全局提示条：挂在 App 根部，任何页面调用 toast() 都会在这里出现 */
export default function GlobalToast() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    const sync = () => setItems([...toastQueue()]);
    window.addEventListener('checkq-toast', sync);
    const timer = setInterval(sync, 500);
    return () => {
      window.removeEventListener('checkq-toast', sync);
      clearInterval(timer);
    };
  }, []);

  if (!items.length) return null;
  return (
    <div className="toast-stack">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismissToast(t.id)}>{t.text}</div>
      ))}
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import Modal from './components/Modal.jsx';

/**
 * 应用内二次确认（替代浏览器 confirm）：统一风格、可控文案、危险操作红色。
 * 用法：const ok = await confirmDialog({ title: '删除任务', message: '不可恢复', danger: true });
 */
let seq = 0;
let resolver = null;
let pending = null;

export function confirmDialog({ title = '确认操作', message = '', confirmText = '确定', cancelText = '取消', danger = false }) {
  pending = { title, message, confirmText, cancelText, danger };
  seq += 1;
  const id = seq;
  return new Promise((resolve) => {
    resolver = (v) => { resolver = null; pending = null; resolve(v); resolve.id = id; };
    window.dispatchEvent(new CustomEvent('checkq-confirm'));
  });
}

export function ConfirmHost() {
  const [state, setState] = useState(null);
  useEffect(() => {
    const sync = () => setState(pending ? { ...pending } : null);
    window.addEventListener('checkq-confirm', sync);
    return () => window.removeEventListener('checkq-confirm', sync);
  }, []);
  if (!state) return null;
  return (
    <Modal
      title={state.title}
      onClose={() => resolver?.(false)}
      width={420}
      footer={
        <>
          <button onClick={() => resolver?.(false)}>{state.cancelText}</button>
          <button className={state.danger ? 'danger' : 'primary'} onClick={() => resolver?.(true)}>{state.confirmText}</button>
        </>
      }
    >
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7 }}>{state.message}</p>
    </Modal>
  );
}

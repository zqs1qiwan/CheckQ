import React, { useEffect, useState } from 'react';
import Modal from './components/Modal.jsx';

/**
 * 应用内二次确认（替代浏览器 confirm）：统一风格、可控文案、危险操作红色。
 * 用法：const ok = await confirmDialog({ title: '删除任务', message: '不可恢复', danger: true });
 *
 * 生命周期：模块级 pending + 订阅者（不是一次性 window 事件）。
 * 之前只在「打开」时 dispatch 事件，resolve 后 ConfirmHost 的 state 没人清 →
 * 弹窗一直挂在屏幕上（删除已完成但确认框不消失）。现在 resolve 会同步通知
 * 所有订阅者把 state 置空，Modal 卸载并 close()。
 */
let seq = 0;
let resolver = null;
let pending = null;
const listeners = new Set();

function notify() {
  const snapshot = pending ? { ...pending } : null;
  for (const fn of listeners) fn(snapshot);
}

export function confirmDialog({ title = '确认操作', message = '', confirmText = '确定', cancelText = '取消', danger = false }) {
  // 若上一个确认还没关闭（异常路径），先按「取消」结束，避免 Promise 永远 pending
  if (resolver) resolver(false);
  pending = { title, message, confirmText, cancelText, danger };
  seq += 1;
  const id = seq;
  return new Promise((resolve) => {
    resolver = (v) => {
      const done = resolve;
      resolver = null;
      pending = null;
      notify();              // 关键：立即清掉 ConfirmHost 的 state
      done(v);
      done.id = id;
    };
    notify();                // 打开（或刷新）弹窗
  });
}

export function ConfirmHost() {
  const [state, setState] = useState(null);
  useEffect(() => {
    listeners.add(setState);
    setState(pending ? { ...pending } : null); // 晚挂载也能看到已 pending 的确认
    return () => listeners.delete(setState);
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

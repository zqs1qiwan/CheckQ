import React, { useEffect, useId, useRef } from 'react';

/**
 * 统一弹窗骨架 —— 原生 <dialog> + showModal()
 *
 * 为什么用原生 dialog（Modern Web Guidance: dialog）：
 *   - 浏览器自带焦点陷阱、背景 inert、Esc/返回手势关闭、顶层渲染（不会被父级 overflow/z-index 裁掉）
 *   - 自带 role=dialog / aria-modal，不需要手写 role、focus trap、inert 或 body 滚动锁
 *   - 关闭后焦点自动回到触发按钮
 * 我们只保留：标题关联（aria-labelledby）、首字段聚焦、点遮罩关闭（closedby="any" + 旧浏览器回退）。
 *
 * 注意：不要给 dialog 无条件写 display，否则会覆盖关闭态；样式都限定在 dialog[open]。
 */
export default function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  width,
  className = '',
  bodyClassName = '',
  closeOnMask = true,
}) {
  const ref = useRef(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const d = ref.current;
    if (!d) return undefined;
    if (!d.open) d.showModal();

    // 首字段优先聚焦；没有表单控件时聚焦 dialog 本身（而不是让浏览器落到右上角 ✕）
    const first = d.querySelector('input:not([type="hidden"]):not([disabled]), textarea, select');
    if (first && typeof first.focus === 'function') first.focus();
    else d.focus({ preventScroll: true });

    // Esc / 返回手势：统一走 React 的关闭路径（避免同一次关闭触发两遍）
    const onCancel = (e) => {
      e.preventDefault();
      closeRef.current?.();
    };
    // closedby="any" 的原生轻关闭（点遮罩）会直接 close → 这里同步 React 状态
    const onNativeClose = () => closeRef.current?.();
    d.addEventListener('cancel', onCancel);
    d.addEventListener('close', onNativeClose);

    // 旧浏览器没有 closedby：用 pointerdown+pointerup 都在框外才算轻关闭
    let pressedOutside = false;
    const outside = (e) => {
      const r = d.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    const supportsClosedBy = 'closedBy' in HTMLDialogElement.prototype;
    const onDown = (e) => { if (!supportsClosedBy && closeOnMask) pressedOutside = outside(e); };
    const onUp = (e) => {
      if (supportsClosedBy || !closeOnMask) return;
      if (pressedOutside && outside(e)) closeRef.current?.();
      pressedOutside = false;
    };
    d.addEventListener('pointerdown', onDown);
    d.addEventListener('pointerup', onUp);

    return () => {
      d.removeEventListener('cancel', onCancel);
      d.removeEventListener('close', onNativeClose);
      d.removeEventListener('pointerdown', onDown);
      d.removeEventListener('pointerup', onUp);
      if (d.open) d.close();
    };
  }, [closeOnMask]);

  return (
    <dialog
      ref={ref}
      className={`modal structured ${className}`}
      style={width ? { width } : undefined}
      aria-labelledby={titleId}
      tabIndex={-1}
      closedby={closeOnMask ? 'any' : 'closerequest'}
    >
      <div className="modal-head">
        <div className="modal-title" id={titleId}>
          {typeof title === 'string' ? <h3>{title}</h3> : title}
          {subtitle && <p className="modal-sub">{subtitle}</p>}
        </div>
        {onClose && (
          <button type="button" className="modal-close" onClick={onClose} title="关闭（Esc）" aria-label="关闭">✕</button>
        )}
      </div>
      <div className={`modal-body ${bodyClassName}`}>{children}</div>
      {footer && <div className="modal-foot">{footer}</div>}
    </dialog>
  );
}

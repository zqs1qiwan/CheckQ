import React, { useEffect, useRef } from 'react';

/**
 * 统一弹窗骨架（v0.4.2 UI 规范）
 * - 右上角固定 ✕ 关闭（不再在底部堆「关闭」按钮）
 * - Esc 关闭、点击遮罩关闭
 * - 头部固定、正文滚动、底部操作区固定（主按钮在最右）
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
  maskClassName = '',
  closeOnMask = true,
}) {
  const ref = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && onClose) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 打开时把焦点移入弹窗，键盘用户不至于留在背景页
  useEffect(() => {
    const el = ref.current?.querySelector('input, textarea, select, button');
    if (el && typeof el.focus === 'function') el.focus();
  }, []);

  return (
    <div
      className={`modal-mask ${maskClassName}`}
      onClick={(e) => e.target === e.currentTarget && closeOnMask && onClose?.()}
    >
      <div
        ref={ref}
        className={`modal structured ${className}`}
        style={width ? { width } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
      >
        <div className="modal-head">
          <div className="modal-title">
            {typeof title === 'string' ? <h3>{title}</h3> : title}
            {subtitle && <p className="modal-sub">{subtitle}</p>}
          </div>
          {onClose && (
            <button className="modal-close" onClick={onClose} title="关闭（Esc）" aria-label="关闭">✕</button>
          )}
        </div>
        <div className={`modal-body ${bodyClassName}`}>{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

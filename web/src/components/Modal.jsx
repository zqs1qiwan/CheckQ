import React, { useEffect, useRef } from 'react';

/**
 * 统一弹窗骨架（v0.4.2 UI 规范 / v0.4.3 交互修复）
 * - 右上角固定 ✕ 关闭（不再在底部堆「关闭」按钮）
 * - Esc 关闭、点击遮罩关闭
 * - **打开时锁定背景滚动**（body 固定 + 记录滚动位置，关闭后还原）——修复「在设置里滚动会带着主窗口一起滚」
 * - 头部固定、正文滚动、底部操作区固定；主按钮在最右
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
  const lastFocus = useRef(null);

  // 背景滚动锁定
  useEffect(() => {
    const scrollY = window.scrollY;
    const prev = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
    };
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    return () => {
      document.body.style.overflow = prev.overflow;
      document.body.style.position = prev.position;
      document.body.style.top = prev.top;
      document.body.style.width = prev.width;
      window.scrollTo(0, scrollY);
    };
  }, []);

  // Esc 关闭
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && onClose) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 打开时把焦点移入弹窗，关闭时归还
  useEffect(() => {
    lastFocus.current = document.activeElement;
    const el = ref.current?.querySelector('input, textarea, select, button');
    if (el && typeof el.focus === 'function') el.focus();
    return () => {
      const back = lastFocus.current;
      if (back && typeof back.focus === 'function') back.focus();
    };
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

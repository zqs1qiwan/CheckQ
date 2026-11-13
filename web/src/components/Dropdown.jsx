import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * 浮层操作菜单（Popover API + fixed 定位）
 *
 * 为什么用 Popover：
 *   - 顶层渲染：任何祖先的 overflow / transform / z-index 都裁不到它
 *     （旧实现用 <details>+absolute，在 .table-scroll{overflow-x:auto} 里底部行菜单会被裁掉）
 *   - 原生轻关闭：点外面 / Esc 自动收起，焦点回到触发按钮，不需要手写 document 监听
 *   - 无障碍：触发按钮 aria-expanded/aria-controls，面板是一组按钮（不冒充 role=menu，
 *     因为我们没有实现方向键导航，见 Modern Web Guidance: viewport-aware-dropdowns）
 *
 * 弹窗内必须 Portal 到 <dialog> 内部：
 *   showModal() 会让 dialog 之外的整份文档 inert；挂到 body 的 popover 虽能画出来但点不到。
 *   成为 dialog 后代后仍在 top layer（不会被 dialog 的 overflow 裁切），且不再 inert。
 *
 * 定位：仍用 JS 计算 fixed 坐标（CSS anchor positioning 目前跨浏览器支持不足），
 * 默认向下、空间不够向上翻转、水平夹紧在视口内，滚动/缩放时跟随。
 */
export default function Dropdown({
  children,
  trigger,
  align = 'left',
  caret = false,
  triggerClass = '',
  width,
  title,
  ariaLabel,
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const [portalTarget, setPortalTarget] = useState(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const popId = useId();

  // 触发器在 <dialog> 内时，浮层必须是该 dialog 的后代（否则被 showModal() 的 inert 拦住）
  useEffect(() => {
    const d = btnRef.current?.closest?.('dialog.modal');
    setPortalTarget(d || document.body);
  }, []);

  const place = useCallback(() => {
    const btn = btnRef.current;
    const pop = popRef.current;
    if (!btn || !pop) return;
    const r = btn.getBoundingClientRect();
    const pw = pop.offsetWidth || width || 160;
    const ph = pop.offsetHeight;
    const gap = 6;
    const margin = 8;
    const below = window.innerHeight - r.bottom - gap - margin;
    const above = r.top - gap - margin;
    let top;
    if (ph && below < ph && above > below) top = Math.max(margin, r.top - ph - gap);
    else top = r.bottom + gap;
    if (window.innerHeight - top < ph && above > below) top = Math.max(margin, r.top - ph - gap);
    top = Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - ph - margin));
    let left = align === 'right' ? r.right - pw : r.left;
    left = Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - pw - margin));
    setPos({ left, top });
  }, [align, width]);

  // 面板常驻 DOM（popover 关闭时浏览器自己隐藏），toggle 事件同步 React 状态
  useEffect(() => {
    const el = popRef.current;
    const btn = btnRef.current;
    if (!el) return undefined;
    // 用原生 popovertarget 触发：轻关闭/再次点击触发器都由浏览器处理，不会闪一下又打开
    btn?.setAttribute('popovertarget', popId);
    btn?.setAttribute('popovertargetaction', 'toggle');
    const onToggle = (e) => {
      const isOpen = e.newState === 'open';
      setOpen(isOpen);
      if (isOpen) requestAnimationFrame(place);
    };
    el.addEventListener('toggle', onToggle);
    return () => el.removeEventListener('toggle', onToggle);
  }, [place, popId]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const onScroll = () => {
      const r = btnRef.current?.getBoundingClientRect();
      // 触发器滚出视口 → 收起（否则浮层会孤零零飘在屏幕上）
      if (r && (r.bottom < 0 || r.top > window.innerHeight)) {
        popRef.current?.hidePopover?.();
        return;
      }
      place();
    };
    const onResize = () => place();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, place]);

  return (
    <span className={`dd ${triggerClass}`}>
      <button
        ref={btnRef}
        type="button"
        className={`dd-trigger${open ? ' open' : ''}`}
        aria-expanded={open}
        aria-controls={popId}
        title={title || ariaLabel}
        aria-label={ariaLabel}
      >
        {trigger}
        {caret ? <span className="dd-caret" aria-hidden="true">▾</span> : null}
      </button>
      {createPortal(
        <div
          ref={popRef}
          id={popId}
          popover="auto"
          className="menu-pop dd-pop"
          style={{ left: pos.left, top: pos.top, minWidth: width || undefined }}
          onClick={(e) => {
            if (e.target.closest?.('button')) popRef.current?.hidePopover?.();
          }}
        >
          {children}
        </div>,
        portalTarget || document.body,
      )}
    </span>
  );
}

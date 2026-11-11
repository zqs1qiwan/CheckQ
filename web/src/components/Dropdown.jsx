import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * 浮层下拉菜单（Portal + fixed 定位）
 *
 * 为什么不用 <details>：
 *   <details> 里的浮层是 absolute 定位，会被祖先容器的 overflow 裁掉 ——
 *   - 任务表格 .table-scroll { overflow-x: auto } → 计算后 overflow-y 也变成 auto
 *     → 底部几行的「···」菜单被裁掉一半、根本点不到；
 *   - API 密钥列表 .key-list { overflow: hidden } → 「⋯」菜单直接消失。
 *   改成 Portal 挂到 body + fixed 定位后，任何父级 overflow 都不会再裁它。
 *
 * 定位规则：
 *   - 默认向下展开；下方空间不够且上方更宽裕时自动向上；
 *   - align="right" 右对齐，超出视口自动夹紧；
 *   - 滚动 / 缩放时跟随触发器重定位，触发器滚出视口则自动关闭。
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
  const btnRef = useRef(null);
  const popRef = useRef(null);

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

  // 打开后立即按触发器位置定位（useLayoutEffect：不闪一帧错位）
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      const t = e.target;
      if (popRef.current?.contains(t)) return;
      if (btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    const onScroll = () => {
      const r = btnRef.current?.getBoundingClientRect();
      // 触发器滚出视口 → 收起（否则浮层会孤零零飘在屏幕上）
      if (r && (r.bottom < 0 || r.top > window.innerHeight)) { setOpen(false); return; }
      place();
    };
    const onResize = () => place();
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
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
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title || ariaLabel}
        aria-label={ariaLabel}
      >
        {trigger}
        {caret ? <span className="dd-caret" aria-hidden="true">▾</span> : null}
      </button>
      {open && createPortal(
        <div
          ref={popRef}
          className="menu-pop dd-pop"
          role="menu"
          style={{ left: pos.left, top: pos.top, minWidth: width || undefined }}
          onClick={(e) => { if (e.target.closest?.('button')) setOpen(false); }}
        >
          {children}
        </div>,
        document.body,
      )}
    </span>
  );
}

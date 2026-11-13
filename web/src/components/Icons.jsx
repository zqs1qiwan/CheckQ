import React from 'react';

/**
 * 统一图标：全部线性 SVG，尺寸/描边/视窗一致，避免 emoji 的大小不一。
 * 用法：import { IconBell } from './Icons.jsx'; <IconBell size={16} />
 */

const S = ({ size = 16, children, fill = 'none', ...rest }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={fill}
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    {children}
  </svg>
);

export function IconBell({ size = 16, ...rest }) {
  return (
    <S size={size} {...rest}>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </S>
  );
}

export function IconHelp({ size = 16, ...rest }) {
  return (
    <S size={size} {...rest}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9a2.5 2.5 0 1 1 3.4 2.3c-.7.4-1 .9-1 1.7v.3" />
      <path d="M12 17h.01" />
    </S>
  );
}

export function IconSun({ size = 16, ...rest }) {
  return (
    <S size={size} {...rest}>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </S>
  );
}

export function IconMoon({ size = 16, ...rest }) {
  return (
    <S size={size} {...rest}>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
    </S>
  );
}

export function IconAuto({ size = 16, ...rest }) {
  return (
    <S size={size} {...rest}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v17" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17" fill="currentColor" stroke="none" />
    </S>
  );
}

export function IconClose({ size = 16, ...rest }) {
  return (
    <S size={size} {...rest}>
      <path d="M6 6l12 12M18 6L6 18" />
    </S>
  );
}

export function IconPlay({ size = 16, ...rest }) {
  return (
    <S size={size} {...rest}>
      <path d="M7 4.5v15l12-7.5-12-7.5Z" />
    </S>
  );
}

export function IconBug({ size = 16, ...rest }) {
  return (
    <S size={size} {...rest}>
      <rect x="8" y="7" width="8" height="12" rx="4" />
      <path d="M8 12H4.5M19.5 12H16M8.5 8.5 6 6M15.5 8.5 18 6M8.5 17 6 19.5M15.5 17 18 19.5" />
    </S>
  );
}

export function IconDownload({ size = 16, ...rest }) {
  return (
    <S size={size} {...rest}>
      <path d="M12 4v10" />
      <path d="m8 11 4 4 4-4" />
      <path d="M5 19h14" />
    </S>
  );
}

export function IconTrash({ size = 16, ...rest }) {
  return (
    <S size={size} {...rest}>
      <path d="M4 7h16" />
      <path d="M9 7V5h6v2" />
      <path d="M6 7l1 12h10l1-12" />
    </S>
  );
}

export function IconMore({ size = 16, ...rest }) {
  return (
    <S size={size} {...rest}>
      <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </S>
  );
}


export function IconBook({ size = 16, ...rest }) {
  return (
    <S size={size} {...rest}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5Z" />
      <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H19v3H6.5A2.5 2.5 0 0 1 4 20.5Z" />
    </S>
  );
}

export function IconKey({ size = 16, ...rest }) {
  return (
    <S size={size} {...rest}>
      <circle cx="8" cy="14" r="3.5" />
      <path d="m10.5 11.5 7-7 2 2-1.5 1.5L19 9.5 17.5 8" />
    </S>
  );
}

export function IconUsers({ size = 16, ...rest }) {
  return (
    <S size={size} {...rest}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19.5c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6" />
      <path d="M16 5.5a3 3 0 0 1 0 5.6M17.5 14.6c1.7.6 2.8 2 3.2 4.4" />
    </S>
  );
}

export function IconShield({ size = 16, ...rest }) {
  return (
    <S size={size} {...rest}>
      <path d="M12 3 5 6v6c0 4.2 2.9 7.4 7 9 4.1-1.6 7-4.8 7-9V6l-7-3Z" />
      <path d="m9.5 12 1.8 1.8 3.4-3.6" />
    </S>
  );
}

export function IconSparkle({ size = 16, ...rest }) {
  return (
    <S size={size} {...rest}>
      <path d="M12 3.5 13.6 9 19 10.5 13.6 12 12 17.5 10.4 12 5 10.5 10.4 9 12 3.5Z" />
      <path d="M18.5 16.5 19.2 18.3 21 19 19.2 19.7 18.5 21.5 17.8 19.7 16 19 17.8 18.3 18.5 16.5Z" />
    </S>
  );
}

/** 设置 / 偏好：滑块式线性图标，16px 下比多齿齿轮更干净 */
export function IconGear({ size = 16, ...rest }) {
  return (
    <S size={size} {...rest}>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </S>
  );
}

export function IconGlobe({ size = 16, ...rest }) {
  return (
    <S size={size} {...rest}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.5 9h17M3.5 15h17" />
      <path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z" />
    </S>
  );
}


export function IconCopy({ size = 16, ...rest }) {
  return (
    <S size={size} {...rest}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </S>
  );
}


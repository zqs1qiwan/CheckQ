import React from 'react';

/**
 * 统一图标（v0.4.2 品牌化）：全部线性 SVG，尺寸/描边/视窗一致，避免 emoji 的大小不一。
 * 用法：<Icon name="bell" size={16} />
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

export const ICONS = {
  bell: IconBell,
  help: IconHelp,
  sun: IconSun,
  moon: IconMoon,
  auto: IconAuto,
  close: IconClose,
  play: IconPlay,
  bug: IconBug,
  download: IconDownload,
  trash: IconTrash,
  more: IconMore,
};

export default function Icon({ name, size = 16, ...rest }) {
  const C = ICONS[name];
  if (!C) return null;
  return <C size={size} {...rest} />;
}

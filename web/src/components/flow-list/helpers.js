import { fmtDateTime } from '../../util.js';
import { toast as globalToast } from '../../toast.js';

export function fmtTime(ts) {
  return fmtDateTime(ts);
}

/** 统一走全局提示总线（受「设置 → 提示级别」控制） */
export function setToast({ kind, text }) {
  globalToast(text, kind === 'fail' ? 'fail' : kind === 'ok' ? 'ok' : 'info');
}


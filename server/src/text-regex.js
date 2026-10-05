/**
 * 文本划选 → 自动泛化正则（PRD §4.0.3）
 * 共享模块：server 端引擎/测试与 web 端 PickPanel 共用同一实现，避免逻辑漂移。
 *
 * 规则：
 * - 连续数字（含小数点）→ 一个捕获组 (\d+(?:\.\d+)?)，避免 "12.5" 拆成两组只取到 "12"
 * - 空白序列 → \s*
 * - 其余字符 → 正则元字符转义
 * - 冒号全半角归一 → [:：]（在占位符阶段处理，避免误伤正则结构 (?: 中的冒号）
 */

export function generalizeSelection(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < text.length && /[0-9.]/.test(text[j])) j++;
      let end = j;
      while (end > i && text[end - 1] === '.') end--; // 尾部小数点不算数字
      out += 'NUMGRP';
      i = end;
    } else if (/\s/.test(ch)) {
      let j = i;
      while (j < text.length && /\s/.test(text[j])) j++;
      out += 'SPGRP';
      i = j;
    } else {
      out += 'LIT' + ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      i++;
    }
  }
  return out
    .replace(/LIT[:：]/g, 'LITCOL')
    .replace(/LITCOL/g, '[:：]')
    .replace(/NUMGRP/g, '(\\d+(?:\\.\\d+)?)')
    .replace(/SPGRP/g, '\\s*')
    .replace(/LIT/g, '');
}

/** 划选文本 → 提取用正则（保证至少一个捕获组） */
export function textExtractRegex(selected) {
  let regex = generalizeSelection(selected);
  if (!regex.includes('(')) regex = `(${regex})`;
  return regex;
}

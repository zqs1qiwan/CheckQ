/** 步骤类型定义（与 server/src/model.js 保持一致） */

export const STEP_TYPES = {
  http: { label: 'HTTP 请求', color: '#3b82f6', outputs: ['success', 'failed'] },
  condition: { label: '条件判断', color: '#f59e0b', outputs: ['true', 'false'] },
  set: { label: '赋值', color: '#10b981', outputs: ['next'] },
  extract: { label: '提取', color: '#8b5cf6', outputs: ['next'] },
  delay: { label: '延迟', color: '#64748b', outputs: ['next'] },
  'random-delay': { label: '随机延迟', color: '#94a3b8', outputs: ['next'] },
  log: { label: '日志', color: '#0ea5e9', outputs: ['next'] },
  notify: { label: '通知', color: '#ec4899', outputs: ['next'] },
  script: { label: '脚本（JS沙箱）', color: '#f97316', outputs: ['next'] },
  foreach: { label: '遍历（foreach）', color: '#a855f7', outputs: ['each', 'next'] },
};

export const OUTPUT_LABELS = {
  success: '成功', failed: '失败', true: '真', false: '假', next: '下一步',
};

export function defaultConfig(type) {
  switch (type) {
    case 'http':
      return { method: 'GET', url: 'https://', headers: [{ name: 'user-agent', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', enabled: true }], body: '', asserts: [] };
    case 'condition':
      return { expr: 'last.json.code == 0' };
    case 'set':
      return { name: 'var1', value: '' };
    case 'extract':
      return { from: 'last.text', re: '(.*)', name: 'extracted', optional: true };
    case 'random-delay':
      return { min: 1, max: 5 };
    case 'delay':
      return { seconds: 5 };
    case 'log':
      return { text: '' };
    case 'notify':
      return { text: '', channels: [] };
    case 'script':
      return { code: '// vars / last / steps 只读可用；return { 新变量: 值 } 合并回 vars\nreturn { out: "" };' };
    case 'foreach':
      return { source: 'last.json.items', itemVar: 'item', indexVar: 'index' };
    default:
      return {};
  }
}

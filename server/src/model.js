/**
 * 流程数据模型
 *
 * Flow = {
 *   id, name, note, cron: '30 8 * * *', timezone, enabled,
 *   vars: { cookie: '...', email: '...' },          // 用户变量（单流程作用域）
 *   nodes: [ Node ], edges: [ Edge ],
 *   notify: { webhook?: url, telegram?: {token,chat}, bark?: url, onSuccess, onFailure }
 * }
 *
 * Node = {
 *   id, type, x, y,                     // type 见 STEP_TYPES；x/y 画布坐标
 *   name: '签到请求',                    // 用户命名
 *   config: { ... },                    // 各类型私有配置
 *   // 出口约定（执行器依赖）:
 *   //   http:      success | failed
 *   //   condition: true | false
 *   //   其他:      next（唯一出口）
 * }
 *
 * Edge = { id, source, sourceHandle, target }
 */

export const STEP_TYPES = {
  http: {
    label: 'HTTP 请求',
    color: '#3b82f6',
    outputs: ['success', 'failed'],
  },
  condition: {
    label: '条件判断',
    color: '#f59e0b',
    outputs: ['true', 'false'],
  },
  set: {
    label: '赋值',
    color: '#10b981',
    outputs: ['next'],
  },
  extract: {
    label: '提取',
    color: '#8b5cf6',
    outputs: ['next'],
  },
  delay: {
    label: '延迟',
    color: '#64748b',
    outputs: ['next'],
  },
  'random-delay': {
    label: '随机延迟',
    color: '#94a3b8',
    outputs: ['next'],
  },
  log: {
    label: '日志',
    color: '#0ea5e9',
    outputs: ['next'],
  },
  notify: {
    label: '通知',
    color: '#ec4899',
    outputs: ['next'],
  },
};

export function validateFlow(flow) {
  const errors = [];
  if (!flow.name || !flow.name.trim()) errors.push('流程名不能为空');
  const nodes = flow.nodes || [];
  if (!nodes.length) errors.push('流程至少需要一个步骤');
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const e of flow.edges || []) {
    if (!byId.has(e.source) || !byId.has(e.target)) errors.push(`连线 ${e.id} 引用了不存在的节点`);
  }
  const starts = nodes.filter((n) => !(flow.edges || []).some((e) => e.target === n.id));
  if (nodes.length && !starts.length) errors.push('没有起点（所有节点都有入线，流程成环）');
  return errors;
}

/** 找入口节点：无入边的第一个（多个时取画布最靠左的） */
export function findEntry(flow) {
  const nodes = flow.nodes || [];
  const edges = flow.edges || [];
  const noIn = nodes.filter((n) => !edges.some((e) => e.target === n.id));
  if (!noIn.length) return null;
  return noIn.sort((a, b) => a.x - b.x)[0];
}

/**
 * 流程数据模型
 *
 * Flow = {
 *   id, name, note, group: '签到',
 *   cron: '30 8 * * *', timezone, enabled,
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
    color: '#4a7fa5',
    outputs: ['success', 'failed'],
  },
  condition: {
    label: '条件判断',
    color: '#b08340',
    outputs: ['true', 'false'],
  },
  set: {
    label: '赋值',
    color: '#4f8a6b',
    outputs: ['next'],
  },
  extract: {
    label: '提取',
    color: '#7a6aa8',
    outputs: ['next'],
  },
  delay: {
    label: '延迟',
    color: '#6b7784',
    outputs: ['next'],
  },
  'random-delay': {
    label: '随机延迟',
    color: '#7d8894',
    outputs: ['next'],
  },
  log: {
    label: '日志',
    color: '#4a8a94',
    outputs: ['next'],
  },
  notify: {
    label: '通知',
    color: '#a86a7a',
    outputs: ['next'],
  },
  script: {
    label: '脚本（JS沙箱）',
    color: '#a9744a',
    outputs: ['next'],
  },
  foreach: {
    label: '遍历（foreach）',
    color: '#8a6a9a',
    outputs: ['each', 'next'],
  },
};

export function validateFlow(flow, { allowEmptyDraft = true } = {}) {
  const errors = [];
  if (!flow.name || !flow.name.trim()) errors.push('流程名不能为空');
  const nodes = flow.nodes || [];
  if (!nodes.length && !allowEmptyDraft) errors.push('流程至少需要一个步骤');
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const e of flow.edges || []) {
    if (!byId.has(e.source) || !byId.has(e.target)) errors.push(`连线 ${e.id} 引用了不存在的节点`);
  }
  // 循环体回边的终点除外允许（foreach 回路）：`foreach` 节点允许被回边指向
  const starts = nodes.filter((n) => !(flow.edges || []).some((e) => e.target === n.id && byId.get(e.source)?.type !== 'foreach' || e.target === n.id && e.source === n.id));
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

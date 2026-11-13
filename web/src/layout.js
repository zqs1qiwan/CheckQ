/**
 * 流程图自动布局（纯函数，无 React 依赖）
 *
 * 规则：按 DAG 最长路径分层（左→右），同层按原 y / x 排序后均匀纵向排开。
 * - 环里的节点无法分层：放到最后一层，避免丢节点；
 * - 不改变 node.data，只返回新的 position；
 * - 供编辑器「更多 → 整理布局」与单测使用。
 */
export function autoLayout(nodes, edges, opts = {}) {
  const x0 = opts.x0 ?? 80;
  const y0 = opts.y0 ?? 80;
  const dx = opts.dx ?? 260;
  const dy = opts.dy ?? 130;
  const list = Array.isArray(nodes) ? nodes : [];
  if (!list.length) return [];

  const ids = new Set(list.map((n) => n.id));
  const adj = new Map(list.map((n) => [n.id, []]));
  const indeg = new Map(list.map((n) => [n.id, 0]));
  for (const e of Array.isArray(edges) ? edges : []) {
    if (!e || !ids.has(e.source) || !ids.has(e.target)) continue;
    adj.get(e.source).push(e.target);
    indeg.set(e.target, (indeg.get(e.target) || 0) + 1);
  }

  const layer = new Map(list.map((n) => [n.id, 0]));
  const deg = new Map(indeg);
  const queue = list.filter((n) => (deg.get(n.id) || 0) === 0).map((n) => n.id);
  const seen = new Set(queue);
  while (queue.length) {
    const id = queue.shift();
    for (const t of adj.get(id) || []) {
      layer.set(t, Math.max(layer.get(t) || 0, (layer.get(id) || 0) + 1));
      deg.set(t, (deg.get(t) || 0) - 1);
      if ((deg.get(t) || 0) === 0 && !seen.has(t)) { seen.add(t); queue.push(t); }
    }
  }

  // 环里的节点：放到最后一层之后，保证仍然可见
  const maxLayer = Math.max(0, ...[...layer.values()]);
  for (const n of list) if (!seen.has(n.id)) layer.set(n.id, maxLayer + 1);

  const byLayer = new Map();
  for (const n of list) {
    const l = layer.get(n.id) || 0;
    if (!byLayer.has(l)) byLayer.set(l, []);
    byLayer.get(l).push(n);
  }
  const out = [];
  for (const [l, group] of [...byLayer.entries()].sort((a, b) => a[0] - b[0])) {
    group.sort((a, b) => {
      const ay = a.position?.y ?? 0, by = b.position?.y ?? 0;
      if (ay !== by) return ay - by;
      const ax = a.position?.x ?? 0, bx = b.position?.x ?? 0;
      if (ax !== bx) return ax - bx;
      return String(a.id).localeCompare(String(b.id));
    });
    group.forEach((n, i) => {
      out.push({ ...n, position: { x: x0 + l * dx, y: y0 + i * dy } });
    });
  }
  return out;
}

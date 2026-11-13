/**
 * 流程图自动布局（纯函数）
 * 运行：node server/test/layout.test.js
 */
import { autoLayout } from '../../web/src/layout.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  PASS', msg); } else { fail++; console.log('  FAIL', msg); } };
const pos = (arr, id) => arr.find((n) => n.id === id).position;

const nodes = [
  { id: 'a', position: { x: 500, y: 500 } },
  { id: 'b', position: { x: 10, y: 10 } },
  { id: 'c', position: { x: 20, y: 20 } },
  { id: 'd', position: { x: 30, y: 30 } },
];
const edges = [
  { source: 'a', target: 'b' },
  { source: 'b', target: 'c' },
  { source: 'a', target: 'd' },
];
const out = autoLayout(nodes, edges, { x0: 80, y0: 80, dx: 260, dy: 130 });
ok(out.length === 4, '不丢节点');
ok(pos(out, 'a').x === 80, '入口在第一列');
ok(pos(out, 'b').x === 340 && pos(out, 'c').x === 600, '链式节点逐层右移');
ok(pos(out, 'd').x === 340, '同层节点共享 x');
ok(pos(out, 'b').y !== pos(out, 'd').y, '同层节点纵向错开');
ok(nodes[0].position.x === 500, '不修改输入节点');

const cyc = autoLayout(
  [{ id: 'x', position: { x: 0, y: 0 } }, { id: 'y', position: { x: 0, y: 0 } }],
  [{ source: 'x', target: 'y' }, { source: 'y', target: 'x' }],
);
ok(cyc.length === 2, '环里的节点也保留');
ok(pos(cyc, 'x').y !== pos(cyc, 'y').y, '环节点在同一层内纵向错开，避免重叠');

ok(autoLayout([], []).length === 0, '空图返回空数组');
ok(autoLayout(nodes, []).every((n) => n.position.x === 80), '无边时所有节点在同一列');

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);

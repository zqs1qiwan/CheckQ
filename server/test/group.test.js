/**
 * 任务分组 + 每组今日统计
 * 运行：node server/test/group.test.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  PASS', msg); } else { fail++; console.log('  FAIL', msg); } };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cq-group-'));
const store = new Store(dir);
const a = store.createFlow({ name: 'A', cron: '', group: '  签到组  ', nodes: [], edges: [] });
const b = store.createFlow({ name: 'B', cron: '', group: '签到组', nodes: [], edges: [] });
const c = store.createFlow({ name: 'C', cron: '', nodes: [], edges: [] });
ok(a.group === '签到组', '创建时分组名 trim');
ok(c.group === '', '不传分组 = 空串（未分组）');

const today = Date.now();
const yesterday = today - 26 * 3600 * 1000;
store.addRun({ id: 'r1', flowId: a.id, status: 'success', startedAt: today, logs: [], durationMs: 1 });
store.addRun({ id: 'r2', flowId: a.id, status: 'failed', startedAt: today, logs: [], durationMs: 1 });
store.addRun({ id: 'r3', flowId: a.id, status: 'success', startedAt: yesterday, logs: [], durationMs: 1 });
store.addRun({ id: 'r4', flowId: b.id, status: 'success', startedAt: today, logs: [], durationMs: 1 });

const list = store.listFlows();
const A = list.find((x) => x.id === a.id);
const B = list.find((x) => x.id === b.id);
const C = list.find((x) => x.id === c.id);
ok(A.group === '签到组' && B.group === '签到组', '列表返回分组名');
ok(C.group === '', '未分组返回空串');
ok(A.today.runs === 2 && A.today.success === 1 && A.today.failed === 1, '今日只统计今天（昨天不计入）');
ok(A.today.rate === 50, '今日成功率 50%');
ok(B.today.runs === 1 && B.today.rate === 100, '另一个任务的今日统计独立');
ok(C.today.runs === 0 && C.today.rate === null, '未运行任务 rate=null');

store.updateFlow(a.id, { group: '  新   组  ' });
ok(store.getFlowRaw(a.id).group === '新 组', '更新分组名时压缩空白');
store.updateFlow(a.id, { group: 'x'.repeat(100) });
ok(store.getFlowRaw(a.id).group.length === 40, '分组名限长 40');

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);

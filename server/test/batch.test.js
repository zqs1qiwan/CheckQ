/**
 * 批量操作 + 备份/恢复回归（青龙/千岛多选批处理对标）。
 */
process.env.ADMIN_PASSWORD = 'test1234';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';

const dir = fs.mkdtempSync(os.tmpdir() + '/cq-batch-');
const { buildServer } = await import('../src/api.js');
const { app, scheduler } = buildServer({ dataDir: dir, port: 0 });
await app.ready();
let passed = 0, failed = 0;
function check(n, c) { if (c) { passed++; console.log(`  PASS ${n}`); } else { failed++; console.log(`  FAIL ${n}`); } }
let r = await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'test1234' } });
const sid = r.headers['set-cookie'].split(';')[0].split('=')[1];
const ck = { qsid: sid };
const mk = async (name) => (await app.inject({ method: 'POST', url: '/api/flows', cookies: ck, payload: { name, nodes: [{ id: 'n0', type: 'log', name: '记录', x: 0, y: 0, config: { text: name } }], edges: [] } })).json();
const a = await mk('a'), b = await mk('b'), c = await mk('c');
r = await app.inject({ method: 'POST', url: '/api/flows/batch', cookies: ck, payload: { ids: [a.id, b.id], action: 'enable' } });
check('批量 enable', r.json().ok === 2);
r = await app.inject({ method: 'POST', url: '/api/flows/batch', cookies: ck, payload: { ids: [a.id, b.id], action: 'run' } });
check('批量 run 全部成功', r.json().ok === 2 && r.json().failed === 0);
r = await app.inject({ method: 'POST', url: '/api/flows/batch', cookies: ck, payload: { ids: [a.id], action: 'disable' } });
check('批量 disable', r.json().ok === 1);
r = await app.inject({ method: 'POST', url: '/api/flows/batch', cookies: ck, payload: { ids: [c.id], action: 'delete' } });
check('批量 delete', r.json().ok === 1);
r = await app.inject({ method: 'POST', url: '/api/flows/batch', cookies: ck, payload: { ids: [], action: 'run' } });
check('空 ids 400', r.statusCode === 400);
r = await app.inject({ method: 'GET', url: '/api/system/backup', cookies: ck });
const bk = r.json();
check('备份含 flows 且不含密码', Array.isArray(bk.flows) && bk.flows.length === 2 && !JSON.stringify(bk).includes('passwordHash'));
r = await app.inject({ method: 'POST', url: '/api/system/restore', cookies: ck, payload: bk });
const rs = r.json();
check('恢复 2 个任务（新 ID、停用）', rs.createdFlows?.length === 2 && rs.createdFlows.every((x) => x.name.includes('恢复')));
r = await app.inject({ method: 'GET', url: '/api/flows', cookies: ck });
const list = r.json();
check('恢复后共 4 任务', list.length === 4);
check('恢复任务默认停用', list.filter((x) => x.name.includes('恢复')).every((x) => x.enabled === false));
await app.close(); scheduler.stop();
console.log(`\n${passed}/${passed + failed} passed`);
if (failed) process.exit(1);

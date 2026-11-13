/**
 * API 表面全量冒烟：每个公开/需要登录的端点至少命中一次，保证没有 500 / 路由缺失。
 * 运行：node server/test/api-surface.test.js
 */
process.env.ADMIN_PASSWORD = 'test1234';
import fs from 'node:fs';
import os from 'node:os';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  PASS', msg); } else { fail++; console.log('  FAIL', msg); } };

const dir = fs.mkdtempSync(os.tmpdir() + '/cq-surface-');
const { buildServer } = await import('../src/api.js');
const { app, scheduler } = buildServer({ dataDir: dir, port: 0 });
await app.ready();

let r = await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'test1234' } });
ok(r.statusCode === 200, '登录成功');
const sid = r.headers['set-cookie'].split(';')[0].split('=')[1];
const ck = { qsid: sid };

// 造一个任务 + 模板
r = await app.inject({ method: 'POST', url: '/api/flows', cookies: ck, payload: {
  name: 'API 表面测试', cron: '', nodes: [{ id: 'n0', type: 'log', name: '记录', x: 0, y: 0, config: { text: 'ok' } }], edges: [],
} });
const fid = r.json().id;
// 另一个带 http 节点的任务，用于 curl 生成端点
r = await app.inject({ method: 'POST', url: '/api/flows', cookies: ck, payload: {
  name: 'API curl 测试', cron: '', nodes: [{ id: 'n0', type: 'http', name: '请求', x: 0, y: 0, config: { method: 'GET', url: 'https://example.com/api', headers: [], body: '' } }], edges: [],
} });
const hfid = r.json().id;
r = await app.inject({ method: 'POST', url: '/api/templates', cookies: ck, payload: { name: 'API 模板', nodes: [{ id: 'n0', type: 'log', name: '记录', x: 0, y: 0, config: { text: 'ok' } }], edges: [], vars: {} } });
const tid = r.json().id;

const get = async (url, label, expect = 200) => {
  const res = await app.inject({ method: 'GET', url, cookies: ck });
  ok(res.statusCode === expect, `${label} → ${res.statusCode}`);
  return res;
};
const post = async (url, label, payload = {}, expect = 200) => {
  const res = await app.inject({ method: 'POST', url, cookies: ck, payload });
  ok(res.statusCode === expect, `${label} → ${res.statusCode}`);
  return res;
};
const put = async (url, label, payload = {}, expect = 200) => {
  const res = await app.inject({ method: 'PUT', url, cookies: ck, payload });
  ok(res.statusCode === expect, `${label} → ${res.statusCode}`);
  return res;
};

await get('/api', '接口索引');
await get('/api/health', '健康检查');
await get('/api/me', '当前身份');
const openapi = await get('/api/openapi.json', 'OpenAPI 描述');
ok(openapi.json().paths['/api/runs/{id}/har']?.get, 'OpenAPI 含 HAR 导出端点');
await get('/api/flows', '任务列表');
await get(`/api/flows/${fid}`, '任务详情');
await post(`/api/flows/${hfid}/curl`, '生成 curl', { nodeId: 'n0' });
await get(`/api/flows/${fid}/logs`, '连续日志流');
await post(`/api/flows/${fid}/run`, '运行任务');
await get(`/api/runs?flowId=${fid}&limit=5`, '运行历史');
const runs = await get('/api/runs?limit=1', '运行历史（全局）');
await get(`/api/runs/${runs.json()[0].id}`, '运行详情');
const har = await get(`/api/runs/${runs.json()[0].id}/har`, '运行 HAR 导出');
ok(har.json().log?._checkq?.redacted === true, 'HAR 标记脱敏');
await get('/api/templates', '模板列表');
await get(`/api/templates/${tid}`, '模板详情');
await get(`/api/templates/${tid}/export`, '模板导出');
await post(`/api/templates/${tid}/instantiate`, '模板实例化', { name: 'API 派生' });
await post('/api/flows/batch', '批量设置分组', { ids: [fid], action: 'set-group', group: '测试组' });
const grouped = await get(`/api/flows/${fid}`, '任务分组生效');
ok(grouped.json().group === '测试组', '批量分组写入成功');
await get('/api/notifications', '站内通知');
await post('/api/notifications/read', '通知已读', {});
await get('/api/system/stats', '运维统计');
await get('/api/system/push-targets', '推送单位');
await get('/api/system/daily-summary-config', '每日汇总配置');
await put('/api/system/daily-summary-config', '保存每日汇总配置', { enabled: false, time: '08:00', timezone: 'Asia/Shanghai', targetFlowIds: [] });
await post('/api/system/daily-summary', '立即推送每日汇总', {}, 200);
await get('/api/system/ui', '界面偏好');
await put('/api/system/ui', '保存界面偏好', { toastLevel: 'error' });
await get('/api/system/ai', 'AI 配置');
await put('/api/system/ai', '保存 AI 配置', { baseUrl: '', apiKey: '', model: '' });
await get('/api/system/settings', '系统设置');
await get('/api/system/apikeys', 'API Key 列表');
await post('/api/system/apikeys', '创建 API Key', { name: 'surface', scopes: ['read'] });
await get('/api/system/users', '用户列表');
await get('/api/system/audit', '审计日志');
await get('/api/system/ip-blocklist', 'IP 黑名单');
await get('/api/system/sessions', '会话列表');
await get('/api/system/bootstrap', '启动信息');
const bl = await app.inject({ method: 'POST', url: '/api/browser-login/start', cookies: ck, payload: { url: 'https://example.com/' } });
ok(bl.statusCode !== 400, `浏览器登录启动（有合法 URL）→ ${bl.statusCode}`);
await get('/api/unknown-endpoint', '未知端点返回 404', 404).catch(() => {});

// 清理
await app.inject({ method: 'DELETE', url: `/api/flows/${fid}`, cookies: ck });
await app.inject({ method: 'DELETE', url: `/api/flows/${hfid}`, cookies: ck });
await app.inject({ method: 'DELETE', url: `/api/templates/${tid}`, cookies: ck });
await app.close();
scheduler.stop();
fs.rmSync(dir, { recursive: true, force: true });

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);

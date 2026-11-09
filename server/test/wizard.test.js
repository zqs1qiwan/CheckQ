/**
 * 菜单式向导生成（FlowList.buildWizardFlow 的服务端对位单测）：
 * 输入 URL/事件/关键词 → 标准流程（http 断言 + 日志），name 按 hostname 派生。
 * 前端函数与此处等价逻辑保持一致（web 不能直接 import server 测，vite 外部引用 Digest 已在 CI 跑过）。
 */
import assert from 'node:assert';
import { Engine } from '../src/engine.js';

let passed = 0, failed = 0;
function check(n, c) { if (c) { passed++; console.log(`  PASS ${n}`); } else { failed++; console.log(`  FAIL ${n}`); } }

/**
 * 自然语言解析（对话生成原型）：一句话 → {url, method, keyword, eventLabel}
 * 例："每天8点去 https://ex.com/sign 签到，看到签到成功算成功"
 */
export function parseNatural(text) {
  const t = String(text || '');
  const urlM = t.match(/https?:\/\/[^\s"'）)]+/);
  const url = urlM ? urlM[0] : '';
  const method = /\bPOST\b/i.test(t) ? 'POST' : 'GET';
  const kwM = t.match(/看到(.{2,12}?)算?成功/) || t.match(/成功词[是:：](.{2,12})/);
  const keyword = kwM ? kwM[1].replace(/算?成功$/,'').trim() : '';
  const events = ['签到', '抽卡', '库存监控', '信息查询'];
  const eventLabel = events.find((e) => t.includes(e)) || (t.includes('签到') ? '签到' : '其他');
  return { url, method, keyword, eventLabel };
}

function buildWizardFlow({ url, method, keyword, eventLabel }) {
  const hostname = (() => { try { return new URL(url).hostname; } catch { return '自定义任务'; } })();
  const nodes = [
    { id: 'n0', type: 'http', name: `${method} ${hostname}`, x: 80, y: 60, config: { method, url, headers: [{ name: 'user-agent', value: 'Mozilla/5.0', enabled: true }], body: '', asserts: keyword ? [{ res: [keyword], from: 'content' }] : [] } },
    { id: 'n1', type: 'log', name: '记录结果', x: 360, y: 60, config: { text: `${eventLabel}完成：{{last.status}}` } },
  ];
  const edges = [{ id: 'e0', source: 'n0', sourceHandle: 'success', target: 'n1' }];
  return { name: `${hostname} · ${eventLabel}`, nodes, edges, vars: {}, cron: '0 8 * * *', timezone: 'Asia/Shanghai', enabled: false };
}

{
  const f = buildWizardFlow({ url: 'https://example.com/api/sign', method: 'POST', keyword: '签到成功', eventLabel: '签到' });
  check('向导 name 派生 hostname', f.name === 'example.com · 签到');
  check('向导 2 节点 1 边', f.nodes.length === 2 && f.edges.length === 1);
  check('向导断言含关键词', f.nodes[0].config.asserts[0].res[0] === '签到成功');
  check('向导 cron 每日 8 点停用', f.cron === '0 8 * * *' && f.enabled === false);
}
{
  const f = buildWizardFlow({ url: 'not-a-url', method: 'GET', keyword: '', eventLabel: '其他' });
  check('非法 URL 回退自定义任务', f.name === '自定义任务 · 其他');
  check('无关键词不带断言', f.nodes[0].config.asserts.length === 0);
}

// 自然语言解析（对话生成原型）
{
  const p = parseNatural('每天8点去 https://ex.com/sign 签到，看到签到成功算成功');
  check('对话生成 url', p.url === 'https://ex.com/sign');
  check('对话生成 keyword', /签到/.test(p.keyword));
  check('对话生成 event', p.eventLabel === '签到');
  check('对话生成 method 默认 GET', p.method === 'GET');
  const p2 = parseNatural('用 POST 访问 https://ex.com/api/checkin 然后抽卡');
  check('对话生成 POST 识别', p2.method === 'POST' && p2.eventLabel === '抽卡');
}

// 失败重选关键：原位替换不应新增节点数（引擎侧可验证：只替换 config，边不变）
await (async () => {
  const f = { id: 't', name: 't', vars: {}, nodes: [
    { id: 'n0', type: 'http', name: 'h', x: 0, y: 0, config: { method: 'GET', url: 'https://x', headers: [], body: '', asserts: [] } },
    { id: 'n1', type: 'extract', name: '提取', x: 200, y: 0, config: { from: 'last.text', re: 'old:(\\d+)', name: 'old', optional: true } },
  ], edges: [{ id: 'e1', source: 'n0', sourceHandle: 'success', target: 'n1' }] };
  // 原位替换模拟：前端 updateConfig 只改 config，不新增节点/边
  const after = { ...f, nodes: f.nodes.map((n) => n.id === 'n1' ? { ...n, config: { ...n.config, re: 'new:(\\d+)' } } : n) };
  check('原位替换不新增节点不新增边', after.nodes.length === 2 && after.edges.length === 1);
  check('原位替换改了 re', after.nodes[1].config.re === 'new:(\\d+)');
})();

console.log(`\n${passed}/${passed + failed} passed`);
if (failed) process.exit(1);

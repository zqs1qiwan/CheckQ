#!/usr/bin/env node
/**
 * CheckQ MCP Server (stdio)
 *
 * 把 CheckQ 的 REST API 暴露成 MCP tools，任何 Agent（Claude Desktop / Cursor / OpenCode ...）
 * 都能通过 stdio JSON-RPC 2.0 调用。零依赖，Node 18+。
 *
 * 环境变量：
 *   CHECKQ_URL       CheckQ 基址，例如 http://checkq.local:18888（必填）
 *   CHECKQ_PASSWORD  登录密码（与 CHECKQ_API_KEY 二选一）
 *   CHECKQ_API_KEY   X-API-Key（推荐，免登录；从 CheckQ 设置页生成）
 *
 * 启动：node mcp/checkq-mcp.cjs
 * 协议：JSON-RPC 2.0 over stdio（Content-Length framing 与 newline-delimited 两种都兼容）
 */
const fs = require('fs');

const BASE = (process.env.CHECKQ_URL || '').replace(/\/+$/, '');
const PASSWORD = process.env.CHECKQ_PASSWORD || '';
const API_KEY = process.env.CHECKQ_API_KEY || '';

if (!BASE) {
  process.stderr.write('CHECKQ_URL 未设置\n');
  process.exit(1);
}

let cookie = null;
async function authHeaders() {
  const h = { 'content-type': 'application/json' };
  if (API_KEY) { h['x-api-key'] = API_KEY; return h; }
  if (!cookie) {
    const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
    if (!r.ok) throw new Error('CheckQ 登录失败: HTTP ' + r.status);
    cookie = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')]).map((c) => c.split(';')[0]).join('; ');
  }
  h.cookie = cookie;
  return h;
}
async function api(method, path, body) {
  const h = await authHeaders();
  // 无 body 的请求（GET/DELETE）不要带 application/json，否则 Fastify 会因空 JSON 体报 400
  if (body === undefined) delete h['content-type'];
  const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${typeof data === 'string' ? data.slice(0, 300) : JSON.stringify(data).slice(0, 300)}`);
  return data;
}

const TOOLS = [
  // —— 基础 ——
  { name: 'health', description: 'CheckQ 健康检查（版本、连通性）', inputSchema: { type: 'object', properties: {} } },
  { name: 'whoami', description: '当前身份与权限（登录用户 / API Key 作用域），用于自检', inputSchema: { type: 'object', properties: {} } },
  { name: 'stats', description: '运维健康统计（任务数/运行数/成功率/下次调度）', inputSchema: { type: 'object', properties: {} } },
  { name: 'notifications_list', description: '站内通知列表（含未读数）', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
  // —— 任务（签到）——
  { name: 'flows_list', description: '列出所有任务（含 cron/enabled/nextRunAt/上次结果）', inputSchema: { type: 'object', properties: { search: { type: 'string' } } } },
  { name: 'flow_get', description: '读取单个任务的完整定义（nodes/edges/vars/log/notify）', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  { name: 'flow_run', description: '立即运行一个任务，返回状态、摘要与人话日志（不改动配置）', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  { name: 'flow_logs', description: '读取某任务的连续日志流（多次运行的人话日志，最像 qinglong 面板）', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, limit: { type: 'number' } } } },
  { name: 'flow_update_vars', description: '更新任务变量（如 cookie / wbToken / ua），其余字段保留', inputSchema: { type: 'object', required: ['id', 'vars'], properties: { id: { type: 'string' }, vars: { type: 'object' } } } },
  { name: 'flow_update', description: '更新任务基础配置（name/cron/timezone/jitterMinutes/enabled/note）', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, name: { type: 'string' }, cron: { type: 'string' }, timezone: { type: 'string' }, jitterMinutes: { type: 'number' }, enabled: { type: 'boolean' }, note: { type: 'string' } } } },
  { name: 'flow_toggle', description: '启用/停用某个任务的定时调度', inputSchema: { type: 'object', required: ['id', 'enabled'], properties: { id: { type: 'string' }, enabled: { type: 'boolean' } } } },
  { name: 'flow_create', description: '新建一个任务（可从模板克隆；至少给 name）', inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, cron: { type: 'string' }, timezone: { type: 'string' }, vars: { type: 'object' }, templateId: { type: 'string' }, enabled: { type: 'boolean' } } } },
  { name: 'flow_delete', description: '删除一个任务（不可恢复；需要 write 作用域）', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  { name: 'flow_notify_test', description: '向某任务已配置的渠道发一条测试通知（验证 webhook/telegram 等）', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  // —— 模板 ——
  { name: 'templates_list', description: '列出所有模板（含变量名）', inputSchema: { type: 'object', properties: {} } },
  { name: 'template_get', description: '读取模板详情（变量名与默认变量值，敏感项已脱敏）', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  { name: 'template_instantiate', description: '从模板创建任务（变量各自覆盖，保留模板流程图）', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, name: { type: 'string' }, vars: { type: 'object' }, note: { type: 'string' } } } },
  // —— 导入 ——
  { name: 'import_curl', description: '把 cURL 命令解析为 http 节点配置（不创建任务）', inputSchema: { type: 'object', required: ['command'], properties: { command: { type: 'string' } } } },
  // —— 运行历史 ——
  { name: 'runs_list', description: '列出某任务的历史运行记录', inputSchema: { type: 'object', required: ['flowId'], properties: { flowId: { type: 'string' }, limit: { type: 'number' } } } },
  { name: 'run_get', description: '读取某次运行的完整日志与变量快照', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
];

async function callTool(name, args) {
  args = args || {};
  switch (name) {
    case 'health': return api('GET', '/api/health');
    case 'whoami': return api('GET', '/api/me');
    case 'flow_logs': return api('GET', '/api/flows/' + encodeURIComponent(args.id) + '/logs?limit=' + (args.limit || 200));
    case 'flow_update': {
      const patch = {};
      for (const k of ['name', 'cron', 'timezone', 'jitterMinutes', 'enabled', 'note']) {
        if (args[k] !== undefined) patch[k] = args[k];
      }
      return api('PUT', '/api/flows/' + encodeURIComponent(args.id), patch);
    }
    case 'flow_toggle':
      return api('PUT', '/api/flows/' + encodeURIComponent(args.id), { enabled: !!args.enabled });
    case 'flow_create': {
      if (args.templateId) {
        const tpl = await api('GET', '/api/templates/' + encodeURIComponent(args.templateId));
        return api('POST', '/api/templates/' + encodeURIComponent(args.templateId) + '/instantiate', {
          name: args.name,
          vars: args.vars || {},
        });
      }
      return api('POST', '/api/flows', {
        name: args.name,
        cron: args.cron || '',
        timezone: args.timezone || 'Asia/Shanghai',
        enabled: args.enabled === true,
        vars: args.vars || {},
        nodes: [{ id: 'n0', type: 'http', name: '请求', x: 80, y: 80, config: { method: 'GET', url: 'https://example.com', headers: [], body: '', asserts: [] } },
                { id: 'n1', type: 'log', name: '日志', x: 320, y: 80, config: { text: '完成：{{last.status}}' } }],
        edges: [{ id: 'e0', source: 'n0', sourceHandle: 'success', target: 'n1' }],
        log: { level: 'all', record: 'log', debug: false },
      });
    }
    case 'flow_notify_test': return api('POST', '/api/flows/' + encodeURIComponent(args.id) + '/notify-test', {});
    case 'flow_delete': return api('DELETE', '/api/flows/' + encodeURIComponent(args.id));
    case 'flows_list': return api('GET', '/api/flows');
    case 'flow_get': return api('GET', '/api/flows/' + args.id);
    case 'flow_run': return api('POST', '/api/flows/' + args.id + '/run', {});
    case 'flow_update_vars': {
      const cur = await api('GET', '/api/flows/' + args.id);
      return api('PUT', '/api/flows/' + args.id, { vars: { ...(cur.vars || {}), ...(args.vars || {}) } });
    }
    case 'runs_list': return api('GET', '/api/runs?flowId=' + encodeURIComponent(args.flowId) + '&limit=' + (args.limit || 30));
    case 'run_get': return api('GET', '/api/runs/' + args.id);
    case 'templates_list': return api('GET', '/api/templates');
    case 'template_get': return api('GET', '/api/templates/' + encodeURIComponent(args.id));
    case 'template_instantiate': return api('POST', '/api/templates/' + encodeURIComponent(args.id) + '/instantiate', {
      name: args.name, vars: args.vars || {}, note: args.note,
    });
    case 'import_curl': return api('POST', '/api/import/curl', { command: args.command });
    case 'stats': return api('GET', '/api/system/stats');
    case 'notifications_list': return api('GET', '/api/notifications?limit=' + (args.limit || 50));
    default: throw new Error('unknown tool: ' + name);
  }
}

function write(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

let buf = '';
process.stdin.setEncoding('utf8');
let pending = 0;
process.stdin.on('data', (chunk) => { buf += chunk; pump(); });
process.stdin.on('end', () => {
  // 等待在途请求完成后再退出，避免 tools/call 被中途截断
  const check = setInterval(() => { if (pending === 0) { clearInterval(check); setTimeout(() => process.exit(0), 200); } }, 50);
});

function pump() {
  while (true) {
    const nl = buf.indexOf('\n');
    if (nl === -1) break;
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    pending++;
    handle(msg).finally(() => { pending--; }).catch(() => {});
  }
}

async function handle(msg) {
  if (msg.method === 'initialize') {
    write({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'checkq-mcp', version: '0.3.17' } } });
    return;
  }
  if (msg.method === 'tools/list') {
    write({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } });
    return;
  }
  if (msg.method === 'tools/call') {
    const { name, arguments: args } = msg.params || {};
    try {
      const data = await callTool(name, args);
      write({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] } });
    } catch (e) {
      write({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'ERROR: ' + (e.message || e) }], isError: true } });
    }
    return;
  }
  if (msg.method === 'notifications/initialized' || msg.method === 'ping') {
    if (msg.id !== undefined) write({ jsonrpc: '2.0', id: msg.id, result: {} });
    return;
  }
  if (msg.id !== undefined) write({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found: ' + msg.method } });
}

process.on('unhandledRejection', (e) => process.stderr.write(String(e) + '\n'));

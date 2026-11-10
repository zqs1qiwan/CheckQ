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
  const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${typeof data === 'string' ? data.slice(0, 300) : JSON.stringify(data).slice(0, 300)}`);
  return data;
}

const TOOLS = [
  { name: 'health', description: 'CheckQ 健康检查', inputSchema: { type: 'object', properties: {} } },
  { name: 'flows_list', description: '列出所有任务（含 cron/enabled/nextRunAt）', inputSchema: { type: 'object', properties: {} } },
  { name: 'flow_get', description: '读取单个任务的完整定义（nodes/edges/vars/log）', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  { name: 'flow_run', description: '运行一个任务并返回逐步日志与摘要', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  { name: 'flow_update_vars', description: '更新任务变量（如 wbToken），其余字段保留', inputSchema: { type: 'object', required: ['id', 'vars'], properties: { id: { type: 'string' }, vars: { type: 'object' } } } },
  { name: 'runs_list', description: '列出某任务的历史运行记录', inputSchema: { type: 'object', required: ['flowId'], properties: { flowId: { type: 'string' }, limit: { type: 'number' } } } },
  { name: 'run_get', description: '读取某次运行的完整日志与变量快照', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  { name: 'templates_list', description: '列出所有模板', inputSchema: { type: 'object', properties: {} } },
  { name: 'stats', description: '运维健康统计（任务数/运行数/成功率/调度器）', inputSchema: { type: 'object', properties: {} } },
];

async function callTool(name, args) {
  args = args || {};
  switch (name) {
    case 'health': return api('GET', '/api/health');
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
    case 'stats': return api('GET', '/api/system/stats');
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

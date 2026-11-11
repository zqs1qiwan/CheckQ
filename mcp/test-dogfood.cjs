// MCP dogfood test: spawn the server, send JSON-RPC requests, print responses
const { spawn } = require('child_process');
const path = require('path');

const server = spawn(process.execPath, [path.join(__dirname, 'checkq-mcp.cjs')], {
  env: { ...process.env, CHECKQ_URL: process.env.CHECKQ_URL || 'http://localhost:19997', CHECKQ_PASSWORD: process.env.CHECKQ_PASSWORD || 'test1234' },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let buf = '';
server.stdout.on('data', (d) => { buf += d.toString(); while (buf.includes('\n')) { const i = buf.indexOf('\n'); const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) console.log('RESP:', line); } });
server.stderr.on('data', (d) => process.stderr.write('ERR: ' + d.toString()));
server.on('exit', (code) => console.log('EXIT', code));

function send(obj) { server.stdin.write(JSON.stringify(obj) + '\n'); }

setTimeout(() => send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } }), 100);
setTimeout(() => send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }), 300);
setTimeout(() => send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'stats', arguments: {} } }), 500);
setTimeout(() => send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'flows_list', arguments: {} } }), 800);
setTimeout(() => send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'notifications_list', arguments: { limit: 5 } } }), 1100);
setTimeout(() => { server.stdin.end(); }, 2400);

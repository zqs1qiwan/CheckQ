/** 本地回声服务端到端：登录(set-cookie) → 受保护接口(靠罐) → 断言 */
import http from 'node:http';
import { Engine } from '../src/engine.js';
import assert from 'node:assert';

const server = http.createServer((req, res) => {
  if (req.url === '/login') {
    res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'sid=e2e123; Path=/; HttpOnly' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.url === '/protected') {
    const ok = (req.headers.cookie || '').includes('sid=e2e123');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ authed: ok, gotCookie: req.headers.cookie || '' }));
    return;
  }
  res.writeHead(404); res.end('nf');
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const flow = {
  id: 'e2e', name: 'e2e-jar', vars: {},
  nodes: [
    { id: 'a', type: 'http', name: 'login', x: 0, y: 0, config: { method: 'POST', url: `http://127.0.0.1:${port}/login`, headers: [], body: '{}', asserts: [] } },
    { id: 'b', type: 'http', name: 'protected', x: 200, y: 0, config: { method: 'GET', url: `http://127.0.0.1:${port}/protected`, headers: [], body: '', asserts: [{ expr: 'last.json.authed == true' }] } },
  ],
  edges: [{ id: 'e1', source: 'a', target: 'b' }],
};

const eng = new Engine(flow);
const res = await eng.run({});
server.close();
assert.strictEqual(res.ok, true, JSON.stringify(res.logs.map((l) => `${l.name}:${l.ok}:${l.message}`)));
const bLog = res.logs.find((l) => l.stepId === 'b');
assert.ok(bLog.detail.jar, '步骤日志应标记 jar 命中');
console.log('PASS 端到端: 登录 set-cookie → 后续请求罐自动携带 → 断言通过, jar 标记已落日志');

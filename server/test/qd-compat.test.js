/** QD 兼容层单测：cookie 罐(GAP-C1) + 函数式表达式(GAP-C3) + 导入转换(GAP-C2/C4) */
import { CookieJar, mergeCookieHeader } from '../src/cookiejar.js';
import { renderTemplate, resolvePath } from '../src/render.js';
import { importHar } from '../src/har-import.js';
import { Engine } from '../src/engine.js';
import assert from 'node:assert';
import crypto from 'node:crypto';
const md5hex = (s) => crypto.createHash('md5').update(s).digest('hex');

let passed = 0;
let failed = 0;
function check(name, actual, expected) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.error(`✗ ${name}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
  }
}

// ---- CookieJar ----
const jar = new CookieJar();
check('空罐无头', jar.headerFor('https://a.com/x'), '');
jar.setFrom('https://a.com/login', ['sid=abc; Path=/; HttpOnly', 'uid=7; Path=/']);
check('同域携带', jar.headerFor('https://a.com/api'), 'sid=abc; uid=7');
check('异域不携带', jar.headerFor('https://b.com/x'), '');
jar.setFrom('https://a.com/x', ['sid=new1; Path=/']);
check('同名覆盖', jar.headerFor('https://a.com/api'), 'sid=new1; uid=7');
jar.setFrom('https://a.com/x', ['uid=; Path=/']);
check('空值删除', jar.headerFor('https://a.com/api'), 'sid=new1');
jar.setFrom('https://a.com/x', ['w=1; Domain=.a.com']);
jar.setFrom('https://sub.a.com/y', ['s2=z; Path=/']);
check('Domain 属性子域共享', jar.headerFor('https://sub.a.com/y').includes('w=1'), true);
check('子域 cookie 不上溯主域(浏览器语义)', jar.headerFor('https://a.com/x').includes('s2=z'), false);

// mergeCookieHeader：显式优先
check('显式同名优先', mergeCookieHeader('sid=jar; uid=7', 'sid=mine'), 'sid=mine; uid=7');
check('仅罐', mergeCookieHeader('a=1', ''), 'a=1');
check('仅显式', mergeCookieHeader('', 'b=2'), 'b=2');

// ---- 函数式表达式（GAP-C3）----
check('md5 拼接', renderTemplate('{{md5("f=1&s="+crowd+"&end")|upper}}', { crowd: '788' }),
  md5hex('f=1&s=788&end').toUpperCase());
check('multiply(timestamp float)|int 毫秒', (() => {
  const v = Number(renderTemplate('{{multiply(timestamp(\'float\'),1000)|int}}', {}));
  return String(Math.abs(v - Date.now()) < 5000);
})(), 'true');
check('default 过滤器(空值)', renderTemplate('{{x|default(\'kindle\')}}', {}), 'kindle');
check('default 过滤器(有值)', renderTemplate('{{x|default(\'kindle\')}}', { x: 'book' }), 'book');
check('default 双引号', renderTemplate('{{x|default("9858650")}}', {}), '9858650');
check('int 过滤器', renderTemplate('{{v|int}}', { v: '42.9' }), '42');
check('striptags', renderTemplate('{{v|striptags}}', { v: '<p>今天<b>已签到</b></p>' }), '今天 已签到');
check('字面量内管道不误断', renderTemplate('{{md5("a|b")}}', {}), md5hex('a|b'));
check('or fallback 仍工作', renderTemplate('{{ua or "默认UA"}}', {}), '默认UA');
check('纯变量不受影响', renderTemplate('{{cookie}}', { cookie: 'x=1' }), 'x=1');
check('表达式中变量缺失置空', renderTemplate('{{md5("a"+nope)}}', {}), '0cc175b9c0f1b6a831c399e269772661');
// jinja 空格风格 {{ __log__ | striptags }}
check('空格管道 striptags', renderTemplate('{{ v | striptags }}', { v: '<b>OK</b>' }), 'OK');
// 表达式内 or / 括号内管道 / 后置管道（真实站点签名形态）
check('表达式内 or 兜底', renderTemplate('{{(title or \'kindle\')}}', {}), 'kindle');
check('表达式内 or 有值', renderTemplate('{{(title or \'kindle\')}}', { title: 'book' }), 'book');
check('拼接中含 or 括号', renderTemplate('{{"kw="+(title or \'kindle\')+"&end"}}', {}), 'kw=kindle&end');
check('括号内管道不顶断表达式', renderTemplate('{{md5("a"+type|upper+"b")}}', { type: 'sms' }), md5hex('aSMSb'));
check('变量后置管道 default', renderTemplate('{{followid|default(\'15598\')}}', {}), '15598');
check('拼接中后置管道', renderTemplate('{{"id="+followid|default(\'42\')+"!"}}', {}), 'id=42!');
// 真实签名表达式（含全角引号字面量段）
check('签名表达式完整渲染', renderTemplate('{{md5("f=ANDROID&keyword="+(title or \'kindle\')+"&keyword_id=“+followid|default(\'15598\')+”&type="+type|upper+"&v=8.7.8")|upper}}', { type: 'sms' }),
  md5hex('f=ANDROID&keyword=kindle&keyword_id=“+followid|default(\'15598\')+”&type=SMS&v=8.7.8').toUpperCase());

// ---- 导入转换（GAP-C2/C4）----
{
  // api://util/delay → delay 节点；api://util/unicode → log 节点；QD data 字段 → body
  const qd = JSON.stringify({
    tpl: [
      { request: { method: 'POST', url: 'https://example.com/api/login', headers: [], data: 'u={{username}}&p={{password}}' },
        rule: { success_asserts: [{ re: 'ok', from: 'content' }], extract_variables: [] } },
      { request: { method: 'GET', url: 'api://util/delay/5', headers: [] }, rule: {} },
      { request: { method: 'GET', url: 'https://example.com/api/sign', headers: [], data: '' },
        rule: { success_asserts: [{ re: '200', from: 'status' }], extract_variables: [{ name: 'fh', re: 'fh=(\\w+)' }] } },
      { request: { method: 'POST', url: 'api://util/unicode', headers: [], data: 'content={{__log__ | striptags}}' }, rule: {} },
    ],
  });
  const flow = importHar(qd);
  const types = flow.nodes.map((n) => n.type);
  check('delay/unicode 转换', JSON.stringify(types), JSON.stringify(['http', 'delay', 'http', 'extract', 'log']));
  check('delay 秒数', flow.nodes[1].config.seconds, 5);
  check('QD data 字段 → body', flow.nodes[0].config.body, 'u={{username}}&p={{password}}');
  check('unicode log 保留模板', flow.nodes[4].config.text, '{{__log__ | striptags}}');
}
{
  // GAP-C4：变量 URL 放行（flaresolverr 类代理服务）
  const qd = JSON.stringify({
    tpl: [{ request: { method: 'POST', url: '{{solver_url}}', headers: [{ name: 'Content-Type', value: 'application/json' }], data: '{"cmd":"request.get"}' }, rule: {} }],
  });
  const flow = importHar(qd);
  check('变量 URL 放行', flow.nodes.length, 1);
  check('变量 URL 保留', flow.nodes[0].config.url, '{{solver_url}}');
}
{
  // util/unicode 回声计算 hack → set 节点（提取非 __log__ 变量时）
  const qd = JSON.stringify({
    tpl: [
      { request: { method: 'POST', url: 'api://util/unicode', headers: [], data: 'content={{multiply(timestamp(\'float\'),1000)|int}}' },
        rule: { extract_variables: [{ name: 'tsp', re: '"转换后": "(.*)"' }] } },
      { request: { method: 'POST', url: 'api://util/unicode', headers: [], data: 'content=结果: {{msg0}}' },
        rule: { extract_variables: [{ name: '__log__', re: '"转换后": "([\\s\\S]*?)"' }] } },
    ],
  });
  const flow = importHar(qd);
  check('回声计算 → set 节点', flow.nodes[0].type, 'set');
  check('set 变量名', flow.nodes[0].config.name, 'tsp');
  check('set 保留表达式', flow.nodes[0].config.value, "{{multiply(timestamp('float'),1000)|int}}");
  check('__log__ 仍 → log 节点', flow.nodes[1].type, 'log');
}

// ---- 引擎级 cookie 罐（GAP-C1 集成）----
const realFetch = globalThis.fetch;
const jarCalls = [];
async function runJarFlow() {
  // 登录(set-cookie) → 业务请求(无显式 cookie 头, 靠罐) → 带显式 cookie 头的请求(显式优先)
  const flow = {
    id: 'jar', name: 'jar', vars: {},
    nodes: [
      { id: 'a', type: 'http', name: 'login', x: 0, y: 0, config: { method: 'POST', url: 'https://example.com/login', headers: [], body: '', asserts: [] } },
      { id: 'b', type: 'http', name: 'sign', x: 200, y: 0, config: { method: 'POST', url: 'https://example.com/sign', headers: [], body: '', asserts: [] } },
      { id: 'c', type: 'http', name: 'with-explicit', x: 400, y: 0, config: { method: 'GET', url: 'https://example.com/me', headers: [{ name: 'cookie', value: 'sid=manual', enabled: true }], body: '', asserts: [] } },
      { id: 'd', type: 'http', name: 'optout', x: 600, y: 0, config: { method: 'GET', url: 'https://example.com/out', headers: [], body: '', asserts: [], cookieJar: false } },
    ],
    edges: [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
      { id: 'e3', source: 'c', target: 'd' },
    ],
  };
  globalThis.fetch = async (url, opts = {}) => {
    jarCalls.push({ url, cookie: opts.headers.cookie || '' });
    if (String(url).endsWith('/login')) {
      return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json', 'set-cookie': 'sid=fromsrv; Path=/; HttpOnly' } });
    }
    return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const eng = new Engine(flow);
  const res = await eng.run({});
  globalThis.fetch = realFetch;
  return res;
}
const jarRes = await runJarFlow();
check('罐流程整体成功', jarRes.ok, true);
check('登录请求不带 cookie', jarCalls[0].cookie, '');
check('后续请求自动带罐 cookie', jarCalls[1].cookie, 'sid=fromsrv');
check('显式 cookie 同名优先', jarCalls[2].cookie, 'sid=manual');
check('cookieJar:false 不读罐', jarCalls[3].cookie, '');

console.log(`${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);

/**
 * cURL 命令解析器 → http 节点 config
 * 支持: -X/--request, -H/--header, --data/--data-raw/--data-binary/--data-urlencode, -d,
 *       -b/--cookie, --compressed, -L/--location, --url, 位置参数 URL,
 *       -u/--user (Basic auth), 单双引号与无引号 token。
 * 返回: { method, url, headers: [{name,value,enabled}], body, asserts: [] }
 * 纯静态解析，零依赖，不做任何网络请求。
 */

export function parseCurl(command) {
  const tokens = tokenize(command.trim());
  if (!tokens.length) throw new Error('空命令');
  if (!/^curl/i.test(tokens[0])) throw new Error('不是 curl 命令（应以 curl 开头）');

  let method = '';
  let url = '';
  const headers = [];
  const bodies = [];
  let authHeader = null;

  const addHeader = (name, value) => {
    if (!name) return;
    const lower = name.toLowerCase();
    if (lower === 'cookie' && bodies.length === 0) {
      headers.push({ name: 'cookie', value, enabled: true });
    } else if (lower === 'authorization') {
      authHeader = value;
      headers.push({ name: 'authorization', value, enabled: true });
    } else {
      headers.push({ name, value, enabled: true });
    }
  };

  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    const next = () => tokens[++i];
    switch (true) {
      case t === '-X' || t === '--request':
        method = next() || '';
        break;
      case t === '-H' || t === '--header': {
        const v = next() || '';
        const ci = v.indexOf(':');
        if (ci > 0) addHeader(v.slice(0, ci).trim(), v.slice(ci + 1).trim());
        // "; 头"形式（无值头）忽略
        break;
      }
      case t === '-b' || t === '--cookie': {
        const v = next() || '';
        // 只有包含 = 才是请求头 cookie；否则是 cookie 文件（不支持，忽略）
        if (v.includes('=')) headers.push({ name: 'cookie', value: v, enabled: true });
        break;
      }
      case t === '--data' || t === '--data-raw' || t === '--data-binary' || t === '--data-urlencode' || t === '-d':
        bodies.push({ raw: next() || '', urlencode: t === '--data-urlencode' });
        break;
      case t === '--url':
        url = next() || '';
        break;
      case t === '-u' || t === '--user': {
        const v = next() || '';
        const enc = Buffer.from(v).toString('base64');
        authHeader = `Basic ${enc}`;
        headers.push({ name: 'authorization', value: `Basic ${enc}`, enabled: true });
        break;
      }
      case t === '-L' || t === '--location':
      case t === '--compressed':
      case t === '-s' || t === '--silent' || t === '-S' || t === '--show-error':
      case t === '-i' || t === '--include':
      case t === '-v' || t === '--verbose':
      case t === '-k' || t === '--insecure':
      case t === '--http2':
      case t === '--http1.1':
      case t === '-A' || t === '--user-agent': // user-agent 有值，先落到下一 case 处理不了 — 显式处理
        if (t === '-A' || t === '--user-agent') {
          const ua = next() || '';
          if (ua) headers.push({ name: 'user-agent', value: ua, enabled: true });
        }
        break;
      case t === '-e' || t === '--referer': {
        const v = next() || '';
        if (v) headers.push({ name: 'referer', value: v, enabled: true });
        break;
      }
      case t === '-F' || t === '--form':
        // multipart 表单：转为 body 键值对（简化处理，不做真实 multipart）
        bodies.push({ raw: next() || '', form: true });
        break;
      case t.startsWith('-'):
        // 不认识的参数：带值则跳过其值
        if (next() === undefined) { /* 无值参数 */ }
        break;
      default:
        // 位置参数 = URL
        if (!url) url = t;
        break;
    }
  }

  if (!url) throw new Error('未找到 URL');
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  // -X 未指定时: 有 body → POST
  if (!method) method = bodies.length ? 'POST' : 'GET';
  method = method.toUpperCase();

  let body = '';
  if (bodies.length) {
    if (bodies[0].form) {
      // multipart 简化: 拼成文本提示
      body = bodies.map((b) => b.raw).join('&');
    } else if (bodies[0].urlencode) {
      body = bodies.map((b) => b.raw).join('&');
    } else {
      body = bodies.map((b) => b.raw).join('&');
    }
  }

  // 自动补 content-type（有 body 且未显式声明时）
  const hasCT = headers.some((h) => h.name.toLowerCase() === 'content-type');
  if (body && !hasCT) {
    const isJson = /^[\[{]/.test(body.trim());
    headers.push({ name: 'content-type', value: isJson ? 'application/json' : 'application/x-www-form-urlencoded', enabled: true });
  }

  return { method, url, headers, body, asserts: [] };
}

/** shell 词法切分：单引号/双引号/反斜杠转义/裸 token */
function tokenize(cmd) {
  const out = [];
  let cur = '';
  let mode = 'plain'; // plain | single | double
  let hasToken = false;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (mode === 'single') {
      if (c === "'") { mode = 'plain'; }
      else { cur += c; hasToken = true; }
    } else if (mode === 'double') {
      if (c === '"') { mode = 'plain'; }
      else if (c === '\\' && (cmd[i + 1] === '"' || cmd[i + 1] === '\\' || cmd[i + 1] === '$')) {
        cur += cmd[i + 1]; i++;
      } else { cur += c; hasToken = true; }
    } else {
      if (c === "'") { mode = 'single'; hasToken = true; }
      else if (c === '"') { mode = 'double'; hasToken = true; }
      else if (c === '\\') { cur += cmd[i + 1] || ''; i++; hasToken = true; }
      else if (/\s/.test(c)) {
        if (hasToken) { out.push(cur); cur = ''; hasToken = false; }
      } else { cur += c; hasToken = true; }
    }
  }
  if (hasToken) out.push(cur);
  return out;
}

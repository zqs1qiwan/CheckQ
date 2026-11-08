/**
 * 变量渲染 + jexl 表达式
 * 模板: {{a.b}} / {{x}} / {{x|urlencode}} / {{x or '默认值'}}（jinja 风格 fallback）
 * 表达式(set 节点 = 前缀 / condition / asserts): last.json.code == 4
 */

import crypto from 'node:crypto';
import jexl from 'jexl';

/** 渲染模板字符串。missing 收集未定义变量名。 */
export function renderTemplate(tpl, vars, missing) {
  if (typeof tpl !== 'string') return tpl;
  return tpl.replace(/\{\{([^}]+)\}\}/g, (_, expr) => {
    const raw = expr.trim();
    // 函数式/拼接表达式（含括号/引号/+）整体走表达式求值（内部支持 or/管道/拼接）
    if (/[('"+]/.test(raw) && !/^\w+(\.\w+)*$/.test(raw)) {
      const val = resolvePath(vars, raw, missing);
      return val === undefined || val === null ? '' : stringify(val);
    }
    // jinja 风格 or fallback（简单形态）: {{ua or 'xxx'}} / {{ua or xxx}}
    if (/\s+or\s+/.test(raw)) {
      for (const alt of raw.split(/\s+or\s+/)) {
        const part = alt.trim();
        const q = part.match(/^['"](.*)['"]$/);
        if (q) return q[1]; // 字面量直接用
        const v = resolvePath(vars, part, null);
        if (v !== undefined && v !== null && v !== '') return stringify(v);
      }
      return '';
    }
    const val = resolvePath(vars, raw, missing);
    return val === undefined || val === null ? '' : stringify(val);
  });
}

function stringify(v) {
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

/** 深路径取值: vars, 'user.email' → vars.user.email；带 |urlencode / |json / |base64 过滤器 */
export function resolvePath(vars, path, missing) {
  const str0 = String(path);
  // 函数式/拼接表达式：整体求值（内部处理 or/拼接/后置管道），不做顶层管道切分
  if (/[('"+]/.test(str0) && !/^\w+(\.\w+)*$/.test(str0)) {
    try {
      return evalTemplateExpr(str0, vars, missing);
    } catch {
      return '';
    }
  }
  // 伪函数路径: timestamp[:ms] / now[:fmt] — 不从 vars 取值。参数在冒号后(如 now:%Y%m%d),也可在管道首项
  const [p0, ...filters0] = splitPipes(str0);
  const pseudoArg = p0.includes(':') ? p0.slice(p0.indexOf(':') + 1) : undefined;
  const pseudoName = p0.includes(':') ? p0.slice(0, p0.indexOf(':')) : p0;
  if (pseudoName === 'timestamp' || pseudoName === 'now') {
    // timestamp[:ms] → 毫秒; now[:fmt] → strftime。`timestamp|ms` 管道写法同样支持
    let cur;
    if (pseudoName === 'timestamp') {
      cur = Math.floor(Date.now() / ((pseudoArg === 'ms' || filters0[0] === 'ms') ? 1 : 1000));
    } else {
      cur = formatNow(pseudoArg || '%Y-%m-%d %H:%M:%S');
    }
    // 后续管道：timestamp 后 filters0 可能是 ['ms']；now 后 filters0[0] 可能是管道过滤器
    const rest = pseudoName === 'timestamp' && filters0[0] === 'ms' ? filters0.slice(1) : filters0;
    for (const f of rest) {
      const arg = f.includes(':') ? f.slice(f.indexOf(':') + 1) : undefined;
      const name = f.includes(':') ? f.slice(0, f.indexOf(':')) : f;
      cur = applyFilter(cur, name, arg);
    }
    return cur;
  }
  let [p, ...filters] = [p0, ...filters0];
  // QD/jinja 函数式表达式（GAP-C3）：含括号/引号/拼接时走表达式求值，如 md5("a"+var)|upper
  let cur;
  if (/[('"+]/.test(p) && !/^\w+(\.\w+)*$/.test(p)) {
    try {
      cur = evalTemplateExpr(p, vars, missing);
    } catch {
      cur = '';
    }
    for (const f of filters) {
      const { name, arg } = parseFilterSpec(f);
      cur = applyFilter(cur, name, arg);
    }
    return cur;
  }
  cur = vars;
  for (const key of p.split('.')) {
    if (cur == null) {
      if (missing && p) missing.add(p);
      return undefined;
    }
    cur = cur[key];
  }
  if (cur === undefined && missing) missing.add(p);
  for (const f of filters) {
    const { name, arg } = parseFilterSpec(f);
    cur = applyFilter(cur, name, arg);
  }
  return cur;
}

/** 管道切分（尊重引号与括号嵌套，`{{md5("a|b")}}` / `{{f(x|upper)}}` 不会在内部误断） */
function splitPipes(str) {
  const out = [];
  let cur = '';
  let quote = null;
  let depth = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === '|' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** 过滤器规格解析：`name:arg`（本引擎原生）与 `name('arg')`/`name("arg")`（QD jinja 风格） */
function parseFilterSpec(f) {
  const m = String(f).match(/^(\w+)\((.*)\)$/s);
  if (m) {
    let arg = m[2].trim();
    const q = arg.match(/^(['"])(.*)\1$/s);
    if (q) arg = q[2];
    return { name: m[1], arg };
  }
  const idx = String(f).indexOf(':');
  return idx >= 0
    ? { name: String(f).slice(0, idx).trim(), arg: String(f).slice(idx + 1).trim() }
    : { name: String(f).trim(), arg: undefined };
}

/** QD/jinja 风格函数式表达式求值（GAP-C3）。白名单函数 + 字符串拼接 + or 兜底 + 字面量 + 变量路径 + 管道过滤器，无 eval。 */
export function evalTemplateExpr(src, vars, missing) {
  const s = String(src);
  let i = 0;
  const skipWs = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const truthy = (v) => !(v === undefined || v === null || v === '' || v === 0 || v === false || (typeof v === 'number' && isNaN(v)));
  // expr := concat ('or' concat)* — jinja or：取第一个真值
  function parseExpr() {
    let val = parseConcat();
    while (true) {
      skipWs();
      if (s.slice(i, i + 2) === 'or' && !/[\w.]/.test(s[i + 2] || '')) {
        i += 2;
        const rhs = parseConcat();
        if (!truthy(val)) val = rhs;
      } else return val;
    }
  }
  function parseConcat() {
    let val = parsePrimary();
    while (true) {
      skipWs();
      if (s[i] === '+') { i++; const rhs = parsePrimary(); val = String(val ?? '') + String(rhs ?? ''); }
      else return val;
    }
  }
  function parsePrimary() {
    skipWs();
    const ch = s[i];
    let val;
    if (ch === "'" || ch === '"') {
      const q = ch; i++;
      let out = '';
      while (i < s.length && s[i] !== q) {
        if (s[i] === '\\' && i + 1 < s.length) { out += s[i + 1]; i += 2; }
        else { out += s[i]; i++; }
      }
      i++; // 跳过闭引号
      val = out;
    } else if (ch === '(') {
      i++; val = parseExpr(); skipWs(); if (s[i] === ')') i++;
    } else if (/\d/.test(ch) || (ch === '-' && /\d/.test(s[i + 1] || ''))) {
      let j = i + 1;
      while (j < s.length && /[\d.]/.test(s[j])) j++;
      val = parseFloat(s.slice(i, j)); i = j;
    } else {
      let j = i;
      while (j < s.length && /[\w.]/.test(s[j])) j++;
      const ident = s.slice(i, j);
      if (!ident) throw new Error(`表达式解析失败: ${s}`);
      i = j;
      skipWs();
      if (s[i] === '(') {
        i++;
        const args = [];
        skipWs();
        if (s[i] !== ')') {
          args.push(parseExpr());
          while (true) { skipWs(); if (s[i] === ',') { i++; args.push(parseExpr()); } else break; }
        }
        skipWs(); if (s[i] === ')') i++;
        const fn = EXPR_FUNCS[ident];
        if (!fn) throw new Error(`不支持的函数: ${ident}`);
        val = fn(...args);
      } else {
        let cur = vars;
        for (const k of ident.split('.')) {
          if (cur == null) { if (missing) missing.add(ident); cur = undefined; break; }
          cur = cur[k];
        }
        if (cur === undefined && missing) missing.add(ident);
        val = cur;
      }
    }
    // 后置管道过滤器：ident|default('x') / f(...)|upper / (expr)|int
    while (true) {
      skipWs();
      if (s[i] !== '|') return val;
      i++;
      let j = i;
      while (j < s.length && /[\w]/.test(s[j])) j++;
      const fname = s.slice(i, j);
      i = j;
      skipWs();
      let arg;
      if (s[i] === '(') {
        i++;
        const av = parseExpr();
        skipWs(); if (s[i] === ')') i++;
        arg = av;
      } else if (s[i] === ':') {
        i++;
        const av = parsePrimary();
        arg = av;
      }
      val = applyFilter(val, fname, arg);
    }
  }
  const result = parseExpr();
  skipWs();
  if (i < s.length) throw new Error(`表达式尾部无法解析: ${s.slice(i)}`);
  return result;
}

/** 模板表达式层白名单函数（对齐 QD jinja 全局函数的常用子集） */
const EXPR_FUNCS = {
  md5: (v) => crypto.createHash('md5').update(String(v ?? '')).digest('hex'),
  sha1: (v) => crypto.createHash('sha1').update(String(v ?? '')).digest('hex'),
  sha256: (v) => crypto.createHash('sha256').update(String(v ?? '')).digest('hex'),
  multiply: (a, b) => Number(a) * Number(b),
  divide: (a, b) => Number(a) / Number(b),
  add: (a, b) => Number(a) + Number(b),
  sub: (a, b) => Number(a) - Number(b),
  int: (v) => parseInt(v, 10),
  float: (v) => parseFloat(v),
  str: (v) => String(v ?? ''),
  timestamp: (unit) => (unit === 'float' ? Date.now() / 1000 : Math.floor(Date.now() / 1000)),
  urlencode: (v) => encodeURIComponent(String(v ?? '')),
  quote_chinese: (v) => encodeURIComponent(String(v ?? '')),
  b64encode: (v) => Buffer.from(String(v ?? '')).toString('base64'),
  b64decode: (v) => Buffer.from(String(v ?? ''), 'base64').toString('utf8'),
  upper: (v) => String(v ?? '').toUpperCase(),
  lower: (v) => String(v ?? '').toLowerCase(),
};

/** 单个过滤器应用。arg 为 `name:arg` 语法中的参数部分 */
function applyFilter(cur, name, arg) {
  if (name === 'urlencode') return arg ? encodeWith(String(cur ?? ''), arg) : encodeURIComponent(String(cur ?? ''));
  if (name === 'urldecode') return decodeURIComponent(String(cur ?? ''));
  if (name === 'json') return JSON.stringify(cur);
  if (name === 'base64') return Buffer.from(String(cur ?? '')).toString('base64');
  if (name === 'base64decode') return Buffer.from(String(cur ?? ''), 'base64').toString('utf8');
  if (name === 'md5') return crypto.createHash('md5').update(String(cur ?? '')).digest('hex');
  if (name === 'sha1') return crypto.createHash('sha1').update(String(cur ?? '')).digest('hex');
  if (name === 'sha256') return crypto.createHash('sha256').update(String(cur ?? '')).digest('hex');
  if (name === 'hex') return Buffer.from(String(cur ?? ''), 'utf8').toString('hex');
  if (name === 'upper') return String(cur ?? '').toUpperCase();
  if (name === 'lower') return String(cur ?? '').toLowerCase();
  if (name === 'trim') return String(cur ?? '').trim();
  if (name === 'int') return parseInt(cur, 10);
  if (name === 'float') return parseFloat(cur);
  // QD jinja 兼容（GAP-C3）：default 空值回退 / striptags 去 HTML 标签
  if (name === 'default') return (cur === undefined || cur === null || cur === '') ? (arg ?? '') : cur;
  if (name === 'striptags') return String(cur ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (name === 'timestamp') return Math.floor(Date.now() / (arg === 'ms' ? 1 : 1000));
  if (name === 'now') return formatNow(arg || '%Y-%m-%d %H:%M:%S');
  if (name === 'gbk' || name === 'gb2312') return String(cur ?? ''); // gbk percent-encode 需 iconv,暂退化
  return cur;
}

/** 指定编码的 urlencode(gbk/gb2312 等)。无 iconv-lite 时退回 percent-encode utf8 */
function encodeWith(str, encoding) {
  try {
    // Node 内建仅支持 utf8/latin1/ascii 等; gbk 需要额外依赖,暂用 TextEncoder(utf8) 退化
    const enc = String(encoding).toLowerCase();
    if (enc === 'utf8' || enc === 'utf-8' || enc === 'latin1' || enc === 'ascii') {
      const buf = Buffer.from(str, enc);
      return Array.from(buf).map((b) => '%' + b.toString(16).toUpperCase().padStart(2, '0')).join('');
    }
    // 其他编码暂不支持,退回 utf8 percent-encode
    return encodeURIComponent(str);
  } catch {
    return encodeURIComponent(str);
  }
}

/** 简易 strftime: %Y %m %d %H %M %S %f(毫秒) %s(epoch) */
function formatNow(fmt) {
  const d = new Date();
  const map = {
    '%Y': d.getFullYear(),
    '%m': String(d.getMonth() + 1).padStart(2, '0'),
    '%d': String(d.getDate()).padStart(2, '0'),
    '%H': String(d.getHours()).padStart(2, '0'),
    '%M': String(d.getMinutes()).padStart(2, '0'),
    '%S': String(d.getSeconds()).padStart(2, '0'),
    '%f': String(d.getMilliseconds()).padStart(3, '0'),
    '%s': Math.floor(d.getTime() / 1000),
  };
  return String(fmt).replace(/%[YmdHMSfs]/g, (m) => map[m] ?? m);
}

/** jexl 表达式求值。上下文: { vars, last, steps } */
export async function evalExpr(expr, ctx) {
  return jexl.evalSync(expr, {
    vars: ctx.vars || {},
    last: ctx.last || {},
    steps: ctx.steps || {},
  });
}

jexl.addTransform('parseInt', (v) => parseInt(v, 10));
jexl.addTransform('parseFloat', (v) => parseFloat(v));
jexl.addTransform('includes', (v, s) => String(v).includes(s));
jexl.addTransform('length', (v) => (v && v.length) || 0);

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
    // jinja 风格 or fallback: {{ua or 'xxx'}} / {{ua or xxx}}
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
  // 伪函数路径: timestamp[:ms] / now[:fmt] — 不从 vars 取值。参数在冒号后(如 now:%Y%m%d),也可在管道首项
  const [p0, ...filters0] = String(path).split('|').map((s) => s.trim());
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
  let [p, ...filters] = String(path).split('|').map((s) => s.trim());
  let cur = vars;
  for (const key of p.split('.')) {
    if (cur == null) {
      if (missing && p) missing.add(p);
      return undefined;
    }
    cur = cur[key];
  }
  if (cur === undefined && missing) missing.add(p);
  for (const f of filters) {
    const arg = f.includes(':') ? f.slice(f.indexOf(':') + 1) : undefined;
    const name = f.includes(':') ? f.slice(0, f.indexOf(':')) : f;
    cur = applyFilter(cur, name, arg);
  }
  return cur;
}

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

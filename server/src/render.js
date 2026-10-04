/**
 * 变量渲染 + jexl 表达式
 * 模板: {{a.b}} / {{x}} / {{x|urlencode}} / {{x or '默认值'}}（jinja 风格 fallback）
 * 表达式(set 节点 = 前缀 / condition / asserts): last.json.code == 4
 */

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
    if (f === 'urlencode') cur = encodeURIComponent(String(cur ?? ''));
    else if (f === 'json') cur = JSON.stringify(cur);
    else if (f === 'base64') cur = Buffer.from(String(cur ?? '')).toString('base64');
  }
  return cur;
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

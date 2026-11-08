/**
 * Run 级 Cookie 罐（QD 兼容层 GAP-C1）
 * 一次运行内所有 http 节点共享：响应 Set-Cookie 自动入罐，后续请求按域名自动携带。
 * 节点显式配置的 cookie 头同名键优先（用户手工值 > 罐内值）。
 * 节点配置 cookieJar:false 可完全退出罐（不读不写）。
 */
export class CookieJar {
  constructor() {
    this.store = new Map(); // domain -> Map(name -> value)
  }

  /** 从响应 Set-Cookie 数组入罐。domain 属性宽松处理（去前导点，子域共享）。 */
  setFrom(urlStr, setCookies) {
    let host;
    try {
      host = new URL(urlStr).hostname.toLowerCase();
    } catch {
      return 0;
    }
    let n = 0;
    for (const sc of setCookies || []) {
      const [pair, ...attrs] = String(sc).split(';');
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      let domain = host;
      for (const a of attrs) {
        const m = a.trim().match(/^domain=(.+)$/i);
        if (m) domain = m[1].replace(/^\./, '').toLowerCase();
      }
      if (!this.store.has(domain)) this.store.set(domain, new Map());
      const bag = this.store.get(domain);
      if (value === '' || /^(deleted|null)$/i.test(value)) bag.delete(name);
      else { bag.set(name, value); n++; }
    }
    return n;
  }

  /** 生成该 URL 应携带的 Cookie 头值（不含已过期的判断，罐随 run 生命周期）。 */
  headerFor(urlStr) {
    let host;
    try {
      host = new URL(urlStr).hostname.toLowerCase();
    } catch {
      return '';
    }
    const parts = [];
    for (const [domain, bag] of this.store) {
      if (host === domain || host.endsWith('.' + domain)) {
        for (const [k, v] of bag) parts.push(`${k}=${v}`);
      }
    }
    return parts.join('; ');
  }

  get size() {
    let n = 0;
    for (const bag of this.store.values()) n += bag.size;
    return n;
  }
}

/** 合并 cookie 头：explicit 行同名键优先，jar 行补充缺失键。 */
export function mergeCookieHeader(jarLine, explicitLine) {
  if (!jarLine) return explicitLine || '';
  if (!explicitLine) return jarLine;
  const explicitKeys = new Set(
    explicitLine.split(';').map((p) => p.split('=')[0].trim()).filter(Boolean)
  );
  const extras = jarLine
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p && !explicitKeys.has(p.split('=')[0].trim()));
  return extras.length ? `${explicitLine}; ${extras.join('; ')}` : explicitLine;
}

/**
 * HAR 导入器
 * 支持两种格式:
 * 1. 浏览器 HAR: { log: { entries: [ { request: { method, url, headers, postData } } ] } }
 * 2. QD(qiandao) 模板: { har: { log: { entries: [...] } } }（编辑接口导出）
 *    或 { tpl: [...] }（保存接口导出）
 *    QD entry: request + { checked, success_asserts, failed_asserts, extract_variables }（可顶层可 rule 里）
 *
 * QD 断言 → 本引擎原生正则断言 {res:[...], from, negate}（保留原始语义，engine 原生支持）
 * QD extract_variables → extract 节点（optional=false 保留 QD 必填语义）
 * QD localhost /util/string/replace → log 节点（QD 的 __log__ 渲染 hack）
 */

export function importHar(rawText) {
  let har;
  try {
    har = JSON.parse(rawText);
  } catch {
    throw new Error('HAR 不是合法 JSON');
  }
  const isQd = Array.isArray(har.tpl) || (har.har && Array.isArray(har.har?.log?.entries));
  const entries = isQd
    ? (har.har?.log?.entries || har.tpl?.map((t) => ({ request: t.request, rule: t.rule })) || [])
    : har?.log?.entries;
  if (!Array.isArray(entries) || !entries.length) throw new Error('HAR 中没有请求记录');

  const nodes = [];
  const edges = [];
  let prevId = null;
  let prevHandle = null;

  const chain = (node, outHandle) => {
    nodes.push(node);
    if (prevId) {
      edges.push({ id: `e${node.id}`, source: prevId, sourceHandle: prevHandle, target: node.id });
    }
    prevId = node.id;
    prevHandle = outHandle;
  };

  entries.forEach((entry, i) => {
    if (entry.checked === false) return;
    const req = entry.request || {};
    const method = (req.method || 'GET').toUpperCase();
    const rawUrl = String(req.url || '');

    // QD api://util/delay/N → delay 节点（GAP-C2：QD 模板常用步骤间延时防风控）
    const delayM = rawUrl.match(/^api:\/\/util\/delay\/(\d+)/i);
    if (delayM) {
      chain({ id: `n${i}`, type: 'delay', name: `延迟 ${delayM[1]}s`, x: 80, y: 60 + i * 130, config: { seconds: Number(delayM[1]) } }, 'next');
      return;
    }

    // QD api://util/unicode|urldecode → log 节点（GAP-C2：QD 的日志中文转码 hack，本引擎响应已解码，直接输出模板）
    if (/^api:\/\/util\/(unicode|urldecode)/i.test(rawUrl)) {
      let text = '';
      try { text = new URL(rawUrl).searchParams.get('content') || ''; } catch {}
      if (!text) {
        const bodyText = typeof req.data === 'string' ? req.data : (req.postData?.text || '');
        text = bodyText.match(/(?:^|&)content=([^&]*)/)?.[1] || '';
      }
      text = decodeURIComponentSafe(text);
      chain({ id: `n${i}`, type: 'log', name: '输出日志', x: 80, y: 60 + i * 130, config: { text } }, 'next');
      return;
    }

    // 放行含 {{var}} 的变量 URL（GAP-C4：如 {{solver_url}} 代理解谜服务地址）
    const hasVar = /\{\{[^}]+\}\}/.test(rawUrl);
    if (!/^https?:/i.test(rawUrl) && !hasVar) return;
    let url = null;
    try { url = new URL(rawUrl); } catch { url = null; }
    if (url && shouldSkip(url, method)) return;

    const rule = entry.rule || {};
    const qdSa = rule.success_asserts || entry.success_asserts || [];
    const qdFa = rule.failed_asserts || entry.failed_asserts || [];
    const qdEv = rule.extract_variables || entry.extract_variables || [];

    // ---- QD localhost string/replace __log__ hack → log 节点 ----
    if (url && isQdLocalhostLog(url)) {
      // s 参数是渲染模板；QD 的 |urlencode→localhost 解码舞蹈在直渲下直接剥掉过滤器
      const raw = url.searchParams.get('s') || '';
      const text = raw.replace(/\|(?:urlencode|json)\}\}/g, '}}');
      chain({ id: `n${i}`, type: 'log', name: '输出日志', x: 80, y: 60 + i * 130, config: { text } }, 'next');
      return;
    }

    const headers = [];
    for (const h of req.headers || []) {
      const name = String(h.name || '').toLowerCase();
      if (name.startsWith(':')) continue;
      if (BROWSER_SKIP_HEADERS.has(name)) continue;
      if (h.checked === false) continue;
      headers.push({ name: h.name, value: h.value, enabled: true });
    }
    // QD tpl 格式的请求体在 data 字段；浏览器 HAR 在 postData
    const postData = req.postData || {};
    const body = typeof req.data === 'string' ? req.data
      : (typeof postData === 'string' ? postData : (postData.text || ''));

    const asserts = [];
    if (qdSa.length) asserts.push({ res: qdSa.map((a) => a.re), from: qdSa[0].from || 'content' });
    if (qdFa.length) asserts.push({ res: qdFa.map((a) => a.re), from: qdFa[0].from || 'content', negate: true });

    const node = {
      id: `n${i}`,
      type: 'http',
      name: url ? `${method} ${url.pathname.slice(0, 24)}` : `${method} {{变量URL}}`,
      x: 80,
      y: 60 + i * 130,
      config: { method, url: rawUrl, headers, body, asserts },
    };
    chain(node, 'success');

    // QD extract_variables → 紧随其后链式 extract 节点（共享同一个 last 响应）
    // QD 语义: 提取尽力而为，未命中变量留空、流程继续（optional: true）
    qdEv.forEach((ev, j) => {
      chain({
        id: `n${i}x${j}`,
        type: 'extract',
        name: `提取 ${ev.name}`,
        x: 440,
        y: 60 + i * 130 + 40 + j * 90,
        config: { from: 'last.text', re: ev.re, name: ev.name, optional: true },
      }, 'next');
    });
  });

  if (!nodes.length) throw new Error('没有可导入的 http(s) 请求');

  return {
    name: '导入的流程',
    note: isQd ? '从 QD 模板导入' : '从浏览器 HAR 导入',
    vars: {},
    nodes,
    edges,
    cron: '',
    enabled: false,
  };
}

const BROWSER_SKIP_HEADERS = new Set([
  'accept-encoding', 'content-length', 'host', 'connection',
  'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform',
  'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site',
]);

function shouldSkip(url, method) {
  if (/\.(js|css|png|jpg|jpeg|gif|svg|woff2?|ttf|ico|mp4|webp)$/i.test(url.pathname)) return true;
  if (/\/(analytics|collect|beacon|track)/i.test(url.pathname)) return true;
  return false;
}

function isQdLocalhostLog(url) {
  return /localhost|127\.0\.0\.1/.test(url.hostname) && url.pathname.includes('/util/string/replace');
}

function decodeURIComponentSafe(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

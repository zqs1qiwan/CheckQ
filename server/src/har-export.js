/**
 * 单次运行 → HAR 1.2（默认脱敏）
 *
 * 用途：把一次运行里的 HTTP 步骤导出成浏览器 DevTools 可导入的 HAR，便于排障。
 * 安全：
 *   - 变量名命中 cookie/token/sess/auth/password/secret/key 的值，在 URL / 请求体 / 响应体 / 头里统一替换为 ***
 *   - Cookie / Authorization / Set-Cookie / x-api-key 等头整值替换为 ***
 *   - 响应体使用引擎已截断的内容（resBodyLimit），不会把完整大响应塞进 HAR
 */
import { isSensitiveName } from './secret.js';

const SENSITIVE_HEADERS = /^(cookie|set-cookie|authorization|proxy-authorization|x-api-key|api-key)$/i;

function secretsOf(flow) {
  const out = [];
  for (const [k, v] of Object.entries(flow?.vars || {})) {
    if (!isSensitiveName(k)) continue;
    const s = String(v ?? '');
    if (s.length >= 4) out.push(s);
  }
  return [...new Set(out)].sort((a, b) => b.length - a.length);
}

function redactText(text, secrets) {
  if (typeof text !== 'string' || !text) return text || '';
  let out = text;
  for (const s of secrets) out = out.split(s).join('***');
  return out;
}

function headerPairs(headers, secrets) {
  const out = [];
  for (const [name, value] of Object.entries(headers || {})) {
    if (value === undefined || value === null) continue;
    const v = SENSITIVE_HEADERS.test(name) ? '***' : redactText(String(value), secrets);
    out.push({ name, value: v });
  }
  return out;
}

function queryPairs(url, secrets) {
  try {
    const u = new URL(url);
    return [...u.searchParams.entries()].map(([name, value]) => ({
      name, value: isSensitiveName(name) ? '***' : redactText(value, secrets),
    }));
  } catch {
    return [];
  }
}

function mimeOf(headers) {
  for (const [k, v] of Object.entries(headers || {})) {
    if (String(k).toLowerCase() === 'content-type') return String(v).split(';')[0];
  }
  return 'application/octet-stream';
}

/** 单次运行 → HAR 对象 */
export function runToHar(run, flow) {
  const secrets = secretsOf(flow);
  const entries = [];
  for (const log of run?.logs || []) {
    if (log?.type !== 'http' || !log.detail) continue;
    const d = log.detail;
    const url = redactText(String(d.url || ''), secrets);
    const reqBody = redactText(d.body || '', secrets);
    const res = d.response || {};
    const resBody = redactText(res.body || '', secrets);
    const started = new Date((run.startedAt || Date.now()) + (Number(log.index) || 0) * 50).toISOString();
    const status = Number(res.status) || 0;
    entries.push({
      startedDateTime: started,
      time: Number(log.ms) || 0,
      request: {
        method: String(d.method || 'GET').toUpperCase(),
        url,
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: headerPairs(d.headers, secrets),
        queryString: queryPairs(url, secrets),
        headersSize: -1,
        bodySize: Buffer.byteLength(reqBody, 'utf8'),
        ...(reqBody ? { postData: { mimeType: mimeOf(d.headers), text: reqBody } } : {}),
      },
      response: {
        status,
        statusText: '',
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: headerPairs(res.headers, secrets),
        content: { size: Buffer.byteLength(resBody, 'utf8'), mimeType: mimeOf(res.headers), text: resBody },
        redirectURL: '',
        headersSize: -1,
        bodySize: -1,
      },
      cache: {},
      timings: { send: 0, wait: Number(res.ms) || Number(log.ms) || 0, receive: 0 },
      _checkq: { stepId: log.stepId, name: log.name, ok: !!log.ok, errorType: log.errorType || undefined, redacted: true },
    });
  }
  return {
    log: {
      version: '1.2',
      creator: { name: 'CheckQ', version: '0.3.17' },
      pages: [{
        startedDateTime: new Date(run?.startedAt || Date.now()).toISOString(),
        id: String(run?.id || 'run'),
        title: `${flow?.name || run?.flowName || '运行'} · ${run?.status || ''}`.trim(),
        pageTimings: { onContentLoad: -1, onLoad: Number(run?.durationMs) || -1 },
      }],
      entries,
      _checkq: { runId: run?.id, flowId: run?.flowId, redacted: true, note: '敏感值已替换为 ***；响应体沿用日志截断长度' },
    },
  };
}

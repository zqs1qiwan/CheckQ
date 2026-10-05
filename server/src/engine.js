/**
 * DAG 执行器
 * 从入口沿 edges 走，每步产生 StepLog：请求/响应/断言/耗时/错误全量记录。
 * 防环: maxSteps 500。
 */

import { renderTemplate, resolvePath, evalExpr } from './render.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ProxyAgent } from 'undici';

const MAX_STEPS = 500;
const HTTP_TIMEOUT = 30000;
const MAX_RESP_BYTES = 2 * 1024 * 1024; // 响应体上限 2MB（预留，当前文本阶段仅记录截断）

const proxyAgents = new Map(); // proxyUrl -> ProxyAgent（复用连接池）
function getProxyAgent(proxyUrl) {
  let a = proxyAgents.get(proxyUrl);
  if (!a) {
    a = new ProxyAgent(proxyUrl);
    proxyAgents.set(proxyUrl, a);
  }
  return a;
}

export class Engine {
  constructor(flow) {
    this.flow = flow;
    this.nodeById = new Map((flow.nodes || []).map((n) => [n.id, n]));
    this.edgeBy = new Map();
    for (const e of flow.edges || []) {
      const k = `${e.source}:${e.sourceHandle ?? ''}`;
      if (!this.edgeBy.has(k)) this.edgeBy.set(k, []);
      this.edgeBy.get(k).push(e);
    }
  }

  nextNodeId(fromId, handle) {
    // 同一出口下匹配多条边：优先精确 handle，其次空 handle 边（UI 拖线未带 handle 时）
    const exact = this.edgeBy.get(`${fromId}:${handle}`) || [];
    const blank = this.edgeBy.get(`${fromId}:`) || [];
    const list = exact.length ? exact : blank;
    return list.length ? list[0].target : null;
  }

  /** 执行流程。debugStopId: 调试模式，跑到该节点（含）即止。returns { ok, logs, vars, finalMessage } */
  async run({ trigger = 'manual', runId, logSink, debugStopId } = {}) {
    const flow = this.flow;
    const vars = { ...(flow.vars || {}) };
    const state = { vars, last: null, steps: {} };
    const logs = [];
    const missing = new Set();

    const entry = this.findEntryNode();
    if (!entry) {
      logs.push({ stepId: null, index: 1, name: '流程', type: 'error', ok: false, message: '找不到入口节点', detail: null, ms: 0 });
      return { ok: false, logs, vars, finalMessage: '找不到入口节点' };
    }

    let node = entry;
    let stepCount = 0;
    let failed = false;
    let finalMessage = '';

    while (node && stepCount < MAX_STEPS) {
      stepCount++;
      const started = Date.now();
      const stepLog = {
        stepId: node.id,
        index: stepCount,
        name: node.name || node.type,
        type: node.type,
        ok: true,
        message: '',
        detail: null,
        ms: 0,
      };
      try {
        const outcome = await this.execNode(node, state, stepLog, missing, logs, logSink);
        stepLog.ms = Date.now() - started;
        logs.push(stepLog);
        if (logSink) logSink(stepLog);
        if (missing.size) {
          stepLog.missing = [...missing];
          missing.clear();
        }
        // 调试模式：到达指定节点（含）即停
        if (debugStopId && node.id === debugStopId) {
          finalMessage = finalMessage || `调试运行：已执行到「${stepLog.name}」，共 ${stepCount} 步`;
          break;
        }
        if (!outcome) {
          failed = true;
          finalMessage = stepLog.message || '步骤失败';
          break;
        }
        const handle = outcome.handle;
        const nextId = this.nextNodeId(node.id, handle);
        if (nextId) {
          node = this.nodeById.get(nextId);
        } else if (handle === 'failed') {
          failed = true;
          finalMessage = stepLog.message || '步骤失败';
          break;
        } else {
          // 出口未连线：链路结束，正常完成
          break;
        }
      } catch (err) {
        stepLog.ok = false;
        stepLog.message = `步骤异常: ${err.message}`;
        stepLog.ms = Date.now() - started;
        logs.push(stepLog);
        if (logSink) logSink(stepLog);
        failed = true;
        finalMessage = stepLog.message;
        break;
      }
    }

    if (stepCount >= MAX_STEPS) {
      failed = true;
      finalMessage = `流程超过 ${MAX_STEPS} 步，疑似成环`;
    }

    return { ok: !failed, logs, vars, finalMessage };
  }

  findEntryNode() {
    const nodes = this.flow.nodes || [];
    const edges = this.flow.edges || [];
    const noIn = nodes.filter((n) => !edges.some((e) => e.target === n.id));
    if (!noIn.length) return null;
    return noIn.sort((a, b) => a.x - b.x)[0];
  }

  /** HTTP 节点执行体（由 execNode 的重试循环调用）。返回 {ok, errorKind, message} */
  async execHttp(node, c, state, stepLog, missing, attempt) {
    const vars = state.vars;
    const url = renderTemplate(c.url, vars, missing);
    const method = (c.method || 'GET').toUpperCase();
    const headers = {};
    for (const h of c.headers || []) {
      if (h && h.enabled !== false && h.name) {
        // QD 模板常见尾部换行残留，一律 trim（cookie 值带 \n 直接被判无效）
        const v = renderTemplate(h.value, vars, missing);
        headers[String(h.name).trim().toLowerCase()] = typeof v === 'string' ? v.trim() : v;
      }
    }
    let body = null;
    if (c.body && method !== 'GET' && method !== 'HEAD') {
      const b = renderTemplate(c.body, vars, missing);
      body = typeof b === 'string' ? b.trim() : b;
    }
    // 代理（4.2）：值支持 {{proxyVar}}，运行时渲染
    let proxyUrl = '';
    if (c.proxy && c.proxy.url) {
      proxyUrl = String(renderTemplate(c.proxy.url, vars, missing)).trim();
    }
    stepLog.detail = { method, url, headers: redact(headers), body, attempt, proxy: proxyUrl || undefined };

    const t0 = Date.now();
    let status, statusText, text, respHeaders, setCookies;
    try {
      if ((c.backend || 'fetch') === 'curl') {
        ({ status, statusText, headers: respHeaders, text, setCookies } = await httpViaCurl(
          url, method, headers, body, c.timeout || HTTP_TIMEOUT, (c.redirect || 'follow') !== 'manual', proxyUrl));
      } else {
        const dispatcher = proxyUrl ? getProxyAgent(proxyUrl) : undefined;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), c.timeout || HTTP_TIMEOUT);
        const resp = await fetch(url, {
          method,
          headers,
          body,
          redirect: c.redirect || 'follow',
          signal: controller.signal,
          dispatcher,
        });
        clearTimeout(timer);
        status = resp.status;
        statusText = resp.statusText || '';
        // charset（4.2）：默认按响应 content-type；强制 c.charset 覆盖
        const ctype = resp.headers.get('content-type') || '';
        let encoding = (ctype.match(/charset=([\w-]+)/i) || [])[1] || 'utf-8';
        if (c.charset && c.charset !== 'auto') encoding = c.charset;
        if (/utf-?8/i.test(encoding)) {
          text = await resp.text();
        } else {
          const buf = await resp.arrayBuffer();
          try {
            text = new TextDecoder(encoding).decode(buf);
          } catch {
            text = new TextDecoder('utf-8').decode(buf); // 不认识的编码回退 utf-8
          }
        }
        respHeaders = Object.fromEntries(resp.headers.entries());
        setCookies = resp.headers.getSetCookie ? resp.headers.getSetCookie() : [];
      }
    } catch (err) {
      return { ok: false, errorKind: 'network', message: `请求失败: ${err.message}${err.cause ? ` (${err.cause.code || err.cause.message || ''})` : ''}` };
    }

    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}

    const duration = Date.now() - t0;
    state.last = { status, statusText, headers: respHeaders, text, json, ms: duration, setCookies: setCookies || [] };
    state.steps[node.id] = state.last;
    stepLog.detail.response = {
      status,
      headers: respHeaders,
      setCookie: (setCookies || []).length ? redactSetCookies(setCookies) : undefined,
      body: text.length > 2000 ? text.slice(0, 2000) + `… (${text.length} bytes)` : text,
      ms: duration,
    };

    // 断言两种形态:
    //   {expr, expect}  jexl 表达式
    //   {res: [regex], from: 'content'|'status', negate}  QD 原生正则（任一命中）
    let assertOk = true;
    const assertResults = [];
    const ctx = { vars, last: state.last, steps: state.steps };
    for (const a of c.asserts || []) {
      if (Array.isArray(a.res)) {
        const text0 = a.from === 'status' ? String(state.last.status) : String(state.last.text ?? '');
        let hit = false;
        for (const re of a.res) {
          try {
            if (new RegExp(re).test(text0)) { hit = true; break; }
          } catch {}
        }
        const pass = a.negate ? !hit : hit;
        assertResults.push({ label: `${a.negate ? '不含' : '含'} /${a.res.join('|')}/ (${a.from || 'content'})`, pass });
        if (!pass) assertOk = false;
      } else {
        try {
          const v = await evalExpr(a.expr, ctx);
          const pass = a.expect === undefined ? Boolean(v) : String(v) === String(a.expect);
          assertResults.push({ expr: a.expr, expect: a.expect, actual: v, pass });
          if (!pass) assertOk = false;
        } catch (err) {
          assertResults.push({ expr: a.expr, expect: a.expect, error: err.message, pass: false });
          assertOk = false;
        }
      }
    }
    if (assertResults.length) stepLog.asserts = assertResults;
    if (!assertOk) {
      const failedOnes = assertResults.filter((r) => !r.pass);
      return { ok: false, errorKind: 'assert', message: `断言失败: ${failedOnes
        .map((r) => r.label || `${r.expr} → ${JSON.stringify(r.actual ?? r.error)} (期望 ${JSON.stringify(r.expect)})`)
        .join('; ')}` };
    }
    stepLog.message = `${status} ${statusText} (${duration}ms)`.trim() + (attempt > 0 ? ` · 第${attempt + 1}次` : '');
    return { ok: true };
  }

  /** 执行单个节点。returns { handle } 或 null(失败) */
  async execNode(node, state, stepLog, missing, logs, logSink) {
    const vars = state.vars;
    switch (node.type) {
      case 'http': {
        const c = node.config || {};
        // 每节点重试（4.2）：网络错误/超时，或断言失败且 retryOn 含 assert
        const retry = c.retry && c.retry.times > 0 ? { times: c.retry.times, backoffMs: Math.max(500, c.retry.backoffMs || 1000), retryOn: c.retry.retryOn || 'error' } : null;
        let attempt = 0;
        let result = null;
        for (;;) {
          result = await this.execHttp(node, c, state, stepLog, missing, attempt);
          if (result.ok) break;
          const isNetworkError = result.errorKind === 'network';
          const isAssertFail = result.errorKind === 'assert';
          if (retry && attempt < retry.times && (isNetworkError || (isAssertFail && retry.retryOn !== 'error'))) {
            attempt++;
            const wait = retry.backoffMs * attempt; // 线性退避
            stepLog.message = `${result.message} → 重试 ${attempt}/${retry.times}（${wait}ms 后）`;
            logs.push({ ...stepLog, ok: true }); // 重试过程记录为中间日志
            if (logSink) logSink(logs[logs.length - 1]);
            await new Promise((r) => setTimeout(r, wait));
            continue;
          }
          stepLog.ok = false;
          stepLog.message = result.message;
          return null;
        }
        return { handle: 'success' };
      }

      case 'condition': {
        const c = node.config || {};
        let v = false;
        try {
          v = await evalExpr(c.expr, { vars, last: state.last, steps: state.steps });
        } catch (err) {
          stepLog.ok = false;
          stepLog.message = `表达式异常: ${err.message}`;
          return null;
        }
        stepLog.message = `${c.expr} → ${JSON.stringify(v)}`;
        return { handle: v ? 'true' : 'false' };
      }

      case 'set': {
        const c = node.config || {};
        const raw = c.value ?? '';
        let rendered;
        if (typeof raw === 'string' && raw.startsWith('=')) {
          rendered = String(await evalExpr(raw.slice(1), { vars, last: state.last, steps: state.steps }));
        } else {
          rendered = renderTemplate(String(raw), vars, missing);
        }
        vars[c.name] = rendered;
        stepLog.message = `${c.name} = ${String(rendered).slice(0, 120)}`;
        return { handle: 'next' };
      }

      case 'extract': {
        const c = node.config || {};
        // 提取模式（4.1）：mode=json 按点路径取值；mode=header/setCookie 取响应头（4.2 Set-Cookie 捕获）
        if (c.mode === 'json') {
          const pathStr = String(c.path || '').trim();
          let cur = state.last && state.last.json;
          for (const key of pathStr ? pathStr.split('.') : []) {
            cur = cur == null ? undefined : cur[key];
          }
          if (cur === undefined || cur === null) {
            stepLog.message = `JSON 路径未命中: ${pathStr || '(空)'}`;
            if (c.optional === false) { stepLog.ok = false; return null; }
          } else {
            const val = typeof cur === 'object' ? JSON.stringify(cur) : String(cur);
            vars[c.name] = val;
            stepLog.message = `${c.name} = ${val.slice(0, 120)}`;
          }
          return { handle: 'next' };
        }
        if (c.mode === 'header' || c.mode === 'setCookie') {
          const h = (state.last && state.last.headers) || {};
          let val = '';
          if (c.mode === 'setCookie') {
            // 优先用引擎保存的多值 Set-Cookie 数组，缺省时回落 headers['set-cookie']
            const list = (state.last && state.last.setCookies && state.last.setCookies.length)
              ? state.last.setCookies
              : (h['set-cookie'] ? (Array.isArray(h['set-cookie']) ? h['set-cookie'] : [h['set-cookie']]) : []);
            let pairs = list.map((sc) => sc.split(';')[0].trim()).filter(Boolean);
            if (c.cookieFilter) {
              try {
                const re = new RegExp(c.cookieFilter);
                pairs = pairs.filter((p) => re.test(p.split('=')[0]));
              } catch (err) {
                stepLog.ok = false;
                stepLog.message = `cookie 过滤正则错误: ${err.message}`;
                return null;
              }
            }
            val = pairs.join('; ');
          } else {
            const hn = String(c.headerName || '').trim().toLowerCase();
            val = hn ? String(h[hn] ?? '') : '';
          }
          if (val) {
            vars[c.name] = val;
            stepLog.message = `${c.name} = ${val.length > 120 ? val.slice(0, 120) + '…' : val}`;
          } else {
            stepLog.message = c.mode === 'setCookie' ? '响应无 Set-Cookie' : `响应头未命中: ${c.headerName}`;
            if (c.optional === false) { stepLog.ok = false; return null; }
          }
          return { handle: 'next' };
        }
        // 默认正则模式（原有）
        const src = resolvePath(state, c.from, missing);
        const text = src === undefined || src === null ? '' : typeof src === 'object' ? JSON.stringify(src) : String(src);
        let m = null;
        try {
          m = new RegExp(c.re, c.flags || '').exec(text);
        } catch (err) {
          stepLog.ok = false;
          stepLog.message = `正则错误: ${err.message}`;
          return null;
        }
        if (m) {
          const val = m.length > 1 ? m[1] : m[0];
          vars[c.name] = val;
          stepLog.message = `${c.name} = ${String(val).slice(0, 120)}`;
        } else {
          stepLog.message = `提取未命中: /${c.re}/ ← ${c.from}`;
          if (c.optional === false) {
            stepLog.ok = false;
            return null; // QD 语义：必填提取未命中 → 流程失败
          }
        }
        return { handle: 'next' };
      }

      case 'random-delay': {
        // 反风控核心件（4.1）：在 [min,max] 秒间随机等待
        const c = node.config || {};
        const min = Number(c.min ?? 1) || 0;
        const max = Number(c.max ?? 5) || 0;
        const lo = Math.min(min, max);
        const hi = Math.max(min, max);
        const sec = lo + Math.random() * (hi - lo);
        await new Promise((r) => setTimeout(r, Math.min(sec, 300) * 1000));
        stepLog.message = `随机等待 ${sec.toFixed(1)}s (${lo}-${hi}s)`;
        return { handle: 'next' };
      }

      case 'delay': {
        const c = node.config || {};
        const sec = Number(renderTemplate(String(c.seconds ?? 1), vars, missing)) || 0;
        await new Promise((r) => setTimeout(r, Math.min(sec, 300) * 1000));
        stepLog.message = `等待 ${sec}s`;
        return { handle: 'next' };
      }

      case 'log': {
        const c = node.config || {};
        stepLog.message = renderTemplate(String(c.text ?? ''), vars, missing) || '(空日志)';
        return { handle: 'next' };
      }

      case 'notify': {
        const c = node.config || {};
        const text = renderTemplate(String(c.text ?? ''), vars, missing);
        const targets = [];
        if (c.webhookUrl) targets.push({ kind: 'webhook', url: renderTemplate(c.webhookUrl, vars, missing) });
        if (c.tgToken && c.tgChat) targets.push({ kind: 'telegram', token: c.tgToken, chat: c.tgChat });
        if (c.barkUrl) targets.push({ kind: 'bark', url: renderTemplate(c.barkUrl, vars, missing) });
        if (!targets.length) {
          stepLog.message = '未配置通知渠道，跳过';
          return { handle: 'next' };
        }
        const errors = [];
        let sent = false;
        for (const t of targets) {
          try {
            if (t.kind === 'webhook') {
              await fetch(t.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: text });
            } else if (t.kind === 'telegram') {
              await fetch(`https://api.telegram.org/bot${t.token}/sendMessage`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ chat_id: t.chat, text }),
              });
            } else if (t.kind === 'bark') {
              const sep = t.url.endsWith('/') ? '' : '/';
              await fetch(`${t.url}${sep}${encodeURIComponent(text)}`, { method: 'GET' });
            }
            sent = true;
          } catch (err) {
            errors.push(`${t.kind}: ${err.message}`);
          }
        }
        stepLog.message = errors.length
          ? (sent ? `通知部分失败: ${errors.join('; ')}` : `通知失败: ${errors.join('; ')}`)
          : `已推送: ${text.slice(0, 100)}`;
        if (!sent && errors.length) {
          stepLog.ok = false;
          return null;
        }
        return { handle: 'next' };
      }

      default:
        stepLog.ok = false;
        stepLog.message = `未知步骤类型: ${node.type}`;
        return null;
    }
  }
}

/**
 * curl 后端：出站 TLS 指纹为 curl 而非 Node fetch(undici)。
 * 用途: 目标站对 undici 指纹做风控时切换（节点 config.backend = 'curl'）。
 * 支持 proxyUrl（http/https/socks5h → --proxy）。
 * 返回与 fetch 路径同构: { status, statusText, headers, text, setCookies }
 */
async function httpViaCurl(url, method, headers, body, timeoutMs, follow, proxyUrl) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'checkq-'));
  const hdrFile = path.join(tmp, 'h.txt');
  const bodyFile = path.join(tmp, 'b.txt');
  const args = ['-sS', '--max-time', String(Math.ceil(timeoutMs / 1000)), '-X', method, '-D', hdrFile, '-o', bodyFile];
  if (follow) args.push('-L');
  if (proxyUrl) args.push('--proxy', proxyUrl);
  args.push(url);
  for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
  if (body && method !== 'GET' && method !== 'HEAD') args.push('--data-binary', body);
  try {
    await new Promise((resolve, reject) => {
      const child = spawn('curl', args, { timeout: timeoutMs + 5000 });
      let stderr = '';
      child.stderr.on('data', (d) => { stderr = String(d).slice(0, 300); });
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr.trim() || `curl exit ${code}`))));
    });
    const hdrRaw = fs.readFileSync(hdrFile, 'utf8');
    const text = fs.readFileSync(bodyFile, 'utf8');
    const blocks = hdrRaw.split(/\r?\n\r?\n/).filter((b) => b.trim());
    const lines = (blocks[blocks.length - 1] || '').split(/\r?\n/);
    const m = (lines[0] || '').match(/^HTTP\/[\d.]+\s+(\d+)/);
    const respHeaders = {};
    const setCookies = [];
    for (const line of lines.slice(1)) {
      const i = line.indexOf(':');
      if (i > 0) {
        const k = line.slice(0, i).trim().toLowerCase();
        const v = line.slice(i + 1).trim();
        if (k === 'set-cookie') setCookies.push(v);
        else respHeaders[k] = v;
      }
    }
    return { status: m ? Number(m[1]) : 0, statusText: '', headers: respHeaders, text, setCookies };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

/** 头部脱敏：cookie/authorization 只留前 12 字符（日志展示用） */
function redact(headers) {
  const out = { ...headers };
  for (const k of Object.keys(out)) {
    if (/^(cookie|authorization)$/i.test(k)) {
      out[k] = String(out[k]).slice(0, 12) + '…';
    }
  }
  return out;
}

/** Set-Cookie 数组脱敏：每个 k=v 只留 k 和 v 的前 4 字符 */
function redactSetCookies(list) {
  return list.map((sc) => {
    const pair = String(sc).split(';')[0] || '';
    const i = pair.indexOf('=');
    return i > 0 ? `${pair.slice(0, i)}=${pair.slice(i + 1, i + 5)}…` : `${pair.slice(0, 12)}…`;
  });
}

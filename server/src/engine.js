/**
 * DAG 执行器
 * 从入口沿 edges 走，每步产生 StepLog：请求/响应/断言/耗时/错误全量记录。
 * 防环: maxSteps 500。
 */

import { renderTemplate, resolvePath, evalExpr } from './render.js';
import { CookieJar, mergeCookieHeader } from './cookiejar.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ProxyAgent } from 'undici';
import vm from 'node:vm';

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
  async run({ trigger = 'manual', runId, logSink, debugStopId, debug } = {}) {
    const flow = this.flow;
    const vars = { ...(flow.vars || {}) };
    const state = { vars, last: null, steps: {}, cookieJar: new CookieJar() };
    const logs = [];
    const missing = new Set();

    // 日志配置（PRD §4.7.4）：level 三档 + include 开关 + resBodyLimit + keywords 关键字规则
    // 低档位（failure/summary）强制忽略 include（见 run 末尾裁剪），include 只在 level=all 生效
    const logCfg = (flow.log && typeof flow.log === 'object') ? flow.log : null;
    const logLevel = logCfg?.level || 'all';
    // 记录范围默认 clean：只留 log 节点（人话）+ 失败步骤；'all' 保留全部步骤
    const logRecord = logCfg?.record || 'log';
    // 流程里根本没有 log 节点时，clean 模式会一条不剩 → 自动退回全步骤（避免"日志空白"）
    const hasLogNode = (flow.nodes || []).some((n) => n && n.type === 'log');
    const effectiveRecord = (logRecord === 'log' || logRecord === 'log-final') && !hasLogNode ? 'all' : logRecord;
    // 调试模式：保留每步请求/响应细节（日常不用，出问题时在日志配置里打开；也可单次运行临时开启）
    const debugMode = logCfg?.debug === true || debug === true;
    const shouldDisplay = (sl) => {
      if (debugMode) return true;
      if (effectiveRecord === 'all') return true;
      if (!sl.ok) return true; // 失败步骤永远保留
      return sl.type === 'log';
    };
    const logInclude = (logCfg?.include && typeof logCfg.include === 'object') ? logCfg.include : {};
    this.logInclude = {
      reqHeaders: logInclude.reqHeaders !== false,
      reqBody: logInclude.reqBody !== false,
      resBody: logInclude.resBody !== false,
      varsSnapshot: logInclude.varsSnapshot !== false,
    };
    const rawLimit = logCfg?.resBodyLimit;
    this.resBodyLimit = rawLimit === undefined || rawLimit === null
      ? 2000
      : Math.min(100000, Math.max(0, Number(rawLimit) || 0));
    const keywords = Array.isArray(logCfg?.keywords) ? logCfg.keywords.filter((k) => k && k.regex) : [];
    const keywordResults = []; // {name, values[]} 汇总

    const entry = this.findEntryNode();
    if (!entry) {
      const empty = (flow.nodes || []).length === 0;
      const msg = empty ? '流程为空：请先在画布上加至少一个节点（如 HTTP 请求）再运行' : '找不到入口节点（可能成环：所有节点都有入线）';
      logs.push({ stepId: null, index: 1, name: '流程', type: 'error', ok: false, message: msg, detail: null, ms: 0 });
      return { ok: false, logs, vars: this.logInclude.varsSnapshot ? vars : {}, finalMessage: msg };
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
        if (logSink && shouldDisplay(stepLog)) logSink(stepLog);
        if (missing.size) {
          stepLog.missing = [...missing];
          missing.clear();
        }

        // 关键字规则提取（PRD §4.7.4）：对每步 HTTP 响应尝试 keywords
        if (keywords.length && stepLog.type === 'http' && state.last) {
          for (const kw of keywords) {
            if (kw.stepId && kw.stepId !== node.id) continue;
            try {
              const source = kw.from === 'headers'
                ? JSON.stringify(state.last.headers || {})
                : kw.from === 'status'
                  ? String(state.last.status ?? '')
                  : String(state.last.text ?? '');
              const re = new RegExp(kw.regex, 'g');
              const values = [];
              let m;
              while ((m = re.exec(source)) !== null) {
                values.push(m.length > 1 ? m[1] : m[0]);
                if (values.length >= 20) break; // 防失控
                if (m.index === re.lastIndex) re.lastIndex++;
              }
              if (values.length) {
                stepLog.keywords = stepLog.keywords || [];
                stepLog.keywords.push({ name: kw.name, values });
                const agg = keywordResults.find((r) => r.name === kw.name);
                if (agg) agg.values.push(...values);
                else keywordResults.push({ name: kw.name, values });
              }
            } catch { /* 非法正则：跳过（编辑器已即时校验） */ }
          }
        }

        // level 三档：运行结束后统一裁剪（在 run 末尾处理，此处保留完整数据供提取）

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
        if (logSink && shouldDisplay(stepLog)) logSink(stepLog);
        failed = true;
        finalMessage = stepLog.message;
        break;
      }
    }

    if (stepCount >= MAX_STEPS) {
      failed = true;
      finalMessage = `流程超过 ${MAX_STEPS} 步，疑似成环`;
    }

    // 日志记录范围（PRD §4.7.4 扩展）：
    //   all       = 所有步骤（默认，调试）
    //   log       = 仅 log 节点 + 失败步骤（qinglong/qiandao 风格，用户只看调教好的干净日志）
    //   log-final = 合并所有 log 节点为一条汇总日志 + 失败步骤
    let trimmedLogs = logs;
    if (!debugMode && (effectiveRecord === 'log' || effectiveRecord === 'log-final')) {
      const displayed = logs.filter((l) => shouldDisplay(l));
      if (effectiveRecord === 'log-final') {
        const logLines = logs.filter((l) => l.type === 'log' && l.ok).map((l) => (l.message || '').trim()).filter(Boolean);
        const merged = logLines.join('； ');
        const finalEntry = { stepId: null, index: 1, name: '汇总', type: 'log', ok: !failed, message: merged || (finalMessage || '流程执行完成'), detail: null, ms: 0 };
        const failedOnes = logs.filter((l) => !l.ok);
        trimmedLogs = failedOnes.length ? [...failedOnes, finalEntry] : [finalEntry];
      } else {
        trimmedLogs = displayed;
      }
    } else if (logLevel !== 'all') {
      trimmedLogs = logs.map((l) => {
        const keepFull = logLevel === 'failure' ? !l.ok : false;
        if (keepFull) return l;
        // 只保留标题信息
        return {
          stepId: l.stepId, index: l.index, name: l.name, type: l.type,
          ok: l.ok, message: l.message, ms: l.ms,
          keywords: l.keywords, // 关键字提取结果永远保留
          asserts: l.asserts,
        };
      });
    }

    // 非调试模式：成功步骤不落请求/响应细节（保留失败步骤详情便于排障）
    // 注：clean 模式下 http 步骤本就不入日志，故此处无需再裁剪。

    // 运行摘要：关键字提取结果汇总（PRD：每次运行关心什么值，一眼可见）
    const summary = keywordResults.length
      ? keywordResults.map((r) => `${r.name}: ${r.values.join(', ')}`).join('； ')
      : '';

    // include.varsSnapshot=false：不记录运行级变量快照（PRD §4.7.4）
    if (!this.logInclude.varsSnapshot) return { ok: !failed, logs: trimmedLogs, vars: {}, finalMessage, summary };
    return { ok: !failed, logs: trimmedLogs, vars, finalMessage, summary };
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
    // run 级 cookie 罐（QD 兼容 GAP-C1）：罐内 cookie 自动补入请求头，显式 cookie 同名键优先
    const useJar = c.cookieJar !== false;
    let jarUsed = 0;
    if (useJar && state.cookieJar) {
      const jarLine = state.cookieJar.headerFor(url);
      if (jarLine) {
        const before = headers.cookie || '';
        headers.cookie = mergeCookieHeader(jarLine, headers.cookie);
        if (headers.cookie !== before) jarUsed = 1;
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
    stepLog.detail = { method, url, headers: redact(headers), body, attempt, proxy: proxyUrl || undefined, jar: jarUsed || undefined };
    // include 开关（level=all 时生效；failure/summary 的裁剪在 run 末尾统一处理）
    const include = this.logInclude || { reqHeaders: true, reqBody: true, resBody: true };
    if (!include.reqHeaders) delete stepLog.detail.headers;
    if (!include.reqBody) delete stepLog.detail.body;

    const t0 = Date.now();
    let status, statusText, text, respHeaders, setCookies;
    try {
      if ((c.backend || 'fetch') === 'curl') {
        ({ status, statusText, headers: respHeaders, text, setCookies } = await httpViaCurl(
          url, method, headers, body, c.timeout || HTTP_TIMEOUT / 1000, (c.redirect || 'follow') !== 'manual', proxyUrl));
      } else {
        const dispatcher = proxyUrl ? getProxyAgent(proxyUrl) : undefined;
        const controller = new AbortController();
        // config.timeout 单位是秒（ConfigPanel「超时 (秒)」/ curl --max-time），fetch 需换算成毫秒
        const timeoutMs = c.timeout ? Math.max(1000, Number(c.timeout) * 1000) : HTTP_TIMEOUT;
        const timer = setTimeout(() => controller.abort(), timeoutMs);
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

    // 响应 Set-Cookie 入罐（后续同域请求自动携带）
    if (useJar && state.cookieJar) state.cookieJar.setFrom(url, setCookies);

    const duration = Date.now() - t0;
    state.last = { status, statusText, headers: respHeaders, text, json, ms: duration, setCookies: setCookies || [] };
    state.steps[node.id] = state.last;
    // resBodyLimit 截断（PRD §4.7.4：默认 2000，0-100000；0 = 不记录响应体）
    const limit = this.resBodyLimit === undefined ? 2000 : this.resBodyLimit;
    const recBody = !include.resBody
      ? undefined
      : limit === 0
        ? ''
        : text.length > limit ? text.slice(0, limit) + `… (${text.length} bytes)` : text;
    stepLog.detail.response = {
      status,
      headers: respHeaders,
      setCookie: (setCookies || []).length ? redactSetCookies(setCookies) : undefined,
      body: recBody,
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
          stepLog.errorType = result.errorKind === 'network' ? 'network' : result.errorKind === 'assert' ? 'assert' : 'engine';
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
          stepLog.errorType = 'engine';
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
        // 日志模板支持 {{last.status}} / {{steps.n1.json...}}（与 http/set 节点同语义）
        const scope = { ...vars, last: state.last || {}, steps: state.steps || {} };
        stepLog.message = renderTemplate(String(c.text ?? ''), scope, missing) || '(空日志)';
        return { handle: 'next' };
      }

      case 'script': {
        // 受限 JS 沙箱（PRD §4.1）：只注入 vars/last/steps 值，无 require/网络/fs/process；超时 1s；返回值对象合并回 vars
        const c = node.config || {};
        const code = String(c.code || '');
        if (!code.trim()) {
          stepLog.ok = false;
          stepLog.message = '脚本为空';
          return null;
        }
        // 先按模板渲染，允许 {{var}} 占位
        const rendered = renderTemplate(code, vars, missing);
        const snapshot = JSON.parse(JSON.stringify({ vars, last: state.last, steps: state.steps }, (_k, v) => (typeof v === 'object' && v !== null && v.__proto__ !== undefined ? v : v)));
        let out;
        try {
          const ctx = {
            vars: snapshot.vars, last: snapshot.last, steps: snapshot.steps,
            console: { log: () => {}, warn: () => {}, error: () => {} },
            Math, JSON, Date, Number, String, Array, Object, isNaN, parseInt, parseFloat,
          };
          vm.createContext(ctx);
          const wrapped = `(() => {\n${rendered}\n})();`;
          out = vm.runInContext(wrapped, ctx, { timeout: 1000 });
        } catch (err) {
          stepLog.ok = false;
          stepLog.message = `脚本异常: ${err.message}`;
          return null;
        }
        if (out && typeof out === 'object' && !Array.isArray(out)) {
          for (const [k, v] of Object.entries(out)) vars[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
          stepLog.message = `脚本返回 ${Object.keys(out).length} 个变量：${Object.keys(out).join(', ')}`;
        } else {
          stepLog.message = '脚本完成（无返回值）';
        }
        return { handle: 'next' };
      }

      case 'foreach': {
        // 遍历（PRD §4.1）：source 求值为数组；each 出口为循环体（单链到链尾），next 为完工后继。
        // 执行模型：每项设 itemVar/index，沿循环体默认出口走完一轮，再下一轮；上限 50 轮，任一步失败则整体失败。
        const c = node.config || {};
        const sourceExpr = String(c.source || '').trim();
        let arr;
        try {
          if (/^(last|vars|steps)\./.test(sourceExpr)) {
            arr = resolvePath({ vars, last: state.last, steps: state.steps }, sourceExpr, null);
          } else {
            arr = await evalExpr(sourceExpr, { vars, last: state.last, steps: state.steps });
          }
        } catch (err) {
          stepLog.ok = false;
          stepLog.message = `遍历源表达式异常: ${err.message}`;
          return null;
        }
        if (typeof arr === 'string' && arr.trim().startsWith('[')) {
          // extract/script 把数组存成 JSON 字符串，这里兼容解析
          try { arr = JSON.parse(arr); } catch { /* 保持原字符串，走下面的类型错误提示 */ }
        }
        if (!Array.isArray(arr)) {
          stepLog.ok = false;
          stepLog.message = `遍历源不是数组: ${sourceExpr} → ${arr === undefined ? 'undefined' : typeof arr}`;
          return null;
        }
        const itemVar = String(c.itemVar || 'item').trim() || 'item';
        const indexVar = String(c.indexVar || 'index').trim() || 'index';
        const bodyTargetId = this.nextNodeId(node.id, 'each');
        if (!bodyTargetId) {
          stepLog.ok = false;
          stepLog.message = 'foreach 未连线循环体（each 出口）';
          return null;
        }
        const maxIter = Math.min(50, arr.length);
        let doneCount = 0;
        for (let i = 0; i < maxIter; i++) {
          vars[itemVar] = arr[i];
          vars[indexVar] = String(i);
          let cursor = this.nodeById.get(bodyTargetId);
          let guard = 0;
          while (cursor && guard < 100) {
            guard++;
            const started = Date.now();
            const bodyLog = { stepId: cursor.id, index: logs.length + 1, name: `${cursor.name || cursor.type} #${i + 1}`, type: cursor.type, ok: true, message: '', detail: null, ms: 0 };
            let outcome;
            try {
              outcome = await this.execNode(cursor, state, bodyLog, missing, logs, logSink);
            } catch (err) {
              bodyLog.ok = false;
              bodyLog.message = `步骤异常: ${err.message}`;
              bodyLog.ms = Date.now() - started;
              logs.push(bodyLog);
              if (logSink) logSink(bodyLog);
              stepLog.ok = false;
              stepLog.message = `遍历第 ${i + 1} 轮失败: ${bodyLog.message}`;
              return null;
            }
            bodyLog.ms = Date.now() - started;
            logs.push(bodyLog);
            if (logSink) logSink(bodyLog);
            if (!outcome) {
              stepLog.ok = false;
              stepLog.message = `遍历第 ${i + 1} 轮失败: ${bodyLog.message}`;
              return null;
            }
            const nxt = this.nextNodeId(cursor.id, outcome.handle);
            if (!nxt) break;
            // 循环体到达 next 的后继时停止本轮（避免与主流程 nxt 重叠执行）
            if (this.nextNodeId(node.id, 'next') === nxt) break;
            cursor = this.nodeById.get(nxt);
          }
          doneCount++;
        }
        stepLog.message = `遍历完成 ${doneCount}/${arr.length} 项（上限 50）`;
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

/** 通用脱敏（PRD §4.7.3 扩展）：变量快照等场景，敏感名变量的值打码 */
export function redactVars(vars) {
  const out = {};
  for (const [k, v] of Object.entries(vars || {})) {
    out[k] = /cookie|token|password|secret|key/i.test(k)
      ? String(v).slice(0, 12) + '…'
      : v;
  }
  return out;
}

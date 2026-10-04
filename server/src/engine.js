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

const MAX_STEPS = 500;
const HTTP_TIMEOUT = 30000;

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

  /** 执行整个流程。returns { ok, logs, vars, finalMessage } */
  async run({ trigger = 'manual', runId, logSink } = {}) {
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
        const outcome = await this.execNode(node, state, stepLog, missing, logs);
        stepLog.ms = Date.now() - started;
        logs.push(stepLog);
        if (logSink) logSink(stepLog);
        if (missing.size) {
          stepLog.missing = [...missing];
          missing.clear();
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

  /** 执行单个节点。returns { handle } 或 null(失败) */
  async execNode(node, state, stepLog, missing, logs) {
    const vars = state.vars;
    switch (node.type) {
      case 'http': {
        const c = node.config || {};
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
        stepLog.detail = { method, url, headers: redact(headers), body };

        const t0 = Date.now();
        let status, statusText, text, respHeaders;
        try {
          if ((c.backend || 'fetch') === 'curl') {
            ({ status, statusText, headers: respHeaders, text } = await httpViaCurl(
              url, method, headers, body, c.timeout || HTTP_TIMEOUT, (c.redirect || 'follow') !== 'manual'));
          } else {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), c.timeout || HTTP_TIMEOUT);
            const resp = await fetch(url, {
              method,
              headers,
              body,
              redirect: c.redirect || 'follow',
              signal: controller.signal,
            });
            clearTimeout(timer);
            status = resp.status;
            statusText = resp.statusText || '';
            text = await resp.text();
            respHeaders = Object.fromEntries(resp.headers.entries());
          }
        } catch (err) {
          stepLog.ok = false;
          stepLog.message = `请求失败: ${err.message}${err.cause ? ` (${err.cause.code || err.cause.message || ''})` : ''}`;
          return null;
        }

        let json = null;
        try {
          json = JSON.parse(text);
        } catch {}

        const duration = Date.now() - t0;
        state.last = { status, statusText, headers: respHeaders, text, json, ms: duration };
        state.steps[node.id] = state.last;
        stepLog.detail.response = {
          status,
          headers: respHeaders,
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
          stepLog.ok = false;
          stepLog.message = `断言失败: ${failedOnes
            .map((r) => r.label || `${r.expr} → ${JSON.stringify(r.actual ?? r.error)} (期望 ${JSON.stringify(r.expect)})`)
            .join('; ')}`;
          return null;
        }
        stepLog.message = `${status} ${statusText} (${duration}ms)`.trim();
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
 * 返回与 fetch 路径同构: { status, statusText, headers, text }
 */
async function httpViaCurl(url, method, headers, body, timeoutMs, follow) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'checkq-'));
  const hdrFile = path.join(tmp, 'h.txt');
  const bodyFile = path.join(tmp, 'b.txt');
  const args = ['-sS', '--max-time', String(Math.ceil(timeoutMs / 1000)), '-X', method, '-D', hdrFile, '-o', bodyFile];
  if (follow) args.push('-L');
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
    for (const line of lines.slice(1)) {
      const i = line.indexOf(':');
      if (i > 0) respHeaders[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
    return { status: m ? Number(m[1]) : 0, statusText: '', headers: respHeaders, text };
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

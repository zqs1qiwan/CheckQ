/**
 * JSON 文件存储: flows / runs / meta(密码 hash)
 * 写入节流 + 原子写（tmp+rename），runs 保留最近 500 条/flow
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Cron } from 'croner';

export class Store {
  #persistTimer = null;

  constructor(dataDir) {
    this.dir = dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    this.flowsFile = path.join(dataDir, 'flows.json');
    this.runsFile = path.join(dataDir, 'runs.json');
    this.metaFile = path.join(dataDir, 'meta.json');
    this.templatesFile = path.join(dataDir, 'templates.json');
    this.flows = this.#load(this.flowsFile, []);
    this.runs = this.#load(this.runsFile, []);
    this.templates = this.#load(this.templatesFile, []);
    this.meta = this.#load(this.metaFile, {});
    if (!this.meta.passwordHash) {
      const pwd = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
      this.meta.passwordHash = hashPwd(pwd);
      this.meta.generatedPassword = !process.env.ADMIN_PASSWORD;
      this.meta.plainHint = process.env.ADMIN_PASSWORD ? null : pwd;
      this.#save(this.metaFile, this.meta);
      if (!process.env.ADMIN_PASSWORD) {
        console.log(`[CheckQ] 未设置 ADMIN_PASSWORD，初始密码: ${pwd}`);
      }
    }
  }

  #load(file, fallback) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return fallback;
    }
  }

  #save(file, obj) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, file);
  }

  #persist() {
    if (this.#persistTimer) return;
    this.#persistTimer = setTimeout(() => {
      this.#persistTimer = null;
      try {
        this.#save(this.flowsFile, this.flows);
        this.#save(this.runsFile, this.runs);
        this.#save(this.templatesFile, this.templates);
      } catch (err) {
        console.error('[CheckQ] persist failed:', err.message);
      }
    }, 400);
  }

  // ---- flows ----
  listFlows() {
    return this.flows.map((f) => {
      const last = this.runs.find((r) => r.flowId === f.id) || null;
      const lastRun = last ? {
        id: last.id, status: last.status, startedAt: last.startedAt, finalMessage: last.finalMessage,
      } : null;
      // 下次运行时间（croner nextRun，仅启用调度的任务）
      let nextRunAt = null;
      if (f.enabled && f.cron) {
        try {
          const job = new Cron(f.cron, { timezone: f.timezone || 'Asia/Shanghai' });
          const next = job.nextRun();
          nextRunAt = next ? next.getTime() : null;
          job.stop();
        } catch { /* 无效 cron 不显示 */ }
      }
      return {
        id: f.id, name: f.name, note: f.note, cron: f.cron, timezone: f.timezone,
        enabled: f.enabled, varsCount: Object.keys(f.vars || {}).length,
        nodesCount: (f.nodes || []).length, tplId: f.tplId || null,
        lastRun,
        nextRunAt,
      };
    });
  }

  getFlow(id) {
    return this.flows.find((f) => f.id === id) || null;
  }

  createFlow(data) {
    const flow = {
      id: crypto.randomUUID(),
      name: data.name || '未命名流程',
      note: data.note || '',
      cron: data.cron || '',
      timezone: data.timezone || 'Asia/Shanghai',
      enabled: false,
      vars: data.vars || {},
      nodes: data.nodes || [],
      edges: data.edges || [],
      notify: data.notify || {},
      log: data.log || null,
      tplId: data.tplId || null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.flows.push(flow);
    this.#persist();
    return flow;
  }

  updateFlow(id, patch) {
    const f = this.getFlow(id);
    if (!f) return null;
    const allowed = ['name', 'note', 'cron', 'timezone', 'enabled', 'vars', 'nodes', 'edges', 'notify', 'log'];
    for (const k of allowed) {
      if (patch[k] !== undefined) f[k] = patch[k];
    }
    f.updatedAt = Date.now();
    this.#persist();
    return f;
  }

  deleteFlow(id) {
    const i = this.flows.findIndex((f) => f.id === id);
    if (i >= 0) {
      this.flows.splice(i, 1);
      this.runs = this.runs.filter((r) => r.flowId !== id);
      this.#persist();
      return true;
    }
    return false;
  }

  // ---- templates ----
  listTemplates() {
    return this.templates.map((t) => ({
      id: t.id, name: t.name, desc: t.desc, source: t.source,
      varNames: t.varNames || [],
      nodesCount: (t.nodes || []).length,
      taskCount: this.flows.filter((f) => f.tplId === t.id).length,
    }));
  }

  getTemplate(id) {
    return this.templates.find((t) => t.id === id) || null;
  }

  createTemplate(data, source = 'flow') {
    const tpl = {
      id: crypto.randomUUID(),
      name: data.name || '未命名模板',
      desc: data.desc || '',
      source,
      varNames: data.varNames || Object.keys(data.vars || {}),
      vars: data.vars || {},      // 默认变量值（生成任务时预填）
      nodes: data.nodes || [],
      edges: data.edges || [],
      createdAt: Date.now(),
    };
    this.templates.push(tpl);
    this.#persist();
    return tpl;
  }

  updateTemplate(id, patch) {
    const t = this.getTemplate(id);
    if (!t) return null;
    for (const k of ['name', 'desc', 'vars', 'varNames']) {
      if (patch[k] !== undefined) t[k] = patch[k];
    }
    this.#persist();
    return t;
  }

  deleteTemplate(id) {
    const i = this.templates.findIndex((t) => t.id === id);
    if (i < 0) return false;
    this.templates.splice(i, 1);
    this.#persist();
    return true;
  }

  /** 从模板生成任务实例：克隆节点图 + 可选覆盖变量。默认名 = 模板名 · 序号 */
  instantiateTemplate(tplId, { name, vars, note } = {}) {
    const tpl = this.getTemplate(tplId);
    if (!tpl) return null;
    // 模板删除后生成的新任务仍独立可用（克隆而非引用）
    const mergedVars = { ...(tpl.vars || {}), ...(vars || {}) };
    const seq = this.flows.filter((f) => f.tplId === tplId).length + 1;
    return this.createFlow({
      name: name || `${tpl.name} · ${seq}`,
      note: note !== undefined ? note : `来自模板「${tpl.name}」`,
      vars: mergedVars,
      nodes: tpl.nodes,
      edges: tpl.edges,
      log: tpl.log,
      tplId,
    });
  }

  // ---- runs ----
  addRun(run) {
    // 幂等：同 id 覆盖（避免重复入列）
    const i = this.runs.findIndex((r) => r.id === run.id);
    if (i >= 0) {
      this.runs[i] = run;
    } else {
      this.runs.unshift(run);
    }
    // 每 flow 保留最近 500
    const per = new Map();
    this.runs = this.runs.filter((r) => {
      const n = (per.get(r.flowId) || 0) + 1;
      per.set(r.flowId, n);
      return n <= 500;
    });
    this.#persist();
  }

  listRuns(flowId, limit = 30) {
    return this.runs.filter((r) => !flowId || r.flowId === flowId).slice(0, limit);
  }

  getRun(id) {
    return this.runs.find((r) => r.id === id) || null;
  }
}

export function hashPwd(pwd) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pwd, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPwd(pwd, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const h = crypto.scryptSync(pwd, salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(hash));
}

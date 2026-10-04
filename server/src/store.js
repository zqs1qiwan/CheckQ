/**
 * JSON 文件存储: flows / runs / meta(密码 hash)
 * 写入节流 + 原子写（tmp+rename），runs 保留最近 500 条/flow
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class Store {
  #persistTimer = null;

  constructor(dataDir) {
    this.dir = dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    this.flowsFile = path.join(dataDir, 'flows.json');
    this.runsFile = path.join(dataDir, 'runs.json');
    this.metaFile = path.join(dataDir, 'meta.json');
    this.flows = this.#load(this.flowsFile, []);
    this.runs = this.#load(this.runsFile, []);
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
      return {
        id: f.id, name: f.name, note: f.note, cron: f.cron, timezone: f.timezone,
        enabled: f.enabled, varsCount: Object.keys(f.vars || {}).length,
        nodesCount: (f.nodes || []).length,
        lastRun,
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
    const allowed = ['name', 'note', 'cron', 'timezone', 'enabled', 'vars', 'nodes', 'edges', 'notify'];
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

/**
 * JSON 文件存储: flows / runs / meta(密码 hash)
 * 写入节流 + 原子写（tmp+rename），runs 保留最近 500 条/flow
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Cron } from 'croner';
import { hashPwd, checkPassword } from './auth.js';
import { secretKey, encryptSecrets, decryptSecrets, maskSecrets } from './secret.js';

export class Store {
  #persistTimer = null;

  constructor(dataDir) {
    this.dir = dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    this.flowsFile = path.join(dataDir, 'flows.json');
    this.runsFile = path.join(dataDir, 'runs.json');
    this.metaFile = path.join(dataDir, 'meta.json');
    this.templatesFile = path.join(dataDir, 'templates.json');
    this.notificationsFile = path.join(dataDir, 'notifications.json');
    // 敏感凭据静态加密密钥（CHECKQ_SECRET 或 data/.secret）
    this.secretKey = secretKey(dataDir);
    // 磁盘上可能是密文（旧版本是明文），读入时统一解密到内存
    this.flows = this.#load(this.flowsFile, []).map((f) => decryptSecrets(this.secretKey, f));
    this.runs = this.#load(this.runsFile, []);
    this.templates = this.#load(this.templatesFile, []).map((x) => decryptSecrets(this.secretKey, x));
    this.notifications = this.#load(this.notificationsFile, []);
    this.meta = this.#load(this.metaFile, {});

    // ---- 账号体系（v0.4.3）：多用户 + 角色 + 2FA + 审计 ----
    this.meta.users = Array.isArray(this.meta.users) ? this.meta.users : [];
    this.meta.apiKeys = Array.isArray(this.meta.apiKeys) ? this.meta.apiKeys : [];
    this.meta.audit = Array.isArray(this.meta.audit) ? this.meta.audit : [];

    // 迁移：旧版单密码 meta.passwordHash → admin 用户；并删除明文密码提示
    if (!this.meta.users.length && this.meta.passwordHash) {
      this.meta.users.push({
        id: crypto.randomUUID(),
        username: 'admin',
        displayName: '管理员',
        role: 'admin',
        passwordHash: this.meta.passwordHash,
        passwordUpdatedAt: Date.now(),
        disabled: false,
        totp: null,
        recoveryCodes: [],
        createdAt: Date.now(),
        lastLoginAt: null,
      });
      console.log('[CheckQ] 已把旧单密码迁移为用户 admin（可稍后在「账号安全」改名/加密码）');
    }
    delete this.meta.passwordHash;   // 不再保留旧字段
    delete this.meta.plainHint;      // 明文密码绝不落盘
    delete this.meta.generatedPassword;

    if (!this.meta.users.length) {
      const pwd = process.env.ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url');
      this.meta.users.push({
        id: crypto.randomUUID(),
        username: 'admin',
        displayName: '管理员',
        role: 'admin',
        passwordHash: hashPwd(pwd),
        passwordUpdatedAt: Date.now(),
        disabled: false,
        totp: null,
        recoveryCodes: [],
        createdAt: Date.now(),
        lastLoginAt: null,
      });
      this.meta.firstRunPassword = pwd;   // 仅本次进程内打印一次，不写盘
      this.#save(this.metaFile, this.meta);
      console.log(`[CheckQ] 初始账号 admin，初始密码: ${pwd}（仅显示一次，请立即登录后修改）`);
    } else {
      delete this.meta.firstRunPassword;
      this.#save(this.metaFile, this.meta);
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

  #flushNow() {
    // 写盘前加密敏感凭据（内存里保持明文，API 返回给前端时才解密）
    this.#save(this.flowsFile, this.flows.map((f) => encryptSecrets(this.secretKey, f)));
    this.#save(this.runsFile, this.runs);
    this.#save(this.templatesFile, this.templates.map((x) => encryptSecrets(this.secretKey, x)));
    this.#save(this.notificationsFile, this.notifications);
    this.#save(this.metaFile, this.meta);
  }

  /** 导出/备份用：脱敏后的 flow（敏感值替换为 *** / 空） */
  maskedFlow(f) {
    return maskSecrets(f);
  }

  maskedTemplate(t) {
    return maskSecrets(t);
  }

  /** 立即落盘（跳过 400ms 节流窗口）；进程退出前调用，避免重启丢配置 */
  flush() {
    if (this.#persistTimer) {
      clearTimeout(this.#persistTimer);
      this.#persistTimer = null;
    }
    try {
      this.#flushNow();
    } catch (err) {
      console.error('[CheckQ] flush failed:', err.message);
    }
  }

  #persist() {
    if (this.#persistTimer) return;
    this.#persistTimer = setTimeout(() => {
      this.#persistTimer = null;
      try {
        this.#flushNow();
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
        enabled: f.enabled, jitterMinutes: f.jitterMinutes || 0, varsCount: Object.keys(f.vars || {}).length,
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
    const jitterMinutes = Math.min(30, Math.max(0, Number(data.jitterMinutes) || 0));
    const flow = {
      id: crypto.randomUUID(),
      name: data.name || '未命名流程',
      note: data.note || '',
      cron: data.cron || '',
      timezone: data.timezone || 'Asia/Shanghai',
      enabled: false,
      jitterMinutes,
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
    this.flush();
    return flow;
  }

  updateFlow(id, patch) {
    const f = this.getFlow(id);
    if (!f) return null;
    const allowed = ['name', 'note', 'cron', 'timezone', 'enabled', 'vars', 'nodes', 'edges', 'notify', 'log', 'jitterMinutes', 'tplId'];
    for (const k of allowed) {
      if (patch[k] !== undefined) f[k] = patch[k];
    }
    f.updatedAt = Date.now();
    this.flush();
    return f;
  }

  deleteFlow(id) {
    const i = this.flows.findIndex((f) => f.id === id);
    if (i >= 0) {
      this.flows.splice(i, 1);
      this.runs = this.runs.filter((r) => r.flowId !== id);
      this.flush();
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
      // 模板携带日志配置（PRD §4.3.1）：level/include/resBodyLimit/keywords 随模板复制
      log: data.log || null,
      // 模板携带通知渠道（带通知的模板实例自动带上通知）：flow.notify 经模板边界不丢失
      notify: data.notify || {},
      createdAt: Date.now(),
    };
    this.templates.push(tpl);
    this.flush();
    return tpl;
  }

  updateTemplate(id, patch) {
    const t = this.getTemplate(id);
    if (!t) return null;
    for (const k of ['name', 'desc', 'vars', 'varNames', 'log', 'nodes', 'edges', 'notify']) {
      if (patch[k] !== undefined) t[k] = patch[k];
    }
    // varNames 与 vars 保持一致：显式传 varNames 时以它为准补齐 vars；只改 vars 时同步 varNames
    if (patch.varNames !== undefined) {
      for (const vn of patch.varNames) if (t.vars[vn] === undefined) t.vars[vn] = '';
    } else if (patch.vars !== undefined) {
      t.varNames = Object.keys(t.vars);
    }
    this.flush();
    return t;
  }

  deleteTemplate(id) {
    const i = this.templates.findIndex((t) => t.id === id);
    if (i < 0) return false;
    this.templates.splice(i, 1);
    this.flush();
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
      notify: tpl.notify || {},
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
    this.flush();
  }

  listRuns(flowId, limit = 30) {
    return this.runs.filter((r) => !flowId || r.flowId === flowId).slice(0, limit);
  }

  getRun(id) {
    return this.runs.find((r) => r.id === id) || null;
  }

  // ---- notifications（站内通知，qinglong 风格“应用内消息”） ----
  addNotification({ title, content, level = 'info', flowId = null, flowName = '' }) {
    const n = {
      id: crypto.randomUUID(),
      title: String(title || 'CheckQ 通知').slice(0, 200),
      content: String(content || '').slice(0, 8000),
      level: ['info', 'success', 'fail'].includes(level) ? level : 'info',
      flowId, flowName,
      read: false,
      createdAt: Date.now(),
    };
    this.notifications.unshift(n);
    if (this.notifications.length > 200) this.notifications = this.notifications.slice(0, 200);
    this.flush();
    return n;
  }

  listNotifications(limit = 50) {
    return {
      items: this.notifications.slice(0, Math.max(1, Math.min(200, Number(limit) || 50))),
      unread: this.notifications.filter((n) => !n.read).length,
      total: this.notifications.length,
    };
  }

  markNotificationsRead(ids) {
    const set = Array.isArray(ids) && ids.length ? new Set(ids) : null;
    let n = 0;
    for (const item of this.notifications) {
      if (!item.read && (!set || set.has(item.id))) { item.read = true; n++; }
    }
    this.flush();
    return n;
  }

  clearNotifications() {
    const n = this.notifications.length;
    this.notifications = [];
    this.flush();
    return n;
  }

  /** 运维统计（首页健康条）：任务/调度/今日运行/成功率/下次触发 */

  // ---- users ----
  listUsers() {
    return this.meta.users.map((u) => this.#publicUser(u));
  }

  #publicUser(u) {
    if (!u) return null;
    return {
      id: u.id,
      username: u.username,
      displayName: u.displayName || u.username,
      role: u.role || 'operator',
      disabled: !!u.disabled,
      totpEnabled: !!(u.totp && u.totp.enabled),
      recoveryCodesLeft: Array.isArray(u.recoveryCodes) ? u.recoveryCodes.length : 0,
      createdAt: u.createdAt || null,
      lastLoginAt: u.lastLoginAt || null,
      passwordUpdatedAt: u.passwordUpdatedAt || null,
      failedLogins: u.failedLogins || 0,
      lockedUntil: u.lockedUntil || null,
    };
  }

  getUser(id) {
    return this.meta.users.find((u) => u.id === id) || null;
  }

  getUserByName(username) {
    const name = String(username || '').trim().toLowerCase();
    return this.meta.users.find((u) => String(u.username).toLowerCase() === name) || null;
  }

  createUser({ username, password, role = 'operator', displayName }) {
    const user = {
      id: crypto.randomUUID(),
      username: String(username).trim(),
      displayName: String(displayName || username).trim(),
      role,
      passwordHash: hashPwd(password),
      passwordUpdatedAt: Date.now(),
      disabled: false,
      totp: null,
      recoveryCodes: [],
      createdAt: Date.now(),
      lastLoginAt: null,
      failedLogins: 0,
      lockedUntil: null,
    };
    this.meta.users.push(user);
    this.flush();
    return user;
  }

  updateUser(id, patch) {
    const u = this.getUser(id);
    if (!u) return null;
    if (patch.username !== undefined) u.username = String(patch.username).trim();
    if (patch.displayName !== undefined) u.displayName = String(patch.displayName).trim();
    if (patch.role !== undefined) u.role = patch.role;
    if (patch.disabled !== undefined) u.disabled = !!patch.disabled;
    if (patch.passwordHash !== undefined) {
      u.passwordHash = patch.passwordHash;
      u.passwordUpdatedAt = Date.now();
    }
    if (patch.totp !== undefined) u.totp = patch.totp;
    if (patch.recoveryCodes !== undefined) u.recoveryCodes = patch.recoveryCodes;
    if (patch.failedLogins !== undefined) u.failedLogins = patch.failedLogins;
    if (patch.lockedUntil !== undefined) u.lockedUntil = patch.lockedUntil;
    this.flush();
    return u;
  }

  deleteUser(id) {
    const i = this.meta.users.findIndex((u) => u.id === id);
    if (i === -1) return false;
    this.meta.users.splice(i, 1);
    this.flush();
    return true;
  }

  // ---- api keys ----
  listApiKeys() {
    return this.meta.apiKeys.map((k) => ({
      id: k.id, name: k.name, prefix: k.prefix, createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt || null, userId: k.userId || null, disabled: !!k.disabled,
    }));
  }

  addApiKey({ name, hash, prefix, userId }) {
    const k = { id: crypto.randomUUID(), name: name || 'API Key', hash, prefix, userId: userId || null, createdAt: Date.now(), lastUsedAt: null, disabled: false };
    this.meta.apiKeys.push(k);
    this.flush();
    return k;
  }

  revokeApiKey(id) {
    const i = this.meta.apiKeys.findIndex((k) => k.id === id);
    if (i === -1) return false;
    this.meta.apiKeys.splice(i, 1);
    this.flush();
    return true;
  }

  findApiKeyByHash(hash) {
    const k = this.meta.apiKeys.find((x) => x.hash === hash && !x.disabled);
    if (k) { k.lastUsedAt = Date.now(); this.flush(); }
    return k || null;
  }

  // ---- audit ----
  audit(action, detail = '', actor = '') {
    this.meta.audit.unshift({ at: Date.now(), action, detail: String(detail || '').slice(0, 300), actor: actor || '' });
    if (this.meta.audit.length > 500) this.meta.audit.length = 500;
    this.flush();
  }

  listAudit(limit = 100) {
    return this.meta.audit.slice(0, Math.min(Math.max(1, limit), 500));
  }

  stats() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const todayStart = start.getTime();
    const todayRuns = this.runs.filter((r) => (r.startedAt || 0) >= todayStart);
    const success = todayRuns.filter((r) => r.status === 'success').length;
    const failed = todayRuns.filter((r) => r.status === 'failed').length;
    const enabled = this.flows.filter((f) => f.enabled && f.cron);
    let nextRunAt = null;
    let nextFlowName = null;
    for (const f of enabled) {
      try {
        const job = new Cron(f.cron, { timezone: f.timezone || 'Asia/Shanghai' });
        const next = job.nextRun()?.getTime() || null;
        job.stop();
        if (next && (nextRunAt === null || next < nextRunAt)) {
          nextRunAt = next;
          nextFlowName = f.name || '';
        }
      } catch { /* 无效 cron 忽略 */ }
    }
    return {
      flows: this.flows.length,
      enabledScheduled: enabled.length,
      templates: this.templates.length,
      todayRuns: todayRuns.length,
      todaySuccess: success,
      todayFailed: failed,
      successRate: todayRuns.length ? Math.round((success / todayRuns.length) * 100) : null,
      nextRunAt,
      nextFlowName, // 下一次调度属于哪个任务（首页健康条提示用）
    };
  }
}

// 密码哈希已抽到 server/src/auth.js（scrypt N=16384 + 随机盐 + 常量时间比较）
export { hashPwd, verifyPwd, checkPassword, checkUsername, hashApiKey, newApiKey, ROLES, PASSWORD_MIN } from './auth.js';

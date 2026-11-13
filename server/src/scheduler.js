/**
 * cron 调度器 — croner，时区支持
 * flow.enabled && flow.cron → 每分钟 tick 匹配
 */

import { Cron } from 'croner';
import { Engine } from './engine.js';

export class Scheduler {
  constructor(store, runner) {
    this.store = store;
    this.runner = runner; // { runFlow(flow, trigger) }
    this.jobs = new Map(); // flowId -> Cron
    this.interval = null;
  }

  start() {
    this.rebuild();
    // 每 60s 对账一次（外部改动 flow 后自动重建任务）
    this.interval = setInterval(() => this.rebuild(), 60_000);
  }

  stop() {
    for (const job of this.jobs.values()) job.stop();
    this.jobs.clear();
    if (this.interval) clearInterval(this.interval);
  }

  rebuild() {
    const want = new Map();
    for (const f of this.store.flows) {
      if (f.enabled && f.cron) want.set(f.id, f);
    }
    // 移除不再需要的（包含非 flows 的汇总任务 id 统一在这里对账）
    for (const [id, job] of this.jobs) {
      if (id.startsWith('__summary__')) continue;
      if (!want.has(id) || job.expression !== want.get(id).cron) {
        job.stop();
        this.jobs.delete(id);
      }
    }
    // 新增
    for (const [id, f] of want) {
      if (this.jobs.has(id)) continue;
      try {
        const job = new Cron(f.cron, { timezone: f.timezone || 'Asia/Shanghai' }, async () => {
          const flow = this.store.getFlow(id);
          if (!flow || !flow.enabled) return;
          // 随机抖动（PRD §4.5）：触发时刻在 cron 点后随机延迟 0-jitterMinutes 分钟，避免整点风控
          const jitter = Math.min(30, Math.max(0, Number(flow.jitterMinutes) || 0));
          const delay = jitter > 0 ? Math.random() * jitter * 60 * 1000 : 0;
          if (delay > 0) console.log(`[CheckQ] jitter: ${flow.name} 延迟 ${Math.round(delay / 1000)}s (${jitter}min 抖动)`);
          setTimeout(async () => {
            const cur = this.store.getFlow(id);
            if (!cur || !cur.enabled) return;
            // 上一次运行（可能正在退避重试）还没结束 → 跳过这一拍，避免同一任务堆积
            if (this.runner.isBusy && this.runner.isBusy(id)) {
              console.log(`[CheckQ] 跳过 ${cur.name}：上一次运行/重试尚未结束`);
              return;
            }
            await this.runner.runFlow(cur, 'cron');
          }, delay);
        });
        this.jobs.set(id, job);
      } catch (err) {
        console.error(`[CheckQ] cron "${f.cron}" invalid on flow ${f.name}: ${err.message}`);
      }
    }
    this.#syncDailySummary();
  }

  #syncDailySummary() {
    const cfg = this.store.meta.dailySummary || {};
    const id = '__summary__';
    const existing = this.jobs.get(id);
    if (!cfg.enabled || !cfg.time) {
      if (existing) { existing.stop(); this.jobs.delete(id); }
      return;
    }
    const expr = `${String(cfg.time).split(':')[1] || '0'} ${String(cfg.time).split(':')[0] || '8'} * * *`;
    if (existing && existing.expression === expr) return;
    if (existing) existing.stop();
    try {
      const job = new Cron(expr, { timezone: cfg.timezone || 'Asia/Shanghai' }, async () => {
        if (this.runner.sendDailySummary) await this.runner.sendDailySummary();
      });
      this.jobs.set(id, job);
    } catch (err) {
      console.error(`[CheckQ] daily summary cron invalid: ${err.message}`);
    }
  }
}

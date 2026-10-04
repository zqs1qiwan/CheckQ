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
    // 移除不再需要的
    for (const [id, job] of this.jobs) {
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
          if (flow && flow.enabled) {
            await this.runner.runFlow(flow, 'cron');
          }
        });
        this.jobs.set(id, job);
      } catch (err) {
        console.error(`[CheckQ] cron "${f.cron}" invalid on flow ${f.name}: ${err.message}`);
      }
    }
  }
}

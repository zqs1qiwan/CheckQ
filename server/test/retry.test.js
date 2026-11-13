/**
 * 任务级失败重试测试（整流重试 + 退避）
 * 运行：node server/test/retry.test.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeRetry, retryDelayMs, runWithRetry, describeRetry, DEFAULT_RETRY } from '../src/retry.js';
import { Store } from '../src/store.js';

let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  PASS', msg); }
  else { fail++; console.log('  FAIL', msg); }
};

console.log('任务级重试');

// ---- normalizeRetry ----
{
  const d = normalizeRetry(undefined);
  ok(d.enabled === true && d.maxAttempts === 3, '缺省：开启、最多 3 次');
  const bad = normalizeRetry({ enabled: true, maxAttempts: 999, baseDelayMs: 1, maxDelayMs: 1, backoff: 'nope' });
  ok(bad.maxAttempts === 10, 'maxAttempts 收敛到上限 10');
  ok(bad.baseDelayMs === 1000, 'baseDelayMs 收敛到下限 1000');
  ok(bad.maxDelayMs >= bad.baseDelayMs, 'maxDelayMs 不小于 baseDelayMs');
  ok(bad.backoff === 'exponential', '非法 backoff 回落到 exponential');
}

// ---- 退避曲线 ----
{
  const cfg = { enabled: true, baseDelayMs: 5000, maxDelayMs: 60000, backoff: 'exponential', jitter: false };
  ok(retryDelayMs(cfg, 1) === 5000, '指数退避：第 1 次失败后等 5s');
  ok(retryDelayMs(cfg, 2) === 10000, '指数退避：第 2 次失败后等 10s');
  ok(retryDelayMs(cfg, 3) === 20000, '指数退避：第 3 次失败后等 20s');
  ok(retryDelayMs(cfg, 5) === 60000, '指数退避：封顶 60s');
  ok(retryDelayMs({ ...cfg, backoff: 'linear' }, 3) === 15000, '线性退避：3 × 5s');
  ok(retryDelayMs({ ...cfg, backoff: 'fixed' }, 4) === 5000, '固定间隔：始终 5s');
  // equal jitter：一半固定 + 一半随机
  const lo = retryDelayMs({ ...cfg, jitter: true }, 1, () => 0);
  const hi = retryDelayMs({ ...cfg, jitter: true }, 1, () => 1);
  ok(lo === 2500 && hi === 5000, '抖动范围是 50%~100%（2500~5000ms）');
}

// ---- 执行器：失败两次后成功 ----
{
  const sleeps = [];
  let calls = 0;
  const r = await runWithRetry({
    retry: { enabled: true, maxAttempts: 3, baseDelayMs: 1000, backoff: 'fixed', jitter: false },
    runOnce: async (attempt) => {
      calls++;
      return attempt < 3 ? { ok: false, finalMessage: `boom ${attempt}` } : { ok: true, finalMessage: 'ok' };
    },
    sleep: async (ms) => { sleeps.push(ms); },
    now: (() => { let t = 0; return () => (t += 100); })(),
  });
  ok(calls === 3, '第 3 次才成功 → 实际跑了 3 次');
  ok(r.ok === true, '最终状态是成功（不会因为前两次失败就判定任务失败）');
  ok(r.attempts.length === 3 && r.attempts[2].ok === true, '尝试记录完整（3 条，最后一条成功）');
  ok(sleeps.length === 2 && sleeps.every((x) => x === 1000), '两次重试各等待 1000ms');
}

// ---- 执行器：次数用尽才算失败 ----
{
  let calls = 0;
  const r = await runWithRetry({
    retry: { enabled: true, maxAttempts: 4, baseDelayMs: 2000, backoff: 'fixed', jitter: false },
    runOnce: async () => { calls++; return { ok: false, finalMessage: 'still bad' }; },
    sleep: async () => {},
  });
  ok(calls === 4, '一直失败 → 跑满 4 次才停');
  ok(r.ok === false && r.attempts.length === 4, '最终判定失败，尝试记录 4 条');
}

// ---- 关闭重试：只跑一次 ----
{
  let calls = 0;
  const r = await runWithRetry({
    retry: { enabled: false, maxAttempts: 5 },
    runOnce: async () => { calls++; return { ok: false, finalMessage: 'bad' }; },
    sleep: async () => { throw new Error('关闭重试时不应等待'); },
  });
  ok(calls === 1, '重试关闭 → 只执行 1 次（保持老行为）');
  ok(r.attempts.length === 1, '只有 1 条尝试记录');
}

// ---- 抛异常也按失败重试 ----
{
  let calls = 0;
  const r = await runWithRetry({
    retry: { enabled: true, maxAttempts: 2, baseDelayMs: 1000, backoff: 'fixed', jitter: false },
    runOnce: async () => { calls++; if (calls === 1) throw new Error('网络炸了'); return { ok: true, finalMessage: 'ok' }; },
    sleep: async () => {},
  });
  ok(calls === 2 && r.ok === true, '执行器抛异常也计入一次失败并继续重试');
}

// ---- 文案 ----
{
  ok(describeRetry({ enabled: false }) === '不重试', '关闭时描述为「不重试」');
  const d = describeRetry({ enabled: true, maxAttempts: 3, backoff: 'exponential', baseDelayMs: 5000 });
  ok(d.includes('最多 3 次') && d.includes('指数退避') && d.includes('5 秒'), `描述可读：${d}`);
}

// ---- 数据层：创建 / 更新 / 旧数据迁移 ----
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cq-retry-'));
  const store = new Store(dir);
  const f = store.createFlow({ name: '重试测试', cron: '', nodes: [], edges: [] });
  ok(f.retry.enabled === true && f.retry.maxAttempts === 3, '新建任务默认开启 3 次重试');
  const updated = store.updateFlow(f.id, { retry: { enabled: false, maxAttempts: 999, baseDelayMs: 1 } });
  ok(updated.retry.enabled === false, '显式关闭后不再重试');
  ok(updated.retry.maxAttempts === 10, '更新时把非法值收敛到上限');
  ok(store.listFlows().find((x) => x.id === f.id).retry.enabled === false, '列表摘要带出重试配置');
  // 模拟旧数据：没有 retry 字段
  fs.writeFileSync(path.join(dir, 'flows.json'), JSON.stringify([{ id: 'old', name: '老任务', nodes: [], edges: [] }]), 'utf8');
  const migrated = new Store(dir);
  ok(migrated.flows[0].retry.enabled === true && migrated.flows[0].retry.maxAttempts === 3,
    '旧任务启动后迁移到默认重试配置');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);

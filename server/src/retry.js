/**
 * 任务级失败重试（整流重试）
 *
 * 语义：一次「运行」= 最多 maxAttempts 次尝试。只有最后一次仍失败，任务才算真正失败。
 * 与节点级重试（http 节点的 config.retry）互补：
 *   - 节点级：同一次执行里，单个请求失败立刻重试（秒级、只针对网络/断言）
 *   - 任务级：整条流程失败后，隔一段时间从头再跑（分钟级，覆盖登录态过期、站点临时风控等）
 *
 * 退避策略：
 *   exponential  5s → 10s → 20s → 40s …（默认，封顶 maxDelayMs）
 *   linear       5s → 10s → 15s → 20s …
 *   fixed        每次都等 baseDelayMs
 * jitter=true 时用「equal jitter」：delay/2 + random(0, delay/2)，
 * 避免多个任务在同一时刻一起重试（惊群）。
 */

export const DEFAULT_RETRY = Object.freeze({
  enabled: true,           // 默认开启：失败后按退避策略自动再跑，跑满次数才判定真正失败
  maxAttempts: 3,          // 含第一次，总共最多跑几次
  backoff: 'exponential',
  baseDelayMs: 5000,       // 第一次重试前等多久
  maxDelayMs: 5 * 60_000,  // 单次等待上限（5 分钟）
  jitter: true,
});

export const RETRY_LIMITS = Object.freeze({
  maxAttempts: [1, 10],
  baseDelayMs: [1_000, 60_000],
  maxDelayMs: [1_000, 30 * 60_000],
});

const clampInt = (v, [lo, hi], fallback) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
};

/** 把任意输入收敛成合法配置（旧数据 / 手写 API 调用都不会把引擎搞崩） */
export function normalizeRetry(input) {
  const r = input && typeof input === 'object' ? input : {};
  const backoff = ['exponential', 'linear', 'fixed'].includes(r.backoff) ? r.backoff : DEFAULT_RETRY.backoff;
  const baseDelayMs = clampInt(r.baseDelayMs, RETRY_LIMITS.baseDelayMs, DEFAULT_RETRY.baseDelayMs);
  const maxDelayMs = clampInt(r.maxDelayMs, RETRY_LIMITS.maxDelayMs, Math.max(baseDelayMs, DEFAULT_RETRY.maxDelayMs));
  return {
    enabled: r.enabled === undefined ? DEFAULT_RETRY.enabled : r.enabled === true,
    maxAttempts: clampInt(r.maxAttempts, RETRY_LIMITS.maxAttempts, DEFAULT_RETRY.maxAttempts),
    backoff,
    baseDelayMs,
    maxDelayMs: Math.max(baseDelayMs, maxDelayMs),
    jitter: r.jitter !== false,
  };
}

/**
 * 第 attempt 次尝试失败后，到下一次尝试之前要等多久。
 * @param {object} retry 已归一化或原始配置
 * @param {number} attempt 已完成的尝试次数（1 = 第一次刚失败）
 * @param {() => number} rand 注入随机源，便于测试
 */
export function retryDelayMs(retry, attempt, rand = Math.random) {
  const cfg = normalizeRetry(retry);
  const n = Math.max(1, Math.round(Number(attempt) || 1));
  let delay;
  if (cfg.backoff === 'fixed') delay = cfg.baseDelayMs;
  else if (cfg.backoff === 'linear') delay = cfg.baseDelayMs * n;
  else delay = cfg.baseDelayMs * 2 ** (n - 1);
  delay = Math.min(delay, cfg.maxDelayMs);
  if (cfg.jitter) delay = delay / 2 + rand() * (delay / 2);
  return Math.max(0, Math.round(delay));
}

/** 人类可读的策略描述（列表 / 详情弹窗用） */
export function describeRetry(input) {
  const cfg = normalizeRetry(input);
  if (!cfg.enabled) return '不重试';
  const name = { exponential: '指数退避', linear: '线性退避', fixed: '固定间隔' }[cfg.backoff];
  const base = cfg.baseDelayMs >= 60_000
    ? `${Math.round(cfg.baseDelayMs / 60_000)} 分钟`
    : `${Math.round(cfg.baseDelayMs / 1000)} 秒`;
  return `最多 ${cfg.maxAttempts} 次 · ${name} · 首次等待 ${base}`;
}

/** 第 N 次尝试的展示文案 */
export function attemptLabel(attempt, maxAttempts) {
  return maxAttempts > 1 ? `第 ${attempt}/${maxAttempts} 次尝试` : '';
}

/**
 * 通用重试执行器（不依赖 Engine，方便单测）。
 * runOnce(attempt) 返回 { ok, ... }；只有 ok=true 或次数用尽才停止。
 */
export async function runWithRetry({
  retry,
  runOnce,
  onAttempt = () => {},
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  rand = Math.random,
  now = Date.now,
}) {
  const cfg = normalizeRetry(retry);
  const maxAttempts = cfg.enabled ? cfg.maxAttempts : 1;
  const attempts = [];
  let last = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startedAt = now();
    let result;
    try {
      result = await runOnce(attempt);
    } catch (err) {
      result = { ok: false, finalMessage: `执行异常: ${err.message}` };
    }
    const rec = {
      attempt,
      startedAt,
      durationMs: Math.max(0, now() - startedAt),
      ok: !!result?.ok,
      message: result?.finalMessage || '',
    };
    attempts.push(rec);
    last = result;
    onAttempt(rec, result);
    if (rec.ok || attempt >= maxAttempts) break;
    rec.nextDelayMs = retryDelayMs(cfg, attempt, rand);
    await sleep(rec.nextDelayMs);
  }
  return { ...(last || { ok: false }), attempts, retry: cfg, maxAttempts };
}

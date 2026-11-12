/** API 封装：统一 401 处理 + JSON */

let on401 = null;
export function set401Handler(fn) {
  on401 = fn;
}

async function req(method, url, body, isForm = false) {
  const opts = { method, credentials: 'include' };
  if (body !== undefined) {
    if (isForm) {
      opts.body = body;
    } else {
      opts.headers = { 'content-type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
  }
  const r = await fetch(url, opts);
  if (r.status === 401) {
    if (on401) on401();
    throw new Error('未登录');
  }
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json().catch(() => ({})) : await r.text();
  if (!r.ok) throw new Error((data && data.error) || `HTTP ${r.status}`);
  return data;
}

export const api = {
  login: (username, password, code) => req('POST', '/api/login', { username, password, code }),
  bootstrap: () => req('GET', '/api/system/bootstrap'),
  setupPassword: (password) => req('POST', '/api/system/bootstrap', { password }),
  setupAccount: (username, password) => req('POST', '/api/system/bootstrap', { username, password }),
  logout: () => req('POST', '/api/logout', {}),
  me: () => req('GET', '/api/me'),
  updateAccount: (payload) => req('PUT', '/api/system/account', payload),
  sessions: () => req('GET', '/api/system/sessions'),
  revokeSession: (id) => req('DELETE', `/api/system/sessions/${id}`),
  logoutAll: () => req('POST', '/api/system/logout-all', {}),
  twofaEnroll: (password) => req('POST', '/api/system/2fa/enroll', { password }),
  twofaConfirm: (code) => req('POST', '/api/system/2fa/confirm', { code }),
  twofaDisable: (password, code) => req('POST', '/api/system/2fa/disable', { password, code }),
  twofaRecoveryCodes: (password, code) => req('POST', '/api/system/2fa/recovery-codes', { password, code }),
  users: () => req('GET', '/api/system/users'),
  createUser: (payload) => req('POST', '/api/system/users', payload),
  updateUser: (id, patch) => req('PUT', `/api/system/users/${id}`, patch),
  resetUserPassword: (id, password) => req('POST', `/api/system/users/${id}/password`, { password }),
  resetUser2fa: (id) => req('POST', `/api/system/users/${id}/2fa/reset`, {}),
  deleteUser: (id) => req('DELETE', `/api/system/users/${id}`),
  auditLog: (limit = 100) => req('GET', `/api/system/audit?limit=${limit}`),
  apiKeys: () => req('GET', '/api/system/apikeys'),
  createApiKey: (name, scopes, expiresAt) => req('POST', '/api/system/apikeys', { name, scopes, expiresAt }),
  revokeApiKey: (id) => req('DELETE', `/api/system/apikeys/${id}`),
  updateApiKey: (id, patch) => req('PUT', `/api/system/apikeys/${id}`, patch),
  ipBlocklist: () => req('GET', '/api/system/ip-blocklist'),
  blockIp: (ip) => req('PUT', '/api/system/ip-blocklist', { ip }),
  unblockIp: (ip) => req('DELETE', `/api/system/ip-blocklist/${encodeURIComponent(ip)}`),
  flows: () => req('GET', '/api/flows'),
  flow: (id) => req('GET', `/api/flows/${id}`),
  createFlow: (flow) => req('POST', '/api/flows', flow),
  updateFlow: (id, patch) => req('PUT', `/api/flows/${id}`, patch),
  deleteFlow: (id) => req('DELETE', `/api/flows/${id}`),
  runFlow: (id, debugStopId, debug) => req('POST', `/api/flows/${id}/run`, { ...(debugStopId ? { debugStopId } : {}), ...(debug ? { debug: true } : {}) }),
  // SSE 流式运行（PRD §4.7.3）：onStart/onLog 实时回调，返回完整 run 对象
  runFlowStream: async (id, { debugStopId, debug, onStart, onLog } = {}) => {
    const res = await fetch(`/api/flows/${id}/run`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stream: true, ...(debugStopId ? { debugStopId } : {}), ...(debug ? { debug: true } : {}) }),
    });
    if (res.status === 401) {
      if (on401) on401();
      throw new Error('未登录');
    }
    if (!res.ok || !res.headers.get('content-type')?.includes('text/event-stream')) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let finalRun = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const events = buf.split('\n\n');
      buf = events.pop(); // 最后一段可能不完整
      for (const ev of events) {
        const lines = ev.split('\n');
        const event = lines.find((l) => l.startsWith('event: '))?.slice(7);
        const dataLine = lines.find((l) => l.startsWith('data: '))?.slice(6);
        if (!event || !dataLine) continue;
        let data;
        try { data = JSON.parse(dataLine); } catch { continue; }
        if (event === 'start' && onStart) onStart(data);
        else if (event === 'log' && onLog) onLog(data);
        else if (event === 'done') finalRun = data;
      }
    }
    if (!finalRun) throw new Error('SSE 流中断，未收到完成事件');
    return finalRun;
  },
  cloneFlow: (id) => req('POST', `/api/flows/${id}/clone`, {}),
  curlFor: (id, nodeId, vars) => req('POST', `/api/flows/${id}/curl`, { nodeId, vars }),
  runs: (flowId, limit = 30) => req('GET', `/api/runs?flowId=${flowId || ''}&limit=${limit}`),
  run: (id) => req('GET', `/api/runs/${id}`),
  // templates
  templates: () => req('GET', '/api/templates'),
  template: (id) => req('GET', `/api/templates/${id}`),
  createTemplate: (tpl) => req('POST', '/api/templates', tpl),
  saveFlowAsTemplate: (flowId, name, desc) => req('POST', `/api/templates/from-flow/${flowId}`, { name, desc }),
  updateTemplate: (id, patch) => req('PUT', `/api/templates/${id}`, patch),
  deleteTemplate: (id) => req('DELETE', `/api/templates/${id}`),
  instantiate: (tplId, body) => req('POST', `/api/templates/${tplId}/instantiate`, body),
  exportTemplate: (tplId) => req('GET', `/api/templates/${tplId}/export`),
  instantiateCsv: (tplId, csv) => req('POST', `/api/templates/${tplId}/instantiate-csv`, { csv }),
  importCurl: (command) => req('POST', '/api/import/curl', { command }),
  importHar: (formData) => req('POST', '/api/import/har', formData, true),
  stats: () => req('GET', '/api/system/stats'),
  systemSettings: () => req('GET', '/api/system/settings'),
  changePassword: (oldPassword, newPassword) => req('POST', '/api/system/password', { oldPassword, newPassword }),
  genApiKey: () => req('POST', '/api/system/apikey', {}),
  aiSettings: () => req('GET', '/api/system/ai'),
  saveAiSettings: (cfg) => req('PUT', '/api/system/ai', cfg),
  aiGenerate: (sentence) => req('POST', '/api/ai/generate', { sentence }),
  dailySummaryConfig: () => req('GET', '/api/system/daily-summary-config'),
  saveDailySummaryConfig: (cfg) => req('PUT', '/api/system/daily-summary-config', cfg),
  templateFromUrl: (url) => req('POST', '/api/templates/from-url', { url }),
  notifyTest: (flowId) => req('POST', `/api/flows/${flowId}/notify-test`, {}),
  dailySummary: (flowId) => req('POST', '/api/system/daily-summary', flowId ? { flowId } : {}),
  pushDailySummary: (opts) => req('POST', '/api/system/daily-summary', opts || {}),
  batch: (ids, action) => req('POST', '/api/flows/batch', { ids, action }),
  browserLoginStart: (flowId, url) => req('POST', '/api/browser-login/start', { flowId, url }),
  browserLoginCapture: (flowId, tabId) => req('POST', '/api/browser-login/capture', { flowId, tabId }),
  backup: () => req('GET', '/api/system/backup'),
  backupFull: (password) => req('POST', '/api/system/backup', { password }),
  restore: (body) => req('POST', '/api/system/restore', body),
  notifications: (limit = 50) => req('GET', `/api/notifications?limit=${limit}`),
  markNotificationsRead: (ids) => req('POST', '/api/notifications/read', ids ? { ids } : {}),
  clearNotifications: () => req('DELETE', '/api/notifications'),
  flowLogs: (id, { limit = 200, before = null } = {}) => req('GET', `/api/flows/${id}/logs?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ''}`),
  uiSettings: () => req('GET', '/api/system/ui'),
  pushTargets: () => req('GET', '/api/system/push-targets'),
  saveUiSettings: (patch) => req('PUT', '/api/system/ui', patch),
};

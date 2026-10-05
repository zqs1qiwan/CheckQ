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
  login: (password) => req('POST', '/api/login', { password }),
  logout: () => req('POST', '/api/logout', {}),
  flows: () => req('GET', '/api/flows'),
  flow: (id) => req('GET', `/api/flows/${id}`),
  createFlow: (flow) => req('POST', '/api/flows', flow),
  updateFlow: (id, patch) => req('PUT', `/api/flows/${id}`, patch),
  deleteFlow: (id) => req('DELETE', `/api/flows/${id}`),
  runFlow: (id, debugStopId) => req('POST', `/api/flows/${id}/run`, debugStopId ? { debugStopId } : {}),
  // SSE 流式运行（PRD §4.7.3）：onStart/onLog 实时回调，返回完整 run 对象
  runFlowStream: async (id, { debugStopId, onStart, onLog } = {}) => {
    const res = await fetch(`/api/flows/${id}/run`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stream: true, ...(debugStopId ? { debugStopId } : {}) }),
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
};

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
  importHar: (formData) => req('POST', '/api/import/har', formData, true),
};

import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

function fmtTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Toast({ toast, onClose }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  return <div className={`toast ${toast.kind || 'ok'}`}>{toast.text}</div>;
}

export default function FlowList({ onOpen, onLogout }) {
  const [flows, setFlows] = useState(null);
  const [templates, setTemplates] = useState(null);
  const [toast, setToast] = useState(null);
  const [modal, setModal] = useState(null); // 'new' | 'import' | 'template-editor' | {type:'instantiate', tpl} | {type:'result', run}
  const [importBusy, setImportBusy] = useState(false);
  const [running, setRunning] = useState(null); // flowId -> 'running'
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all'); // all | scheduled | recent-failed
  const fileRef = useRef();
  const editTemplateRef = useRef(); // 模板编辑页回调刷新

  const load = () => {
    api.flows().then(setFlows).catch((e) => setToast({ kind: 'fail', text: e.message }));
    api.templates().then(setTemplates).catch(() => setTemplates([]));
  };

  useEffect(() => { load(); }, []);

  // 搜索 + 筛选（PRD 4.4）
  const visibleFlows = (flows || []).filter((f) => {
    if (search) {
      const q = search.toLowerCase();
      if (!f.name.toLowerCase().includes(q) && !(f.note || '').toLowerCase().includes(q)) return false;
    }
    if (filter === 'scheduled' && !f.enabled) return false;
    if (filter === 'recent-failed' && f.lastRun?.status !== 'failed') return false;
    return true;
  });

  const createEmpty = async () => {
    const f = await api.createFlow({
      name: '新流程', nodes: [], edges: [], vars: {}, cron: '', enabled: false,
    });
    onOpen(f.id);
  };

  const doImport = async (file) => {
    setImportBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { flow } = await api.importHar(fd);
      const created = await api.createFlow(flow);
      onOpen(created.id);
    } catch (e) {
      setToast({ kind: 'fail', text: `导入失败: ${e.message}` });
    } finally {
      setImportBusy(false);
      setModal(null);
    }
  };

  const toggle = async (f) => {
    await api.updateFlow(f.id, { enabled: !f.enabled });
    load();
  };

  const del = async (f) => {
    if (!confirm(`删除任务「${f.name}」？不可恢复`)) return;
    await api.deleteFlow(f.id);
    load();
  };

  const runNow = async (f) => {
    setRunning(f.id);
    try {
      const run = await api.runFlow(f.id);
      setModal({ type: 'result', run, flowId: f.id });
      load();
    } catch (e) {
      setToast({ kind: 'fail', text: `运行失败: ${e.message}` });
    } finally {
      setRunning(null);
    }
  };

  const lastStatus = (f) => {
    if (!f.lastRun) return <span className="badge muted">未运行</span>;
    const ok = f.lastRun.status === 'success';
    return (
      <span className={`badge ${ok ? 'ok' : 'fail'}`} style={{ cursor: 'pointer' }}
        title="点击查看运行日志"
        onClick={() => api.run(f.lastRun.id).then((full) => setModal({ type: 'result', run: full, flowId: f.id }))}>
        {ok ? '成功' : '失败'} · {fmtTime(f.lastRun.startedAt)}
      </span>
    );
  };

  if (flows === null) return <div className="boot">加载中…</div>;

  return (
    <>
      <div className="topbar">
        <span className="logo">Check<em>Q</em></span>
        <span className="spacer" />
        <button onClick={() => setModal('curl')} disabled={importBusy}>导入 cURL</button>
        <button onClick={() => setModal('import')} disabled={importBusy}>导入 HAR / 模板 JSON</button>
        <button className="primary" onClick={() => setModal('new')}>+ 新建任务</button>
        <button onClick={onLogout}>退出</button>
        <input
          ref={fileRef} type="file" accept=".har,.json" style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files[0]; if (f) doImport(f); e.target.value = ''; }}
        />
      </div>

      <div className="page">
        <div className="page-head">
          <h2>模板</h2>
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>一个模板，多份任务；变量（cookie 等）在创建任务时各自填写</span>
        </div>

        {templates && templates.length > 0 ? (
          <div className="tpl-grid">
            {templates.map((t) => (
              <div key={t.id} className="tpl-card">
                <div className="tpl-name">{t.name}</div>
                <div className="tpl-desc">{t.desc || '—'}</div>
                <div className="tpl-meta">
                  {t.nodesCount} 步 · {t.varNames.length} 个变量 · 已建 {t.taskCount} 个任务
                </div>
                <div className="tpl-actions">
                  <button className="small primary" onClick={() => setModal({ type: 'instantiate', tpl: t })}>+ 创建任务</button>
                  <button className="small" onClick={() => setModal({ type: 'csv', tpl: t })}>批量</button>
                  <button className="small" onClick={() => setModal({ type: 'template-editor', tpl: t })}>管理</button>
                  <button className="small" onClick={async () => {
                    try {
                      const data = await api.exportTemplate(t.id);
                      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                      const a = document.createElement('a');
                      a.href = URL.createObjectURL(blob);
                      a.download = `${t.name.replace(/[\\/:*?"<>|]/g, '_')}.json`;
                      a.click();
                      URL.revokeObjectURL(a.href);
                    } catch (e) {
                      setToast({ kind: 'fail', text: `导出失败: ${e.message}` });
                    }
                  }}>导出</button>
                  <button className="small danger" onClick={async () => {
                    if (!confirm(`删除模板「${t.name}」？已创建的任务不受影响。`)) return;
                    await api.deleteTemplate(t.id);
                    load();
                  }}>删除</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="tpl-empty">
            还没有模板。先建一个任务调试好，点「存为模板」，或导入模板 JSON。
          </div>
        )}

        <div className="page-head" style={{ marginTop: 28 }}>
          <h2>任务</h2>
          <span className="spacer" />
          <input
            style={{ width: 180, fontSize: 13, padding: '4px 8px' }}
            placeholder="搜索名称/备注…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            style={{ width: 110, fontSize: 13, padding: '4px 6px' }}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">全部</option>
            <option value="scheduled">已启用调度</option>
            <option value="recent-failed">最近失败</option>
          </select>
        </div>

        {visibleFlows.length === 0 ? (
          <div className="empty">
            <div className="big">🧩</div>
            <p>{(search || filter !== 'all') ? '没有匹配的任务。' : '还没有任务。从上方模板创建，或「+ 新建任务」从零开始搭建。'}</p>
          </div>
        ) : (
          <table className="flow-table">
            <thead>
              <tr><th>名称</th><th>调度</th><th>下次运行</th><th>状态</th><th>上次运行</th><th style={{ width: 240 }}>操作</th></tr>
            </thead>
            <tbody>
              {visibleFlows.map((f) => (
                <tr key={f.id}>
                  <td>
                    <a className="flow-name" href="#" onClick={(e) => { e.preventDefault(); onOpen(f.id); }}>{f.name}</a>
                    {f.note ? <div style={{ color: 'var(--muted)', fontSize: 12 }}>{f.note}</div> : null}
                  </td>
                  <td>
                    {f.cron ? <span className="cron-code">{f.cron}</span> : <span style={{ color: 'var(--muted)' }}>手动</span>}
                  </td>
                  <td>
                    {f.nextRunAt ? <span style={{ fontSize: 12, color: 'var(--muted)' }}>{fmtTime(f.nextRunAt)}</span> : <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>}
                  </td>
                  <td>
                    <label className="switch" title={f.enabled ? '点击停用调度' : '点击启用调度'}>
                      <input type="checkbox" checked={!!f.enabled} onChange={() => toggle(f)} />
                      <span className="track" />
                    </label>
                  </td>
                  <td>{lastStatus(f)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="small primary" disabled={running === f.id}
                      onClick={() => runNow(f)}>{running === f.id ? '运行中…' : '▶ 运行'}</button>
                    {' '}
                    <button className="small" onClick={() => onOpen(f.id)}>编辑</button>
                    {' '}
                    <button className="small danger" onClick={() => del(f)}>删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal === 'new' && (
        <div className="modal-mask" onClick={(e) => e.target === e.currentTarget && setModal(null)}>
          <div className="modal">
            <h3>新建空白任务</h3>
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>进入编辑器：左侧拖积木到画布 → 连线 → 点「▶ 运行」测试 → 调好后「存为模板」。</p>
            <button className="primary" onClick={createEmpty}>创建</button>
            {' '}
            <button onClick={() => setModal(null)}>取消</button>
          </div>
        </div>
      )}

      {modal === 'curl' && (
        <CurlImportModal onClose={() => setModal(null)} onCreated={(f) => { setModal(null); onOpen(f.id); }} />
      )}

      {modal === 'import' && (
        <div className="modal-mask" onClick={(e) => e.target === e.currentTarget && setModal(null)}>
          <div className="modal">
            <h3>导入</h3>
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>
              支持 .har（浏览器请求录制）和 .json（CheckQ 模板）。点击下方按钮选择文件。
            </p>
            <button className="primary" onClick={() => fileRef.current?.click()}>选择文件</button>
            {' '}
            <button onClick={() => setModal(null)}>取消</button>
          </div>
        </div>
      )}

      {modal?.type === 'csv' && (
        <CsvImportModal tpl={modal.tpl} onClose={() => setModal(null)} onDone={(n) => { setModal(null); setToast({ kind: 'ok', text: `已创建 ${n} 个任务` }); load(); }} />
      )}

      {modal?.type === 'instantiate' && (
        <InstantiateModal tpl={modal.tpl} onClose={() => setModal(null)} onCreated={(f) => { setModal(null); onOpen(f.id); }} />
      )}

      {modal?.type === 'result' && (
        <ResultModal run={modal.run} flowId={modal.flowId} onClose={() => setModal(null)} />
      )}

      {modal?.type === 'template-editor' && (
        <TemplateEditorModal tpl={modal.tpl} onDone={() => { setModal(null); load(); }} />
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </>
  );
}

/** 从模板创建任务：填任务名 + 覆盖变量 */
function InstantiateModal({ tpl, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [vars, setVars] = useState(null); // {name, value}[]，从模板详情拉默认值
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.template(tpl.id).then((t) => {
      setVars(t.varNames.map((n) => ({ name: n, value: (t.vars || {})[n] || '' })));
    }).catch(() => setVars([]));
  }, [tpl.id]);

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const varsObj = {};
      for (const v of vars || []) if (v.name.trim()) varsObj[v.name.trim()] = v.value;
      const f = await api.instantiate(tpl.id, { name: name.trim() || undefined, vars: varsObj });
      onCreated(f);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-mask" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>从模板创建任务：{tpl.name}</h3>
        <p style={{ color: 'var(--muted)', fontSize: 12 }}>节点流程与模板相同，只改这里的变量（如 cookie）。留空用默认值。</p>
        <div className="field">
          <label>任务名</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`默认：${tpl.name} · 序号`} />
        </div>
        {(vars || []).map((v, i) => (
          <div className="field" key={i}>
            <label className="mono">{v.name}</label>
            <textarea
              className="mono" rows={v.name === 'ua' ? 2 : Math.min(3, (v.value.length / 60 | 0) + 1)}
              value={v.value}
              onChange={(e) => setVars(vars.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
            />
          </div>
        ))}
        {vars === null && <p style={{ color: 'var(--muted)' }}>加载变量中…</p>}
        {err && <p style={{ color: 'var(--fail)', fontSize: 12 }}>{err}</p>}
        <button className="primary" disabled={busy || vars === null} onClick={submit}>{busy ? '创建中…' : '创建任务'}</button>
        {' '}
        <button onClick={onClose}>取消</button>
      </div>
    </div>
  );
}

/** 任务列表页的运行结果弹窗（精简版日志） */
function ResultModal({ run, flowId, onClose }) {
  const [expanded, setExpanded] = useState(null);
  const statusLabel = run.status === 'success' ? '✅ 运行成功' : run.status === 'failed' ? '❌ 运行失败' : '⏳ 运行中…';
  return (
    <div className="modal-mask" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 640 }}>
        <h3>{statusLabel} {run.durationMs ? <span style={{ color: 'var(--muted)', fontSize: 12, fontWeight: 400 }}>{(run.durationMs / 1000).toFixed(1)}s</span> : null}</h3>
        {run.finalMessage && (
          <p style={{ color: run.status === 'failed' ? 'var(--fail)' : 'var(--muted)', fontSize: 13, marginTop: -8 }}>{run.finalMessage}</p>
        )}
        <div className="result-logs">
          {(run.logs || []).length === 0 && <p style={{ color: 'var(--muted)' }}>暂无日志</p>}
          {(run.logs || []).map((log, i) => (
            <div key={i} className="step-row">
              <div className="step-head" onClick={() => setExpanded(expanded === i ? null : i)}>
                <span className="idx">{log.index}</span>
                <span className="dot" style={{ background: log.ok ? 'var(--ok)' : 'var(--fail)', width: 8, height: 8, borderRadius: '50%', flex: 'none' }} />
                <span className="msg">{log.name} — {log.message}</span>
                <span style={{ color: 'var(--muted)', fontSize: 11, flex: 'none' }}>{log.ms}ms</span>
              </div>
              {expanded === i && (
                <div className="step-detail">
                  {log.type === 'http' && log.detail && (
                    <>
                      <div><b>{log.detail.method}</b> {log.detail.url}</div>
                      {log.detail.headers && <pre>{Object.entries(log.detail.headers).map(([k, v]) => `${k}: ${v}`).join('\n')}</pre>}
                      {log.detail.body && <pre>{log.detail.body}</pre>}
                    </>
                  )}
                  {log.type === 'http' && log.detail?.response && (
                    <>
                      <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>响应 (HTTP {log.detail.response.status})</span>
                        <span style={{ color: 'var(--muted)', fontSize: 10 }}>编辑器内可用「点选生成逻辑」</span>
                      </div>
                      <pre>{log.detail.response.body}</pre>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 14 }}>
          <button onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

/** cURL 导入 → 新任务 */
function CurlImportModal({ onClose, onCreated }) {
  const [cmd, setCmd] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [preview, setPreview] = useState(null);

  const parse = async () => {
    setErr(''); setPreview(null);
    if (!cmd.trim()) return;
    setBusy(true);
    try {
      const { config } = await api.importCurl(cmd);
      setPreview(config);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setBusy(true); setErr('');
    try {
      const f = await api.createFlow({
        name: `cURL · ${new URL(preview.url).hostname}`,
        nodes: [{ id: 'n0', type: 'http', name: '请求', x: 0, y: 0, config: preview }],
        edges: [], vars: {}, cron: '', enabled: false,
      });
      onCreated(f);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-mask" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 640 }}>
        <h3>导入 cURL 命令</h3>
        <p style={{ color: 'var(--muted)', fontSize: 12 }}>粘贴浏览器 "Copy as cURL" 的完整命令，自动解析为 HTTP 请求节点。</p>
        <textarea
          className="mono" rows={5}
          placeholder={`curl 'https://example.com/api' \\\n  -H 'cookie: sess=...' \\\n  --data-raw '{"a":1}'`}
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
        />
        <div style={{ marginTop: 8 }}>
          <button className="primary" disabled={busy || !cmd.trim()} onClick={parse}>解析预览</button>
          {' '}
          <button onClick={onClose}>取消</button>
        </div>
        {err && <p style={{ color: 'var(--fail)', fontSize: 12 }}>{err}</p>}
        {preview && (
          <div style={{ marginTop: 10, border: '1px solid var(--border)', borderRadius: 8, padding: 10, fontSize: 12 }}>
            <div><b>{preview.method}</b> <span className="mono">{preview.url}</span></div>
            {preview.headers.length > 0 && (
              <div style={{ color: 'var(--muted)', marginTop: 4 }}>
                {preview.headers.map((h) => `${h.name}: ${h.value.length > 40 ? h.value.slice(0, 40) + '…' : h.value}`).join(' | ')}
              </div>
            )}
            {preview.body && <div className="mono" style={{ marginTop: 4, wordBreak: 'break-all' }}>body: {preview.body.slice(0, 120)}</div>}
            <button className="primary" style={{ marginTop: 8 }} disabled={busy} onClick={create}>创建任务</button>
          </div>
        )}
      </div>
    </div>
  );
}

/** CSV 批量建任务：首行=变量名（可含 name 列），每行一条任务 */
function CsvImportModal({ tpl, onClose, onDone }) {
  const [csv, setCsv] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);

  const submit = async () => {
    setBusy(true); setErr(''); setResult(null);
    try {
      const r = await api.instantiateCsv(tpl.id, csv);
      setResult(r);
      if (r.created > 0) onDone(r.created);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-mask" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 640 }}>
        <h3>批量创建任务：{tpl.name}</h3>
        <p style={{ color: 'var(--muted)', fontSize: 12 }}>
          首行为变量名（如 <code className="mono">name,cookie</code>，name 列可选作任务名），每行一条任务。
          {tpl.varNames.length > 0 && <> 模板变量：{tpl.varNames.join(', ')}</>}
        </p>
        <textarea
          className="mono" rows={6}
          placeholder={`name,cookie\n主号,sess=xxx\n备用,sess=yyy`}
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
        />
        {err && <p style={{ color: 'var(--fail)', fontSize: 12 }}>{err}</p>}
        {result && (
          <p style={{ color: 'var(--ok)', fontSize: 12 }}>
            已创建 {result.created} 个任务{result.errors?.length ? `，${result.errors.length} 行失败` : ''}
          </p>
        )}
        <button className="primary" disabled={busy || !csv.trim()} onClick={submit}>{busy ? '创建中…' : '批量创建'}</button>
        {' '}
        <button onClick={onClose}>关闭</button>
      </div>
    </div>
  );
}

/** 模板管理：改名/改默认变量/查看节点数 */
function TemplateEditorModal({ tpl, onDone }) {
  const [name, setName] = useState(tpl.name);
  const [desc, setDesc] = useState(tpl.desc || '');
  const [detail, setDetail] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.template(tpl.id).then(setDetail).catch((e) => setErr(e.message));
  }, [tpl.id]);

  const save = async () => {
    try {
      await api.updateTemplate(tpl.id, { name, desc });
      onDone();
    } catch (e) { setErr(e.message); }
  };

  return (
    <div className="modal-mask" onClick={(e) => e.target === e.currentTarget && onDone()}>
      <div className="modal">
        <h3>管理模板：{tpl.name}</h3>
        {detail && (
          <p style={{ color: 'var(--muted)', fontSize: 12 }}>
            {detail.nodes.length} 个节点 · 变量：{Object.keys(detail.vars || {}).join(', ') || '无'}
          </p>
        )}
        <div className="field">
          <label>模板名</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>描述</label>
          <input value={desc} onChange={(e) => setDesc(e.target.value)} />
        </div>
        {err && <p style={{ color: 'var(--fail)', fontSize: 12 }}>{err}</p>}
        <button className="primary" onClick={save}>保存</button>
        {' '}
        <button onClick={onDone}>取消</button>
      </div>
    </div>
  );
}

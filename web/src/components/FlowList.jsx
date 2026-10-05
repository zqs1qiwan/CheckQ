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
  const fileRef = useRef();
  const editTemplateRef = useRef(); // 模板编辑页回调刷新

  const load = () => {
    api.flows().then(setFlows).catch((e) => setToast({ kind: 'fail', text: e.message }));
    api.templates().then(setTemplates).catch(() => setTemplates([]));
  };

  useEffect(() => { load(); }, []);

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
                  <button className="small" onClick={() => setModal({ type: 'template-editor', tpl: t })}>管理</button>
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
        </div>

        {flows.length === 0 ? (
          <div className="empty">
            <div className="big">🧩</div>
            <p>还没有任务。从上方模板创建，或「+ 新建任务」从零开始搭建。</p>
          </div>
        ) : (
          <table className="flow-table">
            <thead>
              <tr><th>名称</th><th>调度</th><th>状态</th><th>上次运行</th><th style={{ width: 240 }}>操作</th></tr>
            </thead>
            <tbody>
              {flows.map((f) => (
                <tr key={f.id}>
                  <td>
                    <a className="flow-name" href="#" onClick={(e) => { e.preventDefault(); onOpen(f.id); }}>{f.name}</a>
                    {f.note ? <div style={{ color: 'var(--muted)', fontSize: 12 }}>{f.note}</div> : null}
                  </td>
                  <td>
                    {f.cron ? <span className="cron-code">{f.cron}</span> : <span style={{ color: 'var(--muted)' }}>手动</span>}
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
                      <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 6 }}>响应 (HTTP {log.detail.response.status})</div>
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

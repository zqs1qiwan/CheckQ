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
  const [toast, setToast] = useState(null);
  const [modal, setModal] = useState(null); // 'new' | 'tpl' | null
  const [importBusy, setImportBusy] = useState(false);
  const fileRef = useRef();

  const load = () => api.flows().then(setFlows).catch((e) => setToast({ kind: 'fail', text: e.message }));

  useEffect(() => { load(); }, []);

  const createEmpty = async () => {
    const f = await api.createFlow({
      name: '新流程', nodes: [], edges: [], vars: {}, cron: '', enabled: false,
    });
    onOpen(f.id);
  };

  const fromTemplate = async (tplId) => {
    const f = await api.fromTemplate(tplId);
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
    if (!confirm(`删除流程「${f.name}」？不可恢复`)) return;
    await api.deleteFlow(f.id);
    load();
  };

  const lastStatus = (f) => {
    if (!f.lastRun) return <span className="badge muted">未运行</span>;
    const ok = f.lastRun.status === 'success';
    return (
      <span className={`badge ${ok ? 'ok' : 'fail'}`}>
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
        <button onClick={() => fileRef.current?.click()} disabled={importBusy}>导入 HAR / JSON</button>
        <button className="primary" onClick={() => setModal('new')}>新建流程</button>
        <button onClick={onLogout}>退出</button>
        <input
          ref={fileRef} type="file" accept=".har,.json" style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files[0]; if (f) doImport(f); e.target.value = ''; }}
        />
      </div>

      <div className="page">
        <div className="page-head">
          <h2>流程</h2>
          <span className="spacer" />
        </div>

        {flows.length === 0 ? (
          <div className="empty">
            <div className="big">🧩</div>
            <p>还没有流程。新建空白流程，或导入浏览器 HAR / JSON 文件。</p>
          </div>
        ) : (
          <table className="flow-table">
            <thead>
              <tr><th>名称</th><th>调度</th><th>状态</th><th>上次运行</th><th style={{ width: 180 }}>操作</th></tr>
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
                    <label className="switch" title={f.enabled ? '点击停用' : '点击启用'}>
                      <input type="checkbox" checked={!!f.enabled} onChange={() => toggle(f)} />
                      <span className="track" />
                    </label>
                  </td>
                  <td>{lastStatus(f)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
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
            <h3>新建空白流程</h3>
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>从拖拽一个 HTTP 请求开始搭建。</p>
            <button className="primary" onClick={createEmpty}>创建</button>
            {' '}
            <button onClick={() => setModal(null)}>取消</button>
          </div>
        </div>
      )}

      {modal === 'tpl' && (
        <div className="modal-mask" onClick={(e) => e.target === e.currentTarget && setModal(null)}>
          <div className="modal">
            <h3>从模板新建</h3>
            <TemplatePicker onPick={fromTemplate} />
          </div>
        </div>
      )}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </>
  );
}

function TemplatePicker({ onPick }) {
  const [tpls, setTpls] = useState(null);
  useEffect(() => { api.templates().then(setTpls).catch(() => setTpls([])); }, []);
  if (!tpls) return <p style={{ color: 'var(--muted)' }}>加载中…</p>;
  return (
    <>
      {tpls.map((t) => (
        <div key={t.id} className="tpl-item" onClick={() => onPick(t.id)}>
          <div className="t">{t.name}</div>
          <div className="d">{t.desc}</div>
        </div>
      ))}
      <button onClick={() => {}}>关闭</button>
    </>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import PickPanel from './PickPanel.jsx';

function fmtTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export default function RunDrawer({ run, flowId, onClose, onPickResponse, onRepPick, debug: debugProp, onDebugChange }) {
  const [tab, setTab] = useState('logs');
  const [hist, setHist] = useState(null);
  const [expanded, setExpanded] = useState(null); // log index
  const [override, setOverride] = useState(null); // 历史点开的完整 run
  const [pickFor, setPickFor] = useState(null); // {stepId, body} 当前点选的响应
  const [debugLocal, setDebugLocal] = useState(false); // 调试模式（受控优先）
  const [height, setHeight] = useState(() => {
    const v = Number(localStorage.getItem('checkq-drawer-h'));
    return v >= 25 && v <= 92 ? v : 55;
  });
  const dragRef = useRef(null);

  // 拖拽调整日志坞高度（25% ~ 92%）
  const onDragStart = (e) => {
    e.preventDefault();
    dragRef.current = { y: e.clientY, h: height };
    const move = (ev) => {
      if (!dragRef.current) return;
      const dy = dragRef.current.y - (ev.touches ? ev.touches[0].clientY : ev.clientY);
      const next = Math.min(92, Math.max(25, dragRef.current.h + (dy / window.innerHeight) * 100));
      setHeight(Math.round(next));
    };
    const up = () => {
      if (dragRef.current) {
        try { localStorage.setItem('checkq-drawer-h', String(height)); } catch { /* ignore */ }
      }
      dragRef.current = null;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', up);
  };
  const debug = debugProp !== undefined ? debugProp : debugLocal;
  const setDebug = (v) => {
    setDebugLocal(v);
    if (onDebugChange) onDebugChange(v);
  };

  useEffect(() => {
    setOverride(null);
    setTab('logs');
    setHist(null);
    setPickFor(null);
  }, [run?.id]);

  // Esc 关闭日志坞
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && onClose) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (tab === 'history' && flowId && hist === null) {
      api.runs(flowId, 30).then(setHist).catch(() => setHist([]));
    }
  }, [tab, flowId]);

  if (!run && !override) return null;
  const shown = override || run;

  const statusLabel = shown.status === 'success' ? '执行成功' : shown.status === 'failed' ? '执行失败' : '执行中';
  const failLog = shown.logs?.find((l) => !l.ok);
  const [errFilter, setErrFilter] = useState('all'); // all | network | assert | engine
  // 日常只看「人话」：log 节点输出 + 失败步骤；调试模式才展开全部步骤
  const cleanLogs = (shown.logs || []).filter((l) => l.type === 'log' || !l.ok);
  const visibleLogs = (debug ? (shown.logs || []) : cleanLogs).filter((l) => errFilter === 'all' || l.errorType === errFilter || (errFilter === 'network' && l.errorType === 'network'));

  return (
    <div className="run-drawer" style={{ height: `${height}vh` }}>
      <div className="drawer-grip" onMouseDown={onDragStart} onTouchStart={onDragStart} title="拖动调整高度" aria-hidden="true" />
      <div className="drawer-head">
        <div className="drawer-title">
          <div style={{ fontWeight: 600, whiteSpace: 'nowrap' }}><span className={`run-status ${shown.status}`}>{statusLabel}</span> <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 12 }}>{shown.durationMs ? `${(shown.durationMs / 1000).toFixed(1)}s` : ''}</span></div>
          <div style={{ fontSize: 12, color: failLog ? 'var(--fail)' : 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {shown.finalMessage || (shown.startedAt ? fmtTime(shown.startedAt) : '正在执行…')}
          </div>
          {shown.summary && (
            <div style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={shown.summary}>
              摘要：<span style={{ color: 'var(--ok)' }}>{shown.summary}</span>
            </div>
          )}
        </div>
        <div className="run-tabs">
          <button className={tab === 'logs' ? 'active' : ''} onClick={() => setTab('logs')}>步骤日志</button>
          <button className={tab === 'vars' ? 'active' : ''} onClick={() => setTab('vars')}>变量快照</button>
          <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>历史记录</button>
          {tab === 'logs' && (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, whiteSpace: 'nowrap' }} title="调试模式：显示每一步的请求/响应细节">
                <input type="checkbox" style={{ width: 'auto' }} checked={debug} onChange={(e) => setDebug(e.target.checked)} />
                调试
              </label>
              <select value={errFilter} onChange={(e) => setErrFilter(e.target.value)} style={{ fontSize: 12, padding: '4px 6px' }} title="错误分类筛选">
                <option value="all">全部步骤</option>
                <option value="network">网络失败</option>
                <option value="assert">断言失败</option>
                <option value="engine">引擎/配置</option>
              </select>
            </>
          )}
        </div>
        <button className="modal-close drawer-close" onClick={onClose} title="关闭（Esc）" aria-label="关闭">✕</button>
      </div>

      <div className="drawer-body" style={{ fontFamily: 'inherit' }}>
        {tab === 'logs' && (
          <>
            {!visibleLogs?.length ? (
              <div className="empty" style={{ padding: 30 }}>暂无日志（默认只显示 log 节点输出与失败步骤；勾选「调试」查看每步细节）</div>
            ) : (
              visibleLogs.map((log, i) => (
                <div key={i} className="step-row">
                  <div className="step-head" onClick={() => setExpanded(expanded === i ? null : i)}>
                    <span className="idx">{log.index}</span>
                    <span className="dot" style={{ background: log.ok ? 'var(--ok)' : 'var(--fail)', width: 8, height: 8, borderRadius: '50%', flex: 'none' }} />
                    <span className="msg" title={log.message}>{log.name} — {log.message}{log.errorType ? ` [${log.errorType}]` : ''}</span>
                    <span style={{ color: 'var(--muted)', fontSize: 11, flex: 'none' }}>{log.ms}ms</span>
                    <span style={{ color: 'var(--muted)', fontSize: 10, flex: 'none' }}>{expanded === i ? '▲' : '▼'}</span>
                  </div>
                  {expanded === i && (
                    <div className="step-detail">
                      {log.type === 'http' && log.detail && (
                        <>
                          <div><b>{log.detail.method}</b> {log.detail.url}</div>
                          {log.detail.headers && (
                            <>
                              <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 6 }}>请求头</div>
                              <pre>{Object.entries(log.detail.headers).map(([k, v]) => `${k}: ${v}`).join('\n')}</pre>
                            </>
                          )}
                          {log.detail.body && (
                            <>
                              <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 6 }}>请求体</div>
                              <pre>{log.detail.body}</pre>
                            </>
                          )}
                        </>
                      )}
                      {log.type === 'http' && log.detail?.response && (
                        <>
                          <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span>响应 (HTTP {log.detail.response.status}, {log.detail.response.ms}ms)</span>
                            {onPickResponse && (
                              <button className="small" style={{ padding: '2px 8px' }}
                                onClick={() => setPickFor({ stepId: log.stepId, body: log.detail.response.body, repick: false })}>
                                ✦ 点选生成逻辑
                              </button>
                            )}
                            {!log.ok && onRepPick && (
                              <button className="small" style={{ padding: '2px 8px' }}
                                onClick={() => setPickFor({ stepId: log.stepId, body: log.detail.response.body, repick: true })}>
                                ⟳ 用真实响应重选修复
                              </button>
                            )}
                          </div>
                          {pickFor && pickFor.stepId === log.stepId ? (
                            <PickPanel
                              responseBody={pickFor.body}
                              onClose={() => setPickFor(null)}
                              onApply={(result) => { setPickFor(null); (pickFor.repick ? onRepPick : onPickResponse)?.(result, log); }}
                            />
                          ) : (
                            <pre>{log.detail.response.body}</pre>
                          )}
                        </>
                      )}
                      {log.keywords?.length > 0 && (
                        <>
                          <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 6 }}>关键字提取</div>
                          {log.keywords.map((k, j) => (
                            <div key={j} style={{ color: 'var(--ok)' }}>{k.name}：{k.values.join(', ')}</div>
                          ))}
                        </>
                      )}
                      {log.missing?.length > 0 && (
                        <div style={{ color: 'var(--warn)', fontSize: 11, marginTop: 6 }}>⚠ 未定义的变量已按空置：{log.missing.join(', ')}</div>
                      )}
                      {log.asserts?.length > 0 && (
                        <>
                          <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 6 }}>断言</div>
                          {log.asserts.map((a, j) => (
                            <div key={j} style={{ color: a.pass ? 'var(--ok)' : 'var(--fail)' }}>
                              {a.pass ? '✓' : '✗'} {a.label || a.expr} {a.pass ? '' : `→ 实际 ${JSON.stringify(a.actual ?? a.error)} (期望 ${JSON.stringify(a.expect)})`}
                            </div>
                          ))}
                        </>
                      )}
                      {log.type !== 'http' && log.message && (
                        <div style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{log.message}</div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </>
        )}

        {tab === 'vars' && (
          <div>
            {!shown.vars || Object.keys(shown.vars).length === 0 ? (
              <div className="empty" style={{ padding: 30 }}>暂无变量快照（日志档位 summary 或 varsSnapshot 已关时不记）</div>
            ) : (
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{Object.entries(shown.vars).map(([k, v]) => `${k} = ${String(v).slice(0, 200)}`).join('\n')}</pre>
            )}
            <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 8 }}>
              触发方式：{shown.trigger || 'manual'} · 开始：{shown.startedAt ? fmtTime(shown.startedAt) : '—'} · 耗时：{shown.durationMs ?? 0}ms
              {shown.summary && <> · 摘要：{shown.summary}</>}
            </div>
          </div>
        )}

        {tab === 'history' && (
          <>
            {hist === null ? <div className="empty" style={{ padding: 30 }}>加载中…</div> : (
              hist.length === 0 ? <div className="empty" style={{ padding: 30 }}>暂无历史</div> :
              hist.map((r) => (
                <div key={r.id} className="hist-row" onClick={() => api.run(r.id).then((full) => { setTab('logs'); setOverride(full); })}>
                  <span className={`badge ${r.status === 'success' ? 'ok' : 'fail'}`}>{r.status === 'success' ? '成功' : '失败'}</span>
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>{fmtTime(r.startedAt)}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>{r.finalMessage}</span>
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}

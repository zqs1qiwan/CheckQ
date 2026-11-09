import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import PickPanel from './PickPanel.jsx';

function fmtTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export default function RunDrawer({ run, flowId, onClose, onPickResponse }) {
  const [tab, setTab] = useState('logs');
  const [hist, setHist] = useState(null);
  const [expanded, setExpanded] = useState(null); // log index
  const [override, setOverride] = useState(null); // 历史点开的完整 run
  const [pickFor, setPickFor] = useState(null); // {stepId, body} 当前点选的响应

  useEffect(() => {
    setOverride(null);
    setTab('logs');
    setHist(null);
    setPickFor(null);
  }, [run?.id]);

  useEffect(() => {
    if (tab === 'history' && flowId && hist === null) {
      api.runs(flowId, 30).then(setHist).catch(() => setHist([]));
    }
  }, [tab, flowId]);

  if (!run && !override) return null;
  const shown = override || run;

  const statusLabel = shown.status === 'success' ? '✅ 执行成功' : shown.status === 'failed' ? '❌ 执行失败' : '⏳ 执行中';
  const failLog = shown.logs?.find((l) => !l.ok);
  const [errFilter, setErrFilter] = useState('all'); // all | network | assert | engine
  const visibleLogs = (shown.logs || []).filter((l) => errFilter === 'all' || l.errorType === errFilter || (errFilter === 'network' && l.errorType === 'network'));

  return (
    <div className="run-drawer">
      <div className="drawer-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{statusLabel} <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 12 }}>{shown.durationMs ? `${(shown.durationMs / 1000).toFixed(1)}s` : ''}</span></div>
          <div style={{ fontSize: 12, color: failLog ? 'var(--fail)' : 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {shown.finalMessage || fmtTime(shown.startedAt)}
          </div>
          {shown.summary && (
            <div style={{ fontSize: 12, color: 'var(--ok)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={shown.summary}>
              📌 {shown.summary}
            </div>
          )}
        </div>
        <div className="run-tabs">
          <button className={tab === 'logs' ? 'active' : ''} onClick={() => setTab('logs')}>步骤日志</button>
          <button className={tab === 'vars' ? 'active' : ''} onClick={() => setTab('vars')}>变量快照</button>
          <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>历史记录</button>
          {tab === 'logs' && (
            <select value={errFilter} onChange={(e) => setErrFilter(e.target.value)} style={{ fontSize: 12, padding: '4px 6px' }} title="错误分类筛选">
              <option value="all">全部步骤</option>
              <option value="network">网络失败</option>
              <option value="assert">断言失败</option>
              <option value="engine">引擎/配置</option>
            </select>
          )}
        </div>
        <button className="small" onClick={onClose}>关闭</button>
      </div>

      <div className="drawer-body" style={{ fontFamily: 'inherit' }}>
        {tab === 'logs' && (
          <>
            {!visibleLogs?.length ? (
              <div className="empty" style={{ padding: 30 }}>暂无日志</div>
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
                                onClick={() => setPickFor({ stepId: log.stepId, body: log.detail.response.body })}>
                                ✦ 点选生成逻辑
                              </button>
                            )}
                          </div>
                          {pickFor && pickFor.stepId === log.stepId ? (
                            <PickPanel
                              responseBody={pickFor.body}
                              onClose={() => setPickFor(null)}
                              onApply={(result) => { setPickFor(null); onPickResponse && onPickResponse(result, log); }}
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
                            <div key={j} style={{ color: 'var(--ok)' }}>📌 {k.name}：{k.values.join(', ')}</div>
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

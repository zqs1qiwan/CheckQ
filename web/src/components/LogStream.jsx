import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

/**
 * 连续日志流（qinglong 面板风格）
 * - 一个面板里连续滚动显示该任务多次运行的人话日志（默认只有 log 节点输出 + 失败行）
 * - 底部「加载更早的记录」可继续往上翻历史
 * - 「调试」开关：展开某次运行的每步请求/响应细节（日常不需要）
 */
function fmtClock(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export default function LogStream({ flowId, flowName, onClose, live = false }) {
  const [entries, setEntries] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextBefore, setNextBefore] = useState(null);
  const [filter, setFilter] = useState('all'); // all | error
  const [debugRun, setDebugRun] = useState(null); // 展开调试的 runId
  const [debugData, setDebugData] = useState(null);
  const [loading, setLoading] = useState(true);
  const boxRef = useRef(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.flowLogs(flowId, { limit: 300 })
      .then((r) => {
        if (!alive) return;
        setEntries([...(r.entries || [])].reverse());
        setHasMore(!!r.hasMore);
        setNextBefore(r.nextBefore || null);
      })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [flowId]);

  // 实时模式：把新推送的日志追加到流末尾
  useEffect(() => {
    if (!live) return;
    const onLog = (e) => {
      const l = e.detail;
      if (!l || !l.stepId) return;
      setEntries((prev) => [...prev, {
        runId: l.runId || 'live', startedAt: l.startedAt || Date.now(), status: 'running',
        index: l.index, name: l.name, message: l.message || '', type: l.type, ok: l.ok !== false, ms: l.ms || 0,
      }]);
    };
    window.addEventListener('checkq-log', onLog);
    return () => window.removeEventListener('checkq-log', onLog);
  }, [live]);

  // 默认滚到底部（最新在最下面，像终端）
  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [entries.length]);

  const loadMore = async () => {
    if (!nextBefore) return;
    const r = await api.flowLogs(flowId, { limit: 300, before: nextBefore }).catch(() => null);
    if (!r) return;
    const older = [...(r.entries || [])].reverse();
    setEntries((prev) => [...older, ...prev]);
    setHasMore(!!r.hasMore);
    setNextBefore(r.nextBefore || null);
  };

  const toggleDebug = async (runId) => {
    if (debugRun === runId) { setDebugRun(null); setDebugData(null); return; }
    setDebugRun(runId);
    setDebugData(null);
    const full = await api.run(runId).catch(() => null);
    if (full) setDebugData(full);
  };

  // 按运行分组（保持时间正序：旧 → 新）
  const groups = [];
  for (const e of entries) {
    const last = groups[groups.length - 1];
    if (last && last.runId === e.runId) last.items.push(e);
    else groups.push({ runId: e.runId, startedAt: e.startedAt, status: e.status, summary: e.summary, finalMessage: e.finalMessage, items: [e] });
  }
  const visibleGroups = groups
    .map((g) => ({ ...g, items: filter === 'error' ? g.items.filter((i) => !i.ok) : g.items }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="modal-mask" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal logstream-modal">
        <div className="logstream-head">
          <h3 style={{ margin: 0 }}>日志 · {flowName || ''}</h3>
          <div className="logstream-tools">
            <button className={`small${filter === 'all' ? ' primary' : ''}`} onClick={() => setFilter('all')}>全部</button>
            <button className={`small${filter === 'error' ? ' primary' : ''}`} onClick={() => setFilter('error')}>仅错误</button>
            <span className="spacer" />
            <button className="small" onClick={onClose}>关闭</button>
          </div>
        </div>
        <div className="logstream-body" ref={boxRef}>
          {loading && <div className="empty">加载中…</div>}
          {!loading && visibleGroups.length === 0 && <div className="empty">暂无日志</div>}
          {visibleGroups.map((g) => (
            <div key={g.runId + '@' + g.startedAt} className="logstream-group">
              <div className="logstream-run">
                <span className={`badge ${g.status === 'success' ? 'ok' : g.status === 'failed' ? 'fail' : ''}`}>
                  {g.status === 'success' ? '成功' : g.status === 'failed' ? '失败' : '运行中'}
                </span>
                <span className="logstream-time">{fmtClock(g.startedAt)}</span>
                <span className="logstream-count">{g.items.length} 条</span>
                {g.summary && <span className="logstream-summary">摘要：{g.summary}</span>}
                <span className="spacer" />
                <button className="small" onClick={() => toggleDebug(g.runId)}>{debugRun === g.runId ? '收起调试' : '调试'}</button>
              </div>
              {g.items.map((e, i) => (
                <div key={i} className={`logstream-line${e.ok ? '' : ' bad'}`}>
                  <span className="logstream-ts">{fmtClock(e.startedAt).slice(6)}</span>
                  <span className="logstream-node">{e.name}</span>
                  <span className="logstream-msg">{e.message}</span>
                </div>
              ))}
              {debugRun === g.runId && (
                <div className="logstream-debug">
                  {debugData ? (debugData.logs || []).map((l, i) => (
                    <div key={i} className={`logstream-line${l.ok ? '' : ' bad'}`}>
                      <span className="logstream-ts">#{l.index}</span>
                      <span className="logstream-node">{l.name}</span>
                      <span className="logstream-msg">
                        {l.message}
                        {l.detail?.response && ` · HTTP ${l.detail.response.status} ${l.detail.response.ms}ms`}
                      </span>
                      {l.detail?.response?.body && (
                        <pre className="logstream-body-pre">{String(l.detail.response.body).slice(0, 4000)}</pre>
                      )}
                    </div>
                  )) : <div className="empty">加载调试信息…</div>}
                </div>
              )}
            </div>
          ))}
          {hasMore && (
            <div className="logstream-more">
              <button className="small" onClick={loadMore}>加载更早的记录</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

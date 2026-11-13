import React, { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../api.js';
import { fmtDateTime, fmtAgo, isSensitiveName, CHANNEL_LABELS, describeRetryPolicy, describeRetryPolicyDetail } from '../util.js';

/**
 * 任务详情：点任务名打开（对应 qiandao 的「点名字看任务信息」）
 *
 * 分两块：
 *   - 可改：任务名、备注（基础信息）
 *   - 只读：调度、状态、变量、通知渠道、来源模板、流程规模、时间
 * 进画布是另一件事（更多 → 编辑），这里不抢它的入口。
 */
export default function TaskDetailModal({ summary, onClose, onSaved, onToast, onEdit }) {
  const [flow, setFlow] = useState(null);
  const [name, setName] = useState(summary.name || '');
  const [note, setNote] = useState(summary.note || '');
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState({});

  useEffect(() => {
    let alive = true;
    api.flow(summary.id).then((f) => {
      if (!alive) return;
      setFlow(f);
      setName(f.name || '');
      setNote(f.note || '');
    }).catch((e) => onToast?.(e.message, 'fail'));
    return () => { alive = false; };
  }, [summary.id]);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const nf = await api.updateFlow(summary.id, { name: name.trim(), note });
      onSaved?.(nf);
      onToast?.(`已保存「${name.trim()}」`, 'ok');
      onClose();
    } catch (e) {
      onToast?.(e.message, 'fail');
    } finally {
      setBusy(false);
    }
  };

  const vars = Object.entries(flow?.vars || {});
  const channels = flow?.notify?.channels || [];
  const last = summary.lastRun;

  return (
    <Modal
      title="任务详情"
      onClose={onClose}
      width={560}
      footer={
        <>
          <button onClick={() => { onClose(); onEdit?.(summary.id); }} title="打开流程编辑器">编辑流程</button>
          <span className="spacer" />
          <button onClick={onClose}>关闭</button>
          <button className="primary" disabled={busy || !name.trim()} onClick={save}>{busy ? '保存中…' : '保存'}</button>
        </>
      }
    >
      <div className="field">
        <label>任务名</label>
        <input value={name} aria-label="任务名" onChange={(e) => setName(e.target.value)} placeholder="给任务起个好找的名字" />
      </div>
      <div className="field">
        <label title="备注会显示在任务列表里，也能被搜索">备注</label>
        <textarea rows={2} value={note} aria-label="任务备注" onChange={(e) => setNote(e.target.value)} placeholder="例如：账号 A，每天一次" />
      </div>

      <div className="detail-panel">
        <div className="detail-grid">
          <div className="detail-cell">
            <span className="detail-k">调度</span>
            <span className="detail-v">
              {flow?.cron ? <code className="mono cron-code">{flow.cron}</code> : <span className="muted">手动（不定时）</span>}
            </span>
          </div>
          <div className="detail-cell">
            <span className="detail-k">时区</span>
            <span className="detail-v mono">{flow?.timezone || 'Asia/Shanghai'}</span>
          </div>
          <div className="detail-cell">
            <span className="detail-k">状态</span>
            <span className="detail-v">
              <span className={`status-dot${summary.enabled ? ' on' : ''}`} />
              {summary.enabled ? '已启用调度' : '已停用'}
              {flow?.jitterMinutes ? <span className="muted">抖动 {flow.jitterMinutes} 分钟</span> : null}
            </span>
          </div>
          <div className="detail-cell">
            <span className="detail-k">失败重试</span>
            <span className="detail-v">
              <span className={flow?.retry?.enabled ? '' : 'muted'} title={describeRetryPolicyDetail(flow?.retry)}>{describeRetryPolicy(flow?.retry)}</span>
            </span>
          </div>
          <div className="detail-cell">
            <span className="detail-k">下次运行</span>
            <span className="detail-v">{summary.nextRunAt ? fmtDateTime(summary.nextRunAt) : <span className="muted">—</span>}</span>
          </div>
          <div className="detail-cell">
            <span className="detail-k">上次运行</span>
            <span className="detail-v">
              {last ? (
                <>
                  <span className={last.status === 'success' ? 'ok-text' : 'fail-text'}>{last.status === 'success' ? '成功' : '失败'}</span>
                  <span className="muted">{fmtAgo(last.startedAt)}</span>
                </>
              ) : <span className="muted">未运行</span>}
            </span>
          </div>
          <div className="detail-cell">
            <span className="detail-k">流程规模</span>
            <span className="detail-v">
              <span className="meta">
                <span><b>{summary.nodesCount}</b> 步</span>
                <span><b>{flow?.edges?.length || 0}</b> 连线</span>
              </span>
            </span>
          </div>
          <div className="detail-cell">
            <span className="detail-k">通知渠道</span>
            <span className="detail-v">
              {channels.length === 0 ? <span className="muted">未配置</span>
                : channels.map((c) => (
                  <span key={c.type} className="chip chip-mute">{CHANNEL_LABELS[c.type] || c.type}</span>
                ))}
            </span>
          </div>
          <div className="detail-cell">
            <span className="detail-k">来源模板</span>
            <span className="detail-v">
              {summary.template ? (
                <>
                  {summary.template.name}
                  <span className="muted">流程跟随模板</span>
                </>
              ) : <span className="muted">独立任务</span>}
            </span>
          </div>
          <div className="detail-cell">
            <span className="detail-k">创建于</span>
            <span className="detail-v">{flow?.createdAt ? fmtDateTime(flow.createdAt) : '—'}</span>
          </div>
          <div className="detail-cell">
            <span className="detail-k">最后修改</span>
            <span className="detail-v">{flow?.updatedAt ? fmtAgo(flow.updatedAt) : '—'}</span>
          </div>
        </div>

        <div className="detail-section">
          <div className="detail-k">使用的变量</div>
          {vars.length === 0 ? (
            <div className="muted" style={{ fontSize: 12 }}>没有变量（流程里没有 {'{{变量}}'} 占位）</div>
          ) : (
            <div className="var-list">
              {vars.map(([k, v]) => {
                const sensitive = isSensitiveName(k);
                const shown = revealed[k] || !sensitive;
                const empty = v === undefined || v === null || v === '';
                return (
                  <div key={k} className="var-item">
                    <span className="var-name mono">{k}</span>
                    <span className="var-val mono">
                      {empty ? <span className="muted">未填写</span>
                        : shown ? String(v)
                          : <span className="muted">••••••••</span>}
                    </span>
                    {sensitive && !empty && (
                      <button className="small" onClick={() => setRevealed((r) => ({ ...r, [k]: !r[k] }))}>
                        {revealed[k] ? '隐藏' : '显示'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

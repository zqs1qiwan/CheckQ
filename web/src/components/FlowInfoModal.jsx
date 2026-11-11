import React, { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../api.js';

/**
 * 任务信息（基础信息）弹窗：任务名 / 备注 / 模板归属
 *
 * 为什么要有它：点「编辑」会直接进画布（内容编辑），但改名与写备注是「基础信息」，
 * 必须有一个不离开列表就能改的入口 —— 首页任务行「··· → 任务信息…」与编辑器「更多 → 任务信息…」共用本组件。
 *
 * 模板派生任务：显示来源模板；若模板已更新给出「更新到模板版本」按钮。
 */
export default function FlowInfoModal({ flow, template, onClose, onSaved, onToast }) {
  const [name, setName] = useState(flow.name || '');
  const [note, setNote] = useState(flow.note || '');
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    setName(flow.name || '');
    setNote(flow.note || '');
  }, [flow.id, flow.name, flow.note]);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const nf = await api.updateFlow(flow.id, { name: name.trim(), note });
      onSaved?.(nf);
      onToast?.(`已保存「${name.trim()}」`, 'ok');
      onClose();
    } catch (e) {
      onToast?.(e.message, 'fail');
    } finally {
      setBusy(false);
    }
  };

  const syncTemplate = async () => {
    setSyncing(true);
    try {
      await api.syncFlowTemplate(flow.id);
      const nf = await api.flow(flow.id);
      onSaved?.(nf);
      onToast?.('已同步到模板当前版本', 'ok');
      onClose();
    } catch (e) {
      onToast?.(e.message, 'fail');
    } finally {
      setSyncing(false);
    }
  };

  const stale = !!(template && template.stale);

  return (
    <Modal
      title="任务信息"
      onClose={onClose}
      width={480}
      footer={
        <>
          {stale && (
            <button onClick={syncTemplate} disabled={syncing} title="用模板当前的流程图/日志配置覆盖本任务（变量值保留）">
              {syncing ? '同步中…' : '更新到模板版本'}
            </button>
          )}
          <span className="spacer" />
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={busy || !name.trim()} onClick={save}>{busy ? '保存中…' : '保存'}</button>
        </>
      }
    >
      <div className="field">
        <label>任务名</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="给任务起个好找的名字" />
      </div>
      <div className="field">
        <label title="备注会显示在任务列表里，也能被搜索">备注</label>
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：账号 A，每天一次" />
      </div>
      {template && (
        <div className="field">
          <label>来源模板</label>
          <div className="btn-row" style={{ alignItems: 'center' }}>
            <span className={`chip ${stale ? 'chip-write' : 'chip-mute'}`}>{template.name || '(模板已删除)'}</span>
            {stale && <span className="chip chip-write">模板已更新，可一键同步</span>}
            {!stale && template.missing && <span className="chip chip-write">模板已删除</span>}
          </div>
        </div>
      )}
    </Modal>
  );
}

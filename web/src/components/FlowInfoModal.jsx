import React, { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../api.js';

/**
 * 任务信息（基础信息）弹窗：任务名 / 备注 / 来源模板
 *
 * 为什么要有它：点「编辑」会直接进画布（内容编辑），但改名与写备注是「基础信息」，
 * 必须有一个不离开列表就能改的入口 —— 首页任务行「··· → 任务信息…」与编辑器「更多 → 任务信息…」共用本组件。
 *
 * 模板派生任务：显示来源模板；流程始终跟随模板，模板一改这里立刻跟着变。
 */
export default function FlowInfoModal({ flow, template, onClose, onSaved, onToast }) {
  const [name, setName] = useState(flow.name || '');
  const [note, setNote] = useState(flow.note || '');
  const [busy, setBusy] = useState(false);

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

  return (
    <Modal
      title="任务信息"
      onClose={onClose}
      width={480}
      footer={
        <>
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
            <span className="chip chip-mute">{template.name || '(模板已删除)'}</span>
            {template.missing && <span className="chip chip-write">模板已删除，保留最后一份流程</span>}
          </div>
        </div>
      )}
    </Modal>
  );
}

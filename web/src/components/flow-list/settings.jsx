import React, { useEffect, useState } from 'react';
import { api } from '../../api.js';
import Modal from '../Modal.jsx';
import { IconBell, IconSparkle, IconShield, IconUsers, IconKey } from '../Icons.jsx';
import AccountPanel from '../AccountPanel.jsx';
import UsersPanel from '../UsersPanel.jsx';
import ApiKeysPanel from '../ApiKeysPanel.jsx';
import { setToastLevel, getToastLevel } from '../../toast.js';
import { setToast } from './helpers.js';

function SettingsModal({ onClose, initialTab }) {
  const [tab, setTab] = useState(initialTab || 'general');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [me, setMe] = useState(null);
  useEffect(() => {
    api.me().then((r) => setMe(r.authenticated ? r.user : null)).catch(() => {});
  }, []);
  const TABS = [
    { id: 'general', label: '通知与推送', desc: '每日汇总推送与模板', Icon: IconBell },
    { id: 'ai', label: 'AI 助手', desc: '快速组装用的模型', Icon: IconSparkle },
    { id: 'security', label: '账号安全', desc: '密码、两步验证、会话', Icon: IconShield },
    ...(me?.role === 'admin' ? [{ id: 'users', label: '用户管理', desc: '账号与角色', Icon: IconUsers }] : []),
    { id: 'api', label: 'API 密钥', desc: '外部程序接入', Icon: IconKey },
  ];
  const cur = TABS.find((x) => x.id === tab) || TABS[0];
  return (
    <Modal
      title="设置"
      onClose={onClose}
      className="settings-modal"
      bodyClassName="settings-split"
    >
      <nav className="settings-nav">
        {TABS.map((x) => (
          <button
            key={x.id}
            className={`settings-tab${tab === x.id ? ' active' : ''}`}
            onClick={() => { setTab(x.id); setMsg(''); setErr(''); }}
          >
            <x.Icon size={16} />
            <span className="settings-tab-text">
              <b>{x.label}</b>
              <em>{x.desc}</em>
            </span>
          </button>
        ))}
      </nav>
      <div className="settings-panel">
        <div className="settings-page-head">
          <h2>{cur.label}</h2>
          <p>{cur.desc}</p>
        </div>

        {tab === 'general' && <SettingsFlow onToast={(text) => { setMsg(text); setErr(''); }} />}

        {tab === 'ai' && <AiSettings />}

        {tab === 'security' && <AccountPanel onToast={(text) => { setMsg(text); setErr(''); }} />}

        {tab === 'users' && me?.role === 'admin' && <UsersPanel onToast={(text) => { setMsg(text); setErr(''); }} />}

        {tab === 'api' && <ApiKeysPanel onToast={(text) => { setMsg(text); setErr(''); }} />}

        {msg && <p className="settings-msg">{msg}</p>}
        {err && <p className="settings-msg err">{err}</p>}
      </div>
    </Modal>
  );
}

/** 设置内：AI 助手（快速组装 LLM，OpenAI 兼容接口；key 只存服务端） */
function AiSettings() {
  const [cfg, setCfg] = useState({ baseUrl: '', apiKey: '', model: '' });
  const [configured, setConfigured] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    api.aiSettings().then((s) => { setConfigured(s.configured); setCfg({ baseUrl: s.baseUrl, apiKey: s.apiKey, model: s.model }); }).catch(() => {});
  }, []);
  const save = async () => {
    setMsg('');
    try {
      await api.saveAiSettings(cfg);
      const s = await api.aiSettings();
      setConfigured(s.configured); setCfg({ baseUrl: s.baseUrl, apiKey: s.apiKey, model: s.model });
      setMsg('AI 配置已保存');
    } catch (e) { setMsg('保存失败: ' + e.message); }
  };
  return (
    <>
      <div className="field">
        <label title="快速组装用的 LLM，OpenAI 兼容接口">AI 助手（{configured ? '已配置' : '未配置'}）</label>
        <input placeholder="Base URL，例：https://api.deepseek.com/v1" value={cfg.baseUrl} onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })} />
      </div>
      <div className="field-inline">
        <div className="field">
          <label>API Key</label>
          <input type="password" autoComplete="off" placeholder={cfg.apiKey || 'sk-…'} value={cfg.apiKey} onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })} />
        </div>
        <div className="field">
          <label>模型</label>
          <input placeholder="deepseek-chat / gpt-4o-mini" value={cfg.model} onChange={(e) => setCfg({ ...cfg, model: e.target.value })} />
        </div>
      </div>
      <div style={{ color: 'var(--muted)', fontSize: 11, marginBottom: 8, lineHeight: 1.5 }}>
        支持 OpenAI 兼容接口（DeepSeek / OpenAI / Ollama 等）。Key 只存服务端 meta.json，不回显明文。未配置时快速组装走本地规则模式（不耗 API）。
      </div>
      <button className="small" onClick={save}>保存 AI 配置</button>
      {msg && <p style={{ color: msg.startsWith('保存失败') ? 'var(--fail)' : 'var(--ok)', fontSize: 12 }}>{msg}</p>}
    </>
  );
}

/* 设置内：每日总推送（可选）+ 界面提示级别 */
function SettingsFlow({ onToast }) {
  const [cfg, setCfg] = useState({ enabled: false, time: '08:00', timezone: 'Asia/Shanghai', targetFlowIds: [] });
  const [pushable, setPushable] = useState([]);
  const [selectedUnits, setSelectedUnits] = useState([]);
  const [marketUrl, setMarketUrl] = useState('');
  const [level, setLevel] = useState(getToastLevel());
  const [pushing, setPushing] = useState(false);
  useEffect(() => {
    api.dailySummaryConfig().then((c) => {
      setCfg({ ...c, targetFlowIds: c.targetFlowIds || [] });
      setSelectedUnits(c.targetFlowIds || (c.targetFlowId ? [c.targetFlowId] : []));
    }).catch(() => {});
    api.pushTargets().then(setPushable).catch(() => setPushable([]));
  }, []);
  const changeLevel = async (v) => {
    setLevel(v);
    setToastLevel(v);
    try { await api.saveUiSettings({ toastLevel: v }); } catch (e) { onToast(e.message); }
  };
  const pushNow = async () => {
    if (!selectedUnits.length) { onToast('先勾选至少一个推送单位'); return; }
    setPushing(true);
    try {
      const r = await api.pushDailySummary({ flowIds: selectedUnits });
      onToast(`已推送到 ${(r.groups || []).length} 个单位：${r.text || '今日汇总'}`);
    } catch (e) { onToast(e.message); }
    finally { setPushing(false); }
  };
  return (
    <>
      <div className="field">
        <label title="只控制右上角弹出的提示；面板上的「今日汇总」始终是实时数据，打开首页就能看到。">界面提示</label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="radio" name="toast-level" style={{ width: 'auto' }} checked={level === 'error'} onChange={() => changeLevel('error')} />
          仅错误提示（默认，日常最安静）
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="radio" name="toast-level" style={{ width: 'auto' }} checked={level === 'success'} onChange={() => changeLevel('success')} />
          成功 + 错误提示
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="radio" name="toast-level" style={{ width: 'auto' }} checked={level === 'all'} onChange={() => changeLevel('all')} />
          全部提示
        </label>
      </div>
      <div className="field">
        <label title="默认关闭；开启后每天指定时间把今日汇总推送到勾选的任务">每日汇总推送</label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={!!cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} />
          每天 {cfg.time} 把今日汇总推送到下面勾选的任务
        </label>
        <div className="push-units">
          {pushable.length === 0 && <div className="hint">还没有可推送的任务</div>}
          {pushable.map((f) => (
            <label key={f.id} className="push-unit">
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={selectedUnits.includes(f.id)}
                onChange={(e) => setSelectedUnits(e.target.checked ? [...selectedUnits, f.id] : selectedUnits.filter((x) => x !== f.id))}
              />
              <span className="push-unit-name">{f.name}</span>
              {/* 服务端返回的 channels 是类型名字符串数组（历史接口形态），兼容对象形态 */}
              <span className="push-unit-ch">{(f.channels || []).map((c) => { const t = typeof c === 'string' ? c : c.type; return CHANNEL_LABELS[t] || t; }).filter(Boolean).join(' / ')}</span>
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="time" style={{ width: 110 }} value={cfg.time} onChange={(e) => setCfg({ ...cfg, time: e.target.value })} />
          <button className="small" onClick={async () => {
            try {
              const r = await api.saveDailySummaryConfig({ ...cfg, targetFlowIds: selectedUnits });
              setCfg(r);
              onToast(`每日总推送设置已保存（${selectedUnits.length} 个推送单位）`);
            } catch (e) { onToast(e.message); }
          }}>保存</button>
          <button className="small" onClick={pushNow} disabled={pushing || selectedUnits.length === 0}>{pushing ? '推送中…' : '立即推送今日汇总'}</button>
          {selectedUnits.length > 0 && <span style={{ color: 'var(--muted)', fontSize: 11 }}>已选 {selectedUnits.length} 个推送单位</span>}
        </div>
      </div>
      <div className="field">
        <label title="从 URL 导入索引 JSON">模板市场</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="mono" placeholder="https://.../template.json" value={marketUrl} onChange={(e) => setMarketUrl(e.target.value)} />
          <button className="small" onClick={async () => {
            try { await api.templateFromUrl(marketUrl); onToast('模板已导入'); setMarketUrl(''); }
            catch (e) { onToast(e.message); }
          }}>导入</button>
        </div>
      </div>
    </>
  );
}

/** 恢复备份：JSON 文件 → 全部以新 ID 恢复（默认停用，不覆盖现有） */

export default SettingsModal;


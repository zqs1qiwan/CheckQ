import React, { useState } from 'react';
import { api } from '../../api.js';
import Modal from '../Modal.jsx';
import { setToast } from './helpers.js';

/** 自然语言式向导（菜单式）：填站点/事件 → 生成流程骨架（全程不写正则） */
export function buildWizardFlow({ url, method, keyword, eventLabel }) {
  const hostname = (() => {
    try { return new URL(url).hostname; } catch { return '自定义任务'; }
  })();
  const nodes = [
    { id: 'n0', type: 'http', name: `${method} ${hostname}`, x: 80, y: 60, config: { method, url, headers: [{ name: 'user-agent', value: 'Mozilla/5.0', enabled: true }], body: '', asserts: keyword ? [{ res: [keyword], from: 'content' }] : [] } },
    { id: 'n1', type: 'log', name: '记录结果', x: 360, y: 60, config: { text: `${eventLabel}完成：{{last.status}}` } },
  ];
  const edges = [{ id: 'e0', source: 'n0', sourceHandle: 'success', target: 'n1' }];
  return { name: `${hostname} · ${eventLabel}`, nodes, edges, vars: {}, cron: '0 8 * * *', timezone: 'Asia/Shanghai', enabled: false };
}

/** 自然语言解析（对话生成原型）：一句话 → {url, method, keyword, eventLabel} */
export function parseNatural(text) {
  const t = String(text || '');
  const urlM = t.match(/https?:\/\/[^\s"'）)]+/);
  const url = urlM ? urlM[0] : '';
  const method = /\bPOST\b/i.test(t) ? 'POST' : 'GET';
  const kwM = t.match(/看到(.{2,12}?)算?成功/) || t.match(/成功词[是:：](.{2,12})/);
  const keyword = kwM ? kwM[1].replace(/算?成功$/, '').trim() : '';
  const events = ['签到', '抽卡', '库存监控', '信息查询'];
  const eventLabel = events.find((e) => t.includes(e)) || '其他';
  return { url, method, keyword, eventLabel };
}

function WizardModal({ onClose, onCreated }) {
  const [url, setUrl] = useState('https://');
  const [method, setMethod] = useState('GET');
  const [events, setEvents] = useState(['签到', '抽卡', '库存监控', '信息查询', '其他']);
  const [eventLabel, setEventLabel] = useState('签到');
  const [keyword, setKeyword] = useState('');
  const [sentence, setSentence] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiDraft, setAiDraft] = useState(null);
  const [aiErr, setAiErr] = useState('');
  const fillFromSentence = () => {
    if (!sentence.trim()) return;
    const p = parseNatural(sentence);
    if (p.url) setUrl(p.url);
    if (p.method) setMethod(p.method);
    if (p.keyword) setKeyword(p.keyword);
    if (p.eventLabel && events.includes(p.eventLabel)) setEventLabel(p.eventLabel);
  };
  const create = async () => {
    setErr(''); setBusy(true);
    try {
      const payload = buildWizardFlow({ url: url.trim(), method, keyword: keyword.trim(), eventLabel });
      const f = await api.createFlow(payload);
      onCreated(f);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const aiGenerate = async () => {
    setAiErr(''); setAiBusy(true); setAiDraft(null);
    try {
      const { draft } = await api.aiGenerate(sentence.trim());
      setAiDraft(draft);
    } catch (e) { setAiErr(e.message); } finally { setAiBusy(false); }
  };
  const createFromDraft = async () => {
    setAiErr(''); setAiBusy(true);
    try {
      const f = await api.createFlow(aiDraft);
      onCreated(f);
    } catch (e) { setAiErr(e.message); } finally { setAiBusy(false); }
  };
  return (
    <Modal
      title="快速组装"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={busy || !url.trim()} onClick={create}>{busy ? '生成中…' : '生成流程'}</button>
        </>
      }
    >
        <div className="field">
          <label title="用一句话说清「什么时间、去哪个地址、看到什么算成功」">一句话描述</label>
          <input value={sentence} onChange={(e) => setSentence(e.target.value)} placeholder="每天8点去 https://ex.com/sign 签到，看到签到成功算成功" />
          <span className="btn-row" style={{ marginTop: 6 }}>
            <button className="small primary" disabled={aiBusy || !sentence.trim()} onClick={aiGenerate}>{aiBusy ? 'AI 生成中…' : 'AI 生成流程'}</button>
            <button className="small" onClick={fillFromSentence}>规则填充（不耗 API）</button>
          </span>
        </div>
        {aiErr && <p style={{ color: 'var(--fail)', fontSize: 12 }}>{aiErr}</p>}
        {aiDraft && (
          <div className="ai-preview">
            <div style={{ fontWeight: 600, fontSize: 13 }}>{aiDraft.name}</div>
            <div className="meta" style={{ color: 'var(--muted)', fontSize: 12, margin: '4px 0' }}>
              <span><b>{aiDraft.nodes?.length || 0}</b> 个节点</span>
              <span>cron <b>{aiDraft.cron || '—'}</b></span>
              <span>{aiDraft.nodes?.map((n) => n.type)?.join(' → ')}</span>
            </div>
            <span className="btn-row">
              <button className="small primary" disabled={aiBusy} onClick={createFromDraft}>用 AI 结果创建</button>
              <button className="small" onClick={() => setAiDraft(null)}>丢弃</button>
            </span>
          </div>
        )}
        <div style={{ borderTop: '1px solid var(--border)', margin: '12px 0 10px' }} />
        <div className="field">
          <label title="在浏览器打开目标站点，把地址栏里的网址复制过来">请求地址</label>
          <input className="mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/sign" />
        </div>
        <div className="field-inline">
          <div className="field">
            <label>方法</label>
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              {['GET', 'POST'].map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div className="field">
            <label>要做的事</label>
            <select value={eventLabel} onChange={(e) => setEventLabel(e.target.value)}>
              {events.map((x) => <option key={x}>{x}</option>)}
            </select>
          </div>
        </div>
        <div className="field">
          <label title="页面里出现的成功提示文案；留空则只要 HTTP 200 就算成功">看到什么词算成功</label>
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="签到成功" />
        </div>
        {err && <p style={{ color: 'var(--fail)', fontSize: 12 }}>{err}</p>}
    </Modal>
  );
}

export default WizardModal;


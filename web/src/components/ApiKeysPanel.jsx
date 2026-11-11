import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { confirmDialog } from '../confirm.jsx';
import Modal from './Modal.jsx';

const SCOPES = [
  ['read', '只读', '只能查看任务、日志、统计'],
  ['run', '可运行', '可触发任务运行（签到）'],
  ['write', '可修改', '可改变量 / 调度 / 新建任务'],
];

function scopeText(scopes) {
  const s = scopes || [];
  if (s.includes('write')) return '完全权限';
  if (s.includes('run') && s.includes('read')) return '查看 + 运行';
  if (s.includes('run')) return '仅运行';
  return '只读';
}

/** API Key 管理：可命名、可选作用域（给外部 Agent 用）、可吊销 */
export default function ApiKeysPanel({ onToast }) {
  const [keys, setKeys] = useState([]);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState(['read', 'run']);
  const [expiresAt, setExpiresAt] = useState('');
  const [allowedIps, setAllowedIps] = useState('');
  const [editing, setEditing] = useState(null); // { key, ips }
  const [created, setCreated] = useState(null); // { apiKey, key }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = () => api.apiKeys().then((r) => setKeys(r.keys || [])).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const create = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api.createApiKey(name.trim() || 'Agent Key', scopes, expiresAt || null, allowedIps.split(/[\n,;\s]+/).filter(Boolean));
      setCreated(r);
      setName('');
      setAllowedIps('');
      load();
      onToast('API Key 已生成（明文只显示这一次）');
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const revoke = async (k) => {
    const ok = await confirmDialog({ title: '吊销 API Key', message: `吊销「${k.name}」？使用它的外部 Agent 会立即失效。`, confirmText: '吊销', danger: true });
    if (!ok) return;
    try { await api.revokeApiKey(k.id); load(); onToast('已吊销'); }
    catch (e) { onToast(e.message); }
  };

  const toggleScope = (s) => {
    setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  };

  const fmt = (ts) => (ts ? new Date(ts).toLocaleString('zh-CN') : '—');

  return (
    <div className="acc-panel">
      <div className="acc-card">
        <div className="acc-card-head">生成 API Key（给外部 Agent / 脚本用）</div>
        <div className="field"><label>名称</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：签到 Agent" />
        </div>
        <div className="field">
          <label title="只读=只能查看；可运行=能触发任务；可修改=能改变量与调度">权限范围</label>
          {SCOPES.map(([id, label, desc]) => (
            <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={scopes.includes(id)} onChange={() => toggleScope(id)} />
              {label} <span style={{ color: 'var(--muted)', fontSize: 11 }}>{desc}</span>
            </label>
          ))}
        </div>
        <div className="field">
          <label title="到期后该 Key 自动失效并从列表移除">回收日期</label>
          <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </div>
        <div className="field">
          <label title="每行一个 IP 或 CIDR；留空=不限制。来源 IP 取 X-Forwarded-For 优先，其次为连接来源">IP 允许名单</label>
          <textarea className="mono" rows={2} value={allowedIps} onChange={(e) => setAllowedIps(e.target.value)} placeholder={'192.168.1.0/24\n10.0.0.5'} />
        </div>
        <button className="primary" disabled={busy || !scopes.length} onClick={create}>{busy ? '生成中…' : '生成 API Key'}</button>
        {err && <p style={{ color: 'var(--fail)', fontSize: 12 }}>{err}</p>}
      </div>

      {created && (
        <div className="acc-card">
          <div className="acc-card-head" title="明文只显示这一次，服务端只存摘要">新 Key</div>
          <pre className="mono" style={{ wordBreak: 'break-all', fontSize: 12, margin: 0 }}>{created.apiKey}</pre>
          <button className="small" style={{ marginTop: 8 }} onClick={() => { navigator.clipboard?.writeText(created.apiKey); onToast('已复制'); }}>复制</button>
          <div className="hint" style={{ marginTop: 6 }}>
            请求头 <code className="mono">x-api-key: &lt;key&gt;</code>
          </div>
        </div>
      )}

      {editing && (
        <Modal
          title={`IP 允许名单 · ${editing.key.name}`}

          onClose={() => setEditing(null)}
          width={480}
          footer={
            <>
              <button onClick={() => setEditing(null)}>取消</button>
              <button className="primary" onClick={async () => {
                const ips = editing.ips.split(/[\n,;\s]+/).filter(Boolean);
                try {
                  await api.updateApiKey(editing.key.id, { allowedIps: ips });
                  setEditing(null);
                  load();
                  onToast('允许名单已更新');
                } catch (e) { onToast(e.message); }
              }}>保存</button>
            </>
          }
        >
          <div className="field">
            <label title="每行一个 IP 或 CIDR；留空=不限制">允许的 IP / CIDR</label>
            <textarea className="mono" rows={5} value={editing.ips} onChange={(e) => setEditing({ ...editing, ips: e.target.value })} placeholder={'192.168.1.0/24\n10.0.0.5'} />
          </div>

        </Modal>
      )}

      <div className="acc-card">
        <div className="acc-card-head">已生成的 Key（{keys.length}）</div>
        {keys.length === 0 && <div className="hint">还没有 API Key</div>}
        {keys.map((k) => (
          <div key={k.id} className="acc-row">
            <span>
              {k.name} <code className="mono">{k.prefix}…</code>
              <span className="users-uid">
                {' · '}{scopeText(k.scopes)}
                {' · 创建 '}{fmt(k.createdAt)}
                {k.expiresAt ? ` · ${k.expired ? '已过期' : `${k.daysLeft} 天后回收`}（${fmt(k.expiresAt)}）` : ' · 永不过期'}
                {k.allowedIps?.length ? ` · IP 限 ${k.allowedIps.length} 条` : ' · IP 不限'}
                {k.lastUsedAt ? ` · 最近使用 ${fmt(k.lastUsedAt)}` : ''}
              </span>
            </span>
            <span className="acc-row-actions">
              <button className="small" onClick={() => setEditing({ key: k, ips: (k.allowedIps || []).join('\n') })}>允许 IP</button>
              <button className="small danger" onClick={() => revoke(k)}>立即回收</button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

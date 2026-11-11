import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { confirmDialog } from '../confirm.jsx';
import Modal from './Modal.jsx';
import { IconKey, IconCopy } from './Icons.jsx';

const SCOPES = [
  ['read', '只读'],
  ['run', '可运行'],
  ['write', '可修改'],
];

function scopeBadges(scopes) {
  const s = scopes || [];
  if (s.includes('write')) return [{ id: 'write', label: '完全权限' }];
  if (s.includes('run') && s.includes('read')) return [{ id: 'run', label: '查看 + 运行' }];
  if (s.includes('run')) return [{ id: 'run', label: '仅运行' }];
  return [{ id: 'read', label: '只读' }];
}

const fmt = (ts) => (ts ? new Date(ts).toLocaleString('zh-CN') : '—');

/** API 密钥管理（GitHub token 风格）：一行一个密钥，右侧 ⋯ 菜单 */
export default function ApiKeysPanel({ onToast }) {
  const [keys, setKeys] = useState([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState(['read', 'run']);
  const [expiresAt, setExpiresAt] = useState('');
  const [allowedIps, setAllowedIps] = useState('');
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  const [menuFor, setMenuFor] = useState(null);

  const load = () => api.apiKeys().then((r) => setKeys(r.keys || [])).catch(() => setKeys([]));
  useEffect(() => { load(); }, []);

  const create = async () => {
    setBusy(true);
    try {
      const r = await api.createApiKey(
        name.trim() || 'API 密钥',
        scopes,
        expiresAt || null,
        allowedIps.split(/[\n,;\s]+/).filter(Boolean),
      );
      setCreated(r);
      setCreating(false);
      setName(''); setAllowedIps(''); setExpiresAt('');
      load();
    } catch (e) { onToast(e.message); } finally { setBusy(false); }
  };

  const revoke = async (k) => {
    setMenuFor(null);
    const ok = await confirmDialog({ title: '回收密钥', message: `回收「${k.name}」？使用它的程序会立即失效。`, confirmText: '回收', danger: true });
    if (!ok) return;
    try { await api.revokeApiKey(k.id); load(); onToast('已回收'); }
    catch (e) { onToast(e.message); }
  };

  const toggleScope = (s) => setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  return (
    <div className="keys-panel">
      <div className="page-head-row">
        <div>
          <h3 className="section-title">API 密钥</h3>
          <p className="section-desc">用于调用 REST API 与 MCP。明文只在生成时显示一次。</p>
        </div>
        <button className="primary" onClick={() => setCreating(true)}>生成新密钥</button>
      </div>

      {created && (
        <div className="key-reveal">
          <div className="key-reveal-head">
            <strong>密钥已生成</strong>
            <span>仅显示这一次</span>
          </div>
          <div className="key-reveal-body">
            <code className="mono">{created.apiKey}</code>
            <button
              className="small"
              onClick={() => { navigator.clipboard?.writeText(created.apiKey); onToast('已复制'); }}
            ><IconCopy size={13} /> 复制</button>
          </div>
          <div className="key-reveal-foot">
            请求头 <code className="mono">x-api-key: {created.apiKey.slice(0, 12)}…</code>
            <button className="small" onClick={() => setCreated(null)}>完成</button>
          </div>
        </div>
      )}

      {keys.length === 0 ? (
        <div className="empty">还没有 API 密钥</div>
      ) : (
        <div className="key-list">
          {keys.map((k) => (
            <div key={k.id} className="key-row">
              <span className="key-icon"><IconKey size={16} /></span>
              <div className="key-main">
                <div className="key-title">
                  <b>{k.name}</b>
                  {scopeBadges(k.scopes).map((s) => <span key={s.id} className={`chip chip-${s.id}`}>{s.label}</span>)}
                  {k.allowedIps?.length ? <span className="chip chip-mute">IP 限 {k.allowedIps.length}</span> : null}
                  {k.expiresSoon ? <span className="chip chip-write">即将到期</span> : null}
                </div>
                <div className="key-meta">
                  <code className="mono">{k.prefix}…</code>
                  <span>创建 {fmt(k.createdAt)}</span>
                  <span>{k.expiresAt ? (k.expired ? '已过期' : `${k.daysLeft} 天后回收`) : '永不过期'}</span>
                  <span>{k.lastUsedAt ? `最近使用 ${fmt(k.lastUsedAt)}` : '未使用'}</span>
                  <span>{k.useCount ? `调用 ${k.useCount} 次` : ''}</span>
                  {k.lastUsedIp ? <span>来源 {k.lastUsedIp}</span> : null}
                </div>
              </div>
              <div className="key-ops">
                <button className="small" onClick={() => { setMenuFor(menuFor === k.id ? null : k.id); }}>⋯</button>
                {menuFor === k.id && (
                  <div className="key-menu">
                    <button onClick={() => { setEditing({ key: k, ips: (k.allowedIps || []).join('\n') }); setMenuFor(null); }}>允许 IP</button>
                    <button onClick={() => { setMenuFor(null); onToast('请删除后重新生成'); }}>重新生成</button>
                    <button className="danger-text" onClick={() => revoke(k)}>立即回收</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && (
        <Modal
          title="生成 API 密钥"
          onClose={() => setCreating(false)}
          width={480}
          footer={
            <>
              <button onClick={() => setCreating(false)}>取消</button>
              <button className="primary" disabled={busy || !scopes.length} onClick={create}>{busy ? '生成中…' : '生成'}</button>
            </>
          }
        >
          <div className="field">
            <label>名称</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：签到 Agent" autoFocus />
          </div>
          <div className="field">
            <label title="只读=只能查看；可运行=能触发任务；可修改=能改变量与调度">权限范围</label>
            <div className="chip-picker">
              {SCOPES.map(([id, label]) => (
                <label key={id} className={`chip-toggle${scopes.includes(id) ? ' on' : ''}`}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={scopes.includes(id)} onChange={() => toggleScope(id)} />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div className="field">
            <label title="到期后该密钥自动失效并从列表移除">回收日期</label>
            <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </div>
          <div className="field">
            <label title="每行一个 IP 或 CIDR；留空=不限制。来源 IP 取 X-Forwarded-For 优先，其次为连接来源">IP 允许名单</label>
            <textarea className="mono" rows={2} value={allowedIps} onChange={(e) => setAllowedIps(e.target.value)} placeholder={'192.168.1.0/24'} />
          </div>
        </Modal>
      )}

      {editing && (
        <Modal
          title={`允许 IP · ${editing.key.name}`}
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
                  onToast('已更新');
                } catch (e) { onToast(e.message); }
              }}>保存</button>
            </>
          }
        >
          <div className="field">
            <label title="每行一个 IP 或 CIDR；留空=不限制">允许的 IP / CIDR</label>
            <textarea className="mono" rows={5} value={editing.ips} onChange={(e) => setEditing({ ...editing, ips: e.target.value })} placeholder={'192.168.1.0/24'} />
          </div>
        </Modal>
      )}
    </div>
  );
}

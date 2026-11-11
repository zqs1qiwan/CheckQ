import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { confirmDialog } from '../confirm.jsx';

const ROLE_LABEL = { admin: '管理员', operator: '操作员', viewer: '只读' };

/** 用户管理（仅管理员）：账号 CRUD + 角色 + 停用 + 重置密码/2FA + 审计 */
export default function UsersPanel({ onToast }) {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState(['admin', 'operator', 'viewer']);
  const [audit, setAudit] = useState([]);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ username: '', displayName: '', password: '', role: 'operator' });
  const [busy, setBusy] = useState(false);
  const [resetFor, setResetFor] = useState(null);
  const [resetPw, setResetPw] = useState('');

  const load = () => {
    api.users()
      .then((r) => { setUsers(r.users || []); setRoles(r.roles || roles); })
      .catch((e) => setErr(e.message));
    api.auditLog(50).then((r) => setAudit(r.entries || [])).catch(() => {});
  };
  useEffect(load, []);

  const create = async () => {
    setBusy(true); setErr('');
    try {
      await api.createUser({ username: form.username.trim(), displayName: form.displayName.trim() || undefined, password: form.password, role: form.role });
      setForm({ username: '', displayName: '', password: '', role: 'operator' });
      load();
      onToast('账号已创建');
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const patch = async (u, p) => {
    try { await api.updateUser(u.id, p); load(); onToast('已更新'); }
    catch (e) { onToast(e.message); }
  };

  const remove = async (u) => {
    const ok = await confirmDialog({ title: '删除账号', message: `删除账号「${u.username}」？该用户的会话会立即失效。`, confirmText: '删除', danger: true });
    if (!ok) return;
    try { await api.deleteUser(u.id); load(); onToast('账号已删除'); }
    catch (e) { onToast(e.message); }
  };

  const doResetPassword = async () => {
    try {
      await api.resetUserPassword(resetFor.id, resetPw);
      setResetFor(null); setResetPw('');
      load();
      onToast('密码已重置');
    } catch (e) { onToast(e.message); }
  };

  const reset2fa = async (u) => {
    const ok = await confirmDialog({ title: '重置两步验证', message: `重置「${u.username}」的两步验证？该用户需要重新绑定。`, confirmText: '重置', danger: true });
    if (!ok) return;
    try { await api.resetUser2fa(u.id); load(); onToast('已重置两步验证'); }
    catch (e) { onToast(e.message); }
  };

  const fmt = (ts) => (ts ? new Date(ts).toLocaleString('zh-CN') : '—');

  return (
    <div className="users-panel">
      <div className="acc-card">
        <div className="acc-card-head">新建账号</div>
        <div className="field-inline">
          <div className="field"><label title="3-32 位字母数字">用户名</label>
            <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="字母数字，3-32 位" />
          </div>
          <div className="field"><label>显示名（可选）</label>
            <input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          </div>
        </div>
        <div className="field-inline">
          <div className="field"><label title="至少 10 位，含两类字符">初始密码</label>
            <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          <div className="field"><label>角色</label>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r] || r}</option>)}
            </select>
          </div>
        </div>
        <button className="primary" disabled={busy || !form.username || !form.password} onClick={create}>创建账号</button>
        {err && <p style={{ color: 'var(--fail)', fontSize: 12 }}>{err}</p>}
      </div>

      <div className="acc-card">
        <div className="acc-card-head">账号列表（{users.length}）</div>
        <div className="users-table">
          <div className="users-row users-head">
            <span>用户</span><span>角色</span><span>状态</span><span>2FA</span><span>最后登录</span><span>操作</span>
          </div>
          {users.map((u) => (
            <div key={u.id} className="users-row">
              <span className="users-name">
                <b>{u.displayName}</b>
                <span className="users-uid">{u.username}</span>
              </span>
              <span>
                <select value={u.role} onChange={(e) => patch(u, { role: e.target.value })} disabled={u.disabled}>
                  {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r] || r}</option>)}
                </select>
              </span>
              <span>{u.disabled ? <span className="badge fail">已停用</span> : <span className="badge ok">启用</span>}</span>
              <span>{u.totpEnabled ? <span className="badge ok">已开</span> : <span className="badge muted">未开</span>}</span>
              <span className="users-time">{fmt(u.lastLoginAt)}</span>
              <span className="users-ops">
                <button className="small" onClick={() => { setResetFor(u); setResetPw(''); }}>重置密码</button>
                {u.totpEnabled && <button className="small" onClick={() => reset2fa(u)}>重置2FA</button>}
                <button className="small" onClick={() => patch(u, { disabled: !u.disabled })}>{u.disabled ? '启用' : '停用'}</button>
                <button className="small danger" onClick={() => remove(u)}>删除</button>
              </span>
            </div>
          ))}
        </div>
      </div>

      {resetFor && (
        <div className="acc-card">
          <div className="acc-card-head">重置「{resetFor.username}」的密码</div>
          <div className="field"><label title="至少 10 位，含两类字符">新密码</label>
            <input type="password" value={resetPw} onChange={(e) => setResetPw(e.target.value)} />
          </div>
          <div className="btn-row">
            <button className="primary" onClick={doResetPassword}>确认重置</button>
            <button onClick={() => setResetFor(null)}>取消</button>
          </div>
        </div>
      )}

      <div className="acc-card">
        <div className="acc-card-head">审计日志（最近 {audit.length} 条）</div>
        <div className="audit-list">
          {audit.map((a, i) => (
            <div key={i} className="audit-row">
              <span className="audit-time">{fmt(a.at)}</span>
              <span className="audit-action">{a.action}</span>
              <span className="audit-detail">{a.detail}</span>
              <span className="audit-actor">{a.actor || '—'}</span>
            </div>
          ))}
          {audit.length === 0 && <div className="hint">暂无记录</div>}
        </div>
      </div>
    </div>
  );
}

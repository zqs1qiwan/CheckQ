import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

/** 账号安全：修改密码 + 两步验证(TOTP) + 我的会话 */
export default function AccountPanel({ onToast }) {
  const [me, setMe] = useState(null);
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  const [pwErr, setPwErr] = useState('');

  // 2FA
  const [totpPassword, setTotpPassword] = useState('');
  const [enroll, setEnroll] = useState(null); // { secret, uri }
  const [totpCode, setTotpCode] = useState('');
  const [recovery, setRecovery] = useState(null);
  const [totpErr, setTotpErr] = useState('');

  // 用户名 / 显示名
  const [newName, setNewName] = useState('');
  const [newDisplay, setNewDisplay] = useState('');
  const [namePw, setNamePw] = useState('');
  const [nameMsg, setNameMsg] = useState('');
  const [nameErr, setNameErr] = useState('');

  // 会话
  const [sessions, setSessions] = useState([]);

  // IP 黑名单（访问控制）
  const [blocked, setBlocked] = useState([]);
  const [newIp, setNewIp] = useState('');
  const loadBlocked = () => api.ipBlocklist().then((r) => setBlocked(r.ips || [])).catch(() => setBlocked([]));

  const loadMe = () => api.me().then((r) => setMe(r.authenticated ? r : null)).catch(() => setMe(null));
  const loadSessions = () => api.sessions().then((r) => setSessions(r.sessions || [])).catch(() => setSessions([]));

  useEffect(() => { loadMe(); loadSessions(); loadBlocked(); }, []);

  const changePassword = async () => {
    setPwMsg(''); setPwErr('');
    if (newPw.length < 10) { setPwErr('新密码至少 10 位'); return; }
    if (newPw !== newPw2) { setPwErr('两次输入的新密码不一致'); return; }
    try {
      await api.changePassword(oldPw, newPw);
      setPwMsg('密码已修改，其它设备的会话已失效');
      setOldPw(''); setNewPw(''); setNewPw2('');
      loadSessions();
    } catch (e) { setPwErr(e.message); }
  };

  const changeAccount = async () => {
    setNameMsg(''); setNameErr('');
    try {
      const r = await api.updateAccount({
        username: newName.trim() || undefined,
        displayName: newDisplay.trim() || undefined,
        currentPassword: namePw,
      });
      if (r.reauth) {
        setNameMsg('用户名已修改，所有设备需重新登录');
        setTimeout(() => window.location.reload(), 1200);
        return;
      }
      setNameMsg('已更新');
      setNewName(''); setNewDisplay(''); setNamePw('');
      loadMe();
    } catch (e) { setNameErr(e.message); }
  };

  const startEnroll = async () => {
    setTotpErr('');
    try {
      const r = await api.twofaEnroll(totpPassword);
      setEnroll(r);
    } catch (e) { setTotpErr(e.message); }
  };
  const confirmEnroll = async () => {
    setTotpErr('');
    try {
      const r = await api.twofaConfirm(totpCode);
      setRecovery(r.recoveryCodes || []);
      setEnroll(null); setTotpCode(''); setTotpPassword('');
      loadMe();
      onToast('两步验证已启用');
    } catch (e) { setTotpErr(e.message); }
  };
  const disable2fa = async () => {
    setTotpErr('');
    try {
      await api.twofaDisable(totpPassword, totpCode);
      setEnroll(null); setRecovery(null); setTotpCode(''); setTotpPassword('');
      loadMe();
      onToast('两步验证已关闭');
    } catch (e) { setTotpErr(e.message); }
  };
  const regenCodes = async () => {
    setTotpErr('');
    try {
      const r = await api.twofaRecoveryCodes(totpPassword, totpCode);
      setRecovery(r.recoveryCodes || []);
      setTotpCode(''); setTotpPassword('');
      onToast('恢复码已重新生成');
    } catch (e) { setTotpErr(e.message); }
  };

  const revoke = async (id) => {
    try { await api.revokeSession(id); loadSessions(); onToast('会话已吊销'); }
    catch (e) { onToast(e.message); }
  };
  const logoutAll = async () => {
    try { await api.logoutAll(); loadSessions(); onToast('已退出所有设备'); }
    catch (e) { onToast(e.message); }
  };

  const fmt = (ts) => (ts ? new Date(ts).toLocaleString('zh-CN') : '—');

  return (
    <div className="acc-panel">
      {me && (
        <div className="acc-card">
          <div className="acc-card-head">我的账号</div>
          <div className="acc-row"><span>用户名</span><b>{me.user.username}</b></div>
          <div className="acc-row"><span>显示名</span><b>{me.user.displayName}</b></div>
          <div className="acc-row"><span>角色</span><b>{me.user.role === 'admin' ? '管理员' : me.user.role === 'operator' ? '操作员' : '只读'}</b></div>
          <div className="acc-row"><span>两步验证</span><b>{me.user.totpEnabled ? `已启用（恢复码剩 ${me.user.recoveryCodesLeft} 个）` : '未启用'}</b></div>
          <div className="acc-row"><span>最后登录</span><b>{fmt(me.user.lastLoginAt)}</b></div>
        </div>
      )}

      {me && (
        <div className="acc-card">
          <div className="acc-card-head">修改用户名 / 显示名</div>
          <div className="field"><label title="3-32 位字母数字。修改后其它设备会登出，需用新用户名重新登录">新用户名</label>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={me.user.username} autoComplete="username" />
          </div>
          <div className="field"><label title="面板里展示的名字，可选">显示名</label>
            <input value={newDisplay} onChange={(e) => setNewDisplay(e.target.value)} placeholder={me.user.displayName} />
          </div>
          <div className="field"><label>当前密码（确认身份）</label>
            <input type="password" value={namePw} onChange={(e) => setNamePw(e.target.value)} autoComplete="current-password" />
          </div>
          <button className="primary" onClick={changeAccount} disabled={!namePw || (!newName.trim() && !newDisplay.trim())}>保存</button>
          {nameMsg && <p style={{ color: 'var(--ok)', fontSize: 12 }}>{nameMsg}</p>}
          {nameErr && <p style={{ color: 'var(--fail)', fontSize: 12 }}>{nameErr}</p>}
        </div>
      )}

      <div className="acc-card">
        <div className="acc-card-head">修改密码</div>
        <div className="field"><label>当前密码</label>
          <input type="password" autoComplete="current-password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
        </div>
        <div className="field"><label title="至少 10 位，含大小写字母 / 数字 / 符号中的两类；修改后其它设备的会话立即失效">新密码</label>
          <input type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
        </div>
        <div className="field"><label>再输入一次</label>
          <input type="password" autoComplete="new-password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} />
        </div>
        <button className="primary" onClick={changePassword}>修改密码</button>
        {pwMsg && <p style={{ color: 'var(--ok)', fontSize: 12 }}>{pwMsg}</p>}
        {pwErr && <p style={{ color: 'var(--fail)', fontSize: 12 }}>{pwErr}</p>}
      </div>

      <div className="acc-card">
        <div className="acc-card-head" title="用 Google Authenticator / Authy / Aegis 等验证器 App 绑定，绑定后登录需要 6 位动态码">两步验证（TOTP）</div>
        {!enroll && (
          <>
            {me?.user.totpEnabled ? (
              <>
                <div className="field"><label title="用于确认身份">账号密码</label>
                  <input type="password" value={totpPassword} onChange={(e) => setTotpPassword(e.target.value)} />
                </div>
                <div className="field"><label>当前动态码</label>
                  <input value={totpCode} onChange={(e) => setTotpCode(e.target.value)} placeholder="6 位数字" inputMode="numeric" />
                </div>
                <div className="btn-row">
                  <button className="small" onClick={regenCodes}>重新生成恢复码</button>
                  <button className="small danger" onClick={disable2fa}>关闭两步验证</button>
                </div>
              </>
            ) : (
              <>
                <div className="field"><label title="用于确认身份">账号密码</label>
                  <input type="password" value={totpPassword} onChange={(e) => setTotpPassword(e.target.value)} />
                </div>
                <button className="small primary" onClick={startEnroll}>开始绑定</button>
              </>
            )}
          </>
        )}
        {enroll && (
          <>
            <div className="field"><label title="Base32 格式的密钥">密钥</label>
              <input className="mono" readOnly value={enroll.secret} onFocus={(e) => e.target.select()} />
            </div>
            <div className="field"><label title="可被验证器 App 直接导入">otpauth 链接</label>
              <input className="mono" readOnly value={enroll.uri} onFocus={(e) => e.target.select()} />
            </div>
            <div className="field"><label>验证码</label>
              <input value={totpCode} onChange={(e) => setTotpCode(e.target.value)} inputMode="numeric" />
            </div>
            <div className="btn-row">
              <button className="small primary" onClick={confirmEnroll}>确认绑定</button>
              <button className="small" onClick={() => { setEnroll(null); setTotpCode(''); }}>取消</button>
            </div>
          </>
        )}
        {recovery && (
          <div className="acc-recovery">
            <div className="acc-card-head" title="每个恢复码只能用一次；丢失验证器时可用它登录">恢复码（只显示这一次）</div>
            <div className="acc-codes">{recovery.map((c) => <code key={c}>{c}</code>)}</div>
          </div>
        )}
        {totpErr && <p style={{ color: 'var(--fail)', fontSize: 12 }}>{totpErr}</p>}
      </div>

      <div className="acc-card">
        <div className="acc-card-head" title="列入黑名单的 IP 无法登录，也无法使用任何 API Key">访问控制（IP 黑名单）</div>
        <div className="field-inline">
          <div className="field">
            <label title="支持 CIDR，如 192.168.1.0/24">新增黑名单 IP</label>
            <input className="mono" value={newIp} onChange={(e) => setNewIp(e.target.value)} placeholder="192.168.9.9" />
          </div>
          <div className="field" style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button className="small" onClick={async () => {
              if (!newIp.trim()) return;
              try { const r = await api.blockIp(newIp.trim()); setBlocked(r.ips || []); setNewIp(''); onToast('已加入黑名单'); }
              catch (e) { onToast(e.message); }
            }}>加入黑名单</button>
          </div>
        </div>
        {blocked.length === 0 ? <div className="hint">暂无黑名单</div> : blocked.map((ip) => (
          <div key={ip} className="acc-row">
            <span className="mono">{ip}</span>
            <span className="acc-row-actions">
              <button className="small danger" onClick={async () => {
                try { const r = await api.unblockIp(ip); setBlocked(r.ips || []); onToast('已移出黑名单'); }
                catch (e) { onToast(e.message); }
              }}>移出</button>
            </span>
          </div>
        ))}
      </div>

      <div className="acc-card">
        <div className="acc-card-head">我的会话</div>
        {sessions.length === 0 && <div className="hint">暂无其它会话</div>}
        {sessions.map((s) => (
          <div key={s.id} className="acc-row">
            <span className="meta">
              <span>{s.current ? '当前设备' : '其它设备'}</span>
              <span className="mono">{s.ip}</span>
              <span>{fmt(s.lastSeenAt)}</span>
            </span>
            <span className="acc-row-actions">
              {s.current ? <b>当前</b> : <button className="small danger" onClick={() => revoke(s.id)}>吊销</button>}
            </span>
          </div>
        ))}
        <button className="small danger" style={{ marginTop: 8 }} onClick={logoutAll}>退出所有设备</button>
      </div>
    </div>
  );
}

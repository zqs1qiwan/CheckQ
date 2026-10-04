import React, { useState } from 'react';
import { api } from '../api.js';

export default function Login({ onOk }) {
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api.login(password);
      onOk();
    } catch (e2) {
      setErr(e2.message.includes('密码') || e2.message.includes('未登录') ? e2.message : '登录失败，请检查密码');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1>Check<em style={{ color: 'var(--accent)' }}>Q</em></h1>
        <p className="sub">可视化 HTTP 自动化流程引擎</p>
        <input
          type="password"
          placeholder="访问密码"
          value={password}
          autoFocus
          onChange={(e) => setPassword(e.target.value)}
        />
        <button className="primary" disabled={busy || !password}>{busy ? '验证中…' : '进入'}</button>
        <div className="login-err">{err}</div>
      </form>
    </div>
  );
}

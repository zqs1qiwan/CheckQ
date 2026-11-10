import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Login({ onOk }) {
  const [mode, setMode] = useState('loading'); // loading | setup | login
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.bootstrap().then((r) => setMode(r.needsSetup ? 'setup' : 'login')).catch(() => setMode('login'));
  }, []);

  const submitLogin = async (e) => {
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

  const submitSetup = async (e) => {
    e.preventDefault();
    setErr('');
    if (password.length < 8) { setErr('密码至少 8 位'); return; }
    if (password !== confirm) { setErr('两次输入的密码不一致'); return; }
    setBusy(true);
    try {
      await api.setupPassword(password);
      onOk();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'loading') {
    return <div className="login-wrap"><div className="login-card"><p className="sub">正在加载…</p></div></div>;
  }

  if (mode === 'setup') {
    return (
      <div className="login-wrap">
        <form className="login-card" onSubmit={submitSetup}>
          <h1>Check<em style={{ color: 'var(--accent)' }}>Q</em></h1>
          <p className="sub">首次启动 · 创建管理员账号</p>
          <input type="password" placeholder="设置登录密码（至少 8 位）" value={password} autoFocus onChange={(e) => setPassword(e.target.value)} />
          <input type="password" placeholder="再输入一次" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          <button className="primary" disabled={busy || !password}>{busy ? '创建中…' : '创建并进入'}</button>
          <div className="login-err">{err}</div>
          <p className="login-hint">密码只保存在本机数据目录的 meta.json（scrypt 哈希）；API 调用请用「设置 → API Key」。</p>
        </form>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submitLogin}>
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

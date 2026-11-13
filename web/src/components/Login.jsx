import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Login({ onOk }) {
  const [mode, setMode] = useState('loading'); // loading | setup | login
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [needCode, setNeedCode] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.bootstrap()
      .then((r) => {
        setMode(r.needsSetup ? 'setup' : 'login');
        if (r.username) setUsername(r.username);
      })
      .catch(() => setMode('login'));
  }, []);

  const submitLogin = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api.login(username.trim() || undefined, password, code.trim() || undefined);
      onOk();
    } catch (e2) {
      const msg = e2.message || '登录失败';
      if (e2.needTotp || msg.includes('两步')) {
        setNeedCode(true);
        setErr('该账号已启用两步验证，请输入验证码或恢复码');
      } else if (msg.includes('锁定')) {
        setErr(msg);
      } else {
        setErr(msg.includes('未登录') ? '用户名或密码错误' : msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const submitSetup = async (e) => {
    e.preventDefault();
    setErr('');
    if (username.trim().length < 3) { setErr('用户名至少 3 位'); return; }
    if (password.length < 10) { setErr('密码至少 10 位'); return; }
    if (password !== confirm) { setErr('两次输入的密码不一致'); return; }
    setBusy(true);
    try {
      await api.setupAccount(username.trim(), password);
      await api.login(username.trim(), password);
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
          <div className="login-brand">
            <span className="logo-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12.5l5 5L20 6.5" /></svg>
            </span>
            <h1>Check<em>Q</em></h1>
          </div>
          <p className="sub">首次启动，创建管理员账号</p>
          <input placeholder="用户名（字母数字，3-32 位）" aria-label="用户名" name="username" autoComplete="username" value={username} autoFocus onChange={(e) => setUsername(e.target.value)} />
          <input type="password" placeholder="登录密码（至少 10 位，含两类字符）" aria-label="登录密码" name="new-password" autoComplete="new-password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
          <input type="password" placeholder="再输入一次" aria-label="确认密码" name="confirm-password" autoComplete="new-password" minLength={10} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          <button className="primary" disabled={busy || !username || !password}>{busy ? '创建中…' : '创建并进入'}</button>
          <div className="login-err" role="alert" aria-live="polite">{err}</div>
        </form>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submitLogin}>
        <div className="login-brand">
          <span className="logo-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12.5l5 5L20 6.5" /></svg>
          </span>
          <h1>Check<em>Q</em></h1>
        </div>
        <input
          placeholder="用户名"
          aria-label="用户名"
          name="username"
          value={username}
          autoFocus={!needCode}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
        />
        <input
          type="password"
          placeholder="密码"
          aria-label="密码"
          name="password"
          value={password}
          autoFocus={needCode}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        {needCode && (
          <input
            placeholder="验证码或恢复码"
            aria-label="验证码或恢复码"
            name="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
          />
        )}
        <button className="primary" disabled={busy || !password}>{busy ? '验证中…' : '进入'}</button>
        <div className="login-err" role="alert" aria-live="polite">{err}</div>
      </form>
    </div>
  );
}

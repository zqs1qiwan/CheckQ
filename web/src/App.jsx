import React, { useEffect, useState } from 'react';
import { api, set401Handler } from './api.js';
import Login from './components/Login.jsx';
import FlowList from './components/FlowList.jsx';
import FlowEditor from './components/FlowEditor.jsx';
import GlobalToast from './components/GlobalToast.jsx';
import { ConfirmHost } from './confirm.jsx';
import { setToastLevel } from './toast.js';

export default function App() {
  const [view, setView] = useState('loading');
  const [flowId, setFlowId] = useState(null);

  useEffect(() => {
    set401Handler(() => setView('login'));
    // 先问「我是谁」：/api/me 是公开端点，未登录也返回 200，
    // 直接拉 /api/flows 会在登录页产生一堆 401 报错（控制台噪音）。
    api.me()
      .then((r) => {
        if (!r.authenticated) { setView('login'); return; }
        api.flows().then(() => setView('list')).catch(() => setView('login'));
        // 提示级别（服务端为准，失败则用本地缓存）
        api.uiSettings().then((s) => setToastLevel(s.toastLevel)).catch(() => {});
      })
      .catch(() => setView('login'));
  }, []);

  return (
    <>
      {view === 'loading' && <div className="boot">CheckQ</div>}
      {view === 'login' && <Login onOk={() => { setView('list'); api.uiSettings().then((s) => setToastLevel(s.toastLevel)).catch(() => {}); }} />}
      {view === 'list' && (
        <FlowList
          onOpen={(id) => { setFlowId(id); setView('editor'); }}
          onLogout={async () => { try { await api.logout(); } catch {} setView('login'); }}
        />
      )}
      {view === 'editor' && (
        <FlowEditor flowId={flowId} onBack={() => setView('list')} />
      )}
      <GlobalToast />
      <ConfirmHost />
    </>
  );
}

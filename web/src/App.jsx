import React, { useEffect, useState } from 'react';
import { api, set401Handler } from './api.js';
import Login from './components/Login.jsx';
import FlowList from './components/FlowList.jsx';
import FlowEditor from './components/FlowEditor.jsx';

export default function App() {
  const [view, setView] = useState('loading');
  const [flowId, setFlowId] = useState(null);

  useEffect(() => {
    set401Handler(() => setView('login'));
    api.flows().then(() => setView('list')).catch(() => setView('login'));
  }, []);

  if (view === 'loading') return <div className="boot">CheckQ</div>;
  if (view === 'login') return <Login onOk={() => setView('list')} />;
  if (view === 'list') {
    return (
      <FlowList
        onOpen={(id) => { setFlowId(id); setView('editor'); }}
        onLogout={async () => { try { await api.logout(); } catch {} setView('login'); }}
      />
    );
  }
  if (view === 'editor') {
    return <FlowEditor flowId={flowId} onBack={() => setView('list')} />;
  }
  return null;
}

import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import ThemeToggle from './ThemeToggle.jsx';
import LogStream from './LogStream.jsx';
import Modal from './Modal.jsx';
import Dropdown from './Dropdown.jsx';
import TaskDetailModal from './TaskDetailModal.jsx';
import { IconBell, IconGear, IconGlobe } from './Icons.jsx';
import { confirmDialog } from '../confirm.jsx';
import { ROLE_LABELS } from '../util.js';
import { getTheme, setTheme } from '../theme.js';
import { fmtTime, setToast } from './flow-list/helpers.js';
import WizardModal, { buildWizardFlow, parseNatural } from './flow-list/wizard.jsx';
import SettingsModal from './flow-list/settings.jsx';
import { InstantiateModal, CurlImportModal, CsvImportModal, NotificationsModal, RestoreModal, TemplateEditorModal, BackupFullModal, GroupAssignModal } from './flow-list/modals.jsx';

export { buildWizardFlow, parseNatural };

export default function FlowList({ onOpen, onLogout }) {
  const [flows, setFlows] = useState(null);
  const [templates, setTemplates] = useState(null);
  const [modal, setModal] = useState(null); // 'new' | 'import' | 'template-editor' | {type:'instantiate', tpl} | {type:'result', run}
  const [importBusy, setImportBusy] = useState(false);
  const [running, setRunning] = useState(null); // flowId -> 'running'
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all'); // all | scheduled | recent-failed
  const [stats, setStats] = useState(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [viewTab, setViewTab] = useState('flows'); // 首页大 tab：任务 / 模板
  const [marketUrl, setMarketUrl] = useState('');
  const [unread, setUnread] = useState(0);
  const [me, setMe] = useState(null);
  const [, setThemeTick] = useState(0); // 移动端「切换主题」后强制重渲染菜单文案
  const [selected, setSelected] = useState(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchMode, setBatchMode] = useState(false); // 批量管理开关：勾选列默认隐藏，不干扰日常阅读
  const [collapsedGroups, setCollapsedGroups] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('checkq-group-collapsed') || '[]')); } catch { return new Set(); }
  });
  const fileRef = useRef();
  const editTemplateRef = useRef(); // 模板编辑页回调刷新

  // 首次按「大分组默认收起」初始化：≥8 个任务的分组（含未分组）先收起，用户操作后以 localStorage 为准
  useEffect(() => {
    if (!flows) return;
    try {
      if (localStorage.getItem('checkq-group-collapsed') !== null) return;
      const count = new Map();
      for (const f of flows) { const g = f.group || '未分组'; count.set(g, (count.get(g) || 0) + 1); }
      const big = [...count.entries()].filter(([, n]) => n >= 8).map(([g]) => g);
      setCollapsedGroups(new Set(big));
      localStorage.setItem('checkq-group-collapsed', JSON.stringify(big));
    } catch { /* 隐私模式忽略 */ }
  }, [flows]);

  const load = () => {
    api.flows().then(setFlows).catch((e) => setToast({ kind: 'fail', text: e.message }));
    api.templates().then(setTemplates).catch(() => setTemplates([]));
    api.stats().then(setStats).catch(() => setStats(null));
    setSelected(new Set());
  };

  useEffect(() => { load(); }, []);

  // 当前登录身份（用户名 / 角色）
  useEffect(() => {
    api.me().then((r) => setMe(r.authenticated ? r.user : null)).catch(() => {});
  }, []);

  // 站内通知未读数（30s 轮询，失败静默）
  useEffect(() => {
    let alive = true;
    const tick = () => api.notifications(1).then((r) => { if (alive) setUnread(r.unread || 0); }).catch(() => {});
    tick();
    const timer = setInterval(tick, 30000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  // 搜索 + 筛选（PRD 4.4）+ 分组名参与搜索
  const visibleFlows = (flows || []).filter((f) => {
    if (search) {
      const q = search.toLowerCase();
      if (!f.name.toLowerCase().includes(q) && !(f.note || '').toLowerCase().includes(q) && !(f.group || '').toLowerCase().includes(q)) return false;
    }
    if (filter === 'scheduled' && !f.enabled) return false;
    if (filter === 'recent-failed' && f.lastRun?.status !== 'failed') return false;
    return true;
  });

  // 分组：按组名聚合；「未分组」永远排在最后；组内保持列表原顺序
  const groupMap = new Map();
  for (const f of visibleFlows) {
    const g = f.group || '未分组';
    if (!groupMap.has(g)) groupMap.set(g, []);
    groupMap.get(g).push(f);
  }
  const groups = [...groupMap.entries()]
    .sort((a, b) => (a[0] === '未分组' ? 1 : b[0] === '未分组' ? -1 : a[0].localeCompare(b[0], 'zh')));
  const groupOptions = [...new Set((flows || []).map((f) => f.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh'));
  // 搜索/筛选时强制展开，否则用户搜到的任务藏在收起的分组里
  const effectiveCollapsed = (search || filter !== 'all') ? new Set() : collapsedGroups;
  const allCollapsed = groups.length > 0 && groups.every(([name]) => effectiveCollapsed.has(name));
  const anyCollapsed = groups.some(([name]) => effectiveCollapsed.has(name));

  const persistCollapsed = (set) => {
    setCollapsedGroups(set);
    try { localStorage.setItem('checkq-group-collapsed', JSON.stringify([...set])); } catch { /* ignore */ }
  };
  const toggleGroup = (name) => persistCollapsed(
    effectiveCollapsed.has(name) ? new Set([...effectiveCollapsed].filter((x) => x !== name)) : new Set([...effectiveCollapsed, name]),
  );
  const toggleAllGroups = () => persistCollapsed(anyCollapsed ? new Set() : new Set(groups.map(([name]) => name)));

  const groupStats = (items) => {
    let enabled = 0, runs = 0, success = 0, failed = 0, next = null;
    for (const f of items) {
      if (f.enabled) enabled++;
      runs += f.today?.runs || 0;
      success += f.today?.success || 0;
      failed += f.today?.failed || 0;
      if (f.enabled && f.nextRunAt && (!next || f.nextRunAt < next)) next = f.nextRunAt;
    }
    return { enabled, runs, success, failed, rate: runs ? Math.round((success / runs) * 100) : null, next };
  };

  const createEmpty = async () => {
    try {
      const f = await api.createFlow({
        name: '新任务',
        nodes: [
          { id: 'n0', type: 'http', name: '请求', x: 80, y: 60, config: { method: 'GET', url: 'https://', headers: [{ name: 'user-agent', value: 'Mozilla/5.0', enabled: true }], body: '', asserts: [] } },
          { id: 'n1', type: 'log', name: '记录结果', x: 360, y: 60, config: { text: '状态 {{last.status}}' } },
        ],
        edges: [{ id: 'e0', source: 'n0', sourceHandle: 'success', target: 'n1' }],
        vars: {}, cron: '', enabled: false,
      });
      onOpen(f.id);
    } catch (e) {
      setToast({ kind: 'fail', text: `创建失败: ${e.message}` });
    }
  };

  const doImport = async (file) => {
    setImportBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { flow } = await api.importHar(fd);
      const created = await api.createFlow(flow);
      onOpen(created.id);
    } catch (e) {
      setToast({ kind: 'fail', text: `导入失败: ${e.message}` });
    } finally {
      setImportBusy(false);
      setModal(null);
    }
  };

  const toggle = async (f) => {
    await api.updateFlow(f.id, { enabled: !f.enabled });
    load();
  };

  const toggleSelect = (id) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const selectedAll = visibleFlows.length > 0 && visibleFlows.every((f) => selected.has(f.id));
  const toggleSelectAll = () => setSelected(selectedAll ? new Set() : new Set(visibleFlows.map((f) => f.id)));

  const doBatch = async (action) => {
    const ids = [...selected];
    if (!ids.length) return;
    if (action === 'delete' && !(await confirmDialog({ title: '删除任务', message: `删除选中的 ${ids.length} 个任务？不可恢复`, confirmText: '删除', danger: true }))) return;
    setBatchBusy(true);
    try {
      const r = await api.batch(ids, action);
      const label = { run: '运行', enable: '启用', disable: '停用', delete: '删除' }[action] || action;
      setToast({ kind: r.failed ? 'fail' : 'ok', text: `批量${label}：成功 ${r.ok} / 失败 ${r.failed}` });
      if (action === 'run') {
        const first = r.results.find((x) => x.runId);
        if (first) {
          const target = flows.find((f) => f.id === first.id);
          setModal({ type: 'logstream', flowId: first.id, flowName: target?.name || '', refresh: Date.now() });
        }
      }
      load();
    } catch (e) {
      setToast({ kind: 'fail', text: `批量操作失败: ${e.message}` });
    } finally {
      setBatchBusy(false);
    }
  };

  const del = async (f) => {
    if (!(await confirmDialog({ title: '删除任务', message: `删除任务「${f.name}」？不可恢复`, confirmText: '删除', danger: true }))) return;
    await api.deleteFlow(f.id);
    load();
  };

  const runNow = async (f) => {
    setRunning(f.id);
    try {
      const run = await api.runFlow(f.id);
      load();
      // 统一日志入口：运行完直接看连续日志流（最新一次在最下面）
      setModal({ type: 'logstream', flowId: f.id, flowName: f.name, refresh: Date.now() });
      if (run && run.status !== 'success') setToast({ kind: 'fail', text: `运行失败：${run.finalMessage || '执行出错'}` });
    } catch (e) {
      setToast({ kind: 'fail', text: `运行失败: ${e.message}` });
    } finally {
      setRunning(null);
    }
  };

  const openLog = async (f) => {
    // 打开连续日志流（多次运行滚动在一起）
    setModal({ type: 'logstream', flowId: f.id, flowName: f.name });
  };

  const lastStatus = (f) => {
    if (!f.lastRun) return <span className="badge muted">未运行</span>;
    const ok = f.lastRun.status === 'success';
    return (
      <button className={`badge ${ok ? 'ok' : 'fail'} badge-btn`}
        title="点击查看运行日志"
        onClick={() => setModal({ type: 'logstream', flowId: f.id, flowName: f.name, refresh: Date.now() })}>
        {ok ? '成功' : '失败'} <span className="badge-time">{fmtTime(f.lastRun.startedAt)}</span>
      </button>
    );
  };

  if (flows === null) return <div className="boot">加载中…</div>;

  return (
    <>
      <a className="skip-link" href="#main">跳到主要内容</a>
      <header className="topbar">
        <span className="logo" aria-label="CheckQ">
          <span className="logo-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12.5l5 5L20 6.5" />
            </svg>
          </span>
          {'Check'}<em>Q</em>
        </span>
        <span className="spacer" />
        <button className="primary new-task-btn" aria-label="新建任务" title="新建任务" onClick={() => setModal('new')}>
          <span className="btn-label">+ 新建任务</span>
        </button>
        <Dropdown
          trigger={<span className="dd-label">更多</span>}
          caret
          triggerClass="dd-menu"
          width={210}
          ariaLabel="更多操作"
        >
          <button onClick={() => setModal('wizard')}>快速组装</button>
          <button onClick={() => setModal('curl')} disabled={importBusy}>导入 cURL 命令</button>
          <button onClick={() => setModal('import')} disabled={importBusy}>导入 HAR / JSON</button>
          <div className="menu-sep mobile-only" />
          {/* 窄屏：顶栏只保留「新建 / 更多 / 设置」，其余动作收进这里，避免按钮被挤到换行 */}
          <button className="mobile-only" onClick={() => {
            const order = ['light', 'dark', 'auto'];
            setTheme(order[(order.indexOf(getTheme()) + 1) % order.length]);
            setThemeTick((v) => v + 1);
          }}>切换主题（日 / 夜 / 自动）</button>
          <button className="mobile-only" onClick={() => setNotifOpen(true)}>站内通知{unread > 0 ? `（${unread > 99 ? '99+' : unread}）` : ''}</button>
          <button className="mobile-only" onClick={() => window.open('https://zqs1qiwan.github.io/checkq/', '_blank', 'noopener')}>文档中心</button>
          <div className="menu-user mobile-only">
            {me ? (() => {
              const roleLabel = ROLE_LABELS[me.role] || me.role;
              const name = me.displayName || me.username;
              return name === roleLabel ? name : `${name} · ${roleLabel}`;
            })() : ''}
          </div>
          <div className="menu-sep" />
          <button onClick={onLogout}>退出登录</button>
        </Dropdown>
        {me && (() => {
          const roleLabel = ROLE_LABELS[me.role] || me.role;
          const name = me.displayName || me.username;
          // 显示名与角色同名时不要重复「管理员 管理员」
          const showRole = name !== roleLabel;
          return (
            <span className="who-chip" title={`登录身份：${me.username}（${roleLabel}）${me.totpEnabled ? ' · 两步验证已启用' : ''}`}>
              {name}
              {showRole ? <em>{roleLabel}</em> : null}
            </span>
          );
        })()}
        <span className="topbar-actions">
          <ThemeToggle />
          <button className="iconbtn bell-btn" onClick={() => setNotifOpen(true)} title="站内通知" aria-label="站内通知">
            <IconBell size={16} />{unread > 0 && <span className="bell-dot">{unread > 99 ? '99+' : unread}</span>}
          </button>
          <a className="iconbtn" href="https://zqs1qiwan.github.io/checkq/" target="_blank" rel="noreferrer" title="文档中心" aria-label="文档中心"><IconGlobe size={16} /></a>
        </span>
        <button className="iconbtn settings-btn" onClick={() => setModal('settings')} title="设置" aria-label="设置"><IconGear size={16} /></button>
        <input
          ref={fileRef} type="file" accept=".har,.json" style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files[0]; if (f) doImport(f); e.target.value = ''; }}
        />
      </header>

      <main className="page" id="main">
        {stats && (
          <div className="status-rail">
            <span className="meta">
              <span>任务 <b>{stats.flows}</b></span>
              <span>调度中 <b>{stats.enabledScheduled}</b></span>
              <span>模板 <b>{stats.templates}</b></span>
            </span>
            <span className="meta">
              <span>今日 <b>{stats.todayRuns}</b> 次</span>
              <span>成功 <b>{stats.todaySuccess}</b></span>
              <span className={stats.todayFailed ? 'fail-n' : ''}>失败 <b className={stats.todayFailed ? 'fail-n' : ''}>{stats.todayFailed}</b></span>
              {stats.successRate !== null ? <span>成功率 <b>{stats.successRate}%</b></span> : null}
            </span>
            {stats.queuedFlows?.length ? <span className="badge warn">排队中 {stats.queuedFlows.length}</span> : null}
            {stats.dailySummary?.enabled ? <span className="badge ok">每日汇总 {stats.dailySummary.time}</span> : null}
            {stats.nextRunAt ? (
              <span className="next-run" title={`下一次自动运行：${stats.nextFlowName || '未知任务'}（所有已启用任务中最近的一次）`}>
                下次调度 <b>{fmtTime(stats.nextRunAt)}</b>
                {stats.nextFlowName ? <span className="muted">{stats.nextFlowName}</span> : null}
              </span>
            ) : <span className="next-run muted">暂无调度</span>}
          </div>
        )}
        <div className="big-tabs">
          <button className={viewTab === 'flows' ? 'on' : ''} onClick={() => setViewTab('flows')}>任务 <em>{flows?.length ?? 0}</em></button>
          <button className={viewTab === 'tpls' ? 'on' : ''} onClick={() => setViewTab('tpls')}>模板 <em>{templates?.length ?? 0}</em></button>
        </div>

        {viewTab === 'tpls' && (
        <>
        {templates && templates.length > 0 ? (
          <div className="tpl-grid">
            {templates.map((t) => (
              <div key={t.id} className="tpl-card">
                <div className="tpl-name">{t.name}</div>
                <div className="tpl-desc">{t.desc || '—'}</div>
                <div className="tpl-meta">
                  <span className="meta">
                    <span><b>{t.nodesCount}</b> 步</span>
                    <span><b>{t.varNames.length}</b> 个变量</span>
                    <span>已建 <b>{t.taskCount}</b> 个任务</span>
                  </span>
                </div>
                <div className="tpl-actions">
                  <button className="small primary" onClick={() => setModal({ type: 'instantiate', tpl: t })}>+ 创建任务</button>
                  <Dropdown trigger="···" triggerClass="dd-row" align="right" width={170} ariaLabel="模板更多操作">
                    <button onClick={() => setModal({ type: 'csv', tpl: t })}>批量创建</button>
                    <button onClick={() => setModal({ type: 'template-editor', tpl: t })}>管理模板</button>
                    <button onClick={async () => {
                      try {
                        const data = await api.exportTemplate(t.id);
                        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                        const a = document.createElement('a');
                        a.href = URL.createObjectURL(blob);
                        a.download = `${t.name.replace(/[\\/:*?"<>|]/g, '_')}.json`;
                        a.click();
                        URL.revokeObjectURL(a.href);
                      } catch (e) {
                        setToast({ kind: 'fail', text: `导出失败: ${e.message}` });
                      }
                    }}>导出 JSON</button>
                    <button className="danger-text" onClick={async () => {
                      if (!(await confirmDialog({ title: '删除模板', message: `删除模板「${t.name}」？已创建的任务不受影响。`, confirmText: '删除', danger: true }))) return;
                      await api.deleteTemplate(t.id);
                      load();
                    }}>删除模板</button>
                  </Dropdown>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="tpl-empty">
            还没有模板。先建一个任务调试好，点「存为模板」，或导入模板 JSON。
          </div>
        )}

        <div className="page-head" style={{ marginTop: 20 }}>
          <h2>模板市场</h2>
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>从 JSON 索引地址导入一批模板</span>
        </div>
        <div className="field-inline" style={{ maxWidth: 560 }}>
          <div className="field" style={{ flex: '1 1 auto' }}>
            <label>索引地址</label>
            <input className="mono" placeholder="https://example.com/templates.json" value={marketUrl} onChange={(e) => setMarketUrl(e.target.value)} />
          </div>
          <div className="field" style={{ flex: '0 0 auto', display: 'flex', alignItems: 'flex-end' }}>
            <button className="small" onClick={async () => {
              try { await api.templateFromUrl(marketUrl); setMarketUrl(''); load(); setToast({ kind: 'ok', text: '模板已导入' }); }
              catch (e) { setToast({ kind: 'fail', text: e.message }); }
            }}>导入</button>
          </div>
        </div>
        </>
        )}

        {viewTab === 'flows' && (
        <>
        <div className="page-head" style={{ marginTop: 8 }}>
          <div className="toolbar-left">
          {selected.size > 0 && (
            <span className="btn-row">
              <span style={{ fontSize: 12, color: 'var(--accent)', whiteSpace: 'nowrap' }}>已选 {selected.size}</span>
              <button className="small primary" disabled={batchBusy} onClick={() => doBatch('run')}>批量运行</button>
              <button className="small" disabled={batchBusy} onClick={() => doBatch('enable')}>启用</button>
              <button className="small" disabled={batchBusy} onClick={() => doBatch('disable')}>停用</button>
              <button className="small danger" disabled={batchBusy} onClick={() => doBatch('delete')}>删除</button>
              <button className="small" disabled={batchBusy} onClick={() => setModal({ type: 'group', ids: [...selected] })} title="把选中的任务放进同一个分组">分组…</button>
              <button className="small" onClick={() => setSelected(new Set())}>取消</button>
            </span>
          )}
          <button className={`small ${batchMode ? 'primary' : ''}`} title={batchMode ? '退出批量模式' : '进入批量模式：可勾选多个任务一起操作'} onClick={() => { setBatchMode((v) => !v); setSelected(new Set()); }}>
            {batchMode ? '退出批量' : '批量管理'}
          </button>
          <input
            className="toolbar-search"
            placeholder="搜索名称、备注或分组"
            aria-label="搜索任务名称、备注或分组"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="toolbar-select"
            aria-label="按状态筛选任务"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">全部</option>
            <option value="scheduled">已启用调度</option>
            <option value="recent-failed">最近失败</option>
          </select>
          {groups.length > 0 && (
            <button
              className="small"
              onClick={toggleAllGroups}
              title={anyCollapsed ? '展开所有分组' : '折叠所有分组'}
              aria-label={anyCollapsed ? '展开所有分组' : '折叠所有分组'}
            >{anyCollapsed ? '展开全部' : '折叠全部'}</button>
          )}
          </div>
          <span className="spacer" />
          <div className="toolbar-right">
          <button className="small" title="下载脱敏备份（cookie/token 等凭据已清空，适合分享与存档）" onClick={async () => {
            try {
              const data = await api.backup();
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = `checkq-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
              a.click();
              URL.revokeObjectURL(a.href);
              setToast({ kind: 'ok', text: '备份已下载（凭据已脱敏）' });
            } catch (e) { setToast({ kind: 'fail', text: e.message }); }
          }}>备份</button>
          <button className="small" title="完整备份（含明文凭据，需输入当前密码）" onClick={() => setModal('backup-full')}>完整备份</button>
          <button className="small" onClick={() => setModal('restore')}>恢复</button>
          </div>
        </div>

        {visibleFlows.length === 0 ? (
          <div className="empty">
            <p>{(search || filter !== 'all') ? '没有匹配的任务。' : '还没有任务。从上方模板创建，或「+ 新建任务」从零开始搭建。'}</p>
          </div>
        ) : (
          <div className="table-scroll" role="region" aria-label="任务列表" tabIndex={0}>
            <table className="flow-table">
              <caption className="sr-only">任务列表：名称、调度、下次运行、状态、上次运行与操作</caption>
              <thead>
                <tr>
                  {batchMode && <th scope="col" style={{ width: 36 }}><input type="checkbox" checked={selectedAll} onChange={toggleSelectAll} title="全选" aria-label="全选任务" /></th>}
                  <th scope="col">名称</th><th scope="col">调度</th><th scope="col" className="col-next">下次运行</th><th scope="col">状态</th><th scope="col" className="col-last">上次运行</th><th scope="col" style={{ minWidth: 150 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(([gname, items]) => {
                  const st = groupStats(items);
                  const isCollapsed = effectiveCollapsed.has(gname);
                  return (
                    <React.Fragment key={gname}>
                      <tr className="group-row" data-group={gname} data-collapsed={isCollapsed ? '1' : '0'}>
                        <td colSpan={batchMode ? 7 : 6}>
                          <div className="group-head">
                            <button className="group-toggle" onClick={() => toggleGroup(gname)} aria-expanded={!isCollapsed}>
                              <span className="group-chevron" aria-hidden="true">{isCollapsed ? '▸' : '▾'}</span>
                              <span className="group-name">{gname}</span>
                            </button>
                            <span className="meta group-meta">
                              <span>任务 <b>{items.length}</b></span>
                              <span>启用 <b>{st.enabled}</b></span>
                              <span>今日 成功 <b>{st.success}</b> / 失败 <b className={st.failed ? 'fail-n' : ''}>{st.failed}</b></span>
                              {st.rate !== null ? <span>成功率 <b>{st.rate}%</b></span> : <span className="muted">今日未运行</span>}
                              {st.next ? <span className="next-run">下次 <b>{fmtTime(st.next)}</b></span> : null}
                            </span>
                            <span className="spacer" />
                            <button className="small group-collapse" onClick={(e) => { e.stopPropagation(); toggleGroup(gname); }}>{isCollapsed ? '展开' : '折叠'}</button>
                          </div>
                        </td>
                      </tr>
                      {!isCollapsed && items.map((f) => (
                        <tr key={f.id}>
                          {batchMode && <td><input type="checkbox" checked={selected.has(f.id)} onChange={() => toggleSelect(f.id)} /></td>}
                          <td>
                            <button className="flow-name" onClick={() => setModal({ type: 'detail', flow: f })} title="查看任务详情（备注、调度、变量）">{f.name}</button>
                            {f.note ? <div className="flow-note">{f.note}</div> : null}
                            {f.template && (
                              <div className="tpl-tag" title={`来自模板「${f.template.name}」：流程始终跟随模板，模板一改这里立刻跟着变`}>
                                <span className="chip chip-mute">模板</span>
                                <span className="tpl-tag-name">{f.template.name}</span>
                              </div>
                            )}
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {f.cron ? <span className="cron-code">{f.cron}</span> : <span style={{ color: 'var(--muted)' }}>手动</span>}
                          </td>
                          <td className="col-next">
                            {f.nextRunAt ? <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{fmtTime(f.nextRunAt)}</span> : <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>}
                          </td>
                          <td style={{ whiteSpace: 'nowrap', fontSize: 12, color: f.enabled ? 'var(--ok)' : 'var(--muted)' }}>
                            <span className={`status-dot${f.enabled ? ' on' : ''}`} />{f.enabled ? '已启用' : '已停用'}
                          </td>
                          <td className="col-last">{lastStatus(f)}</td>
                          <td>
                            <div className="cell-actions">
                              <button className="small row-run" disabled={running === f.id} title={running === f.id ? '正在运行…' : '立即运行一次'}
                                onClick={() => runNow(f)}>{running === f.id ? '运行中' : '运行'}</button>
                              <button className="small" title="查看运行日志（每天的签到记录都在这里）" onClick={() => openLog(f)}>日志</button>
                              <Dropdown trigger="···" triggerClass="dd-row" align="right" width={170} ariaLabel="任务更多操作">
                                <button onClick={() => onOpen(f.id)}>编辑流程</button>
                                <button onClick={async () => {
                                  try {
                                    await api.cloneFlow(f.id);
                                    setToast({ kind: 'ok', text: '已克隆为副本（调度暂停）' });
                                    load();
                                  } catch (e) {
                                    setToast({ kind: 'fail', text: e.message });
                                  }
                                }}>复制副本</button>
                                <button onClick={() => toggle(f)}>{f.enabled ? '停用调度' : '启用调度'}</button>
                                <button className="danger-text" onClick={() => del(f)}>删除</button>
                              </Dropdown>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        </>
        )}
      </main>

      {modal === 'wizard' && (
        <WizardModal onClose={() => setModal(null)} onCreated={(f) => { setModal(null); onOpen(f.id); setToast({ kind: 'ok', text: '流程已生成，去运行试试，再点「点选生成逻辑」补变量' }); }} />
      )}

      {modal === 'new' && (
        <Modal
          title="新建空白任务"
              onClose={() => setModal(null)}
          footer={
            <>
              <button onClick={() => setModal(null)}>取消</button>
              <button className="primary" onClick={createEmpty}>创建</button>
            </>
          }
        />
      )}

      {modal === 'curl' && (
        <CurlImportModal onClose={() => setModal(null)} onCreated={(f) => { setModal(null); onOpen(f.id); }} />
      )}

      {modal === 'import' && (
        <Modal
          title="导入"
              onClose={() => setModal(null)}
          footer={
            <>
              <button onClick={() => setModal(null)}>取消</button>
              <button className="primary" onClick={() => fileRef.current?.click()}>选择文件</button>
            </>
          }
        />
      )}

      {modal?.type === 'csv' && (
        <CsvImportModal tpl={modal.tpl} onClose={() => setModal(null)} onDone={(n) => { setModal(null); setToast({ kind: 'ok', text: `已创建 ${n} 个任务` }); load(); }} />
      )}

      {modal?.type === 'instantiate' && (
        <InstantiateModal tpl={modal.tpl} onClose={() => setModal(null)} onCreated={(f) => { setModal(null); onOpen(f.id); }} />
      )}

      {modal?.type === 'logstream' && (
        <LogStream key={modal.refresh || modal.flowId} flowId={modal.flowId} flowName={modal.flowName} onClose={() => setModal(null)} />
      )}

      {modal?.type === 'template-editor' && (
        <TemplateEditorModal tpl={modal.tpl} onDone={() => { setModal(null); load(); }} />
      )}

      {modal?.type === 'detail' && (
        <TaskDetailModal
          summary={modal.flow}
          onClose={() => setModal(null)}
          onSaved={() => load()}
          onToast={(text, kind) => setToast({ kind, text })}
          onEdit={(id) => { setModal(null); onOpen(id); }}
          groupOptions={groupOptions}
        />
      )}

      {modal === 'backup-full' && <BackupFullModal onClose={() => setModal(null)} />}

      {modal === 'restore' && (
        <RestoreModal onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />
      )}

      {modal?.type === 'group' && (
        <GroupAssignModal
          ids={modal.ids || []}
          groups={groupOptions}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); setSelected(new Set()); load(); }}
        />
      )}

      {modal === 'settings' && (
        <SettingsModal onClose={() => setModal(null)} />
      )}

      {modal === 'settings-api' && (
        <SettingsModal onClose={() => setModal(null)} initialTab="api" />
      )}

      {notifOpen && (
        <NotificationsModal onClose={() => { setNotifOpen(false); api.notifications(1).then((r) => setUnread(r.unread || 0)).catch(() => {}); }} />
      )}

    </>
  );
}

/** 从模板创建任务：填任务名 + 覆盖变量 */

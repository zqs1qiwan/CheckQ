import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import ThemeToggle from './ThemeToggle.jsx';
import LogStream from './LogStream.jsx';
import Modal from './Modal.jsx';
import Dropdown from './Dropdown.jsx';
import FlowInfoModal from './FlowInfoModal.jsx';
import { IconBell, IconBook, IconKey, IconUsers, IconShield, IconSparkle, IconGear, IconGlobe } from './Icons.jsx';
import { confirmDialog } from '../confirm.jsx';
import AccountPanel from './AccountPanel.jsx';
import UsersPanel from './UsersPanel.jsx';
import ApiKeysPanel from './ApiKeysPanel.jsx';
import { toast as globalToast, setToastLevel, getToastLevel } from '../toast.js';

function fmtTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 统一走全局提示总线（受「设置 → 提示级别」控制） */
function setToast({ kind, text }) {
  globalToast(text, kind === 'fail' ? 'fail' : kind === 'ok' ? 'ok' : 'info');
}

/** 自然语言式向导（菜单式）：填站点/事件 → 生成流程骨架（全程不写正则） */
export function buildWizardFlow({ url, method, keyword, eventLabel }) {
  const hostname = (() => {
    try { return new URL(url).hostname; } catch { return '自定义任务'; }
  })();
  const nodes = [
    { id: 'n0', type: 'http', name: `${method} ${hostname}`, x: 80, y: 60, config: { method, url, headers: [{ name: 'user-agent', value: 'Mozilla/5.0', enabled: true }], body: '', asserts: keyword ? [{ res: [keyword], from: 'content' }] : [] } },
    { id: 'n1', type: 'log', name: '记录结果', x: 360, y: 60, config: { text: `${eventLabel}完成：{{last.status}}` } },
  ];
  const edges = [{ id: 'e0', source: 'n0', sourceHandle: 'success', target: 'n1' }];
  return { name: `${hostname} · ${eventLabel}`, nodes, edges, vars: {}, cron: '0 8 * * *', timezone: 'Asia/Shanghai', enabled: false };
}

/** 自然语言解析（对话生成原型）：一句话 → {url, method, keyword, eventLabel} */
export function parseNatural(text) {
  const t = String(text || '');
  const urlM = t.match(/https?:\/\/[^\s"'）)]+/);
  const url = urlM ? urlM[0] : '';
  const method = /\bPOST\b/i.test(t) ? 'POST' : 'GET';
  const kwM = t.match(/看到(.{2,12}?)算?成功/) || t.match(/成功词[是:：](.{2,12})/);
  const keyword = kwM ? kwM[1].replace(/算?成功$/, '').trim() : '';
  const events = ['签到', '抽卡', '库存监控', '信息查询'];
  const eventLabel = events.find((e) => t.includes(e)) || '其他';
  return { url, method, keyword, eventLabel };
}

function WizardModal({ onClose, onCreated }) {
  const [url, setUrl] = useState('https://');
  const [method, setMethod] = useState('GET');
  const [events, setEvents] = useState(['签到', '抽卡', '库存监控', '信息查询', '其他']);
  const [eventLabel, setEventLabel] = useState('签到');
  const [keyword, setKeyword] = useState('');
  const [sentence, setSentence] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiDraft, setAiDraft] = useState(null);
  const [aiErr, setAiErr] = useState('');
  const fillFromSentence = () => {
    if (!sentence.trim()) return;
    const p = parseNatural(sentence);
    if (p.url) setUrl(p.url);
    if (p.method) setMethod(p.method);
    if (p.keyword) setKeyword(p.keyword);
    if (p.eventLabel && events.includes(p.eventLabel)) setEventLabel(p.eventLabel);
  };
  const create = async () => {
    setErr(''); setBusy(true);
    try {
      const payload = buildWizardFlow({ url: url.trim(), method, keyword: keyword.trim(), eventLabel });
      const f = await api.createFlow(payload);
      onCreated(f);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const aiGenerate = async () => {
    setAiErr(''); setAiBusy(true); setAiDraft(null);
    try {
      const { draft } = await api.aiGenerate(sentence.trim());
      setAiDraft(draft);
    } catch (e) { setAiErr(e.message); } finally { setAiBusy(false); }
  };
  const createFromDraft = async () => {
    setAiErr(''); setAiBusy(true);
    try {
      const f = await api.createFlow(aiDraft);
      onCreated(f);
    } catch (e) { setAiErr(e.message); } finally { setAiBusy(false); }
  };
  return (
    <Modal
      title="快速组装"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={busy || !url.trim()} onClick={create}>{busy ? '生成中…' : '生成流程'}</button>
        </>
      }
    >
        <div className="field">
          <label title="用一句话说清「什么时间、去哪个地址、看到什么算成功」">一句话描述</label>
          <input value={sentence} onChange={(e) => setSentence(e.target.value)} placeholder="每天8点去 https://ex.com/sign 签到，看到签到成功算成功" />
          <span className="btn-row" style={{ marginTop: 6 }}>
            <button className="small primary" disabled={aiBusy || !sentence.trim()} onClick={aiGenerate}>{aiBusy ? 'AI 生成中…' : 'AI 生成流程'}</button>
            <button className="small" onClick={fillFromSentence}>规则填充（不耗 API）</button>
          </span>
        </div>
        {aiErr && <p style={{ color: 'var(--fail)', fontSize: 12 }}>{aiErr}</p>}
        {aiDraft && (
          <div className="ai-preview">
            <div style={{ fontWeight: 600, fontSize: 13 }}>{aiDraft.name}</div>
            <div style={{ color: 'var(--muted)', fontSize: 12, margin: '4px 0' }}>
              {aiDraft.nodes?.length || 0} 个节点 · cron {aiDraft.cron || '—'} · {aiDraft.nodes?.map((n) => n.type)?.join(' → ')}
            </div>
            <span className="btn-row">
              <button className="small primary" disabled={aiBusy} onClick={createFromDraft}>用 AI 结果创建</button>
              <button className="small" onClick={() => setAiDraft(null)}>丢弃</button>
            </span>
          </div>
        )}
        <div style={{ borderTop: '1px solid var(--border)', margin: '12px 0 10px' }} />
        <div className="field">
          <label title="在浏览器打开目标站点，把地址栏里的网址复制过来">请求地址</label>
          <input className="mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/sign" />
        </div>
        <div className="field-inline">
          <div className="field">
            <label>方法</label>
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              {['GET', 'POST'].map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div className="field">
            <label>要做的事</label>
            <select value={eventLabel} onChange={(e) => setEventLabel(e.target.value)}>
              {events.map((x) => <option key={x}>{x}</option>)}
            </select>
          </div>
        </div>
        <div className="field">
          <label title="页面里出现的成功提示文案；留空则只要 HTTP 200 就算成功">看到什么词算成功</label>
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="签到成功" />
        </div>
        {err && <p style={{ color: 'var(--fail)', fontSize: 12 }}>{err}</p>}
    </Modal>
  );
}

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
  const [selected, setSelected] = useState(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchMode, setBatchMode] = useState(false); // 批量管理开关：勾选列默认隐藏，不干扰日常阅读
  const fileRef = useRef();
  const editTemplateRef = useRef(); // 模板编辑页回调刷新

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

  // 搜索 + 筛选（PRD 4.4）
  const visibleFlows = (flows || []).filter((f) => {
    if (search) {
      const q = search.toLowerCase();
      if (!f.name.toLowerCase().includes(q) && !(f.note || '').toLowerCase().includes(q)) return false;
    }
    if (filter === 'scheduled' && !f.enabled) return false;
    if (filter === 'recent-failed' && f.lastRun?.status !== 'failed') return false;
    return true;
  });

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
    if (action === 'sync-template' && !(await confirmDialog({
      title: '更新到模板版本',
      message: `把选中的 ${ids.length} 个任务同步到各自模板的当前版本？流程图与日志配置会被模板覆盖，任务自己的变量值保留。`,
      confirmText: '更新',
    }))) return;
    setBatchBusy(true);
    try {
      const r = await api.batch(ids, action);
      const label = { run: '运行', enable: '启用', disable: '停用', delete: '删除', 'sync-template': '更新模板' }[action] || action;
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

  // 模板联动：把任务同步到模板当前版本（流程图/日志覆盖，变量保留本任务的值）
  const syncTemplate = async (f) => {
    try {
      await api.syncFlowTemplate(f.id);
      setToast({ kind: 'ok', text: `「${f.name}」已同步到模板当前版本` });
      load();
    } catch (e) {
      setToast({ kind: 'fail', text: e.message });
    }
  };

  const lastStatus = (f) => {
    if (!f.lastRun) return <span className="badge muted">未运行</span>;
    const ok = f.lastRun.status === 'success';
    return (
      <span className={`badge ${ok ? 'ok' : 'fail'}`} style={{ cursor: 'pointer' }}
        title="点击查看运行日志"
        onClick={() => setModal({ type: 'logstream', flowId: f.id, flowName: f.name, refresh: Date.now() })}>
        {ok ? '成功' : '失败'} · {fmtTime(f.lastRun.startedAt)}
      </span>
    );
  };

  if (flows === null) return <div className="boot">加载中…</div>;

  return (
    <>
      <div className="topbar">
        <span className="logo">Check<em>Q</em></span>
        <span className="spacer" />
        <button className="primary" onClick={() => setModal('new')}>+ 新建任务</button>
        <Dropdown trigger="更多" caret triggerClass="dd-menu" width={190} ariaLabel="更多操作">
          <button onClick={() => setModal('wizard')}>快速组装</button>
          <button onClick={() => setModal('curl')} disabled={importBusy}>导入 cURL 命令</button>
          <button onClick={() => setModal('import')} disabled={importBusy}>导入 HAR / JSON</button>
          <div className="menu-sep" />
          <button onClick={onLogout}>退出登录</button>
        </Dropdown>
        {me && (
          <span className="who-chip" title={`登录身份：${me.username}（${me.role === 'admin' ? '管理员' : me.role === 'operator' ? '操作员' : '只读'}）${me.totpEnabled ? ' · 两步验证已启用' : ''}`}>
            {me.displayName || me.username}
            <em>{me.role === 'admin' ? '管理员' : me.role === 'operator' ? '操作员' : '只读'}</em>
          </span>
        )}
        <ThemeToggle />
        <button className="iconbtn bell-btn" onClick={() => setNotifOpen(true)} title="站内通知" aria-label="站内通知">
          <IconBell size={16} />{unread > 0 && <span className="bell-dot">{unread > 99 ? '99+' : unread}</span>}
        </button>
        <a className="iconbtn" href="https://zqs1qiwan.github.io/checkq/" target="_blank" rel="noreferrer" title="文档中心" aria-label="文档中心"><IconGlobe size={16} /></a>
        <button className="iconbtn" onClick={() => setModal('settings')} title="设置" aria-label="设置"><IconGear size={16} /></button>
        <input
          ref={fileRef} type="file" accept=".har,.json" style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files[0]; if (f) doImport(f); e.target.value = ''; }}
        />
      </div>

      <div className="page">
        {stats && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, fontSize: 12, color: 'var(--muted)' }}>
            <span className="badge muted">任务 {stats.flows} · 调度中 {stats.enabledScheduled} · 模板 {stats.templates}</span>
            <span className="badge muted">今日 {stats.todayRuns} 次 · 成功 {stats.todaySuccess} · 失败 {stats.todayFailed}{stats.successRate !== null ? ` · 成功率 ${stats.successRate}%` : ''}</span>
            {stats.queuedFlows?.length ? <span className="badge warn">排队中 {stats.queuedFlows.length}</span> : null}
            {stats.dailySummary?.enabled ? <span className="badge ok">每日汇总 {stats.dailySummary.time}</span> : null}
            {stats.nextRunAt ? (
              <span className="badge ok" title={`下一次自动运行：${stats.nextFlowName || '未知任务'}（所有已启用任务中最近的一次）`}>
                下次调度 {fmtTime(stats.nextRunAt)}{stats.nextFlowName ? ` · ${stats.nextFlowName}` : ''}
              </span>
            ) : <span className="badge muted">暂无调度</span>}
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
                  {t.nodesCount} 步 · {t.varNames.length} 个变量 · 已建 {t.taskCount} 个任务
                  {t.staleTasks > 0 && <span className="chip chip-write" style={{ marginLeft: 6 }}>{t.staleTasks} 个待更新</span>}
                </div>
                <div className="tpl-actions">
                  <button className="small primary" onClick={() => setModal({ type: 'instantiate', tpl: t })}>+ 创建任务</button>
                  {t.taskCount > 0 && (
                    <button className="small" title="把这个模板的当前版本同步到它创建的所有任务（流程图/日志覆盖，任务变量保留）"
                      onClick={async () => {
                        try {
                          const r = await api.syncTemplateTasks(t.id);
                          setToast({ kind: 'ok', text: `已把「${t.name}」同步到 ${r.okCount} 个任务` });
                          load();
                        } catch (e) { setToast({ kind: 'fail', text: e.message }); }
                      }}>更新派生任务</button>
                  )}
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
          <span className="spacer" />
          {selected.size > 0 && (
            <span className="btn-row">
              <span style={{ fontSize: 12, color: 'var(--accent)', whiteSpace: 'nowrap' }}>已选 {selected.size}</span>
              <button className="small primary" disabled={batchBusy} onClick={() => doBatch('run')}>批量运行</button>
              <button className="small" disabled={batchBusy} onClick={() => doBatch('enable')}>启用</button>
              <button className="small" disabled={batchBusy} onClick={() => doBatch('disable')}>停用</button>
              <button className="small" disabled={batchBusy} title="把选中的任务同步到各自模板的当前版本" onClick={() => doBatch('sync-template')}>更新模板</button>
              <button className="small danger" disabled={batchBusy} onClick={() => doBatch('delete')}>删除</button>
              <button className="small" onClick={() => setSelected(new Set())}>取消</button>
            </span>
          )}
          <span className="spacer" />
          <button className={`small ${batchMode ? 'primary' : ''}`} title={batchMode ? '退出批量模式' : '进入批量模式：可勾选多个任务一起操作'} onClick={() => { setBatchMode((v) => !v); setSelected(new Set()); }}>
            {batchMode ? '退出批量' : '批量管理'}
          </button>
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
          <input
            style={{ width: 180, minWidth: 120, flex: '0 1 180px', fontSize: 13, padding: '4px 8px' }}
            placeholder="搜索名称/备注…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            style={{ width: 110, flex: '0 0 auto', fontSize: 13, padding: '4px 6px' }}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">全部</option>
            <option value="scheduled">已启用调度</option>
            <option value="recent-failed">最近失败</option>
          </select>
        </div>

        {visibleFlows.length === 0 ? (
          <div className="empty">
            <p>{(search || filter !== 'all') ? '没有匹配的任务。' : '还没有任务。从上方模板创建，或「+ 新建任务」从零开始搭建。'}</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="flow-table">
              <thead>
                <tr>
                  {batchMode && <th style={{ width: 36 }}><input type="checkbox" checked={selectedAll} onChange={toggleSelectAll} title="全选" /></th>}
                  <th>名称</th><th>调度</th><th className="col-next">下次运行</th><th>状态</th><th className="col-last">上次运行</th><th style={{ minWidth: 150 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {visibleFlows.map((f) => (
                  <tr key={f.id}>
                    {batchMode && <td><input type="checkbox" checked={selected.has(f.id)} onChange={() => toggleSelect(f.id)} /></td>}
                    <td>
                      <a className="flow-name" href="#" onClick={(e) => { e.preventDefault(); onOpen(f.id); }}>{f.name}</a>
                      {f.note ? <div style={{ color: 'var(--muted)', fontSize: 12 }}>{f.note}</div> : null}
                      {f.template && (
                        <div className="tpl-tag" title={f.template.stale
                          ? `来源模板「${f.template.name}」已更新，可点「··· → 更新到模板版本」同步流程`
                          : `来自模板「${f.template.name}」`}>
                          <span className={`chip ${f.template.stale ? 'chip-write' : 'chip-mute'}`}>
                            {f.template.stale ? '模板已更新' : '模板'}
                          </span>
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
                        <button className="small primary" disabled={running === f.id} title={running === f.id ? '正在运行…' : '立即运行一次'}
                          onClick={() => runNow(f)}>{running === f.id ? '运行中' : '运行'}</button>
                        <button className="small" title="查看运行日志（每天的签到记录都在这里）" onClick={() => openLog(f)}>日志</button>
                        <Dropdown trigger="···" triggerClass="dd-row" align="right" width={170} ariaLabel="任务更多操作">
                          <button onClick={() => onOpen(f.id)}>编辑</button>
                          <button onClick={() => setModal({ type: 'info', flow: f })}>任务信息…</button>
                          {f.template?.stale && (
                            <button onClick={() => syncTemplate(f)}>更新到模板版本</button>
                          )}
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
              </tbody>
            </table>
          </div>
        )}
        </>
        )}
      </div>

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

      {modal?.type === 'info' && (
        <FlowInfoModal
          flow={modal.flow}
          template={modal.flow.template}
          onClose={() => setModal(null)}
          onSaved={() => load()}
          onToast={(text, kind) => setToast({ kind, text })}
        />
      )}

      {modal === 'backup-full' && <BackupFullModal onClose={() => setModal(null)} />}

      {modal === 'restore' && (
        <RestoreModal onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />
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
function InstantiateModal({ tpl, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [vars, setVars] = useState(null); // {name, value}[]，从模板详情拉默认值
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.template(tpl.id).then((t) => {
      setVars(t.varNames.map((n) => ({ name: n, value: (t.vars || {})[n] || '' })));
    }).catch(() => setVars([]));
  }, [tpl.id]);

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const varsObj = {};
      for (const v of vars || []) if (v.name.trim()) varsObj[v.name.trim()] = v.value;
      const f = await api.instantiate(tpl.id, { name: name.trim() || undefined, vars: varsObj });
      onCreated(f);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`从模板创建任务：${tpl.name}`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={busy || vars === null} onClick={submit}>{busy ? '创建中…' : '创建任务'}</button>
        </>
      }
    >
        <div className="field">
          <label>任务名</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`默认：${tpl.name} · 序号`} />
        </div>
        {(vars || []).map((v, i) => (
          <div className="field" key={i}>
            <label className="mono">{v.name}</label>
            <textarea
              className="mono" rows={v.name === 'ua' ? 2 : Math.min(3, (v.value.length / 60 | 0) + 1)}
              value={v.value}
              onChange={(e) => setVars(vars.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
            />
          </div>
        ))}
        {vars === null && <p style={{ color: 'var(--muted)' }}>加载变量中…</p>}
        {err && <p style={{ color: 'var(--fail)', fontSize: 12 }}>{err}</p>}
    </Modal>
  );
}

/** cURL 导入 → 新任务 */
function CurlImportModal({ onClose, onCreated }) {
  const [cmd, setCmd] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [preview, setPreview] = useState(null);

  const parse = async () => {
    setErr(''); setPreview(null);
    if (!cmd.trim()) return;
    setBusy(true);
    try {
      const { config } = await api.importCurl(cmd);
      setPreview(config);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setBusy(true); setErr('');
    try {
      const f = await api.createFlow({
        name: `cURL · ${new URL(preview.url).hostname}`,
        nodes: [{ id: 'n0', type: 'http', name: '请求', x: 0, y: 0, config: preview }],
        edges: [], vars: {}, cron: '', enabled: false,
      });
      onCreated(f);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="导入 cURL 命令"
      onClose={onClose}
      width={640}
      footer={
        <>
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={busy || !cmd.trim()} onClick={parse}>{busy ? '解析中…' : '解析预览'}</button>
        </>
      }
    >
        <textarea
          className="mono" rows={5}
          placeholder={`curl 'https://example.com/api' \\\n  -H 'cookie: sess=...' \\\n  --data-raw '{"a":1}'`}
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
        />
        {err && <p style={{ color: 'var(--fail)', fontSize: 12 }}>{err}</p>}
        {preview && (
          <div style={{ marginTop: 10, border: '1px solid var(--border)', borderRadius: 8, padding: 10, fontSize: 12 }}>
            <div><b>{preview.method}</b> <span className="mono">{preview.url}</span></div>
            {(preview.headers || []).length > 0 && (
              <div style={{ color: 'var(--muted)', marginTop: 4 }}>
                {(preview.headers || []).map((h) => `${h.name}: ${h.value.length > 40 ? h.value.slice(0, 40) + '…' : h.value}`).join(' | ')}
              </div>
            )}
            {preview.body && <div className="mono" style={{ marginTop: 4, wordBreak: 'break-all' }}>body: {preview.body.slice(0, 120)}</div>}
            <button className="primary" style={{ marginTop: 8 }} disabled={busy} onClick={create}>创建任务</button>
          </div>
        )}
    </Modal>
  );
}

/** CSV 批量建任务：首行=变量名（可含 name 列），每行一条任务 */
function CsvImportModal({ tpl, onClose, onDone }) {
  const [csv, setCsv] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);

  const submit = async () => {
    setBusy(true); setErr(''); setResult(null);
    try {
      const r = await api.instantiateCsv(tpl.id, csv);
      setResult(r);
      if (r.created > 0) onDone(r.created);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`批量创建任务：${tpl.name}`}
      onClose={onClose}
      width={640}
      footer={
        <>
          <button onClick={onClose}>关闭</button>
          <button className="primary" disabled={busy || !csv.trim()} onClick={submit}>{busy ? '创建中…' : '批量创建'}</button>
        </>
      }
    >
        <div className="csv-help">
          <div className="csv-help-title">怎么填</div>
          <ol>
            <li>第一行 = 列名（变量名），只写一次</li>
            <li>从第二行开始，<b>每一行就是一个新任务</b></li>
            <li>第一列写任务名，后面的列按第一行的变量名依次填值</li>
          </ol>
          <div className="csv-example">
            <code>任务名,cookie</code>
            <code>账号A,sess=aaaa1111</code>
            <code>账号B,sess=bbbb2222</code>
          </div>
          <div className="hint">
            {tpl.varNames.length > 0
              ? <>模板需要这些变量：{(tpl.varNames || []).join('、')}；名字要和第一行完全一致。</>
              : <>这个模板没有变量，只填任务名即可。</>}
          </div>
        </div>
        <textarea
        className="mono" rows={7}
        placeholder={'任务名,cookie\n账号A,sess=aaaa1111\n账号B,sess=bbbb2222'}
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        />
        {err && <p style={{ color: 'var(--fail)', fontSize: 12 }}>{err}</p>}
        {result && (
          <p style={{ color: 'var(--ok)', fontSize: 12 }}>
            已创建 {result.created} 个任务{result.errors?.length ? `，${result.errors.length} 行失败` : ''}
          </p>
        )}
    </Modal>
  );
}

/** 系统设置：改密 + API Key */
function NotificationsModal({ onClose }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.notifications(100).then(setData).catch(() => setData({ items: [], unread: 0, total: 0 }));
  useEffect(() => { load(); }, []);
  const markAll = async () => { setBusy(true); try { await api.markNotificationsRead(); await load(); } finally { setBusy(false); } };
  const clearAll = async () => {
    if (!(await confirmDialog({ title: '清空站内通知', message: '清空全部站内通知？此操作不可恢复。', confirmText: '清空', danger: true }))) return;
    setBusy(true);
    try { await api.clearNotifications(); await load(); } finally { setBusy(false); }
  };
  const fmt = (ts) => new Date(ts).toLocaleString('zh-CN');
  return (
    <Modal
      title={`站内通知${data ? `（${data.total} 条 · 未读 ${data.unread}）` : ''}`}
      onClose={onClose}
      className="notif-modal"
      footer={
        <>
          <button className="danger" onClick={clearAll} disabled={busy || !data?.total}>清空</button>
          <span className="spacer" />
          <button className="primary" onClick={markAll} disabled={busy || !data?.unread}>全部已读</button>
        </>
      }
    >
        <div className="notif-list">
          {data && data.items.length === 0 && <div className="notif-empty">还没有通知。到任务的「通知渠道」里添加「站内通知」，运行后即可在这里看到结果。</div>}
          {data && data.items.map((n) => (
            <div key={n.id} className={`notif-item${n.read ? '' : ' unread'}`}>
              <div className="notif-item-head">
                <span className={`dot ${n.level}`} />
                <strong>{n.title}</strong>
                <span className="notif-time">{fmt(n.createdAt)}</span>
              </div>
              <div className="notif-content">{n.content}</div>
              {n.flowName && <div className="notif-flow">来自任务：{n.flowName}</div>}
            </div>
          ))}
        </div>
    </Modal>
  );
}

function SettingsModal({ onClose, initialTab }) {
  const [tab, setTab] = useState(initialTab || 'general');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [me, setMe] = useState(null);
  useEffect(() => {
    api.me().then((r) => setMe(r.authenticated ? r.user : null)).catch(() => {});
  }, []);
  const TABS = [
    { id: 'general', label: '通知与推送', desc: '每日汇总推送与模板', Icon: IconBell },
    { id: 'ai', label: 'AI 助手', desc: '快速组装用的模型', Icon: IconSparkle },
    { id: 'security', label: '账号安全', desc: '密码、两步验证、会话', Icon: IconShield },
    ...(me?.role === 'admin' ? [{ id: 'users', label: '用户管理', desc: '账号与角色', Icon: IconUsers }] : []),
    { id: 'api', label: 'API 密钥', desc: '外部程序接入', Icon: IconKey },
  ];
  const cur = TABS.find((x) => x.id === tab) || TABS[0];
  return (
    <Modal
      title="设置"
      onClose={onClose}
      className="settings-modal"
      bodyClassName="settings-split"
    >
      <nav className="settings-nav">
        {TABS.map((x) => (
          <button
            key={x.id}
            className={`settings-tab${tab === x.id ? ' active' : ''}`}
            onClick={() => { setTab(x.id); setMsg(''); setErr(''); }}
          >
            <x.Icon size={16} />
            <span className="settings-tab-text">
              <b>{x.label}</b>
              <em>{x.desc}</em>
            </span>
          </button>
        ))}
      </nav>
      <div className="settings-panel">
        <div className="settings-page-head">
          <h2>{cur.label}</h2>
          <p>{cur.desc}</p>
        </div>

        {tab === 'general' && <SettingsFlow onToast={(text) => { setMsg(text); setErr(''); }} />}

        {tab === 'ai' && <AiSettings />}

        {tab === 'security' && <AccountPanel onToast={(text) => { setMsg(text); setErr(''); }} />}

        {tab === 'users' && me?.role === 'admin' && <UsersPanel onToast={(text) => { setMsg(text); setErr(''); }} />}

        {tab === 'api' && <ApiKeysPanel onToast={(text) => { setMsg(text); setErr(''); }} />}

        {msg && <p className="settings-msg">{msg}</p>}
        {err && <p className="settings-msg err">{err}</p>}
      </div>
    </Modal>
  );
}

/** 设置内：AI 助手（快速组装 LLM，OpenAI 兼容接口；key 只存服务端） */
function AiSettings() {
  const [cfg, setCfg] = useState({ baseUrl: '', apiKey: '', model: '' });
  const [configured, setConfigured] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    api.aiSettings().then((s) => { setConfigured(s.configured); setCfg({ baseUrl: s.baseUrl, apiKey: s.apiKey, model: s.model }); }).catch(() => {});
  }, []);
  const save = async () => {
    setMsg('');
    try {
      await api.saveAiSettings(cfg);
      const s = await api.aiSettings();
      setConfigured(s.configured); setCfg({ baseUrl: s.baseUrl, apiKey: s.apiKey, model: s.model });
      setMsg('AI 配置已保存');
    } catch (e) { setMsg('保存失败: ' + e.message); }
  };
  return (
    <>
      <div className="field">
        <label title="快速组装用的 LLM，OpenAI 兼容接口">AI 助手{configured ? ' · 已配置' : ' · 未配置'}</label>
        <input placeholder="Base URL，例：https://api.deepseek.com/v1" value={cfg.baseUrl} onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })} />
      </div>
      <div className="field-inline">
        <div className="field">
          <label>API Key</label>
          <input type="password" autoComplete="off" placeholder={cfg.apiKey || 'sk-…'} value={cfg.apiKey} onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })} />
        </div>
        <div className="field">
          <label>模型</label>
          <input placeholder="deepseek-chat / gpt-4o-mini" value={cfg.model} onChange={(e) => setCfg({ ...cfg, model: e.target.value })} />
        </div>
      </div>
      <div style={{ color: 'var(--muted)', fontSize: 11, marginBottom: 8, lineHeight: 1.5 }}>
        支持 OpenAI 兼容接口（DeepSeek / OpenAI / Ollama 等）。Key 只存服务端 meta.json，不回显明文。未配置时快速组装走本地规则模式（不耗 API）。
      </div>
      <button className="small" onClick={save}>保存 AI 配置</button>
      {msg && <p style={{ color: msg.startsWith('保存失败') ? 'var(--fail)' : 'var(--ok)', fontSize: 12 }}>{msg}</p>}
    </>
  );
}

/* 设置内：每日总推送（可选）+ 界面提示级别 */
function SettingsFlow({ onToast }) {
  const [cfg, setCfg] = useState({ enabled: false, time: '08:00', timezone: 'Asia/Shanghai', targetFlowIds: [] });
  const [pushable, setPushable] = useState([]);
  const [selectedUnits, setSelectedUnits] = useState([]);
  const [marketUrl, setMarketUrl] = useState('');
  const [level, setLevel] = useState(getToastLevel());
  const [pushing, setPushing] = useState(false);
  useEffect(() => {
    api.dailySummaryConfig().then((c) => {
      setCfg({ ...c, targetFlowIds: c.targetFlowIds || [] });
      setSelectedUnits(c.targetFlowIds || (c.targetFlowId ? [c.targetFlowId] : []));
    }).catch(() => {});
    api.pushTargets().then(setPushable).catch(() => setPushable([]));
  }, []);
  const changeLevel = async (v) => {
    setLevel(v);
    setToastLevel(v);
    try { await api.saveUiSettings({ toastLevel: v }); } catch (e) { onToast(e.message); }
  };
  const pushNow = async () => {
    if (!selectedUnits.length) { onToast('先勾选至少一个推送单位'); return; }
    setPushing(true);
    try {
      const r = await api.pushDailySummary({ flowIds: selectedUnits });
      onToast(`已推送到 ${(r.groups || []).length} 个单位：${r.text || '今日汇总'}`);
    } catch (e) { onToast(e.message); }
    finally { setPushing(false); }
  };
  return (
    <>
      <div className="field">
        <label title="只控制右上角弹出的提示；面板上的「今日汇总」始终是实时数据，打开首页就能看到。">界面提示</label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="radio" name="toast-level" style={{ width: 'auto' }} checked={level === 'error'} onChange={() => changeLevel('error')} />
          仅错误提示（默认，日常最安静）
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="radio" name="toast-level" style={{ width: 'auto' }} checked={level === 'success'} onChange={() => changeLevel('success')} />
          成功 + 错误提示
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="radio" name="toast-level" style={{ width: 'auto' }} checked={level === 'all'} onChange={() => changeLevel('all')} />
          全部提示
        </label>
      </div>
      <div className="field">
        <label title="默认关闭；开启后每天指定时间把今日汇总推送到勾选的任务">每日总推送</label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={!!cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} />
          每天 {cfg.time} 把今日汇总推送到下面勾选的任务
        </label>
        <div className="push-units">
          {pushable.length === 0 && <div className="hint">还没有可推送的任务</div>}
          {pushable.map((f) => (
            <label key={f.id} className="push-unit">
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={selectedUnits.includes(f.id)}
                onChange={(e) => setSelectedUnits(e.target.checked ? [...selectedUnits, f.id] : selectedUnits.filter((x) => x !== f.id))}
              />
              <span className="push-unit-name">{f.name}</span>
              {/* 服务端返回的 channels 是类型名字符串数组（历史接口形态），兼容对象形态 */}
              <span className="push-unit-ch">{(f.channels || []).map((c) => (typeof c === 'string' ? c : c.type)).filter(Boolean).join(' / ')}</span>
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="time" style={{ width: 110 }} value={cfg.time} onChange={(e) => setCfg({ ...cfg, time: e.target.value })} />
          <button className="small" onClick={async () => {
            try {
              const r = await api.saveDailySummaryConfig({ ...cfg, targetFlowIds: selectedUnits });
              setCfg(r);
              onToast(`每日总推送设置已保存（${selectedUnits.length} 个推送单位）`);
            } catch (e) { onToast(e.message); }
          }}>保存</button>
          <button className="small" onClick={pushNow} disabled={pushing || selectedUnits.length === 0}>{pushing ? '推送中…' : '立即推送今日汇总'}</button>
          {selectedUnits.length > 0 && <span style={{ color: 'var(--muted)', fontSize: 11 }}>已选 {selectedUnits.length} 个推送单位</span>}
        </div>
      </div>
      <div className="field">
        <label title="从 URL 导入索引 JSON">模板市场</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="mono" placeholder="https://.../template.json" value={marketUrl} onChange={(e) => setMarketUrl(e.target.value)} />
          <button className="small" onClick={async () => {
            try { await api.templateFromUrl(marketUrl); onToast('模板已导入'); setMarketUrl(''); }
            catch (e) { onToast(e.message); }
          }}>导入</button>
        </div>
      </div>
    </>
  );
}

/** 恢复备份：JSON 文件 → 全部以新 ID 恢复（默认停用，不覆盖现有） */
function RestoreModal({ onClose, onDone }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const data = JSON.parse(text);
      const r = await api.restore(data);
      setDoneInfo(r);
      setTimeout(onDone, 300);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const [doneInfo, setDoneInfo] = useState(null);
  return (
    <Modal
      title="从备份恢复"
      onClose={onClose}
      width={640}
      footer={
        <>
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={busy || !text.trim()} onClick={submit}>{busy ? '恢复中…' : '开始恢复'}</button>
        </>
      }
    >
        <textarea className="mono" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder='{"flows": [...]}' title="粘贴「备份」下载的文件内容" />
        {doneInfo && <p style={{ color: 'var(--ok)', fontSize: 12 }}>已恢复 {doneInfo.createdFlows?.length || 0} 个任务、{doneInfo.createdTemplates?.length || 0} 个模板</p>}
        {err && <p style={{ color: 'var(--fail)', fontSize: 12 }}>{err}</p>}
    </Modal>
  );
}
/** 模板管理：改名/描述/默认变量编辑/节点数（PRD §4.3 默认变量编辑） */
function TemplateEditorModal({ tpl, onDone }) {
  const [name, setName] = useState(tpl.name);
  const [desc, setDesc] = useState(tpl.desc || '');
  const [detail, setDetail] = useState(null);
  const [vars, setVars] = useState([]); // [{name, value}]
  const [err, setErr] = useState('');

  useEffect(() => {
    api.template(tpl.id).then((t) => {
      setDetail(t);
      const names = t.varNames && t.varNames.length ? t.varNames : Object.keys(t.vars || {});
      setVars(names.map((n) => ({ name: n, value: (t.vars || {})[n] ?? '' })));
    }).catch((e) => setErr(e.message));
  }, [tpl.id]);

  const save = async () => {
    try {
      const varsObj = {};
      for (const v of vars) if (v.name.trim()) varsObj[v.name.trim()] = v.value;
      await api.updateTemplate(tpl.id, { name, desc, vars: varsObj, varNames: Object.keys(varsObj) });
      onDone();
    } catch (e) { setErr(e.message); }
  };

  return (
    <Modal
      title={`管理模板：${tpl.name}`}
      subtitle={detail ? `${detail.nodes.length} 个节点 · ${vars.length} 个默认变量（实例化时预填）` : ''}
      onClose={onDone}
      footer={
        <>
          <button onClick={onDone}>取消</button>
          <button className="primary" onClick={save}>保存</button>
        </>
      }
    >
        <div className="field">
          <label>模板名</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>描述</label>
          <input value={desc} onChange={(e) => setDesc(e.target.value)} />
        </div>
        <div className="field">
          <label title="敏感项建议留空，实例化时再填真实值">默认变量值</label>
          {vars.map((v, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input className="mono" style={{ fontSize: 11, padding: '4px 6px' }} value={v.name} onChange={(e) => setVars(vars.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <button className="small danger" style={{ padding: '2px 7px' }} onClick={() => setVars(vars.filter((_, j) => j !== i))}>×</button>
              </div>
              <textarea className="mono" style={{ fontSize: 11, padding: '4px 6px', marginTop: 3 }} rows={1} value={v.value} onChange={(e) => setVars(vars.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6 }}>
            <input style={{ fontSize: 11, padding: '4px 6px' }} placeholder="新变量名" id="tpl-new-var" />
            <button className="small" onClick={() => setVars([...vars, { name: document.getElementById('tpl-new-var')?.value || `var${vars.length + 1}`, value: '' }])}>+ 添加变量</button>
          </div>
        </div>
        {err && <p style={{ color: 'var(--fail)', fontSize: 12 }}>{err}</p>}
    </Modal>
  );
}

/** 完整备份（含明文凭据）：需再次输入当前密码 */
function BackupFullModal({ onClose }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const data = await api.backupFull(password);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `checkq-backup-full-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      onClose();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal
      title="完整备份（含凭据）"
      onClose={onClose}
      width={440}
      footer={
        <>
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={busy || !password} onClick={submit}>{busy ? '导出中…' : '确认导出'}</button>
        </>
      }
    >
      <div className="field">
        <label>当前密码</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      </div>
      {err && <p style={{ color: 'var(--fail)', fontSize: 12 }}>{err}</p>}
    </Modal>
  );
}

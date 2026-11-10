import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import ThemeToggle from './ThemeToggle.jsx';

function fmtTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
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
  return (
    <div className="modal-mask" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>✨ 快速组装（菜单式 + 一句话生成）</h3>
        <p style={{ color: 'var(--muted)', fontSize: 12 }}>填三项就行：站点地址、要做什么、看到什么算成功。进编辑器后点「▶ 运行」验证，响应里点选补细节。</p>
        <div className="field">
          <label>一句话生成（可选，例：每天8点去 https://ex.com/sign 签到，看到签到成功算成功）</label>
          <input value={sentence} onChange={(e) => setSentence(e.target.value)} placeholder="每天8点去 https://ex.com/sign 签到，看到签到成功算成功" />
          <button className="small" style={{ marginTop: 6 }} onClick={fillFromSentence}>按这句生成并填充</button>
        </div>
        <div className="field">
          <label>请求地址（浏览器打开站点后复制地址栏）</label>
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
          <label>看到什么词算成功（页面文案，如「签到成功」；空=只看 HTTP 200）</label>
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="签到成功" />
        </div>
        <div className="field">
          <div className="hint">生成：HTTP 节点（带断言/UA）→ 日志节点「{eventLabel}完成」，cron 每天 8 点（可改），调度默认关闭。</div>
        </div>
        {err && <p style={{ color: 'var(--fail)', fontSize: 12 }}>{err}</p>}
        <button className="primary" disabled={busy || !url.trim()} onClick={create}>{busy ? '生成中…' : '生成流程'}</button>
        {' '}
        <button onClick={onClose}>取消</button>
      </div>
    </div>
  );
}

function Toast({ toast, onClose }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  return <div className={`toast ${toast.kind || 'ok'}`}>{toast.text}</div>;
}

export default function FlowList({ onOpen, onLogout }) {
  const [flows, setFlows] = useState(null);
  const [templates, setTemplates] = useState(null);
  const [toast, setToast] = useState(null);
  const [modal, setModal] = useState(null); // 'new' | 'import' | 'template-editor' | {type:'instantiate', tpl} | {type:'result', run}
  const [importBusy, setImportBusy] = useState(false);
  const [running, setRunning] = useState(null); // flowId -> 'running'
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all'); // all | scheduled | recent-failed
  const [stats, setStats] = useState(null);
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
    if (action === 'delete' && !confirm(`删除选中的 ${ids.length} 个任务？不可恢复`)) return;
    setBatchBusy(true);
    try {
      const r = await api.batch(ids, action);
      setToast({ kind: r.failed ? 'fail' : 'ok', text: `批量${action === 'run' ? '运行' : action}：成功 ${r.ok} / 失败 ${r.failed}` });
      if (action === 'run') {
        const first = r.results.find((x) => x.runId);
        if (first) setModal({ type: 'result', run: await api.run(first.runId), flowId: first.id });
      }
      load();
    } catch (e) {
      setToast({ kind: 'fail', text: `批量操作失败: ${e.message}` });
    } finally {
      setBatchBusy(false);
    }
  };

  const del = async (f) => {
    if (!confirm(`删除任务「${f.name}」？不可恢复`)) return;
    await api.deleteFlow(f.id);
    load();
  };

  const runNow = async (f) => {
    setRunning(f.id);
    try {
      const run = await api.runFlow(f.id);
      setModal({ type: 'result', run, flowId: f.id });
      load();
    } catch (e) {
      setToast({ kind: 'fail', text: `运行失败: ${e.message}` });
    } finally {
      setRunning(null);
    }
  };

  const openLog = async (f) => {
    try {
      const full = f.lastRun ? await api.run(f.lastRun.id) : (await api.runs(f.id, 1))[0];
      if (!full) {
        setToast({ kind: 'fail', text: '该任务还没有运行记录，先点 ▶ 运行' });
        return;
      }
      setModal({ type: 'result', run: full, flowId: f.id });
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
        onClick={() => api.run(f.lastRun.id).then((full) => setModal({ type: 'result', run: full, flowId: f.id }))}>
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
        <button onClick={() => setModal('curl')} disabled={importBusy}>导入 cURL</button>
        <button onClick={() => setModal('import')} disabled={importBusy}>导入 HAR / 模板 JSON</button>
        <button onClick={() => setModal('wizard')}>✨ 快速组装</button>
        <button className="primary" onClick={() => setModal('new')}>+ 新建任务</button>
        <button onClick={() => setModal('settings')}>设置</button>
        <button onClick={onLogout}>退出</button>
        <ThemeToggle />
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
            {stats.nextRunAt ? <span className="badge ok">下次触发 {fmtTime(stats.nextRunAt)}</span> : <span className="badge muted">暂无调度</span>}
          </div>
        )}
        <div className="page-head">
          <h2>模板</h2>
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>一个模板，多份任务；变量（cookie 等）在创建任务时各自填写</span>
        </div>

        {templates && templates.length > 0 ? (
          <div className="tpl-grid">
            {templates.map((t) => (
              <div key={t.id} className="tpl-card">
                <div className="tpl-name">{t.name}</div>
                <div className="tpl-desc">{t.desc || '—'}</div>
                <div className="tpl-meta">
                  {t.nodesCount} 步 · {t.varNames.length} 个变量 · 已建 {t.taskCount} 个任务
                </div>
                <div className="tpl-actions">
                  <button className="small primary" onClick={() => setModal({ type: 'instantiate', tpl: t })}>+ 创建任务</button>
                  <button className="small" onClick={() => setModal({ type: 'csv', tpl: t })}>批量</button>
                  <button className="small" onClick={() => setModal({ type: 'template-editor', tpl: t })}>管理</button>
                  <button className="small" onClick={async () => {
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
                  }}>导出</button>
                  <button className="small danger" onClick={async () => {
                    if (!confirm(`删除模板「${t.name}」？已创建的任务不受影响。`)) return;
                    await api.deleteTemplate(t.id);
                    load();
                  }}>删除</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="tpl-empty">
            还没有模板。先建一个任务调试好，点「存为模板」，或导入模板 JSON。
          </div>
        )}

        <div className="page-head" style={{ marginTop: 28 }}>
          <h2>任务</h2>
          <span className="spacer" />
          {selected.size > 0 && (
            <span className="btn-row">
              <span style={{ fontSize: 12, color: 'var(--accent)', whiteSpace: 'nowrap' }}>已选 {selected.size}</span>
              <button className="small primary" disabled={batchBusy} onClick={() => doBatch('run')}>▶ 批量运行</button>
              <button className="small" disabled={batchBusy} onClick={() => doBatch('enable')}>启用</button>
              <button className="small" disabled={batchBusy} onClick={() => doBatch('disable')}>停用</button>
              <button className="small danger" disabled={batchBusy} onClick={() => doBatch('delete')}>删除</button>
              <button className="small" onClick={() => setSelected(new Set())}>取消</button>
            </span>
          )}
          <span className="spacer" />
          <button className={`small ${batchMode ? 'primary' : ''}`} onClick={() => { setBatchMode((v) => !v); setSelected(new Set()); }}>
            ☑ 批量{batchMode ? '退出' : '管理'}
          </button>
          <button className="small" onClick={async () => {
            try {
              const data = await api.backup();
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = `checkq-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
              a.click();
              URL.revokeObjectURL(a.href);
              setToast({ kind: 'ok', text: '备份已下载（密码不含在内）' });
            } catch (e) { setToast({ kind: 'fail', text: e.message }); }
          }}>备份</button>
          <button className="small" onClick={() => setModal('restore')}>恢复</button>
          <input
            style={{ width: 180, minWidth: 140, flex: '0 1 180px', fontSize: 13, padding: '4px 8px' }}
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
            <div className="big">🧩</div>
            <p>{(search || filter !== 'all') ? '没有匹配的任务。' : '还没有任务。从上方模板创建，或「+ 新建任务」从零开始搭建。'}</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="flow-table">
              <thead>
                <tr>
                  {batchMode && <th style={{ width: 36 }}><input type="checkbox" checked={selectedAll} onChange={toggleSelectAll} title="全选" /></th>}
                  <th>名称</th><th>调度</th><th>下次运行</th><th>状态</th><th>上次运行</th><th style={{ minWidth: 250 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {visibleFlows.map((f) => (
                  <tr key={f.id}>
                    {batchMode && <td><input type="checkbox" checked={selected.has(f.id)} onChange={() => toggleSelect(f.id)} /></td>}
                    <td>
                      <a className="flow-name" href="#" onClick={(e) => { e.preventDefault(); onOpen(f.id); }}>{f.name}</a>
                      {f.note ? <div style={{ color: 'var(--muted)', fontSize: 12 }}>{f.note}</div> : null}
                    </td>
                    <td>
                      {f.cron ? <span className="cron-code">{f.cron}</span> : <span style={{ color: 'var(--muted)' }}>手动</span>}
                    </td>
                    <td>
                      {f.nextRunAt ? <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{fmtTime(f.nextRunAt)}</span> : <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>}
                    </td>
                    <td>
                      <label className="switch" title={f.enabled ? '点击停用调度' : '点击启用调度'}>
                        <input type="checkbox" checked={!!f.enabled} onChange={() => toggle(f)} />
                        <span className="track" />
                      </label>
                    </td>
                    <td>{lastStatus(f)}</td>
                    <td>
                      <div className="cell-actions">
                        <button className="small primary" disabled={running === f.id}
                          onClick={() => runNow(f)}>{running === f.id ? '运行中…' : '▶ 运行'}</button>
                        <button className="small" onClick={() => onOpen(f.id)}>编辑</button>
                        <button className="small" title="查看运行日志（每天的签到记录都在这里）" onClick={() => openLog(f)}>日志</button>
                        <button className="small" onClick={async () => {
                          try {
                            await api.cloneFlow(f.id);
                            setToast({ kind: 'ok', text: '已克隆为副本（调度暂停）' });
                            load();
                          } catch (e) {
                            setToast({ kind: 'fail', text: e.message });
                          }
                        }}>复制</button>
                        <button className="small danger" onClick={() => del(f)}>删除</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal === 'wizard' && (
        <WizardModal onClose={() => setModal(null)} onCreated={(f) => { setModal(null); onOpen(f.id); setToast({ kind: 'ok', text: '流程已生成，去运行试试，再点「点选生成逻辑」补变量' }); }} />
      )}

      {modal === 'new' && (
        <div className="modal-mask" onClick={(e) => e.target === e.currentTarget && setModal(null)}>
          <div className="modal">
            <h3>新建空白任务</h3>
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>进入编辑器：左侧拖积木到画布 → 连线 → 点「▶ 运行」测试 → 调好后「存为模板」。</p>
            <button className="primary" onClick={createEmpty}>创建</button>
            {' '}
            <button onClick={() => setModal(null)}>取消</button>
          </div>
        </div>
      )}

      {modal === 'curl' && (
        <CurlImportModal onClose={() => setModal(null)} onCreated={(f) => { setModal(null); onOpen(f.id); }} />
      )}

      {modal === 'import' && (
        <div className="modal-mask" onClick={(e) => e.target === e.currentTarget && setModal(null)}>
          <div className="modal">
            <h3>导入</h3>
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>
              支持 .har（浏览器请求录制）和 .json（CheckQ 模板）。点击下方按钮选择文件。
            </p>
            <button className="primary" onClick={() => fileRef.current?.click()}>选择文件</button>
            {' '}
            <button onClick={() => setModal(null)}>取消</button>
          </div>
        </div>
      )}

      {modal?.type === 'csv' && (
        <CsvImportModal tpl={modal.tpl} onClose={() => setModal(null)} onDone={(n) => { setModal(null); setToast({ kind: 'ok', text: `已创建 ${n} 个任务` }); load(); }} />
      )}

      {modal?.type === 'instantiate' && (
        <InstantiateModal tpl={modal.tpl} onClose={() => setModal(null)} onCreated={(f) => { setModal(null); onOpen(f.id); }} />
      )}

      {modal?.type === 'result' && (
        <ResultModal run={modal.run} flowId={modal.flowId} onClose={() => setModal(null)} />
      )}

      {modal?.type === 'template-editor' && (
        <TemplateEditorModal tpl={modal.tpl} onDone={() => { setModal(null); load(); }} />
      )}

      {modal === 'restore' && (
        <RestoreModal onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />
      )}

      {modal === 'settings' && (
        <SettingsModal onClose={() => setModal(null)} />
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
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
    <div className="modal-mask" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>从模板创建任务：{tpl.name}</h3>
        <p style={{ color: 'var(--muted)', fontSize: 12 }}>节点流程与模板相同，只改这里的变量（如 cookie）。留空用默认值。</p>
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
        <button className="primary" disabled={busy || vars === null} onClick={submit}>{busy ? '创建中…' : '创建任务'}</button>
        {' '}
        <button onClick={onClose}>取消</button>
      </div>
    </div>
  );
}

/** 任务列表页的运行结果弹窗（含历史运行切换） */
function ResultModal({ run, flowId, onClose }) {
  const [expanded, setExpanded] = useState(null);
  const [cur, setCur] = useState(run);
  const [hist, setHist] = useState(null);
  useEffect(() => {
    if (!flowId) return;
    api.runs(flowId, 30).then(setHist).catch(() => setHist([]));
  }, [flowId]);
  useEffect(() => { setCur(run); setExpanded(null); }, [run]);
  const shown = cur || run;
  const statusLabel = shown.status === 'success' ? '✅ 运行成功' : shown.status === 'failed' ? '❌ 运行失败' : '⏳ 运行中…';
  const openRun = async (id) => {
    try { const full = await api.run(id); setCur(full); setExpanded(null); }
    catch (e) { }
  };
  return (
    <div className="modal-mask" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 640 }}>
        <h3>运行日志：{shown.flowName || ''}</h3>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
          {statusLabel} · {shown.startedAt ? fmtTime(shown.startedAt) : ''} · 触发 {shown.trigger || 'manual'}
          {shown.durationMs ? ` · ${(shown.durationMs / 1000).toFixed(1)}s` : ''}
        </div>
        {hist && flowId && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ color: 'var(--muted)', fontSize: 11, marginBottom: 4 }}>历史记录（每天的日志在这里切换）</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(hist || []).map((r) => (
                <button key={r.id} className={`small ${r.id === shown.id ? 'primary' : ''}`} onClick={() => openRun(r.id)}>
                  {r.status === 'success' ? '✅' : '❌'} {fmtTime(r.startedAt)}
                </button>
              ))}
            </div>
          </div>
        )}
        {shown.finalMessage && (
          <p style={{ color: shown.status === 'failed' ? 'var(--fail)' : 'var(--muted)', fontSize: 13, marginTop: -4 }}>{shown.finalMessage}</p>
        )}
        {shown.summary && (
          <p style={{ color: 'var(--ok)', fontSize: 12, marginTop: -4 }}>📌 {shown.summary}</p>
        )}
        {shown.vars && Object.keys(shown.vars).length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ color: 'var(--muted)', fontSize: 11, marginBottom: 4 }}>最终变量快照（已脱敏）</div>
            <pre>{Object.entries(shown.vars).map(([k, v]) => `${k} = ${String(v).slice(0, 120)}`).join('\n')}</pre>
          </div>
        )}
        <div className="result-logs">
          {(shown.logs || []).length === 0 && <p style={{ color: 'var(--muted)' }}>暂无日志</p>}
          {(shown.logs || []).map((log, i) => (
            <div key={i} className="step-row">
              <div className="step-head" onClick={() => setExpanded(expanded === i ? null : i)}>
                <span className="idx">{log.index}</span>
                <span className="dot" style={{ background: log.ok ? 'var(--ok)' : 'var(--fail)', width: 8, height: 8, borderRadius: '50%', flex: 'none' }} />
                <span className="msg">{log.name} — {log.message}{log.errorType ? ` [${log.errorType}]` : ''}</span>
                <span style={{ color: 'var(--muted)', fontSize: 11, flex: 'none' }}>{log.ms}ms</span>
              </div>
              {expanded === i && (
                <div className="step-detail">
                  {log.type === 'http' && log.detail && (
                    <>
                      <div><b>{log.detail.method}</b> {log.detail.url}</div>
                      {log.detail.headers && <pre>{Object.entries(log.detail.headers).map(([k, v]) => `${k}: ${v}`).join('\n')}</pre>}
                      {log.detail.body && <pre>{log.detail.body}</pre>}
                    </>
                  )}
                  {log.type === 'http' && log.detail?.response && (
                    <>
                      <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>响应 (HTTP {log.detail.response.status})</span>
                        <span style={{ color: 'var(--muted)', fontSize: 10 }}>编辑器内可用「点选生成逻辑」</span>
                      </div>
                      <pre>{log.detail.response.body}</pre>
                    </>
                  )}
                  {log.keywords?.length > 0 && (
                    <>
                      <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 6 }}>关键字提取</div>
                      {log.keywords.map((k, j) => (<div key={j} style={{ color: 'var(--ok)' }}>📌 {k.name}：{k.values.join(', ')}</div>))}
                    </>
                  )}
                  {log.asserts?.length > 0 && (
                    <>
                      <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 6 }}>断言</div>
                      {log.asserts.map((a, j) => (
                        <div key={j} style={{ color: a.pass ? 'var(--ok)' : 'var(--fail)' }}>
                          {a.pass ? '✓' : '✗'} {a.label || a.expr}
                        </div>
                      ))}
                    </>
                  )}
                  {log.type !== 'http' && log.message && <div style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{log.message}</div>}
                </div>
              )}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 14 }}>
          <button onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
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
    <div className="modal-mask" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 640 }}>
        <h3>导入 cURL 命令</h3>
        <p style={{ color: 'var(--muted)', fontSize: 12 }}>粘贴浏览器 "Copy as cURL" 的完整命令，自动解析为 HTTP 请求节点。</p>
        <textarea
          className="mono" rows={5}
          placeholder={`curl 'https://example.com/api' \\\n  -H 'cookie: sess=...' \\\n  --data-raw '{"a":1}'`}
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
        />
        <div style={{ marginTop: 8 }}>
          <button className="primary" disabled={busy || !cmd.trim()} onClick={parse}>解析预览</button>
          {' '}
          <button onClick={onClose}>取消</button>
        </div>
        {err && <p style={{ color: 'var(--fail)', fontSize: 12 }}>{err}</p>}
        {preview && (
          <div style={{ marginTop: 10, border: '1px solid var(--border)', borderRadius: 8, padding: 10, fontSize: 12 }}>
            <div><b>{preview.method}</b> <span className="mono">{preview.url}</span></div>
            {preview.headers.length > 0 && (
              <div style={{ color: 'var(--muted)', marginTop: 4 }}>
                {preview.headers.map((h) => `${h.name}: ${h.value.length > 40 ? h.value.slice(0, 40) + '…' : h.value}`).join(' | ')}
              </div>
            )}
            {preview.body && <div className="mono" style={{ marginTop: 4, wordBreak: 'break-all' }}>body: {preview.body.slice(0, 120)}</div>}
            <button className="primary" style={{ marginTop: 8 }} disabled={busy} onClick={create}>创建任务</button>
          </div>
        )}
      </div>
    </div>
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
    <div className="modal-mask" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 640 }}>
        <h3>批量创建任务：{tpl.name}</h3>
        <p style={{ color: 'var(--muted)', fontSize: 12 }}>
          首行为变量名（如 <code className="mono">name,cookie</code>，name 列可选作任务名），每行一条任务。
          {tpl.varNames.length > 0 && <> 模板变量：{tpl.varNames.join(', ')}</>}
        </p>
        <textarea
          className="mono" rows={6}
          placeholder={`name,cookie\n主号,sess=xxx\n备用,sess=yyy`}
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
        />
        {err && <p style={{ color: 'var(--fail)', fontSize: 12 }}>{err}</p>}
        {result && (
          <p style={{ color: 'var(--ok)', fontSize: 12 }}>
            已创建 {result.created} 个任务{result.errors?.length ? `，${result.errors.length} 行失败` : ''}
          </p>
        )}
        <button className="primary" disabled={busy || !csv.trim()} onClick={submit}>{busy ? '创建中…' : '批量创建'}</button>
        {' '}
        <button onClick={onClose}>关闭</button>
      </div>
    </div>
  );
}

/** 系统设置：改密 + API Key */
function SettingsModal({ onClose }) {
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [key, setKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  useEffect(() => { api.systemSettings().then((s) => setHasKey(s.hasApiKey)).catch(() => {}); }, []);
  const changePw = async () => {
    setErr(''); setMsg('');
    try { await api.changePassword(oldPw, newPw); setMsg('密码已改，请重新登录'); setOldPw(''); setNewPw(''); }
    catch (e) { setErr(e.message); }
  };
  const genKey = async () => {
    try { const r = await api.genApiKey(); setKey(r.apiKey); setHasKey(true); }
    catch (e) { setErr(e.message); }
  };
  return (
    <div className="modal-mask" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>设置</h3>
        <SettingsFlow onToast={(text, kind) => { setMsg(text); setErr(''); }} />
        <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '16px 0' }} />
        <div className="field">
          <label>当前密码</label>
          <input type="password" autoComplete="off" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
        </div>
        <div className="field">
          <label>新密码（至少 8 位）</label>
          <input type="password" autoComplete="off" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
        </div>
        <button className="primary" onClick={changePw}>改密</button>
        <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '16px 0' }} />
        <div className="field">
          <label>API Key（{hasKey ? '已生成' : '未生成'}）</label>
          {key && <pre className="mono" style={{ wordBreak: 'break-all', fontSize: 12 }}>{key}</pre>}
          <button className="small" onClick={genKey}>{hasKey ? '重新生成' : '生成 API Key'}</button>
        </div>
        {msg && <p style={{ color: 'var(--ok)', fontSize: 12 }}>{msg}</p>}
        {err && <p style={{ color: 'var(--fail)', fontSize: 12 }}>{err}</p>}
        <button onClick={onClose}>关闭</button>
      </div>
    </div>
  );
}

/* 设置内：每日汇总定时 */
function SettingsFlow({ onToast }) {
  const [cfg, setCfg] = useState({ enabled: false, time: '08:00', timezone: 'Asia/Shanghai', targetFlowId: '' });
  const [flows, setFlows] = useState([]);
  const [marketUrl, setMarketUrl] = useState('');
  useEffect(() => {
    api.dailySummaryConfig().then(setCfg).catch(() => {});
    api.flows().then(setFlows).catch(() => setFlows([]));
  }, []);
  return (
    <>
      <div className="field">
        <label>每日汇总（自动）</label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={!!cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} />
          每天 {cfg.time} 自动发送到所选任务的通知渠道
        </label>
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input type="time" style={{ width: 110 }} value={cfg.time} onChange={(e) => setCfg({ ...cfg, time: e.target.value })} />
          <select value={cfg.targetFlowId || ''} onChange={(e) => setCfg({ ...cfg, targetFlowId: e.target.value })}>
            <option value="">选有渠道的任务</option>
            {flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <button className="small" onClick={async () => {
            try { const r = await api.saveDailySummaryConfig(cfg); setCfg(r); onToast('每日汇总已保存'); }
            catch (e) { onToast(e.message); }
          }}>保存</button>
        </div>
      </div>
      <div className="field">
        <label>模板市场（从 URL 导入索引 JSON）</label>
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
    <div className="modal-mask" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 640 }}>
        <h3>从备份恢复</h3>
        <p style={{ color: 'var(--muted)', fontSize: 12 }}>粘贴备份 JSON（「备份」按钮下载的文件）。恢复任务带「（恢复）」后缀且默认停用，手动启用后运行。</p>
        <textarea className="mono" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder='{"flows": [...]}' />
        {doneInfo && <p style={{ color: 'var(--ok)', fontSize: 12 }}>已恢复 {doneInfo.createdFlows?.length || 0} 个任务、{doneInfo.createdTemplates?.length || 0} 个模板</p>}
        {err && <p style={{ color: 'var(--fail)', fontSize: 12 }}>{err}</p>}
        <button className="primary" disabled={busy || !text.trim()} onClick={submit}>{busy ? '恢复中…' : '开始恢复'}</button>
        {' '}
        <button onClick={onClose}>取消</button>
      </div>
    </div>
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
    <div className="modal-mask" onClick={(e) => e.target === e.currentTarget && onDone()}>
      <div className="modal">
        <h3>管理模板：{tpl.name}</h3>
        {detail && (
          <p style={{ color: 'var(--muted)', fontSize: 12 }}>
            {detail.nodes.length} 个节点 · {vars.length} 个默认变量（实例化时预填）
          </p>
        )}
        <div className="field">
          <label>模板名</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>描述</label>
          <input value={desc} onChange={(e) => setDesc(e.target.value)} />
        </div>
        <div className="field">
          <label>默认变量值（敏感项建议留空，实例化时再填真实值）</label>
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
        <button className="primary" onClick={save}>保存</button>
        {' '}
        <button onClick={onDone}>取消</button>
      </div>
    </div>
  );
}

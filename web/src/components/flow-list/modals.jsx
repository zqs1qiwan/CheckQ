import React, { useEffect, useState } from 'react';
import { api } from '../../api.js';
import Modal from '../Modal.jsx';
import { confirmDialog } from '../../confirm.jsx';
import { setToast } from './helpers.js';

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
      title={`站内通知${data ? `（${data.total} 条，未读 ${data.unread}）` : ''}`}
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
      subtitle={detail ? `${detail.nodes.length} 个节点，${vars.length} 个默认变量` : ''}
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

/** 批量设置分组（列表「分组…」按钮） */
function GroupAssignModal({ ids, groups = [], onClose, onDone }) {
  const [group, setGroup] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api.batch(ids, 'set-group', { group: group.trim() });
      setToast(`已设置 ${r.ok || 0}/${r.total || ids.length} 个任务的分组`, 'ok');
      onDone?.(group.trim());
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal
      title={`分组：已选 ${ids.length} 个任务`}
      onClose={onClose}
      width={440}
      footer={
        <>
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={busy} onClick={submit}>{busy ? '设置中…' : '设置分组'}</button>
        </>
      }
    >
      <div className="field">
        <label title="留空=移出分组；填已有分组名=并入该组">分组名</label>
        <input
          list="checkq-group-options-batch"
          value={group}
          aria-label="分组名"
          autoFocus
          onChange={(e) => setGroup(e.target.value)}
          placeholder="例如：签到 / 监控 / 实验（留空=未分组）"
        />
        <datalist id="checkq-group-options-batch">
          {groups.map((g) => <option key={g} value={g} />)}
        </datalist>
      </div>
      <p className="hint" style={{ margin: 0 }}>分组只影响列表的折叠与统计展示，不改变任务的调度与执行。</p>
      {err && <p style={{ color: 'var(--fail)', fontSize: 12, margin: '8px 0 0' }}>{err}</p>}
    </Modal>
  );
}

export { InstantiateModal, CurlImportModal, CsvImportModal, NotificationsModal, RestoreModal, TemplateEditorModal, BackupFullModal, GroupAssignModal };


import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, addEdge,
  useNodesState, useEdgesState, Handle, Position, MarkerType, useReactFlow,
} from '@xyflow/react';
import { api } from '../api.js';
import { STEP_TYPES, OUTPUT_LABELS, defaultConfig } from '../stepTypes.js';
import { currentMode, onMode } from '../theme.js';
import ThemeToggle from './ThemeToggle.jsx';
import ConfigPanel from './ConfigPanel.jsx';
import RunDrawer from './RunDrawer.jsx';

const COLOR = Object.fromEntries(Object.entries(STEP_TYPES).map(([k, v]) => [k, v.color]));

function fmtTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function StepNode({ id, data, selected }) {
  const meta = STEP_TYPES[data.type] || { color: '#666', outputs: ['next'] };
  const rs = data.runStatus; // 'running' | 'ok' | 'failed' | undefined
  return (
    <div className={`node ${selected ? 'selected' : ''} ${rs ? `run-${rs}` : ''}`} style={{ minWidth: 170 }}>
      <div className="node-bar" style={{ background: meta.color }} />
      <div className="node-title">{data.name || meta.label}</div>
      <div className="node-type">{meta.label}</div>
      {rs === 'running' && <span className="run-badge running" title="运行中">●</span>}
      {rs === 'ok' && <span className="run-badge ok" title="成功">✓</span>}
      {rs === 'failed' && <span className="run-badge failed" title="失败">✗</span>}
      <Handle type="target" position={Position.Left} />
      {meta.outputs.map((out, i) => (
        <React.Fragment key={out}>
          <Handle type="source" position={Position.Right} id={out} style={{ top: 30 + i * 20 }} />
          <span className="handle-label" style={{ top: 23 + i * 20 }}>{OUTPUT_LABELS[out]}</span>
        </React.Fragment>
      ))}
    </div>
  );
}

const nodeTypes = { step: StepNode };

export default function FlowEditor({ flowId, onBack }) {
  return (
    <ReactFlowProvider>
      <FlowEditorInner flowId={flowId} onBack={onBack} />
    </ReactFlowProvider>
  );
}

function FlowEditorInner({ flowId, onBack }) {
  const [flow, setFlow] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [runResult, setRunResult] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showPalette, setShowPalette] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth > 900));
  const [showConfig, setShowConfig] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth > 900));
  const [logOpen, setLogOpen] = useState(false);
  const [cookieOpen, setCookieOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [tplName, setTplName] = useState('');
  const [tplErr, setTplErr] = useState('');
  const [toast, setToast] = useState(null);
  const saveTimer = useRef(null);
  const stateRef = useRef({});
  const historyRef = useRef({ past: [], future: [] });
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [themeMode, setThemeMode] = useState(currentMode()); // 'dark' | 'light'（画布 attr 需要解析色值）
  const { screenToFlowPosition, fitView } = useReactFlow();

  useEffect(() => onMode(setThemeMode), []);

  // 面板/日志坞开合后重排视口：58 节点也能一屏看全，不用来回拖拽
  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.12, duration: 220 }), 90);
    return () => clearTimeout(t);
  }, [drawerOpen, showPalette, showConfig, fitView]);

  const snapshotGraph = useCallback(() => ({
    nodes: stateRef.current.nodes.map((n) => ({ id: n.id, type: 'step', position: { ...n.position }, data: JSON.parse(JSON.stringify(n.data)) })),
    edges: stateRef.current.edges.map((e) => ({ ...e, style: e.style ? { ...e.style } : undefined })),
  }), []);

  const pushHistory = useCallback(() => {
    historyRef.current.past.push(snapshotGraph());
    if (historyRef.current.past.length > 50) historyRef.current.past.shift();
    historyRef.current.future = [];
    setCanUndo(true);
    setCanRedo(false);
  }, [snapshotGraph]);

  const undo = useCallback(() => {
    const h = historyRef.current;
    if (!h.past.length) return;
    h.future.push(snapshotGraph());
    const prev = h.past.pop();
    setNodes(prev.nodes);
    setEdges(prev.edges);
    setCanUndo(h.past.length > 0);
    setCanRedo(true);
    setDirty(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(), 800);
  }, [snapshotGraph, setNodes, setEdges]);

  const redo = useCallback(() => {
    const h = historyRef.current;
    if (!h.future.length) return;
    h.past.push(snapshotGraph());
    const nxt = h.future.pop();
    setNodes(nxt.nodes);
    setEdges(nxt.edges);
    setCanRedo(h.future.length > 0);
    setCanUndo(true);
    setDirty(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(), 800);
  }, [snapshotGraph, setNodes, setEdges]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  stateRef.current = { nodes, edges, flow };

  useEffect(() => {
    api.flow(flowId).then((f) => {
      setFlow(f);
      setNodes((f.nodes || []).map((n) => ({
        id: n.id, type: 'step', position: { x: n.x, y: n.y }, data: { ...n },
      })));
      setEdges((f.edges || []).map((e) => decorateEdge({
        id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle,
      })));
    }).catch((e) => setLoadErr(e.message));
  }, [flowId]);

  const decorateEdge = (e) => ({
    ...e,
    animated: false,
    style: { stroke: '#2a3245', strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: '#2a3245' },
  });

  const showToast = (text, kind = 'fail') => {
    setToast({ text, kind });
    setTimeout(() => setToast(null), 3500);
  };

  const save = useCallback(async () => {
    const { nodes: ns, edges: es, flow: f } = stateRef.current;
    if (!f) return;
    setSaving(true);
    try {
      await api.updateFlow(f.id, {
        nodes: ns.map((n) => ({
          id: n.id, type: n.data.type, name: n.data.name,
          x: Math.round(n.position.x), y: Math.round(n.position.y),
          config: n.data.config,
          genBy: n.data.genBy,
        })),
        edges: es.map((e) => ({
          id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle,
        })),
      });
      setDirty(false);
    } catch (e) {
      showToast(`保存失败: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }, []);

  const markDirty = useCallback(() => {
    setDirty(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(), 1500);
  }, [save]);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedId),
    [nodes, selectedId]
  );

  const updateNode = useCallback((nodeId, patch) => {
    setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n)));
    markDirty();
  }, [setNodes, markDirty]);

  const updateConfig = useCallback((nodeId, patch) => {
    setNodes((ns) => ns.map((n) => (n.id === nodeId
      ? { ...n, data: { ...n.data, config: { ...n.data.config, ...patch } } }
      : n)));
    markDirty();
  }, [setNodes, markDirty]);

  const onConnect = useCallback((c) => {
    pushHistory();
    setEdges((es) => addEdge(decorateEdge({ ...c, id: `e${Date.now()}` }), es));
    markDirty();
  }, [setEdges, markDirty, pushHistory]);

  const addNodeAt = useCallback((type, pos) => {
    pushHistory();
    const id = `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    setNodes((ns) => [...ns, {
      id, type: 'step', position: pos,
      data: { id, type, name: STEP_TYPES[type].label, config: defaultConfig(type) },
    }]);
    markDirty();
  }, [setNodes, markDirty, pushHistory]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('application/checkq-step');
    if (!type) return;
    addNodeAt(type, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  }, [screenToFlowPosition, addNodeAt]);

  // 运行回显: 通过 data.runStatus 驱动节点样式(蓝=运行中/绿=成功/红=失败)
  const setRunStatus = useCallback((nodeId, status) => {
    setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, runStatus: status } } : n)));
  }, [setNodes]);
  const setRunStatusAll = useCallback((status) => {
    setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, runStatus: status } })));
  }, [setNodes]);

  const deleteNode = useCallback((id) => {
    pushHistory();
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
    if (selectedId === id) setSelectedId(null);
    markDirty();
  }, [setNodes, setEdges, selectedId, markDirty]);

  const runNow = useCallback(async () => {
    if (dirty) await save();
    setDrawerOpen(true);
    setRunResult({ id: 'pending', status: 'running', logs: [] });
    try {
      const r = await api.runFlowStream(flow.id, {
        onStart: () => {
          setRunResult({ id: 'pending', status: 'running', logs: [] });
          setRunStatusAll(null);
        },
        onLog: (log) => {
          setRunResult((cur) => ({ ...cur, status: 'running', logs: [...(cur.logs || []), log] }));
          setRunStatus(log.stepId, log.ok === false ? 'failed' : 'running');
        },
      });
      setRunResult(r);
      // 最终状态回显: running → ok/failed
      for (const log of r.logs || []) {
        if (log.ok === false) setRunStatus(log.stepId, 'failed');
        else setRunStatus(log.stepId, 'ok');
      }
      // 完成后保留最终态(成功绿/失败红), 下次运行 onStart 时清除
    } catch (e) {
      setRunResult({ id: 'err', status: 'failed', logs: [], finalMessage: e.message, durationMs: 0 });
    }
  }, [dirty, save, flow?.id]);

  const testNotify = async () => {
    try {
      const r = await api.notifyTest(flow.id);
      showToast(`测试通知已发送（${r.results?.length || 0} 个渠道）`, r.ok ? 'ok' : 'fail');
    } catch (e) { showToast(`测试通知失败：${e.message}`); }
  };
  const sendSummary = async () => {
    try {
      const r = await api.dailySummary(flow.id);
      showToast(r.text || '汇总已发送', 'ok');
    } catch (e) { showToast(`汇总发送失败：${e.message}`); }
  };

  const saveAsTemplate = async () => {
    if (dirty) await save();
    setTplName(flow.name.replace(/\s*·\s*\d+$/, '') + ' 模板');
    setTplErr('');
    setTplOpen(true);
  };
  const confirmSaveTemplate = async () => {
    const name = (tplName || '').trim();
    if (!name) { setTplErr('模板名称不能为空'); return; }
    try {
      const t = await api.saveFlowAsTemplate(flow.id, name);
      setTplOpen(false);
      showToast(`已存为模板「${t.name}」，可在首页基于它创建多个任务`, 'ok');
    } catch (e) {
      setTplErr(`保存模板失败: ${e.message}`);
    }
  };

  const debugTo = useCallback(async (nodeId) => {
    if (dirty) await save();
    const node = stateRef.current.nodes.find((n) => n.id === nodeId);
    setDrawerOpen(true);
    setRunResult({ id: 'pending', status: 'running', logs: [] });
    try {
      const r = await api.runFlowStream(flow.id, {
        debugStopId: nodeId,
        onStart: () => {
          setRunResult({ id: 'pending', status: 'running', logs: [] });
          setRunStatusAll(null);
        },
        onLog: (log) => {
          setRunResult((cur) => ({ ...cur, status: 'running', logs: [...(cur.logs || []), log] }));
          setRunStatus(log.stepId, log.ok === false ? 'failed' : 'running');
        },
      });
      setRunResult(r);
      for (const log of r.logs || []) {
        if (log.ok === false) setRunStatus(log.stepId, 'failed');
        else setRunStatus(log.stepId, 'ok');
      }
    } catch (e) {
      setRunResult({ id: 'err', status: 'failed', logs: [], finalMessage: e.message, durationMs: 0 });
    }
  }, [dirty, save, flow?.id]);

  const toggleEnabled = async () => {
    const f = await api.updateFlow(flow.id, { enabled: !flow.enabled });
    setFlow(f);
  };

  // 失败重选：原位替换失败节点的提取/断言配置（PRD §4.0.5）
  const replaceFailedNode = useCallback((picked, log) => {
    const { nodes: ns, flow: f } = stateRef.current;
    if (!f || !log.stepId) return;
    const node = ns.find((n) => n.id === log.stepId);
    if (!node) return;
    if (node.data.type === 'extract' && picked.nodes?.[0]) {
      updateConfig(node.id, { ...node.data.config, ...picked.nodes[0].config, name: picked.varName || node.data.config.name });
      showToast('已原位替换提取配置，立即重跑验证', 'ok');
    } else if (picked.assert) {
      // repick=原位替换整组断言，避免追加后旧错断言仍失败（PRD §4.0.5）
      const asserts = [picked.assert];
      updateConfig(node.id, { asserts });
      showToast('已原位替换断言，立即重跑验证', 'ok');
    }
    markDirty();
  }, [updateConfig, markDirty]);

  /** 点选结果 → 画布流式生长（PRD §4.0.1） */
  const handlePickResponse = useCallback(async (picked, log) => {
    const { nodes: ns, edges: es, flow: f } = stateRef.current;
    if (!f) return;

    // 1. 新增节点：接到产生该响应的 http 节点的下游链尾（引擎是单链执行器，
    //    同一出口多条边只走第一条，所以必须接在链尾而非另开分支）
    if (picked.nodes && picked.nodes.length) {
      const sourceId = log.stepId;
      const added = [];
      const edgesToAdd = [];

      // 沿默认出口（http:success / condition:true / 其他:next）找到链尾节点
      const defaultOut = (t) => (t === 'http' ? 'success' : t === 'condition' ? 'true' : 'next');
      let tailId = sourceId;
      const seen = new Set([sourceId]);
      for (;;) {
        const outEdges = es.filter((e) => e.source === tailId && (e.sourceHandle || '') === defaultOut(ns.find((n) => n.id === tailId)?.data?.type));
        const nextE = outEdges[0];
        if (!nextE || seen.has(nextE.target)) break;
        seen.add(nextE.target);
        tailId = nextE.target;
      }

      let prevId = tailId;
      for (const def of picked.nodes) {
        const id = `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
        const srcNode = ns.find((n) => n.id === prevId);
        // sourceHandle 取决于源节点的出口类型：http/condition 是分支出口，其余是 next
        const srcType = srcNode?.data?.type;
        const outHandle = (srcType === 'http' || srcType === 'condition')
          ? (srcType === 'http' ? 'success' : 'true')
          : 'next';
        added.push({
          id, type: 'step',
          position: { x: (srcNode?.position.x ?? 0) + 220, y: (srcNode?.position.y ?? 0) + (added.length) * 90 - 30 },
          data: { id, type: def.type, name: def.name, config: def.config, genBy: 'pick' },
        });
        edgesToAdd.push({
          id: `e${id}`,
          source: prevId, target: id,
          sourceHandle: outHandle,
        });
        prevId = id;
      }
      setNodes((cur) => [...cur, ...added]);
      setEdges((cur) => [...cur, ...edgesToAdd.map((e) => decorateEdge(e))]);
      markDirty();
      showToast(`已生成 ${added.length} 个节点（沿响应节点 success 边连接）`, 'ok');
      return;
    }

    // 2. 断言：合并进产生该响应的 http 节点
    if (picked.assert) {
      const nodeId = log.stepId;
      const node = ns.find((n) => n.id === nodeId);
      if (node) {
        const asserts = [...(node.data.config?.asserts || []), picked.assert];
        updateConfig(nodeId, { asserts });
        showToast('已合并断言到该请求节点（可编辑）', 'ok');
      }
      return;
    }

    // 3. 关键字规则：合并进 flow.log.keywords
    if (picked.keyword) {
      const logCfg = f.log && typeof f.log === 'object' ? f.log : { level: 'all', include: {}, keywords: [] };
      const keywords = [...(logCfg.keywords || []), picked.keyword];
      const newLog = { ...logCfg, keywords };
      const nf = await api.updateFlow(f.id, { log: newLog });
      setFlow(nf);
      showToast(`已添加关键字规则「${picked.keyword.name}」`, 'ok');
    }
  }, [setNodes, setEdges, markDirty, updateConfig]);

  if (loadErr) return <div className="boot">加载失败：{loadErr} <button className="small" onClick={onBack}>返回</button></div>;
  if (!flow) return <div className="boot">加载流程…</div>;
  const empty = nodes.length === 0;

  return (
    <>
      <div className="topbar editor-topbar">
        <button className="small" onClick={onBack}>返回</button>
        <input
          className="flow-title"
          value={flow.name}
          onChange={(e) => { setFlow({ ...flow, name: e.target.value }); markDirty(); }}
          onBlur={() => api.updateFlow(flow.id, { name: flow.name }).catch((e) => showToast(e.message))}
        />
        <details className="menu">
          <summary>调度</summary>
          <div className="menu-pop schedule-pop">
            <div className="field">
              <label>cron 表达式</label>
              <input
                className="mono"
                placeholder="30 8 * * *（留空=手动）"
                value={flow.cron || ''}
                onChange={(e) => setFlow({ ...flow, cron: e.target.value })}
                onBlur={(e) => api.updateFlow(flow.id, { cron: e.target.value }).then(() => showToast('调度已保存', 'ok')).catch((err) => showToast(err.message))}
              />
            </div>
            <div className="field-inline">
              <div className="field">
                <label>时区</label>
                <select
                  value={flow.timezone || 'Asia/Shanghai'}
                  onChange={(e) => { setFlow({ ...flow, timezone: e.target.value }); api.updateFlow(flow.id, { timezone: e.target.value }); }}
                >
                  <option value="Asia/Shanghai">Asia/Shanghai</option>
                  <option value="UTC">UTC</option>
                  <option value="Asia/Tokyo">Asia/Tokyo</option>
                  <option value="America/New_York">America/New_York</option>
                </select>
              </div>
              <div className="field">
                <label>抖动（分钟）</label>
                <input
                  type="number"
                  value={flow.jitterMinutes ?? 0}
                  title="cron 触发后随机延迟 0-N 分钟，0=不抖动"
                  onChange={(e) => setFlow({ ...flow, jitterMinutes: Number(e.target.value) || 0 })}
                  onBlur={(e) => api.updateFlow(flow.id, { jitterMinutes: Number(e.target.value) || 0 }).then(() => showToast('抖动已保存', 'ok')).catch((err) => showToast(err.message))}
                />
              </div>
            </div>
            <label className="checkline">
              <input type="checkbox" checked={!!flow.enabled} onChange={toggleEnabled} />
              启用定时调度
            </label>
          </div>
        </details>
        <button className={`small${showPalette ? ' active' : ''}`} onClick={() => setShowPalette((v) => !v)} title="显示/收起步骤积木">积木</button>
        <button className={`small${showConfig ? ' active' : ''}`} onClick={() => setShowConfig((v) => !v)} title="显示/收起参数面板">参数</button>
        <span className="spacer" />
        {saving ? <span style={{ color: 'var(--muted)', fontSize: 12 }}>保存中…</span> : dirty ? <span style={{ color: 'var(--warn)', fontSize: 12 }}>未保存</span> : null}
        <button className="small" disabled={!runResult} onClick={() => setDrawerOpen(true)} title={runResult ? '展开运行日志' : '先运行一次'}>日志</button>
        <button className="small primary" onClick={runNow} title="从头执行整个流程">运行</button>
        <details className="menu">
          <summary>···</summary>
          <div className="menu-pop" onClick={(e) => e.currentTarget.closest('details')?.removeAttribute('open')}>
            <button disabled={!canUndo} onClick={undo}>撤销</button>
            <button disabled={!canRedo} onClick={redo}>重做</button>
            <div className="menu-sep" />
            <button onClick={testNotify}>测试通知</button>
            <button onClick={sendSummary}>发送每日汇总</button>
            <button onClick={() => setCookieOpen(true)}>填入 Cookie</button>
            <button onClick={() => setLogOpen(true)}>日志配置</button>
            <button onClick={saveAsTemplate}>存为模板</button>
          </div>
        </details>
        <ThemeToggle />
      </div>

      <div className={`editor${showPalette ? '' : ' no-palette'}${showConfig ? '' : ' no-config'}`} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <div className="editor-main">
        <div className="palette">
          <div className="panel-head">
            <h4>步骤积木</h4>
            <button className="linkbtn" onClick={() => setShowPalette(false)}>收起</button>
          </div>
          {Object.entries(STEP_TYPES).map(([type, meta]) => (
            <div
              key={type}
              className="item"
              draggable
              title="点击直接加到画布，或拖到画布指定位置"
              onDragStart={(e) => e.dataTransfer.setData('application/checkq-step', type)}
              onClick={() => addNodeAt(type, { x: 80 + (nodes.length % 3) * 40, y: 60 + (nodes.length % 3) * 40 })}
            >
              <span className="dot" style={{ background: meta.color }} />
              {meta.label}
            </div>
          ))}
          <div className="hint">
            点击左侧积木直接加到画布<br />
            或拖拽到画布添加节点<br />
            拉动节点右侧圆点连线<br />
            点节点配置，Delete 删除
          </div>
          <div className="section-title">流程变量</div>
          <VarsEditor flow={flow} onVars={(vars) => api.updateFlow(flow.id, { vars }).then(setFlow)} />
        </div>

        <div className="canvas-wrap">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={(chg) => { onNodesChange(chg); if (chg.some((c) => c.type === 'position' || c.type === 'remove')) markDirty(); }}
            onEdgesChange={(chg) => { onEdgesChange(chg); if (chg.some((c) => c.type === 'remove')) markDirty(); }}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            deleteKeyCode={['Delete', 'Backspace']}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background color={themeMode === 'dark' ? '#232933' : '#d8d2c6'} gap={22} />
            <Controls />
            <MiniMap
              pannable
              nodeColor={(n) => COLOR[n.data.type] || '#666'}
              maskColor={themeMode === 'dark' ? 'rgba(15,17,21,.7)' : 'rgba(244,242,237,.72)'}
              style={{ background: themeMode === 'dark' ? '#161a20' : '#fffefa' }}
            />
          </ReactFlow>

          {empty && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 5 }}>
              <div style={{ background: 'var(--panel)', border: '1px dashed var(--border)', borderRadius: 14, padding: '26px 32px', textAlign: 'center', pointerEvents: 'auto', maxWidth: 420 }}>
                <p style={{ margin: '0 0 6px', fontWeight: 600 }}>空白流程</p>
                <p style={{ margin: '0 0 12px', color: 'var(--muted)', fontSize: 12, lineHeight: 1.7 }}>
                  从「积木」里点 HTTP 请求开始：填 URL（支持 <code>{'{{变量}}'}</code>）→ 再加一个日志节点 → 点「运行」验证。
                </p>
                <button className="small primary" onClick={() => addNodeAt('http', { x: 80, y: 60 })}>+ 加一个 HTTP 请求</button>
              </div>
            </div>
          )}
        </div>

        <ConfigPanel
          node={selectedNode?.data}
          onUpdate={(patch) => updateNode(selectedId, patch)}
          onConfigUpdate={(p) => updateConfig(selectedId, p)}
          onDelete={() => deleteNode(selectedId)}
          onDebugTo={debugTo}
          flowId={flow?.id}
          flowVars={flow?.vars || {}}
          onCollapse={() => setShowConfig(false)}
        />
        </div>

        {drawerOpen && (
          <RunDrawer run={runResult} flowId={flow.id} onClose={() => setDrawerOpen(false)} onPickResponse={handlePickResponse} onRepPick={replaceFailedNode} />
        )}
      </div>

      {logOpen && <LogConfigModal flow={flow} onClose={() => setLogOpen(false)} onSaved={(f) => setFlow(f)} />}

      {cookieOpen && (
        <CookieHelpModal
          flow={flow}
          onClose={() => setCookieOpen(false)}
          onSaved={async ({ cookie }) => {
            const nf = await api.updateFlow(flow.id, { vars: { ...(flow.vars || {}), cookie: cookie.trim() } });
            setFlow(nf);
            showToast('cookie 已保存到变量', 'ok');
            return nf;
          }}
        />
      )}

      {tplOpen && (
        <div className="modal-mask" onClick={(e) => e.target === e.currentTarget && setTplOpen(false)}>
          <div className="modal">
            <h3>存为模板</h3>
            <p style={{ color: 'var(--muted)', fontSize: 12 }}>模板会带走节点/连线/变量/日志/通知，之后可基于它批量创建任务。</p>
            <div className="field">
              <label>模板名称</label>
              <input value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="如：恩山签到模板" />
            </div>
            {tplErr && <p style={{ color: 'var(--fail)', fontSize: 12 }}>{tplErr}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="primary" onClick={confirmSaveTemplate}>保存为模板</button>
              <button onClick={() => setTplOpen(false)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.kind}`} onClick={() => setToast(null)}>{toast.text}</div>}
    </>
  );
}

function CookieHelpModal({ flow, onClose, onSaved }) {
  const [url, setUrl] = useState('https://');
  const [cookie, setCookie] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const [tabId, setTabId] = useState('');
  const origin = window.location.origin;
  const captureUrl = `${origin}/api/cookie-capture`;
  const bookmarklet = `javascript:fetch('${captureUrl}',{method:'POST',headers:{'Content-Type':'application/json'},mode:'no-cors',body:JSON.stringify({flowId:'${flow?.id || ''}',cookie:document.cookie,varName:'cookie'})}).then(()=>alert('已回填到 CheckQ'));`;
  const snippet = "copy(document.cookie); // 备用：已登录页面 Console 回车后粘贴";
  const openLogin = () => window.open(url, '_blank');
  const unified = async () => {
    try {
      setErr('');
      const r = await api.browserLoginStart(flow.id, url.trim());
      setTabId(r.tabId);
      setDone(false);
    } catch (e) { setErr(e.message); }
  };
  const captureNow = async () => {
    try {
      setErr('');
      const r = await api.browserLoginCapture(flow.id, tabId);
      setCookie(`已抓到 ${r.length} 字符，已写入 {{${r.varName}}}`);
      setDone(true);
      onSaved({ cookie: '' }); // 已由服务端写入
      setTimeout(onClose, 800);
    } catch (e) { setErr(e.message); }
  };
  const save = async () => {
    try {
      const f = await onSaved({ cookie: cookie.trim() });
      if (f) { setDone(true); setTimeout(onClose, 600); }
    } catch (e) { setErr(e.message); }
  };
  return (
    <div className="modal-mask" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>统一浏览器登录（自动抓 Cookie）</h3>
        <p style={{ color: 'var(--muted)', fontSize: 12, lineHeight: 1.7 }}>
          统一浏览器是路由器上的 Camoufox（与真实浏览器指纹一致）。步骤：
          <br />
          1. 点「打开登录页」→ CheckQ 在统一浏览器打开站点，你在那登录一次
          <br />
          2. 回到这里点「已登录，自动抓」→ CheckQ 自动读 cookie 写进 <code>{'{{cookie}}'}</code>，无需粘贴
          <br />
          3. 点「运行」验证
        </p>
        <div className="field">
          <label>站点地址</label>
          <input className="mono" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <button className="primary" onClick={unified}>打开登录页（统一浏览器）</button>
          <button className="small" disabled={!tabId} onClick={captureNow}>已登录，自动抓 Cookie</button>
        </div>
        {tabId && <p style={{ color: 'var(--muted)', fontSize: 11 }}>tab: {String(tabId).slice(0, 12)}… 登录后点上方抓取</p>}
        <pre className="mono" style={{ background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, fontSize: 11, wordBreak: 'break-all', userSelect: 'all', color: 'var(--muted)' }}>{bookmarklet}</pre>
        <div className="field">
          <label>备用：粘贴 cookie 后保存</label>
          <input className="mono" readOnly value={snippet} onFocus={(e) => e.target.select()} />
        </div>
        <div className="field">
          <textarea className="mono" rows={2} value={cookie} onChange={(e) => setCookie(e.target.value)} placeholder="或在这里粘贴 cookie" />
        </div>
        {done && <p style={{ color: 'var(--ok)', fontSize: 12 }}>已回填到变量</p>}
        {err && <p style={{ color: 'var(--fail)', fontSize: 12 }}>{err}</p>}
        <button className="primary" disabled={!cookie.trim()} onClick={save}>保存 cookie</button>
        {' '}
        <button onClick={onClose}>取消</button>
      </div>
    </div>
  );
}

/** 日志配置抽屉（PRD §4.7.4）：level 三档 + include 四开关 + resBodyLimit + keywords 规则表 */
function LogConfigModal({ flow, onClose, onSaved }) {
  const cur = flow.log && typeof flow.log === 'object' ? flow.log : {};
  const [record, setRecord] = useState(cur.record || 'all');
  const [include, setInclude] = useState({
    reqHeaders: cur.include?.reqHeaders !== false,
    reqBody: cur.include?.reqBody !== false,
    resBody: cur.include?.resBody !== false,
    varsSnapshot: cur.include?.varsSnapshot !== false,
  });
  const [resBodyLimit, setResBodyLimit] = useState(cur.resBodyLimit ?? 2000);
  const [keywords, setKeywords] = useState(Array.isArray(cur.keywords) ? cur.keywords : []);
  const [err, setErr] = useState('');

  const save = async () => {
    try {
      const nf = await api.updateFlow(flow.id, { log: { level, record, include, resBodyLimit: Number(resBodyLimit) || 0, keywords } });
      onSaved(nf);
      onClose();
    } catch (e) { setErr(e.message); }
  };

  const chk = (k, label) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 13 }}>
      <input type="checkbox" style={{ width: 'auto' }} checked={include[k]} onChange={(e) => setInclude({ ...include, [k]: e.target.checked })} />
      {label}
    </label>
  );

  return (
    <div className="modal-mask" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>日志配置：{flow.name}</h3>
        <div className="field">
          <label>记录档位（低档位自动忽略下方内容开关）</label>
          <select value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="all">all —— 全部步骤完整记录（调试期）</option>
            <option value="failure">failure —— 仅失败步骤完整记录（稳定运行期）</option>
            <option value="summary">summary —— 只记标题/关键字/耗时（长期免维护）</option>
          </select>
        </div>
        <div className="field">
          <label>记录范围（决定运行日志里出现哪些步骤）</label>
          <select value={record} onChange={(e) => setRecord(e.target.value)}>
            <option value="all">全部步骤（调试：每个节点一行）</option>
            <option value="log">仅 log 节点（qinglong/qiandao 风格：只看调教好的干净日志）</option>
            <option value="log-final">合并为一条（所有 log 合并成最终一条日志）</option>
          </select>
        </div>
        <div className="field">
          <label>记录内容开关（仅 all 档生效）</label>
          {chk('reqHeaders', '请求头')}
          {chk('reqBody', '请求体')}
          {chk('resBody', '响应体')}
          {chk('varsSnapshot', '运行后变量快照')}
        </div>
        <div className="field">
          <label>响应体截断长度（字符，0 = 不记录）</label>
          <input className="mono" type="number" min={0} max={100000} value={resBodyLimit} onChange={(e) => setResBodyLimit(e.target.value)} />
        </div>
        <div className="field">
          <label>关键字规则（命中值进运行摘要；仅影响日志/通知，不影响流程执行）</label>
          {keywords.map((k, i) => (
            <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 8, marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <input style={{ flex: 1 }} placeholder="规则名（如 积分）" value={k.name || ''} onChange={(e) => setKeywords(keywords.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <button className="small danger" onClick={() => setKeywords(keywords.filter((_, j) => j !== i))}>删除</button>
              </div>
              <input className="mono" placeholder="正则（第 1 捕获组为值）" value={k.regex || ''} onChange={(e) => setKeywords(keywords.map((x, j) => (j === i ? { ...x, regex: e.target.value } : x)))} style={{ marginBottom: 6 }} />
              <div style={{ display: 'flex', gap: 6 }}>
                <select value={k.from || 'response'} onChange={(e) => setKeywords(keywords.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))}>
                  <option value="response">响应体</option>
                  <option value="headers">响应头</option>
                  <option value="status">状态码</option>
                </select>
                <select value={k.into || 'summary'} onChange={(e) => setKeywords(keywords.map((x, j) => (j === i ? { ...x, into: e.target.value } : x)))}>
                  <option value="summary">进摘要</option>
                  <option value="notify">进通知</option>
                  <option value="var">写变量(仅日志侧)</option>
                </select>
              </div>
            </div>
          ))}
          <button className="small" onClick={() => setKeywords([...keywords, { name: '新规则', regex: '', from: 'response', into: 'summary' }])}>+ 添加规则</button>
        </div>
        {err && <p style={{ color: 'var(--fail)', fontSize: 12 }}>{err}</p>}
        <button className="primary" onClick={save}>保存</button>
        {' '}
        <button onClick={onClose}>关闭</button>
      </div>
    </div>
  );
}

function VarsEditor({ flow, onVars }) {
  const [vars, setVars] = useState(flow.vars || {});
  const [nk, setNk] = useState('');
  const [nv, setNv] = useState('');

  useEffect(() => setVars(flow.vars || {}), [flow]);

  const add = () => {
    if (!nk.trim()) return;
    const next = { ...vars, [nk.trim()]: nv };
    setVars(next);
    setNk(''); setNv('');
    onVars(next);
  };
  const remove = (k) => {
    const next = { ...vars };
    delete next[k];
    setVars(next);
    onVars(next);
  };
  const change = (k, v) => setVars({ ...vars, [k]: v });
  const [missing, setMissing] = useState(null);
  useEffect(() => {
    api.runs(flow.id, 5).then((runs) => {
      const set = new Set();
      for (const r of runs) for (const l of r.logs || []) for (const m of l.missing || []) set.add(m);
      setMissing([...set]);
    }).catch(() => setMissing([]));
  }, [flow.id]);

  const isSensitive = (k) => /cookie|token|password|secret|key/i.test(k);

  return (
    <div>
      {Object.keys(vars).length === 0 && (
        <p style={{ color: 'var(--muted)', fontSize: 11, lineHeight: 1.6, marginBottom: 8 }}>
          暂无变量。在请求里写 {'{{cookie}}'} 即可，运行时会自动替换；敏感值（cookie/token）请在这里填。
        </p>
      )}
      {missing && missing.length > 0 && (
        <div style={{ border: '1px solid var(--warn)', borderRadius: 8, padding: 8, marginBottom: 8, fontSize: 11 }}>
          ⚠ 运行日志里出现过未定义的变量：{missing.join('、 ')}
          <div style={{ color: 'var(--muted)' }}>在下面「变量名」输入同名后填值（顺序随便），重跑即自动替换。</div>
        </div>
      )}
      {Object.entries(vars).map(([k, v]) => {
        const sensitive = isSensitive(k);
        const [open, setOpen] = useState(!sensitive);
        return (
          <div key={k} style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input className="mono" style={{ fontSize: 11, padding: '4px 6px' }} value={k} disabled />
              <button className="small" style={{ padding: '2px 7px' }} title={open ? '隐藏值' : '显示值'} onClick={() => setOpen(!open)}>{open ? '🙈' : '👁'}</button>
              <button className="small danger" style={{ padding: '2px 7px' }} onClick={() => remove(k)}>×</button>
            </div>
            {open ? (
              <textarea
                className="mono"
                style={{ fontSize: 11, padding: '4px 6px', marginTop: 3 }}
                rows={Math.min(3, String(v).length / 60 + 1)}
                value={v}
                onChange={(e) => change(k, e.target.value)}
                onBlur={() => onVars(vars)}
              />
            ) : (
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>•••••••• <button className="small" onClick={() => setOpen(true)}>显示</button></div>
            )}
          </div>
        );
      })}
      <input style={{ fontSize: 11, padding: '4px 6px', marginBottom: 4 }} placeholder="变量名" value={nk} onChange={(e) => setNk(e.target.value)} />
      <input style={{ fontSize: 11, padding: '4px 6px', marginBottom: 4 }} placeholder="值" value={nv} onChange={(e) => setNv(e.target.value)} />
      <button className="small" style={{ width: '100%' }} onClick={add}>+ 添加变量</button>
    </div>
  );
}

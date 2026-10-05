import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, addEdge,
  useNodesState, useEdgesState, Handle, Position, MarkerType, useReactFlow,
} from '@xyflow/react';
import { api } from '../api.js';
import { STEP_TYPES, OUTPUT_LABELS, defaultConfig } from '../stepTypes.js';
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
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [runResult, setRunResult] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const saveTimer = useRef(null);
  const stateRef = useRef({});
  const { screenToFlowPosition } = useReactFlow();

  stateRef.current = { nodes, edges, flow };

  useEffect(() => {
    api.flow(flowId).then((f) => {
      setFlow(f);
      setNodes(f.nodes.map((n) => ({
        id: n.id, type: 'step', position: { x: n.x, y: n.y }, data: { ...n },
      })));
      setEdges(f.edges.map((e) => decorateEdge({
        id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle,
      })));
    });
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
    setEdges((es) => addEdge(decorateEdge({ ...c, id: `e${Date.now()}` }), es));
    markDirty();
  }, [setEdges, markDirty]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('application/checkq-step');
    if (!type) return;
    const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const id = `n${Date.now().toString(36)}`;
    setNodes((ns) => [...ns, {
      id, type: 'step', position: pos,
      data: { id, type, name: STEP_TYPES[type].label, config: defaultConfig(type) },
    }]);
    markDirty();
  }, [screenToFlowPosition, setNodes, markDirty]);

  // 运行回显: 通过 data.runStatus 驱动节点样式(蓝=运行中/绿=成功/红=失败)
  const setRunStatus = useCallback((nodeId, status) => {
    setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, runStatus: status } } : n)));
  }, [setNodes]);
  const setRunStatusAll = useCallback((status) => {
    setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, runStatus: status } })));
  }, [setNodes]);

  const deleteNode = useCallback((id) => {
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

  const saveAsTemplate = async () => {
    if (dirty) await save();
    const name = prompt('模板名称：', flow.name.replace(/\s*·\s*\d+$/, '') + ' 模板');
    if (name === null) return;
    try {
      const t = await api.saveFlowAsTemplate(flow.id, name);
      showToast(`已存为模板「${t.name}」，可在首页基于它创建多个任务`, 'ok');
    } catch (e) {
      showToast(`保存模板失败: ${e.message}`);
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

  if (!flow) return <div className="boot">加载流程…</div>;

  return (
    <>
      <div className="topbar">
        <button className="small" onClick={onBack}>← 返回</button>
        <input
          style={{ width: 220, fontWeight: 600, background: 'transparent', border: 'none', padding: '4px 2px' }}
          value={flow.name}
          onChange={(e) => { setFlow({ ...flow, name: e.target.value }); markDirty(); }}
          onBlur={() => api.updateFlow(flow.id, { name: flow.name }).catch((e) => showToast(e.message))}
        />
        <input
          className="mono" style={{ width: 130 }}
          placeholder="cron 30 8 * * *"
          value={flow.cron || ''}
          title="留空=手动运行。例: 30 8 * * * 每天 8:30"
          onChange={(e) => setFlow({ ...flow, cron: e.target.value })}
          onBlur={(e) => api.updateFlow(flow.id, { cron: e.target.value }).then(() => showToast('调度已保存', 'ok')).catch((err) => showToast(err.message))}
        />
        <select
          style={{ width: 150 }}
          value={flow.timezone || 'Asia/Shanghai'}
          onChange={(e) => { setFlow({ ...flow, timezone: e.target.value }); api.updateFlow(flow.id, { timezone: e.target.value }); }}
        >
          <option value="Asia/Shanghai">Asia/Shanghai</option>
          <option value="UTC">UTC</option>
          <option value="Asia/Tokyo">Asia/Tokyo</option>
          <option value="America/New_York">America/New_York</option>
        </select>
        <label className="switch" title={flow.enabled ? '点击停用调度' : '点击启用调度'}>
          <input type="checkbox" checked={!!flow.enabled} onChange={toggleEnabled} />
          <span className="track" />
        </label>
        <span className="spacer" />
        {saving ? <span style={{ color: 'var(--muted)', fontSize: 12 }}>保存中…</span> : dirty ? <span style={{ color: 'var(--warn)', fontSize: 12 }}>未保存</span> : null}
        <button onClick={saveAsTemplate} title="把当前流程保存为模板，之后可基于它批量创建任务">存为模板</button>
        <button className="primary" onClick={runNow} title="从头执行整个流程">▶ 运行</button>
      </div>

      <div className="editor" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <div className="palette">
          <h4>步骤积木</h4>
          {Object.entries(STEP_TYPES).map(([type, meta]) => (
            <div
              key={type}
              className="item"
              draggable
              onDragStart={(e) => e.dataTransfer.setData('application/checkq-step', type)}
            >
              <span className="dot" style={{ background: meta.color }} />
              {meta.label}
            </div>
          ))}
          <div className="hint">
            拖拽到画布添加节点<br />
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
            <Background color="#1a2130" gap={22} />
            <Controls />
            <MiniMap
              pannable
              nodeColor={(n) => COLOR[n.data.type] || '#666'}
              maskColor="rgba(11,14,20,.7)"
              style={{ background: '#12161f' }}
            />
          </ReactFlow>

          {drawerOpen && (
            <RunDrawer run={runResult} flowId={flow.id} onClose={() => setDrawerOpen(false)} onPickResponse={handlePickResponse} />
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
        />
      </div>

      {toast && <div className={`toast ${toast.kind}`} onClick={() => setToast(null)}>{toast.text}</div>}
    </>
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

  return (
    <div>
      {Object.entries(vars).map(([k, v]) => (
        <div key={k} style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input className="mono" style={{ fontSize: 11, padding: '4px 6px' }} value={k} disabled />
            <button className="small danger" style={{ padding: '2px 7px' }} onClick={() => remove(k)}>×</button>
          </div>
          <textarea
            className="mono"
            style={{ fontSize: 11, padding: '4px 6px', marginTop: 3 }}
            rows={Math.min(3, String(v).length / 60 + 1)}
            value={v}
            onChange={(e) => change(k, e.target.value)}
            onBlur={() => onVars(vars)}
          />
        </div>
      ))}
      <input style={{ fontSize: 11, padding: '4px 6px', marginBottom: 4 }} placeholder="变量名" value={nk} onChange={(e) => setNk(e.target.value)} />
      <input style={{ fontSize: 11, padding: '4px 6px', marginBottom: 4 }} placeholder="值" value={nv} onChange={(e) => setNv(e.target.value)} />
      <button className="small" style={{ width: '100%' }} onClick={add}>+ 添加变量</button>
    </div>
  );
}

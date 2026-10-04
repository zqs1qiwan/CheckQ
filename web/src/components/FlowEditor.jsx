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
  return (
    <div className={`node ${selected ? 'selected' : ''}`} style={{ minWidth: 170 }}>
      <div className="node-bar" style={{ background: meta.color }} />
      <div className="node-title">{data.name || meta.label}</div>
      <div className="node-type">{meta.label}</div>
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
      const r = await api.runFlow(flow.id);
      setRunResult(r);
    } catch (e) {
      setRunResult({ id: 'err', status: 'failed', logs: [], finalMessage: e.message, durationMs: 0 });
    }
  }, [dirty, save, flow?.id]);

  const toggleEnabled = async () => {
    const f = await api.updateFlow(flow.id, { enabled: !flow.enabled });
    setFlow(f);
  };

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
        <button className="primary" onClick={runNow}>▶ 运行</button>
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
            <RunDrawer run={runResult} flowId={flow.id} onClose={() => setDrawerOpen(false)} />
          )}
        </div>

        <ConfigPanel
          node={selectedNode?.data}
          onUpdate={(patch) => updateNode(selectedId, patch)}
          onConfigUpdate={(p) => updateConfig(selectedId, p)}
          onDelete={() => deleteNode(selectedId)}
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

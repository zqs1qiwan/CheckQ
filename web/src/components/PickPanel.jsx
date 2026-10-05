/**
 * Pick Panel — 点选即逻辑（PRD §4.0 核心差异化）
 * 输入一段响应体，按内容类型渲染为可点选视图：
 *   JSON → 树形展开，点击叶子值
 *   文本/HTML → 划选文字
 * 点选后弹出用途选择器：存为变量 / 断言成功 / 记录到日志 / 加进通知
 * 产物全部是标准节点 config（前端只是代码生成器，PRD §4.0.4 确定性原则）。
 */
import React, { useMemo, useState } from 'react';

let genSeq = 0;
export function genId(prefix = 'pick') {
  genSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${genSeq}`;
}

/** 文本划选 → 自动泛化正则（PRD §4.0.3）：数字→\d+、空白→\s*、其余转义 */
export function generalizeSelection(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < text.length && /[0-9]/.test(text[j])) j++;
      out += '(\\d+)';
      i = j - 1;
    } else if (/\s/.test(ch)) {
      let j = i;
      while (j < text.length && /\s/.test(text[j])) j++;
      out += '\\s*';
      i = j - 1;
    } else {
      out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return out;
}

/** 全半角冒号兼容 */
function normalizePunct(regex) {
  return regex.replace(/:/g, '[:：]').replace(/：/g, '[:：]');
}

export function textExtractRegex(selected) {
  let regex = normalizePunct(generalizeSelection(selected));
  if (!regex.includes('(')) regex = `(${regex})`;
  return regex;
}

/** 猜变量名：英文键名 / 中文小词表 / 退化为 varN */
export function suggestVarName(context, fallbackSeq) {
  const m = /([A-Za-z_][A-Za-z0-9_]{2,})\s*[:：=]\s*$/.exec(context || '');
  if (m) return m[1].toLowerCase();
  const cn = /([\u4e00-\u9fa5]{2,4})\s*[:：]\s*$/.exec(context || '');
  if (cn) {
    const map = {
      积分: 'points', 签到: 'checkin', 状态: 'status', 余额: 'balance',
      天数: 'days', 消息: 'message', 用户: 'user', 名称: 'name',
      时间: 'time', 金币: 'coins', 等级: 'level',
    };
    if (map[cn[1]]) return map[cn[1]];
  }
  return `var${fallbackSeq}`;
}

/**
 * 生成节点定义（画布流式生长用）。返回:
 *   { nodes: [...] }                    新增节点（extract / notify）
 *   { assert }                          合并进产生该响应的 http 节点
 *   { keyword }                         合并进 flow.log.keywords
 *   { patchNotify: {id, varName} }      已有 notify 节点追加变量
 */
export function buildPickedResult(picked, { seq, notifyNode }) {
  const varName = (picked.varName || suggestVarName(picked.context, seq) || `var${seq}`).trim();

  if (picked.use === 'variable') {
    return {
      varName,
      nodes: [makeExtractNode(picked, varName)],
    };
  }

  if (picked.use === 'notify') {
    if (notifyNode) {
      return { varName, patchNotify: { id: notifyNode.id, varName } };
    }
    return {
      varName,
      nodes: [makeExtractNode(picked, varName), {
        type: 'notify',
        name: '通知',
        config: { text: `签到结果：{{${varName}}}`, channels: [] },
        genBy: 'pick',
      }],
    };
  }

  if (picked.use === 'assert') {
    const a = picked.isJson
      ? { expr: `last.json.${(picked.path || []).join('.')} == ${JSON.stringify(picked.value)}`, expect: 'true' }
      : { res: [generalizeSelection(picked.value)], from: 'content' };
    return { varName, assert: a };
  }

  if (picked.use === 'keyword') {
    return {
      varName,
      keyword: {
        name: String(picked.value || '').slice(0, 8) || `规则${seq}`,
        regex: picked.isJson ? (picked.path || []).join('.') : textExtractRegex(picked.value),
        from: 'response',
        into: 'summary',
      },
    };
  }

  return { varName };
}

function makeExtractNode(picked, varName) {
  return {
    type: 'extract',
    name: `提取 ${varName}`,
    config: picked.isJson
      ? { mode: 'json', path: (picked.path || []).join('.'), name: varName, optional: false }
      : { from: 'last.text', re: textExtractRegex(picked.value), name: varName, optional: false },
    genBy: 'pick',
  };
}

/** ---------- 组件 ---------- */

export default function PickPanel({ responseBody, onApply, onClose }) {
  const parsed = useMemo(() => {
    if (typeof responseBody !== 'string') return { kind: 'none' };
    try {
      const j = JSON.parse(responseBody);
      if (j && typeof j === 'object') return { kind: 'json', data: j };
    } catch { /* not json */ }
    return { kind: 'text', data: responseBody };
  }, [responseBody]);

  const [picked, setPicked] = useState(null);
  const [seq, setSeq] = useState(1);

  if (parsed.kind === 'none') return null;

  const handleApply = (result) => {
    setPicked(null);
    setSeq((s) => s + 1);
    onApply(result);
  };

  return (
    <div className="pick-panel">
      <div className="pick-head">
        <b>点选生成逻辑</b>
        <span style={{ color: 'var(--muted)', fontSize: 11 }}>
          {parsed.kind === 'json' ? '点击 JSON 值' : '划选文字'}
        </span>
        <button className="small" style={{ marginLeft: 'auto' }} onClick={onClose}>完成</button>
      </div>
      <div className="pick-body">
        {picked && (
          <UsePopover
            picked={picked}
            seq={seq}
            onCancel={() => setPicked(null)}
            onApply={handleApply}
          />
        )}
        {parsed.kind === 'json' ? (
          <JsonTree data={parsed.data} path={[]} onPick={setPicked} depth={0} />
        ) : (
          <TextSelect text={parsed.data} onPick={setPicked} />
        )}
      </div>
    </div>
  );
}

/** 用途选择器（PRD §4.0.2 五选一，v0.2 实现四个：变量/断言/日志/通知） */
function UsePopover({ picked, seq, onCancel, onApply }) {
  const [varName, setVarName] = useState(picked.varName || suggestVarName(picked.context, seq));
  const preview = picked.isJson
    ? `${(picked.path || []).join('.')} = ${JSON.stringify(picked.value).slice(0, 60)}`
    : `"${(picked.value || '').slice(0, 40)}"`;

  const apply = (use) => onApply(buildPickedResult({ ...picked, use, varName }, { seq }));

  return (
    <div className="pick-popover">
      <div className="pick-preview"><code>{preview}</code></div>
      <div className="pick-varname">
        <span>变量名</span>
        <input value={varName} onChange={(e) => setVarName(e.target.value)} className="mono" />
      </div>
      <div className="pick-uses">
        <button onClick={() => apply('variable')}>存为变量</button>
        <button onClick={() => apply('assert')}>断言成功</button>
        <button onClick={() => apply('keyword')}>记录到日志</button>
        <button onClick={() => apply('notify')}>加进通知</button>
      </div>
      <button className="small" style={{ width: '100%' }} onClick={onCancel}>取消</button>
    </div>
  );
}

/** JSON 树：可折叠展开，叶子值可点击 */
function JsonTree({ data, path, onPick, depth }) {
  if (data === null || typeof data !== 'object') {
    return <LeafValue value={data} path={path} onPick={onPick} indent />;
  }
  const entries = Array.isArray(data) ? data.map((v, i) => [String(i), v]) : Object.entries(data);
  return (
    <div style={{ paddingLeft: depth ? 14 : 0 }}>
      {entries.map(([k, v]) => (
        <JsonNode key={k} k={k} v={v} path={[...path, k]} onPick={onPick} depth={depth} />
      ))}
    </div>
  );
}

function JsonNode({ k, v, path, onPick, depth }) {
  const [open, setOpen] = useState(depth < 1);
  const isBranch = v !== null && typeof v === 'object';
  const hideKey = /^\d+$/.test(k) && Array.isArray(v) === false && depth > 0 && false; // 数组下标也显示
  return (
    <div>
      <div className="json-row">
        {isBranch ? (
          <button className="json-toggle" onClick={() => setOpen(!open)}>{open ? '▾' : '▸'}</button>
        ) : (
          <span className="json-toggle" />
        )}
        {!hideKey && <span className="json-key">{k}</span>}
        {isBranch ? (
          <span className="json-meta">{Array.isArray(v) ? `array(${v.length})` : '{…}'}</span>
        ) : (
          <LeafValue value={v} path={path} onPick={onPick} />
        )}
      </div>
      {isBranch && open && <JsonTree data={v} path={path} onPick={onPick} depth={depth + 1} />}
    </div>
  );
}

function LeafValue({ value, path, onPick }) {
  const display = typeof value === 'string' ? `"${value}"` : String(value);
  return (
    <span
      className="json-leaf"
      title="点击选用途"
      onClick={() => onPick({
        isJson: true,
        path,
        value,
        context: path.length ? path[path.length - 1] : '',
        varName: path.length ? suggestVarName(path[path.length - 1], 1) : '',
      })}
    >
      <code>{display}</code>
    </span>
  );
}

/** 文本划选：mouseup 检测选区 */
function TextSelect({ text, onPick }) {
  const handleUp = () => {
    const sel = window.getSelection();
    const s = sel ? sel.toString().trim() : '';
    if (!s) return;
    const anchorText = sel.anchorNode && sel.anchorNode.textContent ? sel.anchorNode.textContent : '';
    const anchorOffset = sel.anchorOffset || 0;
    const context = anchorText.slice(Math.max(0, anchorOffset - 12), anchorOffset);
    onPick({ isJson: false, value: s, context });
  };
  return (
    <div className="pick-text" onMouseUp={handleUp}>
      <pre style={{ whiteSpace: 'pre-wrap', userSelect: 'text', cursor: 'text' }}>{text}</pre>
    </div>
  );
}

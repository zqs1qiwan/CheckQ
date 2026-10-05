import React from 'react';
import { STEP_TYPES } from '../stepTypes.js';
import { api } from '../api.js';

export default function ConfigPanel({ node, onUpdate, onConfigUpdate, onDelete, onDebugTo, flowId, flowVars }) {
  if (!node) {
    return (
      <div className="config-panel">
        <div className="empty" style={{ padding: 30, color: 'var(--muted)', fontSize: 13, lineHeight: 1.8 }}>
          点击画布上的节点<br />在此配置参数
        </div >
      </div >
    );
  }

  const type = node.type;
  const config = node.config || {};

  return (
    <div className="config-panel">
      <div className="section-title">{STEP_TYPES[type]?.label || type}</div >
      <div className="field">
        <label>节点名称</label>
        <input value={node.name} onChange={(e) => onUpdate({ name: e.target.value })} />
      </div >

      {type === 'http' && (
        <>{/* HTTP logic */}
          <div className="field-inline">
            <div className="field">
              <label>Method</label>
              <select value={config.method} onChange={(e) => onConfigUpdate({ method: e.target.value })}>
                {['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'].map((m) => <option key={m}>{m}</option>)}
              </select>
            </div >
            <div className="field">
              <label>超时 (秒)</label>
              <input type="number" value={(config.timeout || 30000) / 1000}
                onChange={(e) => onConfigUpdate({ timeout: Math.max(1, Number(e.target.value) || 30) * 1000 })} />
            </div >
            <div className="field" style={{ alignSelf: 'flex-end' }}>
              <button className="small" title="生成等价 curl 命令（变量以当前值代入，敏感值完整还原，仅本机调试用）"
                onClick={async () => {
                  try {
                    const { curl } = await api.curlFor(flowId, node.id, flowVars || {});
                    await navigator.clipboard.writeText(curl);
                    alert('已复制到剪贴板：\n\n' + curl);
                  } catch (e) {
                    alert('生成失败: ' + e.message);
                  }
                }}>复制为 curl</button>
            </div >
          </div >
          <div className="field">
            <label>执行后端</label>
            <select value={config.backend || 'fetch'} onChange={(e) => onConfigUpdate({ backend: e.target.value })}>
              <option value="fetch">fetch（Node 内置，默认）</option>
              <option value="curl">curl（TLS 指纹不同，用于绕开 fetch 指纹风控）</option>
            </select>
            <div className="hint">目标站若对 Node fetch 的 TLS 指纹风控（如返回权限错误但浏览器/curl 正常），切换到 curl 后端。</div>
          </div >
          <div className="field-inline">
            <div className="field">
              <label>编码</label>
              <select value={config.charset || 'auto'} onChange={(e) => onConfigUpdate({ charset: e.target.value === 'auto' ? undefined : e.target.value })}>
                <option value="auto">自动（按响应头）</option>
                <option value="utf-8">UTF-8</option>
                <option value="gbk">GBK</option>
                <option value="gb2312">GB2312</option>
                <option value="big5">Big5</option>
              </select>
            </div >
            <div className="field">
              <label>代理 URL（可选）</label>
              <input className="mono" placeholder="http://user:pass@host:port 或 {{proxyVar}}" value={config.proxy?.url || ''}
                onChange={(e) => onConfigUpdate({ proxy: e.target.value.trim() ? { url: e.target.value } : undefined })} />
            </div >
          </div >
          <div className="field-inline">
            <div className="field">
              <label>失败重试次数</label>
              <input type="number" min="0" max="5" value={config.retry?.times ?? 0}
                onChange={(e) => {
                  const times = Math.max(0, Math.min(5, Number(e.target.value) || 0));
                  onConfigUpdate({ retry: times > 0 ? { times, backms: config.retry?.backoffMs || 1000, retryOn: config.retry?.retryOn || 'both' } : undefined });
                }} />
            </div >
            <div className="field">
              <label>重试内容</label>
              <select value={config.retry?.retryOn || 'both'} onChange={(e) => onConfigUpdate({ retry: { times: config.retry?.times ?? 0, backoffMs: config.retry?.backoffMs || 1000, retryOn: e.target.value } })}>
                <option value="both">网络错误 + 断言失败</option>
                <option value="error">仅网络错误</option>
              </select>
            </div >
          </div >
          <div className="field">
            <label>重试间隔基数 (ms)</label>
            <input type="number" min="500" max="30000" step="500" value={config.retry?.backoffMs ?? 1000}
              onChange={(e) => onConfigUpdate({ retry: { times: config.retry?.times ?? 0, backoffMs: Math.max(500, Number(e.target.value) || 1000), retryOn: config.retry?.retryOn || 'both' } })} />
            <div className="hint">线性退避：第 n 次重试等待 基数×n 毫秒。0 次重试时以上设置不生效。</div>
          </div >
          <div className="field">
            <label>URL <span style={{ color: 'var(--muted)' }}>（支持 {`{{变量}}`}）</span ></label>
            <input className="mono" value={config.url} onChange={(e) => onConfigUpdate({ url: e.target.value })} />
          </div >
          <div className="section-title">请求头</div >
          {(config.headers || []).map((h, i) => (
            <div className="kv-row" key={i}>
              <input type="checkbox" checked={h.enabled !== false} title="启用"
                onChange={(e) => {
                  const hs = [...config.headers];
                  hs[i] = { ...h, enabled: e.target.checked };
                  onConfigUpdate({ headers: hs });
                }} />
              <input className="mono" placeholder="名称" value={h.name}
                onChange={(e) => {
                  const hs = [...config.headers];
                  hs[i] = { ...h, name: e.target.value };
                  onConfigUpdate({ headers: hs });
                }} />
              <input className="mono" placeholder="值 {{var}}" value={h.value}
                onChange={(e) => {
                  const hs = [...config.headers];
                  hs[i] = { ...h, value: e.target.value };
                  onConfigUpdate({ headers: hs });
                }} />
              <button className="small danger" style={{ padding: '2px 7px' }}
                onClick={() => onConfigUpdate({ headers: config.headers.filter((_, j) => j !== i) })}>×</button>
            </div >
          ))}
          <button className="small" style={{ width: '100%' }}
            onClick={() => onConfigUpdate({ headers: [...(config.headers || []), { name: '', value: '', enabled: true }] })}>
            + 添加请求头
          </button>
          {config.method !== 'GET' && config.method !== 'HEAD' && (
            <>{/* Body */}
              <div className="section-title">请求体</div >
              <textarea className="mono" rows={4} value={config.body || ''}
                onChange={(e) => onConfigUpdate({ body: e.target.value })} />
            </>
          )}
          <div className="section-title">断言（全部通过才继续）</div >
          {(config.asserts || []).map((a, i) => (
            <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 8, marginBottom: 8 }}>
              <div className="kv-row">
                <select
                  value={Array.isArray(a.res) ? 're' : 'expr'}
                  onChange={(e) => {
                    const as = [...config.asserts];
                    as[i] = e.target.value === 're'
                      ? { res: [''], from: 'content' }
                      : { expr: '', expect: 'true' };
                    onConfigUpdate({ asserts: as });
                  }}
                >
                  <option value="expr">表达式</option>
                  <option value="re">正则含</option>
                  <option value="re" disabled={true} style={{ display: 'none' }}></option>
                </select>
                <button className="small danger" style={{ padding: '2px 7px' }}
                  onClick={() => onConfigUpdate({ asserts: config.asserts.filter((_, j) => j !== i) })}>×</button>
              </div >
              {Array.isArray(a.res) ? (
                <>{/* Regex assert */}
                  <input className="mono" style={{ marginBottom: 4 }} placeholder='正则 如 "code":0'
                    value={a.res.join('|')}
                    onChange={(e) => {
                      const as = [...config.asserts];
                      as[i] = { ...a, res: e.target.value.split('|') };
                      onConfigUpdate({ asserts: as });
                    }} />
                  <div className="field-inline">
                    <div className="field">
                      <select value={a.from || 'content'} onChange={(e) => { const as = [...config.asserts]; as[i] = { ...a, from: e.target.value }; onConfigUpdate({ asserts: as }); }}>
                        <option value="content">响应体含</option>
                        <option value="status">状态码含</option>
                      </select>
                    </div >
                    <div className="field">
                      <label className="switch" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input type="checkbox" checked={!!a.negate}
                          onChange={(e) => { const as = [...config.asserts]; as[i] = { ...a, negate: e.target.checked }; onConfigUpdate({ asserts: as }); }} />
                        <span className="track" />
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>取反</span >
                      </label>
                    </div >
                  </div >
                </>
              ) : (
                <>{/* Expr assert */}
                  <input className="mono" style={{ marginBottom: 4 }} placeholder='jexl 表达式 如 last.json.code == 0'
                    value={a.expr}
                    onChange={(e) => { const as = [...config.asserts]; as[i] = { ...a, expr: e.target.value }; onConfigUpdate({ asserts: as }); }} />
                  <input className="mono" placeholder='期望值 如 true（留空=真值判断）'
                    value={a.expect ?? ''}
                    onChange={(e) => { const as = [...config.asserts]; as[i] = { ...a, expect: e.target.value }; onConfigUpdate({ asserts: as }); }} />
                </>
              )}
            </div >
          ))}
          <button className="small" style={{ width: '100%' }}
            onClick={() => onConfigUpdate({ asserts: [...(config.asserts || []), { expr: '', expect: 'true' }] })}>
            + 添加断言
          </button>
        </>
      )}

      {type === 'condition' && (
        <div className="field">
          <label>判定表达式 <span style={{ color: 'var(--muted)' }}>(jexl)</span ></label>
          <input className="mono" placeholder="last.json.code == 0" value={config.expr || ''}
            onChange={(e) => onConfigUpdate({ expr: e.target.value })} />
          <div className="hint">
            last = 上一个响应；vars.xxx = 流程变量<br />
            真 → true 出口，假 → false 出口
          </div >
        </div >
      )}

      {type === 'set' && (
        <>{/* Set node */}
          <div className="field">
            <label>变量名</label>
            <input value={config.name || ''} onChange={(e) => onUpdate({ name: e.target.value })} />
          </div >
          <div className="field">
            <label>值 <span style={{ color: 'var(--muted)' }}>（用 = 开头进行表达式求值）</span ></label>
            <input className="mono" placeholder="文本 {{var}} 或 =last.json.token" value={config.value ?? ''}
              onChange={(e) => onConfigUpdate({ value: e.target.value })} />
            <div className="hint">
              直接渲染模板 {`{{xxx}}`}；以 = 开头按表达式求值<br />
              例: =last.json.loginDevice == 'macOS' ? vars.ua_mac : vars.ua_win
            </div >
          </div >
        </>
      )}

      {type === 'extract' && (
        <>{/* Extract node */}
          <div className="field">
            <label>提取模式</label>
            <select value={config.mode || 'regex'} onChange={(e) => {
              const mode = e.target.value;
              if (mode === 'regex') onConfigUpdate({ mode: undefined });
              else if (mode === 'json') onConfigUpdate({ mode: 'json', path: config.path || '' });
              else if (mode === 'header') onConfigUpdate({ mode: 'header', headerName: config.headerName || '' });
              else if (mode === 'setCookie') onConfigUpdate({ mode: 'setCookie', cookieFilter: config.cookieFilter || '' });
            }}>
              <option value="regex">正则提取（响应体/状态码）</option>
              <option value="json">JSON 路径（last.json）</option>
              <option value="header">响应头</option>
              <option value="setCookie">Set-Cookie 捕获</option>
            </select>
          </div>
          {config.mode === 'json' && (
            <div className="field">
              <label>JSON 路径 <span style={{ color: 'var(--muted)' }}>（如 data.token，数组用下标 list.0）</span></label>
              <input className="mono" placeholder="data.token" value={config.path || ''} onChange={(e) => onConfigUpdate({ path: e.target.value })} />
            </div>
          )}
          {config.mode === 'header' && (
            <div className="field">
              <label>响应头名称</label>
              <input className="mono" placeholder="location" value={config.headerName || ''} onChange={(e) => onConfigUpdate({ headerName: e.target.value })} />
            </div>
          )}
          {config.mode === 'setCookie' && (
            <div className="field">
              <label>Cookie 名过滤 <span style={{ color: 'var(--muted)' }}>（正则，可选）</span></label>
              <input className="mono" placeholder="只保留匹配的 cookie 名，如 sess" value={config.cookieFilter || ''} onChange={(e) => onConfigUpdate({ cookieFilter: e.target.value })} />
              <div className="hint">捕获该响应全部 Set-Cookie 的 k=v 部分，用 「; 」 连接存入变量，供后续请求 Cookie 头使用。</div>
            </div>
          )}
          {(!config.mode || config.mode === 'regex') && (
            <>
              <div className="field">
                <label>提取来源</label>
                <select value={config.from || 'last.text'} onChange={(e) => onConfigUpdate({ from: e.target.value })}>
                  <option value="last.text">响应原文 (last.text)</option>
                  <option value="last.json">响应JSON (last.json)</option>
                  <option value="last.status">状态码 (last.status)</option>
                  <option value="vars">流程变量 (vars)</option>
                </select>
              </div>
              <div className="field">
                <label>正则 <span style={{ color: 'var(--muted)' }}>（第1个捕获组）</span></label>
                <input className="mono" placeholder='\\"message\\":\\"(.*?)\\"' value={config.re || ''}
                  onChange={(e) => onConfigUpdate({ re: e.target.value })} />
              </div>
            </>
          )}
          <div className="field-inline">
            <div className="field">
              <label>存入变量名</label>
              <input value={config.name || ''} onChange={(e) => onConfigUpdate({ name: e.target.value })} />
            </div>
            <div className="field" style={{ flex: '0 0 auto', display: 'flex', alignItems: 'flex-end' }}>
              <label className="switch" style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={config.optional !== false}
                  onChange={(e) => onConfigUpdate({ optional: e.target.checked })} />
                <span className="track" />
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>未命中不失败</span>
              </label>
            </div>
          </div>
        </>
      )}

      {type === 'random-delay' && (
        <>{/* Random delay node */}
          <div className="field-inline">
            <div className="field">
              <label>最小等待 (秒)</label>
              <input type="number" min="0" max="300" value={config.min ?? 1} onChange={(e) => onConfigUpdate({ min: Number(e.target.value) })} />
            </div>
            <div className="field">
              <label>最大等待 (秒)</label>
              <input type="number" min="0" max="300" value={config.max ?? 5} onChange={(e) => onConfigUpdate({ max: Number(e.target.value) })} />
            </div>
          </div>
          <div className="hint">在 [最小, 最大] 秒之间随机等待，用于避开整点/固定间隔的反自动化风控。</div>
        </>
      )}

      {type === 'delay' && (
        <div className="field">
          <label>等待秒数</label>
          <input type="number" min="0" max="300" value={config.seconds ?? 1}
            onChange={(e) => onConfigUpdate({ seconds: Number(e.target.value) })} />
        </div >
      )}

      {type === 'log' && (
        <div className="field">
          <label>输出文本 <span style={{ color: 'var(--muted)' }}>（支持 {`{{变量}}`}）</span ></label>
          <textarea rows={3} value={config.text || ''} onChange={(e) => onConfigUpdate({ text: e.target.value })} />
        </div >
      )}

      {type === 'notify' && (
        <>{/* Notify node */}
          <div className="field">
            <label>通知文本</label>
            <textarea rows={2} value={config.text || ''} onChange={(e) => onConfigUpdate({ text: e.target.value })} />
          </div >
          <div className="field">
            <label>Telegram Bot Token</label>
            <input className="mono" value={config.tgToken || ''} onChange={(e) => onConfigUpdate({ tgToken: e.target.value })} />
          </div >
          <div className="field">
            <label>Telegram Chat ID</label>
            <input className="mono" value={config.tgChat || ''} onChange={(e) => onConfigUpdate({ tgChat: e.target.value })} />
          </div >
          <div className="field">
            <label>Bark URL</label>
            <input className="mono" placeholder="https://api.day.app/xxx" value={config.barkUrl || ''}
              onChange={(e) => onConfigUpdate({ barkUrl: e.target.value })} />
          </div >
          <div className="field">
            <label>Webhook URL</label>
            <input className="mono" value={config.webhookUrl || ''} onChange={(e) => onConfigUpdate({ webhookUrl: e.target.value })} />
          </div >
        </>
      )}

      <div className="section-title" style={{ marginTop: 24 }}>操作</div >
      {onDebugTo && (
        <button
          style={{ width: '100%', marginBottom: 8 }}
          onClick={() => onDebugTo(node.id)}
          title="从头运行流程，执行到这个节点为止（含），不会继续后面的步骤"
        >▶ 调试到此为止</button>
      )}
      <button className="danger" style={{ width: '100%' }} onClick={onDelete}>删除此节点</button>
    </div >
  );
}

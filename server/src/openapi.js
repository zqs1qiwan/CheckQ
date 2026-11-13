/**
 * 开放 API 描述（OpenAPI 3.1）—— 供外部 Agent / 集成自助发现
 * 暴露：GET /api/openapi.json
 */

const scopes = {
  read: '查看任务、运行记录、日志、统计、模板',
  run: '触发任务运行（跑签到）',
  write: '修改变量 / 调度 / 新建任务 / 通知配置',
};

const errorResponses = {
  401: { description: '未登录、API Key 无效或已过期回收' },
  403: { description: '权限不足（API Key 作用域不包含所需能力）' },
  404: { description: '资源不存在' },
  429: { description: '登录限流' },
};

function op(summary, extra = {}) {
  return {
    summary,
    tags: extra.tags || ['flows'],
    description: extra.description,
    parameters: extra.parameters,
    requestBody: extra.requestBody,
    responses: {
      200: { description: '成功', content: { 'application/json': { schema: extra.schema || { type: 'object' } } } },
      ...(extra.errors || []).reduce((acc, code) => ({ ...acc, [code]: errorResponses[code] }), {}),
    },
    'x-required-scope': extra.scope || 'read',
  };
}

const idParam = (name = 'id', desc = '资源 ID') => ({
  name, in: 'path', required: true, description: desc, schema: { type: 'string' },
});

export function buildOpenApi() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'CheckQ 开放 API',
      version: '0.3.17',
      description:
        'CheckQ 自动化签到引擎的对外接口。认证二选一：① 请求头 `x-api-key: <key>`（推荐，可按作用域发放）；② 浏览器会话 Cookie（登录后自动带上）。\n' +
        'API Key 作用域：' + Object.entries(scopes).map(([k, v]) => `\`${k}\` = ${v}`).join('；') + '。\n' +
        '写操作需 `write`，运行任务需 `run`，只读操作用 `read`。过期 Key 会被自动回收。',
      contact: { name: 'CheckQ', url: 'http://checkq.local:18888/' },
    },
    servers: [{ url: 'http://checkq.local:18888', description: '生产实例（局域网）' }],
    security: [{ apiKeyAuth: [] }, { cookieAuth: [] }],
    components: {
      securitySchemes: {
        apiKeyAuth: { type: 'apiKey', in: 'header', name: 'x-api-key', description: '面板「设置 → API Key」生成，可设作用域与回收日期' },
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'qsid', description: '浏览器登录会话（httpOnly）' },
      },
      schemas: {
        Flow: {
          type: 'object',
          properties: {
            id: { type: 'string' }, name: { type: 'string' }, note: { type: 'string' },
            cron: { type: 'string' }, timezone: { type: 'string' }, enabled: { type: 'boolean' },
            vars: { type: 'object', additionalProperties: { type: 'string' }, description: '流程变量（cookie/token 等；落盘加密，返回明文以便编辑）' },
            nodes: { type: 'array', items: { type: 'object' } },
            edges: { type: 'array', items: { type: 'object' } },
            log: { type: 'object' },
            notify: { type: 'object' },
          },
        },
        Run: {
          type: 'object',
          properties: {
            id: { type: 'string' }, flowId: { type: 'string' }, status: { type: 'string', enum: ['success', 'failed', 'running'] },
            startedAt: { type: 'integer' }, durationMs: { type: 'integer' },
            finalMessage: { type: 'string' }, summary: { type: 'string' },
            logs: { type: 'array', items: { type: 'object', description: '步骤日志（人话日志）' } },
          },
        },
        LogEntry: {
          type: 'object',
          properties: {
            runId: { type: 'string' }, startedAt: { type: 'integer' }, status: { type: 'string' },
            index: { type: 'integer' }, name: { type: 'string' }, message: { type: 'string' },
            type: { type: 'string' }, ok: { type: 'boolean' }, ms: { type: 'integer' },
          },
        },
      },
    },
    'x-scopes': scopes,
    paths: {
      '/api': { get: op('接口索引（无需鉴权即可访问的元信息）', { tags: ['meta'], scope: null }) },
      '/api/health': { get: op('健康检查', { tags: ['meta'] }) },
      '/api/me': { get: op('当前身份（会话用户 / API Key 身份与作用域）', { tags: ['meta'] }) },
      '/api/flows': { get: op('列出任务（含 cron/enabled/nextRunAt/上次结果）', { tags: ['flows'], schema: { type: 'array', items: { $ref: '#/components/schemas/Flow' } } }) },
      '/api/flows/{id}': {
        get: op('任务详情（nodes/vars/log/notify）', { tags: ['flows'], parameters: [idParam()], schema: { $ref: '#/components/schemas/Flow' } }),
        put: op('更新任务（vars/cron/timezone/jitterMinutes/enabled/name/note）', {
          tags: ['flows'], scope: 'write', parameters: [idParam()],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Flow' } } } },
          errors: [401, 403],
        }),
      },
      '/api/flows/{id}/run': {
        post: op('立即运行一次（跑签到），返回状态 + 摘要 + 人话日志', {
          tags: ['flows'], scope: 'run', parameters: [idParam()],
          requestBody: { required: false, content: { 'application/json': { schema: { type: 'object' } } } },
          schema: { $ref: '#/components/schemas/Run' }, errors: [401, 403],
        }),
      },
      '/api/flows/{id}/logs': {
        get: op('连续日志流（多次运行的人话日志，最像 qinglong 面板）', {
          tags: ['flows'], parameters: [idParam(), { name: 'limit', in: 'query', schema: { type: 'integer', default: 200 } }],
          schema: { type: 'object', properties: { entries: { type: 'array', items: { $ref: '#/components/schemas/LogEntry' } }, hasMore: { type: 'boolean' } } },
        }),
      },
      '/api/flows/{id}/notify-test': {
        post: op('向该任务已配置的渠道发一条测试通知', { tags: ['flows'], scope: 'write', parameters: [idParam()], errors: [401, 403] }),
      },
      '/api/runs': {
        get: op('运行历史（按 flowId 过滤）', {
          tags: ['runs'],
          parameters: [{ name: 'flowId', in: 'query', schema: { type: 'string' } }, { name: 'limit', in: 'query', schema: { type: 'integer', default: 30 } }],
          schema: { type: 'array', items: { $ref: '#/components/schemas/Run' } },
        }),
      },
      '/api/runs/{id}': { get: op('某次运行详情（日志 + 变量快照，变量已脱敏）', { tags: ['runs'], parameters: [idParam()], schema: { $ref: '#/components/schemas/Run' } }) },
      '/api/runs/{id}/har': { get: op('导出单次运行的 HAR（默认脱敏；响应体沿用日志截断）', { tags: ['runs'], parameters: [idParam()], schema: { type: 'object' } }) },
      '/api/templates': { get: op('模板列表（含变量名）', { tags: ['templates'], schema: { type: 'array', items: { type: 'object' } } }) },
      '/api/templates/{id}': { get: op('模板详情（变量名 + 默认值，敏感项已脱敏）', { tags: ['templates'], parameters: [idParam()], schema: { type: 'object' } }) },
      '/api/templates/{id}/instantiate': {
        post: op('从模板创建任务（变量可覆盖）', {
          tags: ['templates'], scope: 'write', parameters: [idParam()],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, vars: { type: 'object' } } } } } },
          errors: [401, 403],
        }),
      },
      '/api/notifications': { get: op('站内通知列表', { tags: ['meta'], parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } }], schema: { type: 'object' } }) },
      '/api/system/stats': { get: op('运维统计（任务数/今日运行/成功率/下次调度）', { tags: ['meta'], schema: { type: 'object' } }) },
      '/api/system/push-targets': { get: op('可推送单位（带通知渠道的任务）', { tags: ['meta'], schema: { type: 'array', items: { type: 'object' } } }) },
      '/api/system/apikeys': {
        get: op('API Key 列表（管理员；含作用域与回收日期）', { tags: ['keys'], errors: [401, 403] }),
        post: op('生成 API Key（管理员；可指定 scopes 与回收日期，明文只返回一次）', {
          tags: ['keys'], scope: 'write',
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, scopes: { type: 'array', items: { type: 'string', enum: ['read', 'run', 'write'] } }, expiresAt: { type: 'string', description: '回收日期 YYYY-MM-DD，留空=永不过期' } } } } } },
          errors: [401, 403],
        }),
      },
      '/api/system/apikeys/{id}': { delete: op('吊销 API Key（立即失效）', { tags: ['keys'], scope: 'write', parameters: [idParam('id', 'API Key ID')], errors: [401, 403] }) },
      '/api/system/users': { get: op('用户列表（管理员）', { tags: ['admin'], errors: [401, 403] }) },
      '/api/system/audit': { get: op('审计日志（管理员）', { tags: ['admin'], errors: [401, 403] }) },
    },
  };
}

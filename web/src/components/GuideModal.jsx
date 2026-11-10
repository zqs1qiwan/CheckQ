import React, { useState } from 'react';

const SECTIONS = [
  {
    id: 'start',
    title: '3 步上手',
    body: [
      '① 新建任务：顶栏「+ 新建任务」，画布会自动放好「HTTP 请求 → 日志」两个节点。',
      '② 填 URL 并运行：点节点填 URL（支持 {{变量}}），顶栏点「运行」，底部日志坞会实时显示每一步。',
      '③ 配调度：顶栏「调度」里填 cron（如 30 8 * * * = 每天 8:30）并启用，任务就会自动跑。',
    ],
  },
  {
    id: 'list',
    title: '任务列表',
    body: [
      '运行：立即执行一次；日志：查看历史运行记录；···：编辑 / 复制副本 / 停用调度 / 删除。',
      '状态列：绿点=已启用调度，灰点=已停用；「下次运行」只显示已启用任务的时间。',
      '顶部绿条「下次调度」= 所有已启用任务中最近的一次自动运行时间，不是某个任务的专属时间。',
      '搜索框支持名称/备注；筛选支持全部 / 已启用调度 / 最近失败。',
    ],
  },
  {
    id: 'editor',
    title: '编辑器',
    body: [
      '积木：点击直接加到画布，或拖拽到指定位置；每个节点右侧圆点可连线。',
      '参数：点选节点后配置；HTTP 节点的后端/编码/代理/重试在「高级选项」里。',
      '日志：底部整宽日志坞，运行步骤实时滚动；两侧面板可「收起」或顶栏「积木/参数」开关。',
      'Delete 键删除选中节点；Ctrl+Z / Ctrl+Shift+Z 撤销重做（顶栏 ··· 里也有）。',
    ],
  },
  {
    id: 'log',
    title: '日志配置（重要）',
    body: [
      '记录范围：全部步骤（调试）/ 仅 log 节点（qinglong、qiandao 风格，只看调教好的干净日志）/ 合并为一条。',
      '推荐日常使用「仅 log 节点」：只有你在流程里放置的「日志」节点才会显示，技术细节自动隐藏。',
      '记录档位：all / failure / summary 控制响应体等细节的保留程度；关键字规则可把值提取到运行摘要。',
      'WorkBuddy 流程已默认「仅 log 节点」，日志里只看到「今日已签：+100 积分」这类人话。',
    ],
  },
  {
    id: 'notify',
    title: '通知渠道',
    body: [
      '编辑器 ··· →「通知渠道」：支持 Webhook / Bark / Telegram / Server酱 / 钉钉 / 企业微信 / 飞书。',
      '可分别开启「成功时通知」「失败时通知」；模板支持 {{flow.name}} {{status}} {{message}} {{duration}} {{time}}。',
      '点「测试发送」会立即向所有渠道发一条测试消息，确认配置正确。',
    ],
  },
  {
    id: 'faq',
    title: '常见问题',
    body: [
      '「找不到入口节点」：流程成环了，所有节点都有入线；检查连线。',
      '「HTTP 400/断言失败」：400 不一定是错误，断言通过即可继续；点日志步骤可看响应体。',
      '「超时」：HTTP 节点超时可填 30（秒），不是毫秒。',
      '「变量未定义」：日志配置里开启变量快照，或看运行记录的「未定义变量」。',
    ],
  },
];

export default function GuideModal({ onClose }) {
  const [tab, setTab] = useState('start');
  const cur = SECTIONS.find((s) => s.id === tab);
  return (
    <div className="modal-mask" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal guide-modal">
        <div className="guide-nav">
          <div className="guide-title">使用引导</div>
          {SECTIONS.map((s) => (
            <button key={s.id} className={`guide-tab${tab === s.id ? ' active' : ''}`} onClick={() => setTab(s.id)}>{s.title}</button>
          ))}
        </div>
        <div className="guide-body">
          {cur.body.map((line, i) => (
            <p key={i} style={{ margin: '0 0 10px', lineHeight: 1.7, fontSize: 13 }}>{line}</p>
          ))}
          <div className="guide-foot">
            <button className="primary" onClick={onClose}>开始使用</button>
          </div>
        </div>
      </div>
    </div>
  );
}

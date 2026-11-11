#!/usr/bin/env node
/**
 * 轮换 Telegram Bot Token：一处配置改完全站
 * 用法：node tools/rotate-telegram-token.cjs <新 token> [chatId]
 *  - 找到所有配置了 telegram 渠道的任务，把 token 换成新的
 *  - 逐个发一次测试通知确认可用
 *  - 旧 token 立即失效（由 BotFather 侧 /token 或 /revoke 决定）
 */
const BASE = process.env.CHECKQ_URL || 'http://checkq.local:18888';
const PW = process.env.CHECKQ_PASSWORD || '';
const newToken = process.argv[2];
const chatId = process.argv[3];

if (!newToken) {
  console.error('用法: node tools/rotate-telegram-token.cjs <新 token> [chatId]');
  process.exit(1);
}

(async () => {
  const l = await fetch(BASE + '/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: PW }),
  });
  if (!l.ok) throw new Error('登录失败');
  const cookie = (l.headers.getSetCookie ? l.headers.getSetCookie() : [l.headers.get('set-cookie')]).map((c) => c.split(';')[0]).join('; ');
  const H = { 'content-type': 'application/json', cookie };

  // 先确认新 token 有效
  const me = await fetch(`https://api.telegram.org/bot${newToken}/getMe`);
  const meJ = await me.json();
  if (!meJ.ok) throw new Error('新 token 无效: ' + JSON.stringify(meJ).slice(0, 120));
  console.log('新 token 校验通过: @' + meJ.result.username);

  const flows = await (await fetch(BASE + '/api/flows', { headers: { cookie } })).json();
  let updated = 0;
  for (const f of flows) {
    const d = await (await fetch(BASE + '/api/flows/' + f.id, { headers: { cookie } })).json();
    const channels = (d.notify?.channels || []).map((c) => (c.type === 'telegram' ? { ...c, token: newToken, ...(chatId ? { chat: chatId } : {}) } : c));
    if (!channels.some((c, i) => c !== (d.notify?.channels || [])[i])) continue;
    const up = await fetch(BASE + '/api/flows/' + f.id, { method: 'PUT', headers: H, body: JSON.stringify({ notify: { ...d.notify, channels } }) });
    if (!up.ok) { console.log('  ✗ 更新失败:', d.name, (await up.text()).slice(0, 120)); continue; }
    updated++;
    console.log('  ✓ 已更新:', d.name);
    const t = await fetch(BASE + '/api/flows/' + f.id + '/notify-test', { method: 'POST', headers: H, body: '{}' });
    const tj = await t.json();
    console.log('    测试通知:', t.status, JSON.stringify(tj.results || tj.error));
  }
  console.log('共更新', updated, '个任务');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });

/**
 * 全量 UI 交互巡检（仓库护栏，零依赖）
 *
 * 覆盖：9 视口 × 明暗主题；顶栏单行/等高、工具条分组、弹窗居中、
 * 设置分区、任务详情、模板页、移动端「更多」菜单、编辑器画布/面板/MiniMap。
 *
 * 用法：node tools/ui-interaction-audit.cjs [baseUrl]
 * 默认 baseUrl = http://localhost:19998；需要先起一个本地/测试实例。
 * 只读：不创建、不修改、不删除任何任务或设置。
 */
const { launch, CDP, newPage, sleep } = require('./cdp-lite.cjs');
const BASE = process.argv[2] || 'http://localhost:19998';
const OUT = 'C:/Users/Q/AppData/Local/Temp/opencode/shots-audit';

const VIEWPORTS = [
  [320, 568, 'mobile'], [360, 740, 'mobile'], [390, 844, 'mobile'],
  [600, 800, 'tablet'], [768, 1024, 'tablet'], [1024, 768, 'small-desktop'],
  [1280, 720, 'laptop'], [1440, 900, 'desktop'], [1920, 1080, 'wide'],
];

(async () => {
  const { proc, wsUrl } = await launch(9510);
  const cdp = await CDP.connect(wsUrl);
  const page = await newPage(cdp);
  const findings = [];
  const add = (where, msg) => { findings.push({ where, msg }); };

  await page.setViewport(1440, 900);
  await page.goto(BASE + '/');
  await page.eval("await fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'admin',password:'test1234'})}); return 1;");
  await page.reload();
  await sleep(900);

  for (const [w, h, kind] of VIEWPORTS) {
    await page.setViewport(w, h, kind === 'mobile');
    await page.reload();
    await sleep(700);
    for (const mode of ['dark', 'light']) {
      await page.eval(`document.documentElement.dataset.mode='${mode}'; document.documentElement.dataset.theme='${mode}'; await new Promise(r=>setTimeout(r,150)); return 1;`);

      // A. 顶栏几何：行数、图标按钮对齐、文字换行、横向溢出
      const top = await page.eval(`
        const bar=document.querySelector('.topbar');
        const kids=[...bar.children].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0});
        const rows=new Map();
        for(const k of kids){const r=k.getBoundingClientRect();const key=Math.round(r.top/6)*6;if(!rows.has(key))rows.set(key,[]);rows.get(key).push(k)}
        const icons=kids.filter(e=>e.classList.contains('iconbtn')||e.classList.contains('dd-trigger')||e.classList.contains('who-chip'));
        const iconH=[...new Set(icons.map(e=>Math.round(e.getBoundingClientRect().height)))];
        const rowGroups=[...rows.values()];
        const misaligned=[];
        for(const g of rowGroups){
          const centers=g.map(e=>{const r=e.getBoundingClientRect();return r.top+r.height/2});
          const max=Math.max(...centers),min=Math.min(...centers);
          if(max-min>4) misaligned.push(Math.round(max-min));
        }
        const wrapped=[...bar.querySelectorAll('button')].filter(b=>{
          const r=b.getBoundingClientRect();const cs=getComputedStyle(b);
          return r.height>parseFloat(cs.height)+2 && r.height>34;
        }).map(b=>b.textContent.trim().slice(0,12)+'('+Math.round(b.getBoundingClientRect().height)+')');
        const docW=document.documentElement.scrollWidth;
        return JSON.stringify({
          rows:rowGroups.length, rowSizes:rowGroups.map(g=>g.length),
          iconHeights:iconH, misaligned, wrapped, docW, vw:innerWidth,
          barH:Math.round(bar.getBoundingClientRect().height),
        });
      `);
      const t = JSON.parse(top);
      if (t.docW > t.vw + 1) add(`${w}x${h}/${mode}`, `顶栏导致横向溢出 ${t.docW}>${t.vw}`);
      if (t.misaligned.length) add(`${w}x${h}/${mode}`, `顶栏同一行元素垂直未对齐 偏差=${t.misaligned.join(',')}px`);
      if (t.wrapped.length) add(`${w}x${h}/${mode}`, `按钮文字被挤到换行: ${t.wrapped.join(', ')}`);
      if (t.iconHeights.length > 1) add(`${w}x${h}/${mode}`, `图标按钮高度不一致: ${t.iconHeights.join(',')}`);

      // B. 设置弹窗居中 + 内部几何
      await page.eval(`document.querySelector('button[aria-label="设置"]').click(); await new Promise(r=>setTimeout(r,450)); return 1;`);
      const set = await page.eval(`
        const m=document.querySelector('dialog.modal[open]');
        if(!m) return JSON.stringify({err:'设置弹窗未打开'});
        const r=m.getBoundingClientRect();const cs=getComputedStyle(m);
        const cx=r.left+r.width/2, cy=r.top+r.height/2;
        const dx=Math.round(cx-innerWidth/2), dy=Math.round(cy-innerHeight/2);
        const nav=m.querySelector('.settings-nav');
        const tabs=[...m.querySelectorAll('.settings-tab')];
        const tabRects=tabs.map(t=>t.getBoundingClientRect());
        const iconCenters=[...nav.querySelectorAll('svg')].map(s=>{const q=s.getBoundingClientRect();return Math.round(q.top+q.height/2)});
        const panel=m.querySelector('.settings-panel');
        return JSON.stringify({
          rect:[Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)],
          centerOffset:[dx,dy],
          position:cs.position, margin:cs.margin, display:cs.display, height:cs.height,
          inset:[cs.top,cs.right,cs.bottom,cs.left].join('|'),
          viewport:[innerWidth,innerHeight],
          navScroll:nav.scrollHeight>nav.clientHeight+2,
          panelScroll:panel.scrollHeight>panel.clientHeight+2,
          tabHeights:[...new Set(tabRects.map(r=>Math.round(r.height)))],
          iconXs:[...new Set([...nav.querySelectorAll('svg')].map(s=>Math.round(s.getBoundingClientRect().left)))],
          labelXs:[...new Set([...nav.querySelectorAll('.settings-tab-text')].map(s=>Math.round(s.getBoundingClientRect().left)))],
          iconCenters:[...new Set(iconCenters)].length,
          closeHit:(()=>{const c=m.querySelector('.modal-close');const q=c.getBoundingClientRect();const e=document.elementFromPoint(q.left+q.width/2,q.top+q.height/2);return !!e&&c.contains(e)})(),
        });
      `);
      const s = JSON.parse(set);
      if (s.err) add(`${w}x${h}/${mode}`, s.err);
      else {
        if (Math.abs(s.centerOffset[0]) > 12 || Math.abs(s.centerOffset[1]) > 12) {
          add(`${w}x${h}/${mode}`, `设置弹窗未居中 offset=${s.centerOffset} rect=${s.rect} viewport=${s.viewport} pos=${s.position} inset=${s.inset} margin=${s.margin} height=${s.height}`);
        }
        if (!s.closeHit) add(`${w}x${h}/${mode}`, `设置弹窗右上角 ✕ 点不到（命中测试失败）`);
        if (s.tabHeights.length > 1) add(`${w}x${h}/${mode}`, `设置侧栏 tab 高度不一致: ${s.tabHeights.join(',')}`);
        if (s.iconXs.length > 1) add(`${w}x${h}/${mode}`, `设置侧栏图标未对齐: x=${s.iconXs.join(',')}`);
        if (s.labelXs.length > 1) add(`${w}x${h}/${mode}`, `设置侧栏文字未对齐: x=${s.labelXs.join(',')}`);
      }
      if (w === 320 || w === 768 || w === 1024) {
        await page.shot(`${OUT}/settings-${w}-${mode}.png`);
      }
      await page.eval(`document.querySelector('dialog.modal[open] .modal-close')?.click(); await new Promise(r=>setTimeout(r,250)); return 1;`);

      // C. 页面滚动后重新打开设置（复现「跑到最左上角」）
      await page.eval(`window.scrollTo(0, document.body.scrollHeight); await new Promise(r=>setTimeout(r,200)); document.querySelector('button[aria-label="设置"]').click(); await new Promise(r=>setTimeout(r,400)); return 1;`);
      const scrolled = await page.eval(`
        const m=document.querySelector('dialog.modal[open]');if(!m)return '[]';
        const r=m.getBoundingClientRect();
        return JSON.stringify([Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height),Math.round(r.left+r.width/2-innerWidth/2),Math.round(r.top+r.height/2-innerHeight/2)]);
      `);
      const sc = JSON.parse(scrolled);
      if (sc.length && (Math.abs(sc[4]) > 12 || Math.abs(sc[5]) > 12)) {
        add(`${w}x${h}/${mode}`, `滚动后设置弹窗跑偏 rect=${sc.slice(0,4)} offset=${sc.slice(4)}`);
      }
      await page.eval(`document.querySelector('dialog.modal[open] .modal-close')?.click(); await new Promise(r=>setTimeout(r,200)); window.scrollTo(0,0); return 1;`);
    }
    console.log(`viewport ${w}x${h} (${kind}) done, findings so far=${findings.length}`);
  }

  // D. 桌面：逐个弹窗居中 + 按钮组不换行 + 底部行下拉
  await page.setViewport(1440, 900);
  await page.reload(); await sleep(800);
  const modals = [
    ['新建空白任务', `document.querySelector('.topbar .new-task-btn')?.click()`],
    ['恢复', `[...document.querySelectorAll('.page button')].find(b=>b.textContent.trim()==='恢复')?.click()`],
    ['完整备份', `[...document.querySelectorAll('.page button')].find(b=>b.textContent.trim()==='完整备份')?.click()`],
    ['站内通知', `document.querySelector('.bell-btn')?.click()`],
    ['任务详情', `document.querySelector('button.flow-name')?.click()`],
  ];
  for (const [label, openExpr] of modals) {
    await page.eval(`${openExpr}\nawait new Promise(r=>setTimeout(r,350)); return 1;`);
    const r = await page.eval(`
      const m=document.querySelector('dialog.modal[open]');if(!m)return JSON.stringify({err:'未打开'});
      const q=m.getBoundingClientRect();
      return JSON.stringify({rect:[Math.round(q.left),Math.round(q.top),Math.round(q.width),Math.round(q.height)],off:[Math.round(q.left+q.width/2-innerWidth/2),Math.round(q.top+q.height/2-innerHeight/2)]});
    `);
    const j = JSON.parse(r);
    if (j.err) add('弹窗/1440', `${label}: ${j.err}`);
    else if (Math.abs(j.off[0]) > 12 || Math.abs(j.off[1]) > 12) add('弹窗/1440', `${label} 未居中 off=${j.off} rect=${j.rect}`);
    await page.eval(`document.querySelector('dialog.modal[open] .modal-close')?.click(); await new Promise(r=>setTimeout(r,200)); return 1;`);
  }

  const groups = await page.eval(`
    const out=[];
    for(const g of document.querySelectorAll('.page-head, .btn-row, .modal-foot, .cell-actions, .toolbar-left, .toolbar-right')){
      const kids=[...g.children].filter(e=>{const q=e.getBoundingClientRect();return q.width>0&&q.height>0});
      if(!kids.length) continue;
      const centers=kids.map(e=>{const q=e.getBoundingClientRect();return q.top+q.height/2});
      const spread=Math.max(...centers)-Math.min(...centers);
      if(spread>3) out.push({cls:String(g.className),rows:Math.round(spread),kids:kids.map(e=>e.textContent.trim().slice(0,8))});
    }
    return JSON.stringify(out);
  `);
  const g = JSON.parse(groups);
  for (const item of g) add('按钮组/1440', `${item.cls} 垂直中心偏差 ${item.rows}px（疑似换行）: ${item.kids.join(' / ')}`);

  await page.shot(`${OUT}/home-1440-final.png`);

  // E. 窄屏：动作收进「更多」，设置仍可达且弹窗居中
  await page.setViewport(390, 844, true);
  await page.reload(); await sleep(800);
  const mobile = await page.eval(`
    const hidden=getComputedStyle(document.querySelector('.topbar-actions')).display==='none';
    const settingsVisible=!!document.querySelector('.topbar .settings-btn') && getComputedStyle(document.querySelector('.topbar .settings-btn')).display!=='none';
    document.querySelector('.dd-menu .dd-trigger').click();
    await new Promise(r=>setTimeout(r,320));
    const items=[...document.querySelectorAll('.dd-pop:popover-open button.mobile-only')].map(e=>e.textContent.trim());
    const setItem=[...document.querySelectorAll('.dd-pop:popover-open button')].find(b=>b.textContent.includes('切换主题'));
    return JSON.stringify({hidden,settingsVisible,items,hasTheme:!!setItem,hasUser:!!document.querySelector('.dd-pop:popover-open .menu-user.mobile-only')});
  `);
  const m = JSON.parse(mobile);
  if (!m.hidden) add('移动端/390', '顶栏次要动作组未收起');
  if (!m.settingsVisible) add('移动端/390', '设置按钮在窄屏不可见');
  if (m.items.length < 3) add('移动端/390', `「更多」缺少移动端动作项: ${m.items.join(' / ')}`);
  if (!m.hasTheme) add('移动端/390', '「更多」缺少切换主题');
  if (!m.hasUser) add('移动端/390', '「更多」缺少登录身份信息');
  // 菜单里的「切换主题」要真的切主题
  const beforeTheme = await page.eval(`return document.documentElement.dataset.mode;`);
  await page.eval(`[...document.querySelectorAll('.dd-pop:popover-open button')].find(x=>x.textContent.includes('切换主题'))?.click(); await new Promise(r=>setTimeout(r,300)); return 1;`);
  const afterTheme = await page.eval(`return document.documentElement.dataset.mode;`);
  if (beforeTheme === afterTheme) add('移动端/390', `菜单切换主题无效（${beforeTheme} → ${afterTheme}）`);
  // 顶栏设置按钮仍可直接打开，且弹窗居中
  await page.eval(`document.querySelector('.topbar .settings-btn')?.click(); await new Promise(r=>setTimeout(r,450)); return 1;`);
  const viaMenu = await page.eval(`
    const d=document.querySelector('dialog.modal[open]');
    if(!d)return JSON.stringify({err:'从更多菜单无法打开设置'});
    const q=d.getBoundingClientRect();
    return JSON.stringify({title:d.querySelector('h3')?.textContent,off:[Math.round(q.left+q.width/2-innerWidth/2),Math.round(q.top+q.height/2-innerHeight/2)]});
  `);
  const vm = JSON.parse(viaMenu);
  if (vm.err) add('移动端/390', vm.err);
  else if (Math.abs(vm.off[0]) > 12 || Math.abs(vm.off[1]) > 12) add('移动端/390', `菜单打开的设置弹窗未居中 off=${vm.off}`);
  console.log('移动端菜单:', JSON.stringify(m), '菜单打开设置:', viaMenu);
  await page.shot(`${OUT}/mobile-390-final.png`);

  // F. 模板页：卡片、卡片菜单、无横向溢出
  await page.setViewport(1440, 900);
  await page.reload(); await sleep(800);
  await page.eval(`[...document.querySelectorAll('.big-tabs button')].find(b=>b.textContent.includes('模板'))?.click(); await new Promise(r=>setTimeout(r,400)); return 1;`);
  const tpl = await page.eval(`
    const cards=[...document.querySelectorAll('.tpl-card')];
    return JSON.stringify({cards:cards.length, overflow:document.documentElement.scrollWidth>innerWidth+1});
  `);
  const tp = JSON.parse(tpl);
  if (tp.overflow) add('模板页/1440', '模板页横向溢出');
  if (tp.cards < 1) add('模板页/1440', '没有模板卡片，无法验证模板交互');
  await page.eval(`document.querySelector('.tpl-card .dd-trigger')?.click(); await new Promise(r=>setTimeout(r,300)); return 1;`);
  const tplMenu = await page.eval(`return JSON.stringify([...document.querySelectorAll('.dd-pop:popover-open button')].map(b=>b.textContent.trim()))`);
  if (!JSON.parse(tplMenu).length) add('模板页/1440', '模板卡菜单没有打开');
  await page.eval(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); [...document.querySelectorAll('.big-tabs button')].find(b=>b.textContent.includes('任务'))?.click(); await new Promise(r=>setTimeout(r,300)); return 1;`);

  // G. 编辑器：画布/积木/参数/MiniMap/工具栏/更多菜单（只读，不保存）
  await page.eval(`
    const row=document.querySelector('.flow-table tbody tr');
    row.querySelector('.dd-trigger').click(); await new Promise(r=>setTimeout(r,250));
    [...document.querySelectorAll('.dd-pop:popover-open button')].find(b=>b.textContent.includes('编辑流程')).click();
    await new Promise(r=>setTimeout(r,1400)); return 1;
  `);
  const ed = await page.eval(`
    const has=(sel)=>!!document.querySelector(sel);
    const btns=[...document.querySelectorAll('.editor-topbar button')].map(b=>b.textContent.trim()).filter(Boolean);
    return JSON.stringify({
      palette:has('.palette'), canvas:has('.canvas-wrap'), config:has('.config-panel'),
      minimap:has('.react-flow__minimap'), nodes:document.querySelectorAll('.react-flow__node').length,
      btns, overflow:document.documentElement.scrollWidth>innerWidth+1,
      canvasH:Math.round((document.querySelector('.canvas-wrap')||{getBoundingClientRect:()=>({height:0})}).getBoundingClientRect().height),
    });
  `);
  const e = JSON.parse(ed);
  if (!e.palette) add('编辑器/1440', '缺少积木面板');
  if (!e.canvas || e.canvasH < 200) add('编辑器/1440', `画布缺失或高度塌陷 (${e.canvasH})`);
  if (!e.config) add('编辑器/1440', '缺少参数面板');
  if (!e.minimap) add('编辑器/1440', '缺少 MiniMap');
  if (e.overflow) add('编辑器/1440', '编辑器横向溢出');
  for (const label of ['调度', '整理', '运行', '日志']) if (!e.btns.includes(label)) add('编辑器/1440', `工具栏缺少「${label}」`);
  await page.eval(`document.querySelector('.editor-topbar .dd-trigger')?.click(); await new Promise(r=>setTimeout(r,300)); return 1;`);
  const edMenu = await page.eval(`return JSON.stringify([...document.querySelectorAll('.dd-pop:popover-open button')].map(b=>b.textContent.trim()))`);
  const em = JSON.parse(edMenu);
  for (const label of ['复制节点', '粘贴节点', '整理布局', '撤销', '重做']) {
    if (!em.some((x) => x.includes(label))) add('编辑器/1440', `编辑器「更多」缺少「${label}」`);
  }
  await page.eval(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); [...document.querySelectorAll('.editor-topbar button')].find(b=>b.textContent.trim()==='返回')?.click(); await new Promise(r=>setTimeout(r,900)); return 1;`);
  console.log('模板页:', tpl, 'tplMenu=', tplMenu);
  console.log('编辑器:', ed, 'edMenu=', edMenu);
  await page.shot(`${OUT}/editor-1440-final.png`);

  console.log('=== FINDINGS (' + findings.length + ') ===');
  for (const f of findings) console.log(`[${f.where}] ${f.msg}`);
  console.log('console errors:', JSON.stringify(page.consoleErrors.slice(0, 10)));
  await page.close(); cdp.close(); proc.kill();
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });

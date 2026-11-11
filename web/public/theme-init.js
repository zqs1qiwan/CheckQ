/**
 * 防 FOUC：JS 加载前先按持久化主题（默认 auto=跟随系统）定 data-mode / data-theme。
 *
 * 为什么放在独立文件里：服务端 CSP 是 `script-src 'self'`，
 * index.html 里的内联脚本会被浏览器直接拦掉 → 主题要等主包执行才生效 → 白天模式会闪一下。
 * 同源外链脚本在 'self' 下允许，且是同步加载（不带 defer/async），仍在首屏绘制前执行。
 */
(function () {
  try {
    var t = localStorage.getItem('checkq-theme') || 'auto';
    var dark = t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = t;
    document.documentElement.dataset.mode = dark ? 'dark' : 'light';
  } catch (e) {
    document.documentElement.dataset.theme = 'auto';
    document.documentElement.dataset.mode = 'light';
  }
})();

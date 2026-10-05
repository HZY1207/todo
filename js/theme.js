(function () {
  'use strict';

  var THEME_KEY = 'todo_theme_v1';
  var THEMES = ['green', 'mono', 'blue'];

  function saved() {
    var v = null;
    try { v = localStorage.getItem(THEME_KEY); } catch (e) {}
    return THEMES.indexOf(v) === -1 ? 'green' : v;
  }

  function paintMeta() {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    var bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    if (bg) meta.setAttribute('content', bg);
  }

  function apply(name) {
    if (THEMES.indexOf(name) === -1) name = 'green';
    document.documentElement.setAttribute('data-theme', name);
    try { localStorage.setItem(THEME_KEY, name); } catch (e) {}
    // 立刻同步一次，避免地址栏 / 状态栏颜色滞后一帧
    paintMeta();
    requestAnimationFrame(function () {
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) {
        var bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
        if (bg) meta.setAttribute('content', bg);
      }
    });
    document.querySelectorAll('.theme-card').forEach(function (card) {
      var on = card.getAttribute('data-theme') === name;
      card.classList.toggle('active', on);
      card.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function init() {
    // index.html 的 <head> 里已有一段内联脚本在首帧前设好 data-theme，这里保持一致
    apply(saved());

    var grid = document.getElementById('theme-grid');
    if (grid) {
      grid.addEventListener('click', function (e) {
        var card = e.target.closest ? e.target.closest('.theme-card') : null;
        if (card) apply(card.getAttribute('data-theme'));
      });
    }
  }

  window.Theme = { init: init, apply: apply, current: saved, list: THEMES };
})();

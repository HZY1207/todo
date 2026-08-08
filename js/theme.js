(function () {
  'use strict';

  var THEME_KEY = 'todo_theme_v1';
  var THEMES = ['green', 'mono', 'blue'];

  function apply(name) {
    document.documentElement.setAttribute('data-theme', name);
    localStorage.setItem(THEME_KEY, name);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      requestAnimationFrame(function () {
        var bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
        if (bg) meta.setAttribute('content', bg);
      });
    }
    document.querySelectorAll('.theme-card').forEach(function (card) {
      card.classList.toggle('active', card.getAttribute('data-theme') === name);
    });
  }

  function init() {
    var saved = localStorage.getItem(THEME_KEY);
    if (THEMES.indexOf(saved) === -1) saved = 'green';
    apply(saved);

    var grid = document.getElementById('theme-grid');
    if (grid) {
      grid.addEventListener('click', function (e) {
        var card = e.target.closest('.theme-card');
        if (card) apply(card.getAttribute('data-theme'));
      });
    }
  }

  window.Theme = { init: init };
})();
(function () {
  'use strict';

  var filter = 'all';

  var els = {
    list: document.getElementById('todo-list'),
    empty: document.getElementById('empty-hint'),
    counter: document.getElementById('counter'),
    addForm: document.getElementById('add-form'),
    addInput: document.getElementById('add-input'),
    addDate: document.getElementById('add-date'),
    settingsBtn: document.getElementById('btn-settings'),
    overlay: document.getElementById('settings-overlay'),
    statHint: document.getElementById('stat-hint')
  };

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function fmtDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  function todayStr() {
    var t = new Date();
    return fmtDate(t);
  }

  function isOverdue(dateStr) {
    return dateStr && dateStr < todayStr();
  }

  function renderList() {
    var all = Store.items();
    var visible = all.filter(function (t) {
      if (filter === 'active') return !t.done;
      if (filter === 'done') return t.done;
      return true;
    });
    var sorted = visible.slice().sort(function (a, b) {
      if (!!a.done !== !!b.done) return a.done ? 1 : -1;
      return (b.created || 0) - (a.created || 0);
    });

    els.list.innerHTML = '';
    sorted.forEach(function (it) { els.list.appendChild(buildItem(it)); });

    els.empty.hidden = sorted.length > 0;

    var s = Store.stats();
    els.counter.textContent = s.total ? (s.total - s.done) + ' 未完成 / ' + s.total + ' 项' : '';
  }

  function buildItem(it) {
    var li = document.createElement('li');
    li.className = 'todo-item' + (it.done ? ' done' : '');
    li.dataset.id = it.id;

    var check = document.createElement('button');
    check.type = 'button';
    check.className = 'todo-check';
    check.setAttribute('aria-label', it.done ? '标记未完成' : '标记完成');
    if (it.done) check.setAttribute('aria-checked', 'true');
    check.addEventListener('click', function () { Store.toggle(it.id); });

    var text = document.createElement('span');
    text.className = 'todo-text';
    text.textContent = it.text;

    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'todo-del';
    del.textContent = '✕';
    del.setAttribute('aria-label', '删除');
    del.addEventListener('click', function () { Store.remove(it.id); });

    li.appendChild(check);
    li.appendChild(text);

    if (it.date) {
      var date = document.createElement('span');
      date.className = 'todo-date';
      var d = it.date.split('-');
      date.textContent = (d.length === 3) ? parseInt(d[1], 10) + '月' + parseInt(d[2], 10) + '日' : it.date;
      if (isOverdue(it.date) && !it.done) li.classList.add('overdue');
      li.appendChild(date);
    }

    li.appendChild(del);

    text.addEventListener('dblclick', function () { editItem(text, it); });

    return li;
  }

  function editItem(textEl, it) {
    if (textEl.querySelector('input')) return;
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'todo-edit';
    input.value = it.text;
    input.maxLength = 100;
    textEl.textContent = '';
    textEl.appendChild(input);
    input.focus();
    input.select();

    var cancelled = false;
    var done = function () {
      if (cancelled) return;
      var v = input.value.trim();
      if (v) Store.setText(it.id, v);
      else Store.remove(it.id);
    };
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelled = true;
        input.blur();
        textEl.textContent = it.text;
      }
    });
    input.addEventListener('blur', done);
  }

  function bindEvents() {
    els.addForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = els.addInput.value.trim();
      if (!text) return;
      Store.add(text, els.addDate.value || todayStr());
      els.addInput.value = '';
      els.addDate.value = todayStr();
    });

    document.querySelectorAll('.filter-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        filter = btn.dataset.filter;
        document.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.toggle('active', b === btn); });
        renderList();
      });
    });

    document.querySelectorAll('.view-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.view-btn').forEach(function (b) { b.classList.toggle('active', b === btn); });
        document.getElementById('view-list').classList.toggle('active', btn.dataset.view === 'list');
        document.getElementById('view-calendar').classList.toggle('active', btn.dataset.view === 'calendar');
      });
    });

    els.settingsBtn.addEventListener('click', openSettings);

    els.overlay.querySelector('[data-close]').addEventListener('click', closeSettings);
    els.overlay.addEventListener('click', function (e) {
      if (e.target === els.overlay) closeSettings();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !els.overlay.hidden) closeSettings();
    });

    document.getElementById('btn-export').addEventListener('click', exportData);
    document.getElementById('btn-import').addEventListener('click', function () {
      document.getElementById('import-file').click();
    });
    document.getElementById('import-file').addEventListener('change', importFile);
    document.getElementById('btn-clear').addEventListener('click', function () {
      if (confirm('确定清空全部待办吗？此操作不可恢复，建议先导出备份。')) {
        Store.clear();
        closeSettings();
      }
    });

    Store.onChange(updateStats);
  }

  function openSettings() {
    els.overlay.hidden = false;
    updateStats();
  }

  function closeSettings() { els.overlay.hidden = true; }

  function updateStats() {
    var s = Store.stats();
    els.statHint.textContent = '共 ' + s.total + ' 项待办，已完成 ' + s.done + ' 项。数据仅保存在本机浏览器中。';
  }

  function exportData() {
    var blob = new Blob([Store.exportJson()], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'todo-backup-' + todayStr() + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
    alert('已导出备份文件。可把该 JSON 文件通过微信 / 网盘发送到电脑，再在电脑上导入。');
  }

  function importFile(e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var n = Store.importData(reader.result);
        alert(n > 0 ? '导入成功，新增 ' + n + ' 项待办。' : '未发现可导入的待办（可能是重复数据）。');
      } catch (err) {
        alert('导入失败：文件格式不正确。');
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  }

  function init() {
    els.addDate.value = todayStr();
    bindEvents();
    Store.onChange(renderList);
    renderList();
    Theme.init();
    Calendar.init();
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
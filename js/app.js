(function () {
  'use strict';

  var filter = 'all';
  var LONG_PRESS_MS = 480;

  var els = {
    list: document.getElementById('todo-list'),
    empty: document.getElementById('empty-hint'),
    counter: document.getElementById('counter'),
    addForm: document.getElementById('add-form'),
    addInput: document.getElementById('add-input'),
    addDate: document.getElementById('add-date'),
    settingsBtn: document.getElementById('btn-settings'),
    overlay: document.getElementById('settings-overlay'),
    sheet: document.querySelector('#settings-overlay .sheet'),
    statHint: document.getElementById('stat-hint'),
    toast: document.getElementById('toast'),
    toastMsg: document.getElementById('toast-msg'),
    toastUndo: document.getElementById('toast-undo'),
    viewList: document.getElementById('view-list'),
    viewCalendar: document.getElementById('view-calendar')
  };

  var viewNames = ['list', 'calendar'];
  var lastFocus = null;
  var toastAction = null;
  var importMode = 'merge';

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function fmtDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  function todayStr() {
    var t = new Date();
    return fmtDate(t);
  }

  function isOverdue(dateStr) {
    return !!dateStr && dateStr < todayStr();
  }

  function now() {
    return (window.performance && performance.now) ? performance.now() : Date.now();
  }

  var emptyText = {
    all: '暂无待办，添加一条吧',
    active: '没有进行中的待办',
    done: '还没有完成的事项',
    undated: '没有未排期的待办'
  };

  /* ---------- 清单视图 ---------- */

  function renderList() {
    var all = Store.items();
    var visible = all.filter(function (t) {
      if (filter === 'active') return !t.done;
      if (filter === 'done') return t.done;
      if (filter === 'undated') return !t.date;
      return true;
    });
    var sorted = visible.slice().sort(function (a, b) {
      if (!!a.done !== !!b.done) return a.done ? 1 : -1;
      return (b.created || 0) - (a.created || 0);
    });

    els.list.innerHTML = '';
    sorted.forEach(function (it) { els.list.appendChild(buildItem(it)); });

    els.empty.hidden = sorted.length > 0;
    els.empty.textContent = emptyText[filter] || emptyText.all;

    updateStats();
  }

  function buildItem(it) {
    var li = document.createElement('li');
    li.className = 'todo-item' + (it.done ? ' done' : '');
    li.dataset.id = it.id;

    var check = document.createElement('button');
    check.type = 'button';
    check.className = 'todo-check' + (it.done ? ' done' : '');
    check.setAttribute('role', 'checkbox');
    check.setAttribute('aria-checked', it.done ? 'true' : 'false');
    check.setAttribute('aria-label', it.text);
    check.title = it.done ? '标记未完成' : '标记完成';
    check.addEventListener('click', function () { Store.toggle(it.id); });

    var text = document.createElement('span');
    text.className = 'todo-text';
    text.textContent = it.text;
    text.title = '双击编辑';

    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'todo-del';
    del.textContent = '✕';
    del.setAttribute('aria-label', '删除');
    del.addEventListener('click', function () { deleteItem(it); });

    var editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'todo-edit-btn';
    editBtn.textContent = '✎';
    editBtn.setAttribute('aria-label', '编辑');
    editBtn.addEventListener('click', function () { startEdit(li, it); });

    li.appendChild(check);
    li.appendChild(text);

    if (it.date) {
      var date = document.createElement('span');
      date.className = 'todo-date';
      var d = it.date.split('-');
      date.textContent = (d.length === 3) ? parseInt(d[1], 10) + '月' + parseInt(d[2], 10) + '日' : it.date;
      if (isOverdue(it.date) && !it.done) li.classList.add('overdue');
      li.appendChild(date);
    } else {
      var flag = document.createElement('span');
      flag.className = 'todo-flag';
      flag.textContent = '未排期';
      li.appendChild(flag);
    }

    li.appendChild(editBtn);
    li.appendChild(del);

    text.addEventListener('dblclick', function () { startEdit(li, it); });
    // 触屏没有双击语义：长按文字进入编辑
    bindLongPress(text, function () { startEdit(li, it); });

    return li;
  }

  function deleteItem(it) {
    var removed = Store.remove(it.id);
    if (removed) showUndo(removed);
  }

  /* ---------- 编辑 ---------- */

  function startEdit(li, it) {
    if (li.classList.contains('editing')) return;
    var textEl = li.querySelector('.todo-text');

    var box = document.createElement('div');
    box.className = 'todo-edit-box';

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'todo-edit';
    input.value = it.text;
    input.maxLength = 100;
    input.setAttribute('aria-label', '编辑内容');

    var date = document.createElement('input');
    date.type = 'date';
    date.className = 'todo-edit-date';
    date.value = it.date || '';
    date.setAttribute('aria-label', '日期，留空表示未排期');

    box.appendChild(input);
    box.appendChild(date);

    var actions = document.createElement('div');
    actions.className = 'todo-edit-actions';

    var save = document.createElement('button');
    save.type = 'button';
    save.className = 'edit-btn';
    save.textContent = '✓';
    save.setAttribute('aria-label', '保存');

    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'edit-btn ghost';
    cancel.textContent = '✕';
    cancel.setAttribute('aria-label', '取消编辑');

    actions.appendChild(save);
    actions.appendChild(cancel);

    Array.prototype.slice.call(li.children).forEach(function (child) { child.hidden = true; });
    li.appendChild(box);
    li.appendChild(actions);
    li.classList.add('editing');

    var closed = false;
    function close(revert) {
      if (closed) return;
      closed = true;
      if (revert) renderList();
      else commit();
    }
    function commit() {
      var v = input.value.trim();
      var d = Store.isValidDate(date.value) ? date.value : '';
      if (!v) { deleteItem(it); return; }
      if (v !== it.text) Store.setText(it.id, v);
      if (d !== (it.date || '')) Store.setDate(it.id, d);
      // 两个值都没变时不会有 Store 变化事件，手动回到只读态
      if (v === it.text && d === (it.date || '')) renderList();
    }

    save.addEventListener('click', function () { close(false); });
    cancel.addEventListener('click', function () { close(true); });

    li.addEventListener('focusout', function (e) {
      if (closed) return;
      if (e.relatedTarget && li.contains(e.relatedTarget)) return;
      setTimeout(function () {
        var a = document.activeElement;
        if (!closed && (!a || !li.contains(a))) close(false);
      }, 0);
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); close(false); }
      if (e.key === 'Escape') { e.preventDefault(); close(true); }
    });
    date.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); close(false); }
      if (e.key === 'Escape') { e.preventDefault(); close(true); }
    });

    var active = document.activeElement;
    if (active && li.contains(active)) active.blur();
    input.focus();
    input.select();
  }

  /* ---------- 长按 ---------- */

  function bindLongPress(el, fn) {
    var timer = null, fired = false, moved = false, startX = 0, startY = 0;

    function clear() {
      if (timer) { clearTimeout(timer); timer = null; }
    }

    el.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      moved = false;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      clear();
      timer = setTimeout(function () {
        timer = null;
        fired = true;
        try { el.dispatchEvent(new Event('touchend')); } catch (err) {}
        fn();
      }, LONG_PRESS_MS);
    }, { passive: true });

    el.addEventListener('touchmove', function (e) {
      if (!e.touches.length) return;
      var dx = e.touches[0].clientX - startX;
      var dy = e.touches[0].clientY - startY;
      if (dx * dx + dy * dy > 100) { moved = true; clear(); }
    }, { passive: true });

    el.addEventListener('touchend', function () {
      clear();
      if (fired) {
        fired = false;
        // 吞掉长按之后浏览器补发的那次 click，避免顺带切换完成状态
        el.addEventListener('click', swallow, true);
        setTimeout(function () { el.removeEventListener('click', swallow, true); }, 700);
      }
    });

    el.addEventListener('touchcancel', function () { moved = false; clear(); });

    function swallow(e) { e.stopPropagation(); e.preventDefault(); }
  }

  /* ---------- 底部提示：撤销删除 / 刷新到新版本 ---------- */

  function showToast(msg, actionLabel, seconds, action) {
    if (!els.toast) return;
    clearTimeout(showToast._t);
    els.toastMsg.textContent = msg;
    els.toastUndo.textContent = actionLabel;
    toastAction = action;
    els.toast.hidden = false;
    showToast._t = setTimeout(hideToast, seconds * 1000);
  }

  function hideToast() {
    if (!els.toast) return;
    clearTimeout(showToast._t);
    els.toast.hidden = true;
    toastAction = null;
  }

  function showUndo(item) {
    showToast('已删除', '撤销', 6, function () { Store.restore(item); });
  }

  // Service Worker 换新后当前页面还在跑旧代码，提示一下（本会话本来就有旧 worker 才提示）
  function watchForUpdate() {
    if (!('serviceWorker' in navigator)) return;
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController) return;
      showToast('已更新到新版本', '刷新', 15, function () { location.reload(); });
    });
  }

  /* ---------- 事件绑定 ---------- */

  function bindEvents() {
    els.addForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = els.addInput.value.trim();
      if (!text) return;
      var it = Store.add(text, els.addDate.value);
      if (it && it._saved === false) {
        alert('保存失败：浏览器存储不可用（可能是隐私模式）或已写满。请先导出备份。');
      }
      els.addInput.value = '';
      els.addDate.value = '';
      els.addInput.focus();
    });

    document.querySelectorAll('.filter-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        filter = btn.dataset.filter;
        document.querySelectorAll('.filter-btn').forEach(function (b) {
          var on = b === btn;
          b.classList.toggle('active', on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        renderList();
      });
    });

    document.querySelectorAll('.view-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { setView(btn.dataset.view); });
    });

    els.settingsBtn.addEventListener('click', openSettings);

    var closeBtn = els.overlay.querySelector('[data-close]');
    if (closeBtn) closeBtn.addEventListener('click', closeSettings);
    els.overlay.addEventListener('click', function (e) {
      if (e.target === els.overlay) closeSettings();
    });

    document.getElementById('btn-export').addEventListener('click', exportData);
    document.getElementById('btn-import').addEventListener('click', function () {
      importMode = 'merge';
      document.getElementById('import-file').click();
    });
    document.getElementById('btn-restore').addEventListener('click', function () {
      if (!confirm('从备份还原会先清空当前全部待办，再按备份文件恢复。确定继续吗？')) return;
      importMode = 'replace';
      document.getElementById('restore-file').click();
    });
    document.getElementById('import-file').addEventListener('change', importFile);
    document.getElementById('restore-file').addEventListener('change', importFile);
    document.getElementById('btn-clear').addEventListener('click', function () {
      if (confirm('确定清空全部待办吗？此操作不可恢复，建议先导出备份。')) {
        Store.clear();
        closeSettings();
      }
    });

    if (els.toastUndo) {
      els.toastUndo.addEventListener('click', function () {
        var fn = toastAction;
        // 先收起提示再执行动作，避免动作里的 store 变化与提示状态互相影响
        els.toast.hidden = true;
        clearTimeout(showToast._t);
        toastAction = null;
        if (fn) fn();
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!els.overlay.hidden) { closeSettings(); return; }
      // 没有设置面板时，Escape 退出正在进行的编辑
      var editing = els.list.querySelector('.todo-item.editing');
      if (editing) renderList();
    });
  }

  function setView(name) {
    if (viewNames.indexOf(name) === -1) name = 'list';
    document.querySelectorAll('.view-btn').forEach(function (b) {
      var on = b.dataset.view === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    els.viewList.classList.toggle('active', name === 'list');
    els.viewCalendar.classList.toggle('active', name === 'calendar');
  }

  /* ---------- 设置面板 ---------- */

  function focusables() {
    return els.overlay.querySelectorAll('button, input, [tabindex]');
  }

  function openSettings() {
    lastFocus = document.activeElement;
    els.overlay.hidden = false;
    updateStats();
    var first = els.overlay.querySelector('[data-close]');
    if (first) first.focus();
  }

  function closeSettings() {
    if (els.overlay.hidden) return;
    els.overlay.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    lastFocus = null;
  }

  // 把 Tab 焦点留在面板内
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab' || els.overlay.hidden) return;
    var list = focusables();
    if (!list.length) return;
    var first = list[0], last = list[list.length - 1];
    var active = document.activeElement || document.body;
    if (e.shiftKey && (active === first || !els.overlay.contains(active))) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault(); first.focus();
    }
  });

  function updateStats() {
    var s = Store.stats();
    els.counter.textContent = s.total ? s.active + ' 未完成 / ' + s.total + ' 项' : '';
    if (els.statHint) {
      els.statHint.textContent = '共 ' + s.total + ' 项待办，已完成 ' + s.done +
        ' 项，未排期 ' + s.undated + ' 项。数据仅保存在本机浏览器中。';
    }
  }

  /* ---------- 导入导出 ---------- */

  function exportData() {
    var raw = Store.exportJson();
    var a = document.createElement('a');
    var done = false;
    if (window.URL && URL.createObjectURL) {
      var blob = new Blob([raw], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      a.href = url;
      a.download = 'todo-backup-' + todayStr() + '.json';
      done = true;
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    } else if (navigator.msSaveBlob) {
      navigator.msSaveBlob(new Blob([raw], { type: 'application/json' }), 'todo-backup-' + todayStr() + '.json');
      return;
    }
    if (!done) {
      a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(raw);
      a.download = 'todo-backup-' + todayStr() + '.json';
    }
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    alert('已导出备份文件。可把该 JSON 文件通过微信 / 网盘发送到电脑，再在电脑上导入。');
  }

  function importFile(e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var r = Store.importData(reader.result, importMode);
        var replace = r.mode === 'replace';
        if (r.added > 0) {
          var msg = (replace ? '还原成功，恢复 ' : '导入成功，新增 ') + r.added + ' 项待办。';
          if (r.duplicates > 0) msg += '跳过 ' + r.duplicates + ' 条重复。';
          if (r.skipped > 0) msg += '（另有 ' + r.skipped + ' 条数据无效）';
          if (r.saved === false) msg += ' 但写入浏览器存储失败，请先导出备份。';
          alert(msg);
        } else if (replace) {
          alert(r.skipped > 0 ? '备份文件里没有有效待办，当前数据已清空。' : '备份文件是空的，当前数据已清空。');
        } else if (r.duplicates > 0 && r.skipped === 0) {
          alert('这些待办都已经存在，没有新增（' + r.duplicates + ' 条重复）。');
        } else {
          alert(r.skipped > 0 ? '没有可导入的有效待办（' + r.skipped + ' 条记录格式不正确）。' : '文件里没有待办数据。');
        }
      } catch (err) {
        alert('导入失败：文件不是有效的 JSON。');
      }
      importMode = 'merge';
      e.target.value = '';
    };
    reader.onerror = function () {
      alert('读取文件失败，请重试。');
      e.target.value = '';
    };
    reader.readAsText(file);
  }

  /* ---------- 启动 ---------- */

  function init() {
    els.addDate.value = '';
    setView('list');
    bindEvents();
    watchForUpdate();

    // 只注册一次：以前 renderList 在这里和 bindEvents 里各注册一次，每次改动都会重建两遍列表
    Store.onChange(renderList);

    renderList();
    Theme.init();
    Calendar.init();

    var secure = location.protocol === 'https:' ||
      location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if ('serviceWorker' in navigator && secure) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();

(function () {
  'use strict';

  var MONTHS = ['一月', '二月', '三月', '四月', '五月', '六月',
    '七月', '八月', '九月', '十月', '十一月', '十二月'];
  var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  var curYear, curMonth;
  var selectedDate = null;   // YYYY-MM-DD
  var mode = 'date';         // 'date' | 'undated'

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function fmt(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }

  function todayStr() {
    var t = new Date();
    return fmt(t.getFullYear(), t.getMonth(), t.getDate());
  }

  function isRealDate(y, m, d) {
    var probe = new Date(y, m, d);
    return probe.getFullYear() === y && probe.getMonth() === m && probe.getDate() === d;
  }

  // 严格解析：拒绝 2026-13-45 这类会被 Date 静默滚动的值
  function parseDate(str) {
    if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
    var p = str.split('-');
    var y = parseInt(p[0], 10), m = parseInt(p[1], 10) - 1, d = parseInt(p[2], 10);
    if (!isRealDate(y, m, d)) return null;
    return new Date(y, m, d);
  }

  function byDate() {
    var map = { dated: {}, undated: [] };
    Store.items().forEach(function (it) {
      var key = Store.isValidDate(it.date) ? it.date : '';
      if (!key) { map.undated.push(it); return; }
      (map.dated[key] = map.dated[key] || []).push(it);
    });
    return map;
  }

  function sortDay(list) {
    var undone = list.filter(function (t) { return !t.done; });
    var done = list.filter(function (t) { return t.done; });
    return undone.concat(done);
  }

  /* ---------- 月历 ---------- */

  function render() {
    var grid = document.getElementById('cal-grid');
    if (!grid) return;
    grid.innerHTML = '';

    var title = document.getElementById('cal-title');
    title.textContent = curYear + '年 ' + MONTHS[curMonth];

    var today = todayStr();
    if (mode === 'date' && !selectedDate) selectedDate = today;

    var map = byDate();
    var undatedBtn = document.getElementById('btn-undated');
    if (undatedBtn) {
      undatedBtn.textContent = '未排期 ' + map.undated.length;
      undatedBtn.hidden = map.undated.length === 0;
      undatedBtn.classList.toggle('active', mode === 'undated');
      undatedBtn.setAttribute('aria-pressed', mode === 'undated' ? 'true' : 'false');
    }

    var first = new Date(curYear, curMonth, 1);
    var startWeekday = (first.getDay() + 6) % 7;                       // 周一为第一天
    var daysInMonth = new Date(curYear, curMonth + 1, 0).getDate();
    var prevDays = new Date(curYear, curMonth, 0).getDate();
    var rows = Math.ceil((startWeekday + daysInMonth) / 7);            // 只渲染真实需要的周数

    for (var i = 0; i < rows * 7; i++) {
      var dayNum, isOther = false, year = curYear, month = curMonth;
      if (i < startWeekday) {
        isOther = true;
        month = curMonth - 1;
        dayNum = prevDays - startWeekday + 1 + i;
      } else if (i >= startWeekday + daysInMonth) {
        isOther = true;
        month = curMonth + 1;
        dayNum = i - startWeekday - daysInMonth + 1;
      } else {
        dayNum = i - startWeekday + 1;
      }
      if (month < 0) { month = 11; year--; }
      if (month > 11) { month = 0; year++; }

      var key = fmt(year, month, dayNum);
      var cell = document.createElement('button');
      cell.className = 'cal-cell';
      cell.type = 'button';

      var dayNumEl = document.createElement('span');
      dayNumEl.className = 'cal-day';
      dayNumEl.textContent = dayNum;
      cell.appendChild(dayNumEl);

      if (isOther) cell.classList.add('other');
      if (key === today) cell.classList.add('today');
      if (mode === 'date' && key === selectedDate) cell.classList.add('selected');

      var dayItems = sortDay(map.dated[key] || []);
      dayItems.slice(0, 2).forEach(function (it) {
        var line = document.createElement('span');
        line.className = 'cal-text' + (it.done ? ' done' : '');
        line.textContent = it.text;
        cell.appendChild(line);
      });
      if (dayItems.length > 2) {
        var more = document.createElement('span');
        more.className = 'cal-more';
        more.textContent = '+' + (dayItems.length - 2);
        cell.appendChild(more);
      }

      var dayLabel = year + '年' + (month + 1) + '月' + dayNum + '日';
      var pending = dayItems.filter(function (t) { return !t.done; }).length;
      cell.setAttribute('aria-label',
        dayLabel + (isOther ? '（非本月）' : '') +
        (dayItems.length ? '，' + dayItems.length + ' 项待办，' + pending + ' 项未完成' : '，无待办'));

      cell.addEventListener('click', (function (key) {
        return function () { select(key); };
      })(key));

      grid.appendChild(cell);
    }

    renderDayPanel(map);
  }

  /* ---------- 当日面板 ---------- */

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

    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'todo-del';
    del.textContent = '✕';
    del.setAttribute('aria-label', '删除');
    del.addEventListener('click', function () { Store.remove(it.id); });

    li.appendChild(check);
    li.appendChild(text);
    li.appendChild(del);
    return li;
  }

  function renderDayPanel(map) {
    var title = document.getElementById('day-title');
    var listEl = document.getElementById('day-list');
    var empty = document.getElementById('day-empty');
    var input = document.getElementById('day-add-input');
    var back = document.getElementById('btn-panel-back');
    if (!listEl) return;

    listEl.innerHTML = '';

    var undated = mode === 'undated';
    if (undated) {
      title.textContent = '未排期';
      if (back) back.hidden = false;
      if (input) input.placeholder = '添加一条未排期待办…';
    } else {
      var d = parseDate(selectedDate);
      title.textContent = selectedDate + (d ? ' · ' + WEEKDAYS[d.getDay()] : '');
      if (back) back.hidden = true;
      if (input) input.placeholder = '为这一天添加待办…';
    }

    var list = sortDay(undated ? map.undated : (map.dated[selectedDate] || []));
    list.forEach(function (it) { listEl.appendChild(buildItem(it)); });

    if (empty) {
      empty.hidden = list.length > 0;
      empty.textContent = undated ? '没有未排期的待办' : '这一天还没有待办';
    }
  }

  /* ---------- 交互 ---------- */

  function select(key) {
    if (!parseDate(key)) return;
    var p = key.split('-');
    curYear = parseInt(p[0], 10);
    curMonth = parseInt(p[1], 10) - 1;
    selectedDate = key;
    mode = 'date';
    render();
  }

  function nav(offset) {
    if (isNaN(curYear) || isNaN(curMonth)) return;
    var m = new Date(curYear, curMonth + offset, 1);
    curYear = m.getFullYear();
    curMonth = m.getMonth();
    render();
  }

  function goToday() {
    var t = new Date();
    curYear = t.getFullYear();
    curMonth = t.getMonth();
    selectedDate = todayStr();
    mode = 'date';
    render();
  }

  function showUndated() {
    mode = 'undated';
    render();
  }

  function init() {
    var d = new Date();
    curYear = d.getFullYear();
    curMonth = d.getMonth();
    selectedDate = todayStr();
    mode = 'date';

    document.querySelectorAll('.cal-nav').forEach(function (btn) {
      btn.addEventListener('click', function () { nav(parseInt(btn.dataset.offset, 10)); });
    });
    document.getElementById('btn-today').addEventListener('click', goToday);

    var back = document.getElementById('btn-panel-back');
    if (back) back.addEventListener('click', goToday);

    var undatedBtn = document.getElementById('btn-undated');
    if (undatedBtn) undatedBtn.addEventListener('click', showUndated);

    var form = document.getElementById('day-add-form');
    var input = document.getElementById('day-add-input');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = input.value.trim();
      if (!text) return;
      var it = Store.add(text, mode === 'undated' ? '' : selectedDate);
      if (it && it._saved === false) {
        alert('保存失败：浏览器存储不可用（可能是隐私模式）或已写满。请先导出备份。');
      }
      input.value = '';
      input.focus();
    });

    Store.onChange(render);
    render();
  }

  window.Calendar = {
    init: init,
    getSelected: function () { return mode === 'undated' ? '' : selectedDate; },
    isUndated: function () { return mode === 'undated'; }
  };
})();

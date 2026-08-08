(function () {
  'use strict';

  var MONTHS = ['一月', '二月', '三月', '四月', '五月', '六月',
    '七月', '八月', '九月', '十月', '十一月', '十二月'];

  var curYear, curMonth, curDay; // 当前显示的月份
  var selectedDate = null;       // 选中的日期 YYYY-MM-DD

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function fmt(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }

  function todayStr() {
    var t = new Date();
    return fmt(t.getFullYear(), t.getMonth(), t.getDate());
  }

  function parseDate(str) {
    var p = String(str).split('-');
    if (p.length !== 3) return null;
    var y = parseInt(p[0], 10), m = parseInt(p[1], 10) - 1, d = parseInt(p[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
    return new Date(y, m, d);
  }

  function render() {
    var grid = document.getElementById('cal-grid');
    if (!grid) return;
    grid.innerHTML = '';

    var title = document.getElementById('cal-title');
    title.textContent = curYear + '年 ' + MONTHS[curMonth];

    var today = todayStr();
    if (!selectedDate) selectedDate = today;

    var first = new Date(curYear, curMonth, 1);
    var startWeekday = (first.getDay() + 6) % 7; // 周一为第一天
    var daysInMonth = new Date(curYear, curMonth + 1, 0).getDate();
    var prevDays = new Date(curYear, curMonth, 0).getDate();

    var items = Store.items();
    var byDate = {};
    items.forEach(function (it) {
      if (!it.date) return;
      var k = it.date;
      (byDate[k] = byDate[k] || []).push(it);
    });

    for (var i = 0; i < 42; i++) {
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
      if (key === selectedDate) cell.classList.add('selected');

      var dayItems = byDate[key] || [];
      var undone = dayItems.filter(function (t) { return !t.done; });
      var doneItems = dayItems.filter(function (t) { return t.done; });
      var shown = undone.concat(doneItems).slice(0, 2);
      shown.forEach(function (it) {
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

      cell.addEventListener('click', (function (key) {
        return function () { select(key); };
      })(key));

      grid.appendChild(cell);
    }

    renderDayPanel(byDate);
  }

  function renderDayPanel(byDate) {
    var title = document.getElementById('day-title');
    var listEl = document.getElementById('day-list');
    var empty = document.getElementById('day-empty');
    listEl.innerHTML = '';

    var d = parseDate(selectedDate);
    var weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    title.textContent = selectedDate + (d ? ' · ' + weekdays[d.getDay()] : '');

    var list = byDate ? byDate[selectedDate] || [] : [];
    list.forEach(function (it) {
      var li = buildItem(it);
      listEl.appendChild(li);
    });
    empty.hidden = list.length > 0;
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
    li.appendChild(del);
    return li;
  }

  function select(key) {
    var parts = key.split('-');
    curYear = parseInt(parts[0], 10);
    curMonth = parseInt(parts[1], 10) - 1;
    selectedDate = key;
    render();
  }

  function nav(offset) {
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
    render();
  }

  function init() {
    var d = new Date();
    curYear = d.getFullYear();
    curMonth = d.getMonth();
    selectedDate = todayStr();

    document.querySelectorAll('.cal-nav').forEach(function (btn) {
      btn.addEventListener('click', function () { nav(parseInt(btn.dataset.offset, 10)); });
    });
    document.getElementById('btn-today').addEventListener('click', goToday);

    var form = document.getElementById('day-add-form');
    var input = document.getElementById('day-add-input');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = input.value.trim();
      if (!text) return;
      Store.add(text, selectedDate);
      input.value = '';
    });

    Store.onChange(render);
    render();
  }

  window.Calendar = {
    init: init,
    getSelected: function () { return selectedDate; }
  };
})();
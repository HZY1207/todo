(function () {
  'use strict';

  var KEY = 'todo_data_v1';
  var ID_KEY = 'todo_seq_v1';

  var listeners = [];

  function uid() {
    var n = parseInt(localStorage.getItem(ID_KEY) || '0', 10) + 1;
    localStorage.setItem(ID_KEY, String(n));
    return String(n);
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      var data = raw ? JSON.parse(raw) : { items: [] };
      if (!Array.isArray(data.items)) data.items = [];
      return data;
    } catch (e) {
      return { items: [] };
    }
  }

  function save(data) {
    localStorage.setItem(KEY, JSON.stringify(data));
    emit();
  }

  function emit() {
    listeners.forEach(function (fn) { try { fn(); } catch (e) {} });
  }

  function onChange(fn) { listeners.push(fn); }

  function keyOf(dateStr) {
    return dateStr ? String(dateStr) : '';
  }

  function add(text, dateStr) {
    var data = load();
    data.items.unshift({
      id: uid(),
      text: String(text).trim(),
      done: false,
      date: keyOf(dateStr),
      created: Date.now()
    });
    save(data);
    return data.items[0];
  }

  function toggle(id) {
    var data = load();
    data.items = data.items.map(function (t) {
      if (t.id === id) { t.done = !t.done; t.doneAt = t.done ? Date.now() : null; }
      return t;
    });
    save(data);
  }

  function remove(id) {
    var data = load();
    data.items = data.items.filter(function (t) { return t.id !== id; });
    save(data);
  }

  function setText(id, text) {
    var data = load();
    data.items = data.items.map(function (t) {
      if (t.id === id) t.text = String(text).trim();
      return t;
    });
    save(data);
  }

  function clearAll() {
    save({ items: [] });
  }

  function items() { return load().items; }

  function importData(json) {
    var parsed = typeof json === 'string' ? JSON.parse(json) : json;
    if (!parsed || !Array.isArray(parsed.items)) throw new Error('格式不正确');
    var data = load();
    var have = {};
    data.items.forEach(function (t) { have[t.id] = true; });
    var added = 0;
    parsed.items.forEach(function (it) {
      if (!it || typeof it.text !== 'string' || !it.text.trim()) return;
      var id = it.id && !have[it.id] ? String(it.id) : uid();
      have[id] = true;
      data.items.push({
        id: id,
        text: String(it.text).trim(),
        done: !!it.done,
        date: keyOf(it.date),
        created: it.created || Date.now()
      });
      added++;
    });
    if (added) save(data);
    return added;
  }

  function exportJson() {
    return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), items: items() }, null, 2);
  }

  function stats() {
    var all = items();
    var done = 0;
    all.forEach(function (t) { if (t.done) done++; });
    return { total: all.length, done: done };
  }

  window.Store = {
    add: add,
    toggle: toggle,
    remove: remove,
    setText: setText,
    clear: clearAll,
    items: items,
    importData: importData,
    exportJson: exportJson,
    stats: stats,
    onChange: onChange
  };
})();
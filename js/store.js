(function () {
  'use strict';

  var KEY = 'todo_data_v1';
  var ID_KEY = 'todo_seq_v1';
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  var listeners = [];

  /* ---------- 存储层：任何一次 localStorage 失败都不应该让 UI 崩掉 ---------- */

  function readRaw() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }

  function writeRaw(str) {
    try { localStorage.setItem(KEY, str); return true; }
    catch (e) { return false; }
  }

  function readSeq() {
    try { return parseInt(localStorage.getItem(ID_KEY) || '0', 10) || 0; }
    catch (e) { return 0; }
  }

  function writeSeq(n) {
    try { localStorage.setItem(ID_KEY, String(n)); return true; }
    catch (e) { return false; }
  }

  function load() {
    var raw = readRaw();
    if (!raw) return { items: [] };
    try {
      var data = JSON.parse(raw);
      if (!data || !Array.isArray(data.items)) return { items: [] };
      return data;
    } catch (e) {
      // 解析失败不要静默当成"没有数据"：把坏数据留一份，避免用户以为数据凭空消失
      try { localStorage.setItem(KEY + '_corrupt', raw); } catch (e2) {}
      return { items: [], corrupt: true };
    }
  }

  function save(data) {
    var ok = writeRaw(JSON.stringify(data));
    emit();
    return ok;
  }

  function emit() {
    listeners.forEach(function (fn) { try { fn(); } catch (e) {} });
  }

  function onChange(fn) { listeners.push(fn); }

  /* ---------- 字段规范化 ---------- */

  function normDate(v) {
    return (typeof v === 'string' && DATE_RE.test(v)) ? v : '';
  }

  function textOf(v) {
    if (typeof v !== 'string') return '';
    // 输入框限了 100，导入路径没有：这里兜一下，避免一条超长文本撑爆 localStorage
    return v.trim().slice(0, 200);
  }

  /* ---------- id ---------- */

  function maxNumericId(items) {
    var max = 0;
    items.forEach(function (t) {
      var n = parseInt(t && t.id, 10);
      if (!isNaN(n) && String(n) === String(t.id) && n > max) max = n;
    });
    return max;
  }

  // 计数器可能落后于数据（导入过他方数据、或 ID_KEY 被清掉），取两者的较大值
  function nextId(data) {
    var seq = readSeq();
    var max = maxNumericId(data.items);
    if (max > seq) { seq = max; writeSeq(seq); }
    seq += 1;
    writeSeq(seq);
    return String(seq);
  }

  function newId(data, taken) {
    var seq = readSeq();
    var max = maxNumericId(data.items);
    if (taken) {
      Object.keys(taken).forEach(function (k) {
        var n = parseInt(k, 10);
        if (!isNaN(n) && String(n) === String(k) && n > max) max = n;
      });
    }
    if (max > seq) seq = max;
    do { seq += 1; } while (taken && taken[String(seq)]);
    writeSeq(seq);
    return String(seq);
  }

  /* ---------- 增删改查 ---------- */

  function add(text, dateStr) {
    var data = load();
    var t = textOf(text);
    if (!t) return null;
    var item = {
      id: nextId(data),
      text: t,
      done: false,
      date: normDate(dateStr),
      created: Date.now()
    };
    data.items.unshift(item);
    item._saved = save(data);
    return item;
  }

  // 撤销删除用：把原对象放回原位，id 不会撞车（刚被删掉）
  function restore(item) {
    if (!item || typeof item.id === 'undefined') return null;
    var data = load();
    if (data.items.some(function (t) { return t.id === item.id; })) return null;
    data.items.push({
      id: String(item.id),
      text: textOf(item.text),
      done: !!item.done,
      date: normDate(item.date),
      created: item.created || Date.now()
    });
    save(data);
    return true;
  }

  function toggle(id) {
    var data = load();
    data.items = data.items.map(function (t) {
      if (t.id === id) { t.done = !t.done; t.doneAt = t.done ? Date.now() : null; }
      return t;
    });
    return save(data);
  }

  function remove(id) {
    var data = load();
    var hit = null;
    data.items = data.items.filter(function (t) {
      if (t.id === id) { hit = t; return false; }
      return true;
    });
    if (!hit) return null;
    save(data);
    return hit;
  }

  function setText(id, text) {
    var data = load();
    var v = textOf(text);
    if (!v) return null;
    data.items = data.items.map(function (t) {
      if (t.id === id) t.text = v;
      return t;
    });
    return save(data);
  }

  // date 传空字符串表示改为"未排期"
  function setDate(id, dateStr) {
    var data = load();
    var v = normDate(dateStr);
    data.items = data.items.map(function (t) {
      if (t.id === id) t.date = v;
      return t;
    });
    return save(data);
  }

  function clearAll() {
    var ok = save({ items: [] });
    writeSeq(0);
    return ok;
  }

  function items() { return load().items; }

  // mode: 'merge'（默认，合并导入）| 'replace'（清空后从备份还原）
  function importData(json, mode) {
    var parsed = typeof json === 'string' ? JSON.parse(json) : json;
    if (!parsed || !Array.isArray(parsed.items)) throw new Error('格式不正确');
    var replace = mode === 'replace';
    var data = replace ? { items: [] } : load();
    var taken = {};
    var seen = {};
    if (!replace) {
      data.items.forEach(function (t) {
        if (t && typeof t.id !== 'undefined') taken[String(t.id)] = true;
      });
      data.items.forEach(function (t) { seen[fingerprint(t)] = true; });
    }
    var added = 0, skipped = 0, duplicates = 0;
    parsed.items.forEach(function (it) {
      if (!it || typeof it !== 'object') { skipped++; return; }
      var text = textOf(it.text);
      if (!text) { skipped++; return; }
      var created = parseInt(it.created, 10);
      if (isNaN(created)) created = Date.now();
      if (!replace) {
        // 去重指纹：同内容 + 同日期 + 同创建时刻视为同一条待办，
        // 这样"同一份备份导两次"不会翻倍，但两次分别新建的同名待办不会被误合。
        var fp = text + '\u0000' + normDate(it.date) + '\u0000' + created;
        if (seen[fp]) { duplicates++; return; }
        seen[fp] = true;
      }
      // 导入的 id 一律重新分配：外来 id 与本机计数器互不知情，直接沿用会让
      // toggle/remove 的 t.id === id 一次命中多条
      var id = newId(data, taken);
      taken[id] = true;
      data.items.push({
        id: id,
        text: text,
        done: !!it.done,
        date: normDate(it.date),
        created: created
      });
      added++;
    });
    var saved = added || replace ? save(data) : true;
    return { added: added, skipped: skipped, duplicates: duplicates, saved: saved, mode: replace ? 'replace' : 'merge' };
  }

  function exportJson() {
    return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), items: items() }, null, 2);
  }

  // 去重指纹：同内容 + 同日期 + 同创建时刻视为同一条待办，
  // 这样"同一份备份导两次"不会翻倍，但两次分别新建的同名待办不会被误合。
  function fingerprint(t) {
    return textOf(t.text) + '\u0000' + normDate(t.date) + '\u0000' + (t.created || 0);
  }

  function stats() {
    var all = items();
    var done = 0, undated = 0;
    all.forEach(function (t) {
      if (t.done) done++;
      if (!t.date) undated++;
    });
    return { total: all.length, done: done, active: all.length - done, undated: undated };
  }

  function isValidDate(v) { return typeof v === 'string' && DATE_RE.test(v); }

  window.Store = {
    add: add,
    restore: restore,
    toggle: toggle,
    remove: remove,
    setText: setText,
    setDate: setDate,
    clear: clearAll,
    items: items,
    importData: importData,
    exportJson: exportJson,
    stats: stats,
    isValidDate: isValidDate,
    onChange: onChange
  };
})();

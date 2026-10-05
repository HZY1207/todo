/* Minimal DOM/localStorage harness to execute the todo app's scripts in Node.
   Purpose: catch runtime bugs and pin the fixed behaviour, not to emulate a browser.
   Run: node _review/harness.js                                                        */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

/* ---------------- fake DOM ---------------- */
class ClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  add(...c) { c.filter(Boolean).forEach(x => this.set.add(x)); this._sync(); }
  remove(...c) { c.forEach(x => this.set.delete(x)); this._sync(); }
  contains(c) { return this.set.has(c); }
  toggle(c, force) {
    const on = force === undefined ? !this.set.has(c) : !!force;
    if (on) this.set.add(c); else this.set.delete(c);
    this._sync(); return on;
  }
  _sync() { this.el._className = [...this.set].join(' '); }
}

let idSeq = 0;
class El {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = doc || null;
    this.children = [];
    this.parentNode = null;
    this.listeners = {};
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this._className = '';
    this._id = '';
    this._text = '';
    this.hidden = false;
    this.value = '';
    this.type = '';
    this.title = '';
    this.placeholder = '';
    this.maxLength = 0;
    this.classList = new ClassList(this);
    this._uid = ++idSeq;
  }
  set className(v) { this._className = v; this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return this._className; }
  set id(v) { this._id = v; }
  get id() { return this._id; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() {
    if (this.children.length) return this.children.map(c => c.textContent).join('');
    return this._text;
  }
  set innerHTML(v) { if (String(v) !== '') throw new Error('harness: innerHTML set to non-empty'); this.children = []; }
  get innerHTML() { return ''; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter(x => x !== c); return c; }
  contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
    if (k.startsWith('data-')) {
      const camel = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[camel] = String(v);
    }
    if (k === 'hidden') this.hidden = true;
  }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  removeAttribute(k) {
    delete this.attributes[k];
    if (k === 'hidden') this.hidden = false;
    if (k.startsWith('data-')) {
      const camel = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      delete this.dataset[camel];
    }
  }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter(f => f !== fn); }
  querySelector(sel) { return query(this, sel, true); }
  querySelectorAll(sel) { return query(this, sel, false); }
  closest(sel) {
    let n = this;
    while (n) { if (n.tagName && matches(n, sel)) return n; n = n.parentNode; }
    return null;
  }
  matches(sel) { return matches(this, sel); }
  focus() {
    const prev = this.ownerDocument && this.ownerDocument.activeElement;
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
    if (prev && prev !== this) prev._emitFocusOut(this);
  }
  _emitFocusOut(next) {
    let node = this;
    while (node) {
      (node.listeners.focusout || []).forEach(fn => fn({ type: 'focusout', target: this, relatedTarget: next || null }));
      node = node.parentNode;
    }
  }
  select() {}
  blur() {
    if (this.ownerDocument && this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null;
    this._emitFocusOut(null);
  }
  click() { this._clicked = true; this.dispatch('click'); }
  get outerHTML() { return serialize(this); }
  dispatch(type, extra) {
    const ev = Object.assign({
      type, target: this, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() {},
      touches: []
    }, extra);
    let node = this;
    while (node) {
      (node.listeners[type] || []).forEach(fn => fn.call(node, ev));
      node = node.parentNode;
    }
    return ev;
  }
}
class Evt {
  constructor(type) { this.type = type; this.defaultPrevented = false; }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() {}
}

/* selector engine: only the shapes this app uses */
function parseSel(sel) {
  sel = String(sel).trim();
  if (sel === '*') return { tag: null, id: null, classes: [] };
  const m = /^([a-zA-Z]*)((?:[#.][\w-]+)*)$/.exec(sel);
  if (!m) throw new Error('harness: unsupported selector ' + sel);
  const out = { tag: m[1] || null, id: null, classes: [] };
  const re = /([#.])([\w-]+)/g; let t;
  while ((t = re.exec(m[2] || ''))) { if (t[1] === '#') out.id = t[2]; else out.classes.push(t[2]); }
  return out;
}
function matches(el, sel) {
  sel = String(sel).trim();
  const parts = sel.split(/\s+(?![^(]*\))/);      // descendant combinator, ignoring ":not(...)"
  if (parts.length > 1) {
    if (!matchesOne(el, parts[parts.length - 1])) return false;
    let n = el.parentNode, i = parts.length - 2;
    while (n && i >= 0) {
      if (n.tagName && matchesOne(n, parts[i])) i--;
      n = n.parentNode;
    }
    return i < 0;
  }
  return matchesOne(el, sel);
}
function matchesOne(el, sel) {
  sel = String(sel).trim();
  if (!el || !el.tagName) return false;
  if (sel.includes(',')) return sel.split(',').some(one => matches(el, one.trim()));
  let negate = null;
  const not = /:not\(([^)]+)\)\s*$/.exec(sel);
  if (not) { negate = not[1]; sel = sel.slice(0, not.index).trim(); }
  let attr = null;
  const am = /\[([\w-]+)(?:="([^"]*)")?\]\s*(:not\([^)]*\))?$/.exec(sel);
  if (am) { attr = am; sel = sel.slice(0, am.index).trim(); }
  const p = parseSel(sel || '*');
  if (p.tag && p.tag !== '*' && el.tagName !== p.tag.toUpperCase()) return false;
  if (p.id && el.id !== p.id) return false;
  if (!p.classes.every(c => el.classList.contains(c))) return false;
  if (attr) {
    const v = el.getAttribute(attr[1]);
    if (v === null) return false;
    if (attr[2] !== undefined && v !== attr[2]) return false;
  }
  if (negate && matches(el, negate)) return false;
  return true;
}
function walk(root, fn) { root.children.forEach(c => { fn(c); walk(c, fn); }); }

/* ---------------- serialisation (for visual snapshots) ---------------- */
const VOID_TAGS = new Set(['br', 'meta', 'link', 'input', 'img', 'hr', 'source']);
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
function esc(s) { return String(s).replace(/[&<>"]/g, c => ESC[c]); }
function serialize(el, indent) {
  const pad = indent || '';
  const tag = el.tagName.toLowerCase();
  const attrs = [];
  if (el.id) attrs.push('id="' + esc(el.id) + '"');
  if (el._className) attrs.push('class="' + esc(el._className.trim()) + '"');
  Object.keys(el.attributes).forEach(k => {
    if (k === 'id' || k === 'class') return;
    if (k === 'hidden' && el.attributes[k] === '') { attrs.push('hidden'); return; }
    attrs.push(k + '="' + esc(el.attributes[k]) + '"');
  });
  if (el.hidden && !('hidden' in el.attributes)) attrs.push('hidden');
  const open = '<' + tag + (attrs.length ? ' ' + attrs.join(' ') : '') + '>';
  if (VOID_TAGS.has(tag)) return pad + open;
  const inner = el.children.length ? el.children.map(c => serialize(c, pad + '  ')).join('\n') : (el._text ? esc(el._text) : '');
  return pad + open + (inner ? '\n' + inner + '\n' + pad : '') + '</' + tag + '>';
}
function outline(el, depth) {
  const pad = '  '.repeat(depth || 0);
  const parts = [];
  if (el.id) parts.push('#' + el.id);
  if (el._className) parts.push('.' + el._className.trim().split(/\s+/).join('.'));
  let line = pad + el.tagName.toLowerCase() + (parts.length ? parts.join('') : '');
  if (!el.children.length && el._text) line += '  "' + el._text + '"';
  if (el.hidden) line += '   [hidden]';
  const lines = [line];
  el.children.forEach(c => lines.push(outline(c, (depth || 0) + 1)));
  return lines.join('\n');
}
function query(root, sel, first) {
  const out = [];
  walk(root, el => { if (matches(el, sel)) out.push(el); });
  return first ? (out[0] || null) : out;
}

/* ---------------- document from index.html ---------------- */
const VOID = new Set(['br', 'meta', 'link', 'input', 'img', 'hr', 'source']);
function parseHTML(html) {
  const docEl = new El('html');
  const body = new El('body');
  const head = new El('head');
  docEl.appendChild(head);
  docEl.appendChild(body);
  const doc = {
    documentElement: docEl, body, head,
    listeners: {}, activeElement: null,
    querySelector(sel) { return query({ children: [docEl] }, sel, true); },
    querySelectorAll(sel) { return query({ children: [docEl] }, sel, false); },
    getElementById(id) { return query({ children: [docEl] }, '#' + id, true); },
    createElement(tag) { return new El(tag, doc); },
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter(f => f !== fn); },
    dispatch(type, extra) {
      const ev = Object.assign({
        type, target: this, preventDefault() {}, stopPropagation() {},
        shiftKey: false, focus() {}
      }, extra);
      (this.listeners[type] || []).forEach(fn => fn(ev));
    }
  };
  // head: parse it so the inline theme-boot script's effect can be observed
  head.innerHTML = '';
  const metaEl = new El('meta', doc);
  metaEl.setAttribute('name', 'theme-color');
  metaEl.setAttribute('content', '#f3f6f0');
  head.appendChild(metaEl);
  const iconEl = new El('link', doc);
  iconEl.setAttribute('rel', 'icon');
  iconEl.setAttribute('href', 'favicon.ico');
  head.appendChild(iconEl);

  const bodyStart = html.search(/<body[^>]*>/i);
  const bodyHtml = bodyStart === -1 ? html : html.slice(html.indexOf('>', bodyStart) + 1);
  const tok = /<(\/?)([a-zA-Z0-9]+)([^>]*?)(\/?)>/g;
  const stack = [body];
  let m;
  while ((m = tok.exec(bodyHtml))) {
    const closing = m[1] === '/', tag = m[2].toLowerCase();
    if (!closing && (tag === 'script' || tag === 'style')) {
      const end = bodyHtml.toLowerCase().indexOf('</' + tag + '>', tok.lastIndex);
      if (end !== -1) tok.lastIndex = end;
      continue;
    }
    if (closing) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName === tag.toUpperCase()) { stack.length = i; break; }
      }
      continue;
    }
    const el = new El(tag, doc);
    applyAttrs(el, m[3]);
    stack[stack.length - 1].appendChild(el);
    if (VOID.has(tag) || m[4] === '/') continue;
    stack.push(el);
  }
  doc._meta = metaEl;
  return doc;
}
function applyAttrs(el, raw) {
  const re = /([\w-]+)(?:\s*=\s*"([^"]*)")?/g; let m;
  while ((m = re.exec(raw))) {
    const k = m[1], v = m[2] === undefined ? '' : m[2];
    if (k === 'class') el.className = v;
    else if (k === 'id') el.id = v;
    else el.setAttribute(k, v);
  }
}

/* ---------------- localStorage ---------------- */
function makeStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(String(k)) ? map.get(String(k)) : null),
    setItem: (k, v) => { map.set(String(k), String(v)); },
    removeItem: k => { map.delete(String(k)); },
    clear: () => map.clear(),
    key: i => [...map.keys()][i],
    get length() { return map.size; },
    _map: map
  };
}

/* ---------------- boot ---------------- */
function boot(opts) {
  opts = opts || {};
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const document = parseHTML(html);
  const storage = makeStorage();
  if (opts.seed) Object.keys(opts.seed).forEach(k => storage.setItem(k, opts.seed[k]));

  // the inline <head> script, applied before scripts run
  const bootScript = /<script>([\s\S]*?)<\/script>/.exec(html.slice(0, html.search(/<body/i)));
  if (bootScript) {
    try { new Function('localStorage', 'document', bootScript[1])(storage, document); }
    catch (e) { throw new Error('inline theme boot script failed: ' + e.message); }
  }

  const alerts = [];
  const swCalls = [];
  const swListeners = {};
  const reloads = [];
  const created = { readers: [] };
  const sandbox = {
    document, localStorage: storage, console, swCalls, swListeners, created,
    alert: msg => alerts.push(String(msg)),
    confirm: () => (opts.confirm === undefined ? true : opts.confirm),
    setTimeout: setTimeout,        // real timers: the long-press probe needs genuine elapsed time
    clearTimeout: clearTimeout,
    requestAnimationFrame: fn => { fn(); return 0; },
    performance: { now: () => Date.now() },
    getComputedStyle: () => ({ getPropertyValue: () => '#f3f6f0' }),
    Event: Evt,
    Date, JSON, Math, parseInt, parseFloat, isNaN, String, Number, Array, Object, Error, Promise,
    Blob: function (parts) { this.parts = parts; },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
    FileReader: function () {
      created.readers.push(this);
      this.readAsText = function (file) {
        this.result = file.text;
        setTimeout(() => this.onload && this.onload(), 0);
      };
    },
    navigator: {
      serviceWorker: {
        controller: opts.controller || null,
        register: u => { swCalls.push(u); return Promise.resolve({}); },
        addEventListener: (t, fn) => { (swListeners[t] = swListeners[t] || []).push(fn); }
      }
    },
    location: {
      protocol: opts.protocol || 'https:',
      hostname: opts.hostname || 'example.test',
      origin: 'https://example.test',
      reload: () => reloads.push(Date.now())
    }
  };
  setTimeout._q = [];
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  ['js/store.js', 'js/theme.js', 'js/calendar.js', 'js/app.js'].forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  });
  document.dispatch('DOMContentLoaded');
  // let any deferred focusout / rAF work settle before probes inspect the DOM
  const drain = () => new Promise(r => setTimeout(r, 60));
  return { sandbox, document, storage, alerts, swCalls, swListeners, reloads, created, $: id => document.getElementById(id), drain };
}

module.exports = { boot, El, outline };

/* ---------------- probe suite ---------------- */
async function main() {
  const results = [];
  const t = (name, fn) => {
    try { const r = fn(); results.push([r === true ? 'PASS' : 'FAIL', name, r === true ? '' : String(r)]); }
    catch (e) { results.push(['THROW', name, e.message]); }
  };
  const DAY = 86400000;
  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const today = iso(new Date());
  const vis = el => el.children.filter(c => !c.hidden);      // visible children only
  const rows = d => d.getElementById('todo-list').children;
  const textOf = li => (li.querySelector('.todo-text') || { textContent: '' }).textContent;
  const store = app => app.sandbox.Store;

  /* ================= 清单：增删改查 ================= */
  {
    const app = boot();
    const d = app.document, S = store(app);
    d.getElementById('add-input').value = '  买牛奶  ';
    d.getElementById('add-form').dispatch('submit');
    t('add: trims text', () => S.items()[0].text === '买牛奶' ? true : JSON.stringify(S.items()[0]));
    t('add: empty date stays empty (未排期)', () => S.items()[0].date === '' ? true : 'date=' + JSON.stringify(S.items()[0].date));
    t('add: input cleared after submit', () => d.getElementById('add-input').value === '' ? true : 'left=' + JSON.stringify(d.getElementById('add-input').value));
    t('render: one row', () => rows(d).length === 1 ? true : 'rows=' + rows(d).length);
    t('counter: shows remaining/total', () => d.getElementById('counter').textContent === '1 未完成 / 1 项' ? true : d.getElementById('counter').textContent);
    t('undated row shows the 未排期 flag', () => vis(rows(d)[0]).some(c => c.classList.contains('todo-flag')) ? true : 'no flag chip');

    rows(d)[0].querySelector('.todo-check').dispatch('click');
    t('toggle: marks done', () => S.items()[0].done === true ? true : 'not done');
    t('toggle: checkbox gets .done (the ★ fix for the never-painted tick)', () => {
      const c = rows(d)[0].querySelector('.todo-check');
      return c.classList.contains('done') === true && c.getAttribute('aria-checked') === 'true'
        ? true : 'class=' + c.className + ' aria=' + c.getAttribute('aria-checked');
    });
    t('toggle: aria-checked goes back to false', () => {
      rows(d)[0].querySelector('.todo-check').dispatch('click');
      const c = rows(d)[0].querySelector('.todo-check');
      return c.classList.contains('done') === false && c.getAttribute('aria-checked') === 'false'
        ? true : 'class=' + c.className + ' aria=' + c.getAttribute('aria-checked');
    });
  }

  /* ================= 只渲染一次（原缺陷 3） ================= */
  {
    const app = boot();
    const d = app.document;
    const orig = d.createElement.bind(d);
    let built = 0;
    d.createElement = tag => { if (String(tag).toLowerCase() === 'li') built++; return orig(tag); };
    d.getElementById('add-input').value = 'x';
    d.getElementById('add-form').dispatch('submit');
    d.createElement = orig;
    t('one store change builds each row exactly once', () => built === 1 ? true : built + ' rows built (renderList registered more than once)');
  }

  /* ================= 空态文案随筛选变化（原缺陷 5） ================= */
  {
    const app = boot();
    const d = app.document, S = store(app);
    S.add('只有未完成', '');
    const empty = d.getElementById('empty-hint');
    t('empty hint: 全部 filter hidden while rows exist', () => empty.hidden === true && empty.textContent === '暂无待办，添加一条吧' ? true : 'hidden=' + empty.hidden + ' text=' + JSON.stringify(empty.textContent));
    const doneBtn = d.querySelectorAll('.filter-btn').find(b => b.dataset.filter === 'done');
    doneBtn.dispatch('click');
    t('empty hint: 已完成 filter says 还没有完成的事项', () => empty.textContent === '还没有完成的事项' ? true : JSON.stringify(empty.textContent));
    const activeBtn = d.querySelectorAll('.filter-btn').find(b => b.dataset.filter === 'active');
    activeBtn.dispatch('click');
    t('empty hint: 进行中 filter hides when rows exist', () => empty.hidden === true ? true : 'still visible');
    activeBtn.dispatch('click');
    S.toggle(S.items()[0].id);
    t('empty hint: 进行中 filter with nothing active', () => empty.textContent === '没有进行中的待办' ? true : JSON.stringify(empty.textContent));
    t('filter buttons expose aria-pressed', () => doneBtn.getAttribute('aria-pressed') === 'false' && activeBtn.getAttribute('aria-pressed') === 'true' ? true : 'done=' + doneBtn.getAttribute('aria-pressed') + ' active=' + activeBtn.getAttribute('aria-pressed'));
  }

  /* ================= 编辑（内容 + 日期） ================= */
  {
    const app = boot();
    const d = app.document, S = store(app);
    S.add('原文', today);
    const li = rows(d)[0];
    t('edit: ✎ button enters edit mode', () => {
      li.querySelector('.todo-edit-btn').dispatch('click');
      return li.classList.contains('editing') ? true : 'class=' + li.className;
    });
    const input = li.querySelector('.todo-edit');
    const dateInput = li.querySelector('.todo-edit-date');
    t('edit: date input pre-filled with the current date', () => dateInput && dateInput.value === today ? true : 'value=' + (dateInput && dateInput.value));
    t('edit: read-only children hidden while editing', () => vis(li).length === 2 ? true : 'visible children=' + vis(li).length);
    input.value = '改过的';
    dateInput.value = iso(new Date(Date.now() + 3 * DAY));
    li.querySelector('.edit-btn').dispatch('click');
    t('edit: save writes text and date', () => {
      const it = S.items()[0];
      return it.text === '改过的' && it.date === iso(new Date(Date.now() + 3 * DAY)) ? true : JSON.stringify(it);
    });
    t('edit: row returns to read-only', () => rows(d)[0].classList.contains('editing') ? 'still editing' : true);

    // clearing the date => 未排期
    rows(d)[0].querySelector('.todo-edit-btn').dispatch('click');
    const li2 = rows(d)[0];
    li2.querySelector('.todo-edit-date').value = '';
    li2.querySelector('.edit-btn').dispatch('click');
    t('edit: clearing the date makes it 未排期', () => S.items()[0].date === '' ? true : 'date=' + JSON.stringify(S.items()[0].date));

    // escape reverts
    const li3 = rows(d)[0];
    li3.querySelector('.todo-edit-btn').dispatch('click');
    li3.querySelector('.todo-edit').value = '不该保存';
    rows(d)[0].querySelector('.todo-edit').dispatch('keydown', { key: 'Escape' });
    t('edit: Escape reverts without saving', () => S.items()[0].text === '改过的' ? true : 'text=' + S.items()[0].text);
    t('edit: Escape leaves no detached input in the row', () => {
      const l = rows(d)[0];
      return l.querySelector('.todo-edit') === null && !l.classList.contains('editing') ? true
        : 'stale edit nodes remain in the row';
    });

    // blur saves (focusout defers one tick, so the probe waits)
    const li4 = rows(d)[0];
    li4.querySelector('.todo-edit-btn').dispatch('click');
    const inp = rows(d)[0].querySelector('.todo-edit');
    inp.value = '失焦保存';
    inp.blur();
    await new Promise(r => setTimeout(r, 120));
    t('edit: blur saves the text and leaves edit mode', () => {
      const ok = S.items()[0].text === '失焦保存';
      const l = rows(d)[0];
      return ok && !l.classList.contains('editing') && l.querySelector('.todo-edit') === null
        ? true : 'text=' + S.items()[0].text + ' editing=' + l.classList.contains('editing');
    });

    // clearing text deletes
    const li5 = rows(d)[0];
    li5.querySelector('.todo-edit-btn').dispatch('click');
    const inp5 = li5.querySelector('.todo-edit');
    inp5.value = '   ';
    li5.querySelector('.edit-btn').dispatch('click');
    t('edit: emptying the text deletes the item', () => S.items().length === 0 ? true : 'still ' + S.items().length + ' item(s)');
  }

  /* ================= 删除 + 撤销 ================= */
  {
    const app = boot();
    const d = app.document, S = store(app);
    S.add('会被误删的', today);
    t('toast starts hidden', () => d.getElementById('toast').hidden === true ? true : 'visible');
    rows(d)[0].querySelector('.todo-del').dispatch('click');
    t('delete: removes the item', () => S.items().length === 0 ? true : 'still there');
    t('delete: shows the undo toast', () => d.getElementById('toast').hidden === false ? true : 'toast stayed hidden');
    d.getElementById('toast-undo').dispatch('click');
    t('undo: restores the item', () => {
      const it = S.items()[0];
      return S.items().length === 1 && it.text === '会被误删的' && it.date === today ? true : JSON.stringify(S.items());
    });
    t('undo: hides the toast', () => d.getElementById('toast').hidden === true ? true : 'still visible');
  }

  /* ================= 长按（触屏编辑入口） ================= */
  {
    const app = boot();
    const d = app.document, S = store(app);
    S.add('长按我', today);
    const li = rows(d)[0];
    const text = li.querySelector('.todo-text');
    text.dispatch('touchstart', { touches: [{ clientX: 10, clientY: 10 }] });
    t('long press: not opened immediately', () => li.classList.contains('editing') ? 'opened on touchstart — a normal tap would enter edit mode' : true);
    await new Promise(r => setTimeout(r, 700));
    t('long press: opens the editor after the hold delay', () => li.classList.contains('editing') ? true : 'class=' + li.className);
    t('long press: the trailing click is swallowed, item not toggled', () => {
      text.dispatch('click');
      return S.items()[0].done === false ? true : 'the ghost click toggled the item — long press would also mark it done';
    });
    const app2 = boot();
    app2.sandbox.Store.add('滑动', today);
    const li2 = app2.document.getElementById('todo-list').children[0];
    const tx2 = li2.querySelector('.todo-text');
    tx2.dispatch('touchstart', { touches: [{ clientX: 0, clientY: 0 }] });
    tx2.dispatch('touchmove', { touches: [{ clientX: 0, clientY: 40 }] });   // 滚动页面
    await new Promise(r => setTimeout(r, 700));
    t('long press: a scrolling finger cancels it', () => li2.classList.contains('editing') ? 'scrolling the list opened the editor' : true);
  }

  /* ================= 导入（原缺陷 2 / 6） ================= */
  {
    const app = boot();
    const S = store(app);
    const r = S.importData(JSON.stringify({
      version: 1,
      items: [
        { id: '1', text: '导入项', done: false, date: '2026-01-02', created: 5 },
        { id: '1', text: '重复 id 的项', done: true, date: '', created: 6 },
        { text: '没有 id 的项', done: false, date: '2026-02-03', created: 7 },
        { id: '9', text: '   ', done: false, date: '', created: 8 },
        { id: '10', text: 12345, done: false, date: '', created: 9 },
        { id: '11', text: '非法日期', done: false, date: 'bad-date-string', created: 10 }
      ]
    }));
    t('import: returns counts', () => r && r.added === 4 && r.skipped === 2 ? true : JSON.stringify(r));
    t('import: ids are unique after import', () => {
      const ids = S.items().map(i => i.id);
      return new Set(ids).size === ids.length ? true : 'DUPLICATE IDS: ' + JSON.stringify(ids);
    });
    t('import: ids are rewritten, not trusted', () => S.items().every(i => /^\d+$/.test(i.id)) ? true : 'ids=' + JSON.stringify(S.items().map(i => i.id)));
    t('import: invalid date becomes 未排期', () => {
      const it = S.items().find(i => i.text === '非法日期');
      return it && it.date === '' ? true : 'date=' + JSON.stringify(it && it.date);
    });
    t('import: created coerced to a number', () => S.items().every(i => typeof i.created === 'number') ? true : 'created types differ');
    t('import: rejects non-object entries without throwing', () => S.importData(JSON.stringify({ items: [null, 42, 'str'] })).added === 0 ? true : 'imported something');
    t('import: throws on malformed json', () => { try { S.importData('{not json'); return 'no throw'; } catch (e) { return true; } });
    t('import: rejects payload without items array', () => { try { S.importData('{"foo":1}'); return 'accepted'; } catch (e) { return true; } });

    const app2 = boot();
    const S2 = store(app2);
    S2.importData(JSON.stringify({ items: [{ id: '1', text: 'a' }, { id: '2', text: 'b' }] }));
    const fresh = S2.add('new one', '');
    t('id: new item after importing ids 1,2 does not collide', () => {
      const ids = S2.items().map(i => i.id);
      return new Set(ids).size === ids.length ? true : 'ids=' + JSON.stringify(ids);
    });
    t('id: toggling touches exactly one item', () => {
      S2.toggle(fresh.id);
      const done = S2.items().filter(i => i.done).length;
      return done === 1 ? true : done + ' items were toggled at once';
    });
    t('id: re-importing the same file does not collide', () => {
      const app3 = boot();
      const S3 = store(app3);
      const payload = JSON.stringify({ items: [{ id: '7', text: 'a' }, { id: '8', text: 'b' }] });
      S3.importData(payload); S3.importData(payload);
      const ids = S3.items().map(i => i.id);
      return new Set(ids).size === ids.length ? true : 'ids=' + JSON.stringify(ids);
    });
  }

  /* ================= 写入失败（原缺陷 4） ================= */
  {
    const app = boot();
    const S = store(app);
    app.storage.setItem = () => { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; };
    t('save failure: Store.add does not throw', () => {
      const it = S.add('写不进去', '');
      return it && it._saved === false ? true : 'no failure flag on the returned item';
    });
    t('save failure: add form alerts the user', () => {
      const app2 = boot();
      app2.storage.setItem = () => { throw new Error('QuotaExceededError'); };
      const d2 = app2.document;
      d2.getElementById('add-input').value = '写不进去';
      d2.getElementById('add-form').dispatch('submit');
      return app2.alerts.length === 1 && /保存失败/.test(app2.alerts[0]) ? true : 'alerts=' + JSON.stringify(app2.alerts);
    });
    t('load: corrupt stored json does not throw and is preserved', () => {
      const app3 = boot({ seed: { todo_data_v1: '{"items": [1,2' } });
      const items = store(app3).items();
      return Array.isArray(items) && items.length === 0 && app3.storage.getItem('todo_data_v1_corrupt')
        ? true : 'items=' + JSON.stringify(items) + ' backup=' + app3.storage.getItem('todo_data_v1_corrupt');
    });
    t('load: tolerates storage read throwing', () => {
      const app4 = boot();
      app4.storage.getItem = () => { throw new Error('SecurityError'); };
      return Array.isArray(store(app4).items()) ? true : 'threw';
    });
  }

  /* ================= 清单：未排期筛选 ================= */
  {
    const app = boot();
    const d = app.document, S = store(app);
    S.add('有日期的', today);
    S.add('没日期的', '');
    const btn = d.querySelectorAll('.filter-btn').find(b => b.dataset.filter === 'undated');
    t('filter: 未排期 button exists', () => btn ? true : 'no undated filter button');
    btn.dispatch('click');
    t('filter: 未排期 shows only undated rows', () => {
      const list = rows(d);
      const texts = list.map(textOf);
      return list.length === 1 && texts[0] === '没日期的' ? true : JSON.stringify(texts);
    });
    t('filter: 未排期 ignores completion, only the date', () => {
      S.toggle(S.items().find(i => i.text === '没日期的').id);   // 标为已完成，但仍然没有日期
      const list = rows(d).map(textOf);
      return list.length === 1 && list[0] === '没日期的' ? true : JSON.stringify(list);
    });
    t('filter: 未排期 empty hint wording', () => {
      const app2 = boot();
      const d2 = app2.document;
      store(app2).add('有日期', today);
      const b = d2.querySelectorAll('.filter-btn').find(x => x.dataset.filter === 'undated');
      b.dispatch('click');
      const hint = d2.getElementById('empty-hint');
      return hint.hidden === false && hint.textContent === '没有未排期的待办' ? true : 'hidden=' + hint.hidden + ' text=' + JSON.stringify(hint.textContent);
    });
  }

  /* ================= 导入去重（批次 A-2） ================= */
  {
    const app = boot();
    const S = store(app);
    const payload = JSON.stringify({
      items: [
        { id: '1', text: '买牛奶', date: '2026-03-01', created: 111 },
        { id: '2', text: '买牛奶', date: '2026-03-01', created: 111 },   // 同内容同日期同创建时刻
        { id: '3', text: '买牛奶', date: '2026-03-01', created: 222 },   // 同一分钟但不同创建时刻
        { id: '4', text: '买牛奶', date: '2026-03-02', created: 111 }    // 不同日期
      ]
    });
    const first = S.importData(payload);
    t('dedup: identical entries collapse, distinct ones survive', () => {
      return first.added === 3 && first.duplicates === 1 ? true : JSON.stringify(first);
    });
    const second = S.importData(payload);
    t('dedup: importing the same file twice adds nothing', () => {
      return second.added === 0 && second.duplicates === 4 ? true : JSON.stringify(second);
    });
    t('dedup: store size stays 3 after two imports', () => S.items().length === 3 ? true : 'count=' + S.items().length);
    t('dedup: user-created duplicates are NOT merged', () => {
      const app2 = boot();
      const S2 = store(app2);
      S2.add('重复内容', today);
      S2.add('重复内容', today);
      return S2.items().length === 2 ? true : 'two manual adds were merged into ' + S2.items().length;
    });
    t('import: message mentions the duplicate count', () => {
      const app3 = boot();
      const S3 = store(app3);
      const payload = JSON.stringify({ items: [{ text: 'x', created: 5 }] });
      const r1 = S3.importData(payload);
      const r2 = S3.importData(payload);
      return r1.added === 1 && r1.duplicates === 0 && r2.added === 0 && r2.duplicates === 1
        ? true : JSON.stringify({ first: r1, second: r2 });
    });
  }

  /* ================= SW 更新提示（批次 A-3） ================= */
  {
    const app = boot({ controller: {} });
    const d = app.document;
    t('sw update: controllerchange listener registered', () => (app.swListeners.controllerchange || []).length === 1 ? true : 'listeners=' + JSON.stringify(Object.keys(app.swListeners)));
    t('sw update: toast hidden before any change', () => d.getElementById('toast').hidden === true ? true : 'visible');
    app.swListeners.controllerchange.forEach(fn => fn());
    t('sw update: toast announces the new version', () => {
      const hidden = d.getElementById('toast').hidden;
      const msg = d.getElementById('toast-msg').textContent;
      const label = d.getElementById('toast-undo').textContent;
      return hidden === false && /新版本/.test(msg) && label === '刷新' ? true : 'hidden=' + hidden + ' msg=' + JSON.stringify(msg) + ' label=' + JSON.stringify(label);
    });
    t('sw update: 刷新 reloads the page', () => {
      d.getElementById('toast-undo').dispatch('click');
      return app.reloads.length === 1 ? true : 'reloads=' + app.reloads.length;
    });
    t('sw update: toast hidden after acting', () => d.getElementById('toast').hidden === true ? true : 'still visible');
    t('sw update: no prompt on a first-ever install', () => {
      const fresh = boot({ controller: null });
      (fresh.swListeners.controllerchange || []).forEach(fn => fn());
      return fresh.document.getElementById('toast').hidden === true ? true : 'prompted a first-time visitor to refresh';
    });
    t('toast: undo still shares the same toast element', () => {
      const app2 = boot();
      const d2 = app2.document, S2 = store(app2);
      S2.add('会被误删', today);
      d2.getElementById('todo-list').children[0].querySelector('.todo-del').dispatch('click');
      const label = d2.getElementById('toast-undo').textContent;
      const msg = d2.getElementById('toast-msg').textContent;
      if (label !== '撤销' || msg !== '已删除') return 'label=' + label + ' msg=' + msg;
      d2.getElementById('toast-undo').dispatch('click');
      return S2.items().length === 1 ? true : 'undo failed after the toast was generalised';
    });
  }

  /* ================= 从备份还原（批次 B-1） ================= */
  {
    const app = boot();
    const S = store(app);
    S.add('旧数据一', today);
    S.add('旧数据二', '');
    const before = S.items().length;
    const backup = JSON.stringify({ version: 1, items: [{ text: '备份里的', date: '2026-05-05', created: 999 }] });
    const r = S.importData(backup, 'replace');
    t('restore: replaces instead of merging', () => {
      const texts = S.items().map(i => i.text);
      return before === 2 && r.added === 1 && r.mode === 'replace' && texts.length === 1 && texts[0] === '备份里的'
        ? true : 'texts=' + JSON.stringify(texts) + ' r=' + JSON.stringify(r);
    });
    t('restore: keeps the backup date', () => S.items()[0].date === '2026-05-05' ? true : S.items()[0].date);
    t('restore: invalid entries are skipped, valid ones kept', () => {
      const r2 = S.importData(JSON.stringify({ items: [{ text: '好的', created: 1 }, { text: '  ' }, null] }), 'replace');
      return r2.added === 1 && r2.skipped === 2 && S.items().length === 1 ? true : JSON.stringify(r2);
    });
    t('restore: an empty backup clears everything', () => {
      const r3 = S.importData(JSON.stringify({ items: [] }), 'replace');
      return r3.added === 0 && S.items().length === 0 ? true : 'items=' + S.items().length;
    });
    const app2 = boot({ confirm: false });
    app2.sandbox.Store.add('不该被清掉', today);
    app2.document.getElementById('btn-restore').click();
    t('restore: declining the confirm leaves data untouched', () => {
      return app2.sandbox.Store.items().length === 1 ? true : 'data was cleared despite declining';
    });
    const app3 = boot({ confirm: true });
    app3.sandbox.Store.add('将被覆盖', today);
    app3.document.getElementById('btn-restore').click();
    t('restore: accepting the confirm opens the restore file picker', () => {
      const input = app3.document.getElementById('restore-file');
      return input && input._clicked === true ? true : 'restore-file input was not clicked';
    });
    // 端到端走一遍文件选择路径（FileReader 桩会把文件内容回送 onload）
    const app4 = boot();
    const S4 = store(app4);
    S4.add('原本的', today);
    const mergeInput = app4.document.getElementById('import-file');
    mergeInput.files = [{ name: 'b.json', text: JSON.stringify({ items: [{ text: '合并进来的', created: 7 }] }) }];
    app4.created.readers.length = 0;
    mergeInput.dispatch('change');
    await new Promise(r => setTimeout(r, 40));
    t('file path: 导入并合并 adds the file contents', () => {
      const texts = S4.items().map(i => i.text).sort();
      return texts.length === 2 && texts.indexOf('合并进来的') !== -1 ? true : JSON.stringify(texts);
    });
    t('file path: shows a success alert with the count', () => app4.alerts.some(a => /导入成功，新增 1 项/.test(a)) ? true : JSON.stringify(app4.alerts));

    // 还原路径：先点按钮（会走 confirm 并把模式切成 replace），再选文件
    const restoreInput = app4.document.getElementById('restore-file');
    app4.document.getElementById('btn-restore').click();
    restoreInput.files = [{ name: 'r.json', text: JSON.stringify({ items: [{ text: '备份里的', created: 3 }] }) }];
    restoreInput.dispatch('change');
    await new Promise(r => setTimeout(r, 40));
    t('file path: 从备份还原 replaces everything', () => {
      const texts = S4.items().map(i => i.text);
      return texts.length === 1 && texts[0] === '备份里的' ? true : JSON.stringify(texts);
    });
    t('file path: announces 还原 not 导入', () => app4.alerts.some(a => /还原成功，恢复 1 项/.test(a)) ? true : JSON.stringify(app4.alerts));
    await new Promise(r => setTimeout(r, 40));
  }

  /* ================= 月历 ================= */
  {
    const app = boot();
    const d = app.document, S = store(app);
    const grid = d.getElementById('cal-grid');
    t('calendar: cell count equals the real number of weeks', () => {
      const cells = grid.children.length;
      const weeks = Math.ceil((new Date(new Date().getFullYear(), new Date().getMonth(), 1).getDay() + 6) % 7 +
        new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()) / 7;
      return cells === Math.ceil(weeks) * 7 && (cells === 35 || cells === 42) ? true : 'cells=' + cells;
    });
    t('calendar: title is real year + month', () => /^\d{4}年 /.test(d.getElementById('cal-title').textContent) ? true : d.getElementById('cal-title').textContent);
    t('calendar: today is marked and selected by default', () => {
      const c = grid.children.find(x => x.classList.contains('today'));
      return c && c.classList.contains('selected') ? true : 'today cell missing or unselected';
    });
    t('calendar: parseDate rejects rolled-over dates', () => {
      const app2 = boot();
      store(app2).add('坏日期', '2026-13-45');
      const cells = app2.document.getElementById('cal-grid').children;
      let found = false;
      cells.forEach(c => c.children.forEach(ch => { if (ch.textContent === '坏日期') found = true; }));
      return found ? 'a 2026-13-45 item was drawn in the grid' : true;
    });
    t('calendar: undated item is not silently lost (未排期 bucket)', () => {
      S.add('没有日期', '');
      const btn = d.getElementById('btn-undated');
      return btn && btn.hidden === false && /1/.test(btn.textContent) ? true : 'button=' + (btn && btn.textContent) + ' hidden=' + (btn && btn.hidden);
    });
    t('calendar: 未排期 panel lists undated items and adds into the bucket', () => {
      const before = S.items().length;
      d.getElementById('btn-undated').dispatch('click');
      const list = d.getElementById('day-list');
      d.getElementById('day-add-input').value = '又一条未排期';
      d.getElementById('day-add-form').dispatch('submit');
      return S.items().length === before + 1 && S.items().slice(-1)[0].date === '' && list.children.length >= 1
        ? true : 'len=' + list.children.length + ' date=' + JSON.stringify(S.items().slice(-1)[0].date);
    });
    t('calendar: day panel adds with the selected date', () => {
      const app3 = boot();
      const d3 = app3.document, S3 = store(app3);
      const sel = app3.sandbox.Calendar.getSelected();
      d3.getElementById('day-add-input').value = '当天的事';
      d3.getElementById('day-add-form').dispatch('submit');
      return S3.items()[0].date === sel ? true : 'stored ' + JSON.stringify(S3.items()[0].date) + ' selected ' + JSON.stringify(sel);
    });
    t('calendar: clicking a cell selects that date', () => {
      const app4 = boot();
      const d4 = app4.document;
      const cells = d4.getElementById('cal-grid').children;
      const target = cells.find(c => !c.classList.contains('today') && !c.classList.contains('other'));
      target.dispatch('click');
      const label = d4.getElementById('day-title').textContent;
      return /^\d{4}-\d{2}-\d{2} · 周/.test(label) ? true : label;
    });
    t('calendar: 返回今天 leaves 未排期 mode', () => {
      const app5 = boot();
      const d5 = app5.document;
      store(app5).add('x', '');
      d5.getElementById('btn-undated').dispatch('click');
      d5.getElementById('btn-panel-back').dispatch('click');
      return app5.sandbox.Calendar.isUndated() === false ? true : 'still in undated mode';
    });
    t('calendar: nav across a year boundary keeps a real year', () => {
      const navPrev = d.querySelectorAll('.cal-nav')[0];
      for (let i = 0; i < 14; i++) navPrev.dispatch('click');
      return /^\d{4}年 /.test(d.getElementById('cal-title').textContent) ? true : d.getElementById('cal-title').textContent;
    });
    t('calendar: day panel orders undone before done', () => {
      const app6 = boot();
      const d6 = app6.document, S6 = store(app6);
      S6.add('Bdone', today); S6.toggle(S6.items()[0].id);
      S6.add('Aopen', today);
      const order = d6.getElementById('day-list').children.map(c => textOf(c));
      return order.length === 2 && order[0] === 'Aopen' ? true : JSON.stringify(order);
    });
    t('calendar: cells carry an aria-label with the day and counts', () => {
      const app7 = boot();
      const c = app7.document.getElementById('cal-grid').children.find(x => x.classList.contains('today'));
      const label = c && c.getAttribute('aria-label');
      return label && /项待办|无待办/.test(label) ? true : 'label=' + label;
    });
  }

  /* ================= 主题 / 首屏（原缺陷 7） ================= */
  {
    const app = boot();
    const d = app.document;
    t('theme: default green applied', () => d.documentElement.getAttribute('data-theme') === 'green' ? true : d.documentElement.getAttribute('data-theme'));
    t('theme: saved mono applied by the boot script', () => boot({ seed: { todo_theme_v1: 'mono' } }).document.documentElement.getAttribute('data-theme') === 'mono' ? true : 'not applied');
    t('theme: invalid saved value falls back to green', () => boot({ seed: { todo_theme_v1: 'neon' } }).document.documentElement.getAttribute('data-theme') === 'green' ? true : 'not green');
    t('theme: boot script runs before the app scripts (no flash)', () => {
      const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
      const inline = html.indexOf('todo_theme_v1');
      const css = html.indexOf('css/style.css');
      return inline !== -1 && inline < css ? true : 'inline=' + inline + ' css=' + css;
    });
    t('theme: card click applies + persists + aria-pressed', () => {
      const card = d.querySelectorAll('.theme-card').find(c => c.getAttribute('data-theme') === 'blue');
      d.getElementById('theme-grid').dispatch('click', { target: card });
      const ok = d.documentElement.getAttribute('data-theme') === 'blue' && app.storage.getItem('todo_theme_v1') === 'blue';
      return ok && card.getAttribute('aria-pressed') === 'true' ? true : 'attr=' + d.documentElement.getAttribute('data-theme');
    });
  }

  /* ================= 无障碍 / 交互细节 ================= */
  {
    const app = boot();
    const d = app.document;
    t('a11y: tablist buttons expose aria-selected + aria-controls', () => {
      const btns = d.querySelectorAll('.view-btn');
      return btns.every(b => b.getAttribute('aria-selected') && b.getAttribute('aria-controls')) ? true : 'missing attributes';
    });
    t('a11y: switching view updates aria-selected and the panels', () => {
      const btns = d.querySelectorAll('.view-btn');
      btns[1].dispatch('click');
      const sel = btns[1].getAttribute('aria-selected');
      return sel === 'true' && d.getElementById('view-calendar').classList.contains('active') && !d.getElementById('view-list').classList.contains('active')
        ? true : 'sel=' + sel;
    });
    t('a11y: settings dialog is modal and traps focus', () => {
      const sheet = d.querySelector('#settings-overlay .sheet');
      return sheet && sheet.getAttribute('aria-modal') === 'true' && sheet.getAttribute('aria-labelledby') === 'settings-title'
        ? true : 'sheet attrs=' + JSON.stringify(sheet && sheet.attributes);
    });
    t('a11y: opening settings focuses the close button', () => {
      d.getElementById('btn-settings').dispatch('click');
      const active = d.activeElement;
      return active && active.getAttribute('data-close') !== null ? true : 'active=' + (active && (active.id || active.className));
    });
    t('a11y: Escape closes settings and restores focus', () => {
      d.dispatch('keydown', { key: 'Escape' });
      return d.getElementById('settings-overlay').hidden === true ? true : 'still open';
    });
    t('a11y: Escape cancels an in-progress edit', () => {
      const S = store(app);
      S.add('编辑中的', today);
      const li = rows(d)[0];
      li.querySelector('.todo-edit-btn').dispatch('click');
      d.dispatch('keydown', { key: 'Escape' });
      return rows(d)[0].classList.contains('editing') ? 'still editing' : true;
    });
    t('a11y: the delete button survives re-render (no duplicate listeners)', () => {
      const S = store(app);
      const before = S.items().length;
      rows(d)[0].querySelector('.todo-del').dispatch('click');
      return S.items().length === before - 1 ? true : 'expected ' + (before - 1) + ' got ' + S.items().length;
    });
  }

  /* ================= PWA 静态检查 ================= */
  {
    const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
    const sw = read('sw.js');
    const manifest = JSON.parse(read('manifest.json'));
    t('pwa: precache is per-asset, not addAll', () => /cache\.add\(/.test(sw) && !/addAll\(/.test(sw) ? true : 'still uses addAll');
    t('pwa: cache name is versioned for updates', () => /var CACHE = 'todo-v\d+'/.test(sw) ? true : 'no version in cache name');
    t('pwa: sw registers on localhost too', () => {
      const app = boot({ protocol: 'http:', hostname: 'localhost' });
      return app.swCalls.length === 1 ? true : 'register skipped on http://localhost';
    });
    t('pwa: sw skipped on plain file://', () => {
      const app = boot({ protocol: 'file:', hostname: '' });
      return app.swCalls.length === 0 ? true : 'registered on file://';
    });
    t('pwa: manifest icons match the files on disk', () => {
      return manifest.icons.every(i => {
        const p = path.join(ROOT, i.src);
        return fs.existsSync(p) || /MISSING-BINARIES/.test(fs.readdirSync(path.dirname(p)).join(' '));
      }) ? true : 'icon missing on disk';
    });
    t('pwa: no "any maskable" on an icon without safe-zone padding', () => {
      return manifest.icons.some(i => /maskable/.test(i.purpose || ''))
        ? 'icon-512 is still declared maskable; Android will crop the corners of a full-bleed 512px icon'
        : true;
    });
    t('pwa: sw.js only caches same-origin in-scope requests', () => /inScope\(/.test(sw) && /origin !== self\.location\.origin/.test(sw) ? true : 'no scope/origin guard');
    t('meta: viewport-fit=cover present for safe-area padding', () => /viewport-fit=cover/.test(read('index.html')) ? true : 'missing');
  }

  /* ================= 代码卫生 ================= */
  {
    const files = ['js/store.js', 'js/theme.js', 'js/calendar.js', 'js/app.js', 'sw.js'];
    t('hygiene: every file parses', () => {
      const bad = [];
      files.forEach(f => {
        try { new vm.Script(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }); }
        catch (e) { bad.push(f + ': ' + e.message); }
      });
      return bad.length ? bad.join('; ') : true;
    });
    t('hygiene: no leftover :checked selector on the button checkbox', () => /\.todo-check:checked/.test(fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8')) ? 'the dead :checked rule is still in style.css' : true);
    t('hygiene: no trailing-newline churn vs upstream convention', () => {
      const p = path.join(ROOT, 'css/style.css');
      return fs.readFileSync(p, 'utf8').endsWith('\n') ? true : 'style.css lost its trailing LF';
    });
  }

  const w = Math.max(...results.map(r => r[1].length));
  results.forEach(([s, n, m]) => console.log(s.padEnd(5) + ' ' + n.padEnd(w) + (m ? '  ' + m : '')));
  const bad = results.filter(r => r[0] !== 'PASS').length;
  console.log('\n' + (results.length - bad) + '/' + results.length + ' probes pass, ' + bad + ' anomalies');
  return bad;
}

if (require.main === module) {
  main().then(bad => { process.exitCode = bad ? 1 : 0; }, err => {
    console.error('harness crashed:', err && err.stack || err);
    process.exitCode = 2;
  });
}

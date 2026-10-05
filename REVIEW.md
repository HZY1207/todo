# 代码评审：HZY1207/todo（待办清单 PWA）

- 仓库：https://github.com/HZY1207/todo
- 评审版本：`main` @ `1cb69794d13ce7e58154509f17c1d36f4d6a5bdc`
- 本地副本：`E:\work\dsh\HZY1207-todo`（经 web_fetch 逐文件镜像，9 个文本文件的 blob SHA-1 与上游一致）
- 评审方式：通读全部 9 个文件 + 在 Node 里用自制 DOM/localStorage 桩**实际执行**了 `store.js`、`theme.js`、`calendar.js`、`app.js`（`_review/harness.js`，38 项探针，27 通过 / 11 项异常）
- 未改动任何业务代码

> **2026-08 更新：本文记录的 11 项问题已全部修复。** 修复清单、验证结果和过程中新发现的
> bug 见 [`FIXES.md`](FIXES.md)；同步回工作副本的步骤见 [`SYNC.md`](SYNC.md)。
> 下面保留的是修复前的原始评审，作为问题依据。

---

## 一、结论速览

代码质量明显高于同类练手项目：纯静态、无依赖、无构建；`innerHTML` 只用于清空、其余一律 `createElement` + `textContent`（**没有 XSS 面**）；`load()`、`emit()`、`SW register` 都有 try/catch 或 `.catch()`；主题白名单校验、日期用本地时区、导出带 `version`/`exportedAt`——这些都是有意识的设计。

**但有 4 个真实缺陷值得先修**，其中「完成勾」那个是用户一眼就会看到的视觉 bug：

| # | 严重度 | 问题 | 位置 |
| --- | --- | --- | --- |
| 1 | **高（可见 bug）** | 完成勾永远不显示：CSS 用 `.todo-check:checked`，而元素是 `<button>` | [style.css:212-226](HZY1207-todo/css/style.css#L212-L226) / [app.js:57-62](HZY1207-todo/js/app.js#L57-L62) |
| 2 | **高（数据正确性）** | 导入的 id 会互相撞车，一次 `toggle` 同时改掉多条 | [store.js:9-13](HZY1207-todo/js/store.js#L9-L13)、[store.js:88-104](HZY1207-todo/js/store.js#L88-L104) |
| 3 | 中 | 每次数据变化整个列表重建两遍（监听器注册两次） | [app.js:173](HZY1207-todo/js/app.js#L173) + [app.js:222](HZY1207-todo/js/app.js#L222) |
| 4 | 中 | `localStorage` 写入失败（配额满 / 隐私模式）直接抛异常到控制台，UI 不动 | [store.js:26-29](HZY1207-todo/js/store.js#L26-L29) |

另有 3 个次要缺陷和一批设计评审点，见下。

---

## 二、缺陷详情（均已复现）

### 1. 高风险：完成勾永远不显示（`<button>` 用了 `:checked`）

`app.js` 把勾选控件建成 `<button class="todo-check">`：

```js
var check = document.createElement('button');   // app.js:57
check.className = 'todo-check';
if (it.done) check.setAttribute('aria-checked', 'true');   // app.js:61
```

而 `style.css` 依赖 `:checked` 伪类给它上色和画勾：

```css
.todo-check:checked { background: var(--accent); }          /* style.css:212 */
.todo-check:checked::after { /* ✓ 白勾 */ }                  /* style.css:216 */
```

`:checked` 只匹配 checkbox / radio / `<option>`，**`<button>` 永远不会命中**，代码里也没有任何地方设置 `.checked` 或状态类（`class` 始终是 `todo-check`）。

实测结果：

```
FAIL  done item: checkbox element reflects the checked state
      the <button> gets aria-checked="true" but no .checked property or state class
FAIL  done item: stylesheet cannot style it (:checked on a <button>)
      .todo-check:checked 与 ::after 的白勾永远不会绘制，只有文字划线生效
```

后果：勾完一条待办，圆圈既不变实心也不出现 ✓，唯一反馈是文字变灰加删除线（`.todo-item.done .todo-text`，style.css:234 是独立规则，不受影响）。

附带问题：`aria-checked` 只在 `it.done` 为真时**设置**，从未在切回未完成时**清除**——重新渲染时属性会一直残留 `"true"`（这一点因为每次变化都整表重建而被掩盖了，但一旦按缺陷 3 优化就立刻暴露）。

**修法（任选）**：把状态做成 class 而非伪类，最省事：

```css
.todo-check.done { background: var(--accent); }
.todo-check.done::after { /* 原 :checked::after 的内容 */ }
```

```js
// app.js buildItem 内
if (it.done) { check.classList.add('done'); check.setAttribute('aria-checked', 'true'); }
else { check.setAttribute('aria-checked', 'false'); }   // 关键：显式写 false
```

`aria-checked="false"` 比删除属性更好，因为 `<button>` 想被读屏当成勾选框，还应补 `role="checkbox"`（见下）。

---

### 2. 高风险：导入的数据会造出重复 id，一次操作误改多条

```js
function uid() {
  var n = parseInt(localStorage.getItem(ID_KEY) || '0', 10) + 1;   // store.js:10
  localStorage.setItem(ID_KEY, String(n));
  return String(n);
}
```

`uid()` 只看自己的计数器 `todo_seq_v1`，完全不知道数据里已经有哪些 id。而 `importData()` 会原样接收外来 id：

```js
var have = {};                                                   // store.js:88
data.items.forEach(function (t) { have[t.id] = true; });          // 只收「库里已有」
parsed.items.forEach(function (it) {
  var id = it.id && !have[it.id] ? String(it.id) : uid();          // store.js:93
  have[id] = true;                                               // ← 这一行确实有
  ...
```

`have[id] = true` 看着像修好了，但它只覆盖**同一个 payload 内**的重复；payload 内部重复的 id 依然会各自拿到自己的 id——实测：

```
FAIL  import: duplicate ids inside one payload are deduplicated
      DUPLICATE IDS after one import: ["1","1","2"]
```

更常见的是**跨来源**撞车（正好命中项目主打的「手机 ↔ 电脑导出导入」场景）：

```
FAIL  id collision: uid() counter vs imported ids 1,2
      ids are ["1","1","2"] — 导入 id 1、2 之后，下一个 uid() 仍然是 1
```

后果不是"多余数据"，而是**删错/改错**。`toggle`/`remove`/`setText` 全靠 `t.id === id`：

```js
data.items.map(function (t) { if (t.id === id) { t.done = !t.done; ... } })   // store.js:57
```

实测：`FAIL id collision: toggling one hits every item sharing the id — TOGGLED 2 ITEMS AT ONCE (id 1)`。点一条勾，两条一起变；删一条，两条一起没。用户会认为"数据丢了"。

**修法**：导入时把外来 id 统一重编，或让 `uid()` 读一遍现有 id 取最大值。后者更小改动也更快：

```js
function uid(data) {
  var n = parseInt(localStorage.getItem(ID_KEY) || '0', 10);
  var max = n;
  (data ? data.items : []).forEach(function (t) {
    var v = parseInt(t.id, 10);
    if (!isNaN(v) && v > max) max = v;
  });
  if (max !== n) { n = max; localStorage.setItem(ID_KEY, String(n)); }
  n += 1;
  localStorage.setItem(ID_KEY, String(n));
  return String(n);
}
```

更彻底的做法是改用 `crypto.randomUUID()`（本项目只跑在现代浏览器里，见下文环境判断），从此不必维护计数器，也不会因为换设备而互相撞号。

---

### 3. 中：每次数据变化，整个列表被重建两遍

`Store.onChange` 没有去重，`renderList` 被注册了两次：

```js
Store.onChange(updateStats);   // app.js:173  （bindEvents 内）
...
Store.onChange(renderList);    // app.js:222  （init 内）
```

实测（统计一次变化里重建了多少个 `<li>`）：

```
FAIL  one store change: DOM rows rebuilt
      2 rows built for a single change -> renderList ran 2x
```

后果：DOM 节点、事件监听、`slide-in` 入场动画全部跑两遍；条目多时是可见的卡顿与"闪两下"。另外 `renderList()` 一次渲染要调 **4 次** `Store.items()`，每次都是一遍 `JSON.parse` 全量数据 —— 20 条数据无所谓，1000 条就是每次改动 4000 次对象解析。同一份 `items` 在一个 tick 内被解析 6 次（`renderList` 4 次 + `updateStats` 1 次 + `Calendar.render` 1 次）。

**修法**：删掉 `bindEvents()` 里的 `Store.onChange(updateStats)`；把 `items` 在 `Store` 内部做一次内存缓存（`save()` 时刷新），或让 `renderList` 把结果透传给 `updateStats`。

---

### 4. 中：`save()` 无保护，`localStorage` 写失败会直接把异常抛给调用方

```js
function load() { try { ... } catch (e) { return { items: [] }; } }   // store.js:16-23 ✅
function save(data) { localStorage.setItem(KEY, JSON.stringify(data)); emit(); }   // store.js:27 ❌
```

读做了保护，写没有。实测（模拟配额满）：

```
FAIL  save: unhandled when localStorage rejects the write
      UNCAUGHT QuotaExceededError escapes Store.add()
```

触发条件不难遇到：iOS Safari 隐私模式（`setItem` 直接抛 `QuotaExceededError`）、Safari 7 天未访问清空存储、数据量逼近 5MB。当前表现是：点「＋」没反应、控制台报错、用户以为应用坏了。而 `emit()` 在 `save()` 之后，异常会让 UI 连"看起来加上了"都做不到。

**修法**：`save()` 里 try/catch，失败时返回 false；`add` 等入口据此提示「保存失败，可能是浏览器存储空间不足或处于隐私模式」并考虑 `alert` 一次。`load()` 解析失败时也建议不要静默返回空——那看起来就是"数据全没了"，至少留一个提示或把坏数据备份到另一个 key。

---

### 5. 次要：空列表提示文案与实际不符

`index.html:40` 是固定文案「暂无待办，添加一条吧」，`renderList` 只做 `els.empty.hidden = sorted.length > 0`。于是在"已完成"筛选下、明明有 3 条待办时：

```
FAIL  filter=done with zero done items: hint text
      MISLEADING: 共用的提示「暂无待办，添加一条吧」在空的「已完成」筛选下也照原样显示
```

**修法**：按 `filter` 切换文案（`暂无待办` / `没有进行中的待办` / `还没有完成的事项`），或在有筛选时干脆不显示该元素。

---

### 6. 次要：导入不校验日期，非法日期会造出"月历里看不见"的待办

```js
date: keyOf(it.date),   // store.js:99 —— 只 String() 一次，不校验格式
```

实测：payload 里 `date: "bad-date-string"` 被原样存下。

```
FAIL  import: keeps unvalidated date string
      STORED INVALID DATE "bad-date-string"
FAIL  calendar: an item with an unparseable date is invisible in the month grid
      该条在清单视图里正常显示，但没有任何日历格子会画它：byDate["bad-date"] 永远不会被查
```

用户能看到这条待办（清单视图），但在月历里彻底失踪，且无处申诉。另外 `calendar.js:19-25` 的 `parseDate()` 只检查 `p.length === 3`，`"2026-13-45"` 会变成 `new Date(2026, 12, 45)` 静默滚到 2027 年。

**修法**：导入时用 `/^\d{4}-\d{2}-\d{2}$/` 校验，非法则置空；`calendar.js` 的 `parseDate` 增加"回读比对"：

```js
var d = new Date(y, m, day);
if (d.getFullYear() !== y || d.getMonth() !== m || d.getDate() !== day) return null;
```

顺带一提：`select(key)` 里 `parseInt('')` 得到 `NaN`，一旦 `selectedDate` 变成空串，`cal-title` 会渲染成 `NaN年 undefined` 且 42 个格子的 key 全是 `NaN-NaN-NaN`（当前入口不可达，但任何未来的调用点都会踩到，建议 `select` 开头加一行 `if (!key) return;`）。

---

### 7. 次要：首屏主题闪烁（FOUC）

`theme.js` 在 `DOMContentLoaded` 之后才给 `<html>` 写 `data-theme`：

```
FAIL  index.html: theme applied only after DOMContentLoaded (FOUC)
      <html data-theme> 在 theme.js 运行前不存在，非默认主题会先以默认配色画一帧
```

用户选了「黑白」主题，每次冷启动都能看到一瞬绿色。**修法**：在 `<head>` 里放一段极短的内联脚本，在 CSS 之前读 `todo_theme_v1` 并设置 `document.documentElement.dataset.theme`（`theme.js` 的 `init()` 再复用同一逻辑）。

---

## 三、其它值得注意的点（非缺陷，但会影响体验/可维护性）

**PWA / 离线**

- `sw.js:17` 用 `c.addAll(ASSETS)`，而 `ASSETS` 含 `./images/icon-192.png` 与 `./images/icon-512.png`。`addAll` 是**全有或全无**：任一 404 则 `install` 失败，Service Worker 装不上、离线能力失效。
  > **修正（已核实）**：这两个 PNG 在 `E:\work\vs\todo\images\` 与上游 tree 里都存在，实测尺寸 192×192 与 512×512，与 `manifest.json` 声明一致，**所以这不是当前故障**。上面这条只作为"以后若删掉图标会导致整个离线能力失效"的脆弱性记录；该脆弱点已在修复中改为逐个 `cache.add()`。
- 缓存名为固定的 `todo-v1`，而 `fetch` 是 cache-first（`sw.js:37`）。**改代码后必须同时改 `CACHE` 名**，否则老用户永远拿到旧版；建议把版本号写进构建/发布说明。
- `sw.js` 只判断 `e.request.url.indexOf(location.origin) === 0` 就写缓存，会把 `/admin/` 之类的同源响应也塞进来；建议限定在注册 scope 内。
- `app.js:226` 的 `location.protocol === 'https:'` 守卫导致 **http://localhost 下不注册 SW**。但 localhost 本身就是 secure context（README 第 19-21 行也用 `python -m http.server` 演示），所以本地永远测不到离线能力。建议改成 `location.protocol === 'https:' || ['localhost','127.0.0.1'].indexOf(location.hostname) !== -1`。

**数据模型**

- 没有"无日期"待办这个概念：`add-form` 的日期框被 `els.addDate.value || todayStr()` 强制补成今天（`app.js:130`），空值永远存不进去，所以日历里不存在"未排期"这类条目，也没法给已有条目改日期（只能删了重建）。对一个"月历式"待办应用来说，这是最值得补的产品能力。
- 导入是纯追加（`store.js:95` `push`），不做内容去重。同一份备份导两次就是双份数据；而导出文件名带日期，用户很容易重复导入。建议以 `text+date+created` 做一次近似去重，或在提示里明确说"重复导入会翻倍"。
- `importData` 对 `created` 不做类型校验（`it.created || Date.now()`），恶意/损坏文件塞个字符串会让排序退化成噪声。同理 `text` 没有长度上限（UI 有 `maxlength=100`，导入路径没有），一条 10 万字的待办足以撑爆 localStorage 并触发上面的缺陷 4。

**可访问性与交互**

- 顶部的「清单 / 月历」是 `role="tablist"` + `role="tab"`，但没有 `aria-selected`、没有 `aria-controls`，也没有对应的 `tabpanel`——读屏会念成"标签页"却拿不到选中状态。
- `<button class="todo-check">` 想要勾选框语义，应补 `role="checkbox"` + `aria-checked`（并修好缺陷 1 里"只写 true 不写 false"的问题）。
- 设置面板是 `role="dialog"`，但无 `aria-modal`、无焦点陷阱、无打开后自动聚焦，Escape 之外无法用键盘离开（`app.js:157-159` 只处理 Escape）。
- 用 `dblclick` 触发编辑：移动端没有双击语义（双击会被当成两次缩放/点击），手机上等于**无法编辑已有待办**。这是第一个应该在移动端替换的交互（常见的做法是整行点击进入编辑，或长按菜单）。
- `editItem` 里 `textEl.textContent = it.text`（`app.js:119`，Escape 分支）清掉了子节点但 `<input>` 仍在文档里（实测 `PASS/FALSE` 混合：文本对，但节点残留 1 个）。视觉上看不出来，但会留下游离的监听器，且 `if (textEl.querySelector('input')) return` 的重复进入保护变得不可靠。
- 编辑期间任何一次 `Store` 变化都会整表重建，正在输入的内容直接消失；由于列表和月历的监听器都会触发，边编辑边在月历里操作一下就丢字。

**主题 / 样式**

- `theme.js:12-15` 在 `requestAnimationFrame` 里更新 `<meta name="theme-color">`，但设置的 `content` 是 CSS 变量 `--bg` 的值。而 `:root` 的 `--bg` 在**任何主题下都是 `#f3f6f0`**（`style.css:2`）——`[data-theme="mono"]` 覆盖的也是 `--bg: #f5f5f5` 等具体值。所以首帧 meta 用的是 HTML 里写死的 `#f3f6f0`，之后 `apply()` 又把它设成计算后的 `--bg`（合理的取值），逻辑没错；但注意 `getComputedStyle` 在 `rAF` 里才拿到值，切换主题时地址栏颜色会慢一帧。可以接受。
- `.cal-cell` 固定 `min-height: 58px`、每格最多两条 + `+N`，视觉上干净；但 `.cal-grid` 总渲染 42 格（`calendar.js:51`），五行月份下方会多出整整一周的"下月"格子，页面上显得空一大块。建议按实际行数（5 或 6 行）渲染。
- README 第 8 行写"每天格子上显示待办**圆点**"，实现是直接显示最多两条**文字**（`calendar.js:82-88`）。文档与实现不一致，建议改文档。
- `.cal-cell.other` 用 `opacity: 0.45` 压低对比度，再叠加 `--text-dim`，在浅色屏上「上/下月」的日期几乎看不清，属可访问性上的对比度不足。

**工程化**

- 没有 `package.json`、没有测试、没有 CI（`node --check` 5 个脚本全部通过，语法是干净的）。本次评审的 `_review/harness.js` 可直接当第一个回归测试用：`node _review/harness.js`。
- 代码风格是统一的 ES5 风格（`var`、`function`），只在 `querySelectorAll(...).forEach`、`classList.toggle(force)` 等处依赖现代特性，因此对 IE 不兼容但对任何 2018 年后的浏览器都成立。若确定目标环境如此，可以放心用 `crypto.randomUUID()`（修缺陷 2）与 `const/let`。
- 版本号只在导出 JSON 里（`version: 1`），没有对应的迁移逻辑；将来改数据结构时需要处理 v0→v1。

---

## 四、建议的修复顺序

1. **缺陷 1**（完成勾）—— 一行 CSS + 一行 JS，用户可见度最高。
2. **缺陷 2**（id 撞车）—— 数据正确性，宁可早修；修完建议再加一条"导入后 id 唯一"的断言进 `_review/harness.js`。
3. **缺陷 3 + 4**（双渲染、写失败）—— 各几行，性能和健壮性一起拿。
4. **缺陷 7 + 5**（首屏主题、空态文案）—— 体验细节。
5. **缺陷 6**（日期校验）+ 移动端编辑交互 —— 需要一点产品决策，建议单独一轮。
6. PWA 三项（逐个 `cache.add`、`CACHE` 版本策略、localhost 也注册 SW）—— 上线前过一遍。

---

## 五、复现方式

```powershell
node E:\work\dsh\HZY1207-todo\_review\harness.js
```

`_review/harness.js` 自带一个约 120 行的 DOM 桩（元素树、`classList`、事件冒泡、选择器、`localStorage`），在 Node 里 `vm.runInContext` 依次执行 `store.js`、`theme.js`、`calendar.js`、`app.js` 并派发 `DOMContentLoaded`，然后跑 38 项探针。它**不是**浏览器模拟器，只覆盖这个应用实际用到的 API；作用是把"我读出来的可疑点"变成可执行、可回归的断言。上面的每一条 FAIL 输出都来自它，也可以作为修完之后的验收依据。

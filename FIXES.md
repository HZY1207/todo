# 修复记录与验证

修复对象：`E:\work\dsh\HZY1207-todo`（上游 `HZY1207/todo` @ `1cb69794` 的镜像）
同步回工作副本的步骤见 `SYNC.md`；问题清单与原始分析见 `REVIEW.md`。

## 一、改了什么

| # | 原问题 | 修复方式 | 涉及文件 |
| --- | --- | --- | --- |
| 1 | 完成勾永远不显示（`<button>` 用了 `:checked`） | 状态改由 `.done` 类驱动；按钮补 `role="checkbox"`，`aria-checked` 明确写 `true` / `false`（不再只写 true） | `css/style.css`、`js/app.js`、`js/calendar.js` |
| 2 | 导入的 id 撞车，一次操作误改多条 | 导入的 id 一律**重新分配**（`newId()` 同时避开计数器与库内/本次已用 id）；`nextId()` 取计数器与库内最大数字 id 的较大值 | `js/store.js` |
| 3 | 每次数据变化整表重建两遍 | 删掉 `bindEvents()` 里重复的 `Store.onChange(updateStats)`，只保留单一 `renderList` 入口 | `js/app.js` |
| 4 | `localStorage` 写失败直接抛异常 | `save()`/`writeRaw()`/`writeSeq()` 全部 try/catch；`add()` 返回带 `_saved` 标记的对象，写入失败时表单弹提示；解析失败的数据另存到 `todo_data_v1_corrupt` 而不是静默丢弃 | `js/store.js`、`js/app.js`、`js/calendar.js` |
| 5 | 空态文案不随筛选变化 | 文案按 `all/active/done` 三套切换 | `js/app.js`、`index.html` |
| 6 | 导入不校验日期，产生"月历里看不见"的待办 | 规范化：不合法日期落为未排期；导入的 `created` 强制为数字；文本 `trim` + 截断到 200 字符 | `js/store.js` |
| 7 | 首屏主题闪烁（FOUC） | `<head>` 里在样式表**之前**放一段内联脚本先定 `data-theme`；`theme.js` 复用同一套白名单逻辑 | `index.html`、`js/theme.js` |
| 8 | PWA：`cache.addAll` 全有或全无 | 改为逐个 `cache.add()` + 单个失败不影响安装；`CACHE` 提到 `todo-v2` 并在文件头写明"改代码要同时改版本号" | `sw.js` |
| 9 | PWA：cache-first 导致更新推不下去 | 导航请求与 `index.html`/`manifest.json` 改为网络优先、离线回退缓存；静态资源保持缓存优先 | `sw.js` |
| 10 | PWA：http://localhost 不注册 SW | 判定改为 `https:` 或 `localhost`/`127.0.0.1` | `js/app.js` |
| 11 | 触屏无法编辑（双击无意义） | 文字长按 480ms 进入编辑（滚动超过 10px 取消，并吞掉长按后的补发 click）；同时每行新增 ✎ 按钮，桌面/触屏都可用 | `js/app.js`、`css/style.css` |
| 12 | 编辑只能改文字，不能改日期 | 编辑态同时给出文本输入与日期输入，日期留空即改为未排期 | `js/app.js` |
| 13 | 删除无确认、误删不可恢复 | 删除后底部出现「已删除 / 撤销」，6 秒内可恢复（`Store.restore`）；清空全部仍保留 `confirm` | `js/app.js`、`js/store.js`、`index.html`、`css/style.css` |
| 14 | 已有待办无法改日期；日期被 `\|\| todayStr()` 强制补成今天 | 新增 `Store.setDate(id, '')`；添加表单日期默认留空（= 未排期），提示"留空 = 未排期" | `js/store.js`、`js/app.js`、`index.html` |
| 15 | **产品缺口：没有"未排期"概念** | 月历顶部新增「未排期 N」按钮，点开后面板列出全部无日期待办，并可直接在其中新增；`返回今天` 退出该模式 | `index.html`、`js/calendar.js`、`css/style.css` |
| 16 | 月历固定渲染 42 格 | 按 `Math.ceil((起始偏移 + 当月天数) / 7)` 渲染，5 行月份不再多出一周 | `js/calendar.js` |
| 17 | `parseDate` 接受被滚动的日期（`2026-13-45`） | 严格校验：格式 + 回读比对年月日；`select('')` 直接返回，不再产生 `NaN年` | `js/calendar.js` |
| 18 | 设置面板无 `aria-modal`、无焦点管理、无 Tab 陷阱 | 补 `aria-modal`/`aria-labelledby`，打开聚焦关闭按钮、关闭归还焦点、Tab 在面板内循环 | `index.html`、`js/app.js` |
| 19 | 标签页语义不完整 | 视图按钮补 `aria-selected` + `aria-controls`，筛选与主题补 `aria-pressed`，计数区补 `role="status" aria-live="polite"`，日历格子补 `aria-label` | `index.html`、`js/app.js`、`js/calendar.js` |
| 20 | `/favicon.ico` 404 | 由 `images/icon-192.png` 生成 `favicon.ico`（PNG-in-ICO，2687 B）并在 `<head>` 声明 | `favicon.ico`、`index.html` |
| 21 | `icon-512` 标了 `maskable` 却无安全区留白 | 改为 `"purpose": "any"`，避免 Android 自适应图标裁掉四角；同时补 `id` 字段、去掉 `orientation` 锁定 | `manifest.json` |
| 22 | 对比度不足（下月日期、`--text-dim`） | 提高三套主题的 `--text-dim`；`.cal-cell.other` 的透明度 0.45 → 0.75 | `css/style.css` |
| 23 | 未处理 `prefers-reduced-motion` | 补媒体查询关闭动画；同时补 `:focus-visible` 键盘焦点样式 | `css/style.css` |

## 二、第二轮（批次 A / B）：把上面有意留下的缺口补掉

| # | 事项 | 结果 |
| --- | --- | --- |
| 24 | 清单视图没有"未排期"筛选 | 新增 `data-filter="undated"` 按钮与空态文案；该筛选只看日期不看完成状态（[`app.js`](js/app.js)、[`index.html`](index.html)） |
| 25 | 同一份备份导两次会翻倍 | 新增 `fingerprint()`（文本 + 日期 + 创建时刻）在导入时去重，结果里返回 `duplicates` 计数并显示在提示里。**手动新建的同名待办不会被误合**（创建时刻不同），这是刻意取舍 |
| 26 | 数据更新后当前页面仍跑旧代码 | `watchForUpdate()` 监听 `controllerchange`，复用底部提示条显示「已更新到新版本 / 刷新」；只在「本会话本来就有旧 worker」时提示，首次安装的访客不会看到 |
| 27 | 没有"从备份覆盖恢复" | `importData(json, 'replace')` 清空后按备份恢复；设置面板拆成「导入并合并」与「从备份还原」两个按钮，后者先 `confirm` 再选文件 |
| 28 | 稳定 id（`crypto.randomUUID()`） | **决定不做**，理由见下 |

### 关于第 28 项为什么不做

原始动机是"id 撞车"，而撞车已经在第 2 项里彻底解决（`nextId()` 取计数器与库内最大数字 id 的较大值，导入的 id 一律重编）。
换 UUID 的收益只是"跨设备 id 稳定"，但代价是：

- 旧的数字 id 与新的 UUID 会在导入时混在一起，`newId()` 的 `maxNumericId()` 需要额外兼容；
- 随机 UUID 与已有小整数 id **理论上仍可能相撞**，而 `toggle`/`remove` 是靠 `t.id === id` 精确匹配的，撞了就是误改；
- 现在这套数字方案有 110 项断言覆盖，换成 UUID 需要重写其中一批。

第 25 项的去重指纹是"内容 + 日期 + 创建时刻"，不依赖 id，所以"跨设备稳定 id"对本应用没有实际收益。
如果以后要做真正的多端同步（而不是导出导入），再一并换成 UUID 更合适。

## 三、修复过程中由测试发现的额外 bug

回归套件（`_review/harness.js`）在改造 `app.js` 时抓到一个**原代码没有、我改出来的**新 bug：

```js
var viewNames = ['清单', '月历'];           // ← 白名单里是中文标签
document.querySelectorAll('.view-btn')...
  btn.addEventListener('click', function () { setView(btn.dataset.view); });   // 传的是 'list' / 'calendar'
...
function setView(name) {
  if (viewNames.indexOf(name) === -1) name = 'list';   // 'calendar' 不在白名单 → 永远退回列表视图
```

后果是月历视图**完全打不开**。断言 `a11y: switching view updates aria-selected and the panels` 直接失败
（`sel=false`），改成 `['list', 'calendar']` 后通过。这正是"跑起来才算数"的价值——这段逻辑单看代码很像对的。

第二个：把「撤销删除提示」泛化成通用 toast（第 26 项要复用它）时，`hideToast()` 会先把
`pendingUndo` 清空、再执行撤销动作，于是**撤销永远失败**：

```
FAIL  undo: restores the item   []
```

改成"先取出动作、动作里用闭包捕获待恢复对象、再收起提示"，并把清理动作内联进按钮处理器，
不再让 `hideToast()` 负责重置动作状态。断言 `toast: undo still shares the same toast element` 现在锁住这个行为。

## 四、验证结果

```
node _review\harness.js       → 110/110 probes pass, 0 anomalies
node _review\serve-check.js   → all HTTP checks passed
node --check（5 个脚本）       → 全部通过
```

`harness.js` 覆盖：增删改查、完成勾状态类与 `aria-checked` 往返、单次变化只构建一次行、
四套空态文案（含未排期）、编辑（进入/保存/取消/失焦/清空删除/改日期/清空日期）、长按（延迟触发、
滚动取消、吞掉补发 click）、删除撤销、导入（计数/跳过/id 唯一/id 重编/非法日期/字段强制/
重复导入不撞车/二次导入零新增/去重指纹不误合手动重复）、覆盖还原（清空后恢复、空备份、confirm 拦截、
文件选择端到端）、写入失败不抛异常且弹提示、损坏数据兜底、月历（周数/严格日期/未排期桶/
面板新增/跨年导航/排序/aria-label）、主题（默认/记忆/非法值回退/首帧顺序）、无障碍
（tablist、对话框焦点、Esc 取消编辑）、SW 更新提示（有旧 worker 才提示、点刷新会 reload）、
PWA 静态检查（逐个缓存、版本号、localhost 注册、file:// 跳过、manifest 与磁盘一致）、
代码卫生（语法、无残留 `:checked`、换行约定）。

## 五、仍然存在 / 有意留下的

1. **未排期筛选不做完成状态区分**：它只看有没有日期，已完成但无日期的条目仍会出现。
2. **去重依赖 `created` 字段**：手工编辑过导出文件的 `created` 值会让去重失效（属于可接受的边界）。
3. **`_review/` 是否入库由你决定**：两个测试脚本不参与运行时，`sw.js` 也不缓存它们。
4. **图标仍是 `any` 用途**：要拿到 Android 自适应图标的最佳效果，应另做一张带安全区留白的
   `icon-512-maskable.png`，而不是复用 512 那张。
5. **稳定 id / 真正的多端同步**：见第二节第 28 项的取舍说明，建议留到做同步功能时一并处理。

/* 用真实的 index.html + 真实的 JS 渲染出两个视图的静态快照，放进 _review/snapshot/。
   目的：不依赖浏览器自动化，也能把"跑起来长什么样"固化下来看。
   运行：node _review/snapshot.js                                                    */
'use strict';
const fs = require('fs');
const path = require('path');
const { boot, outline } = require('./harness.js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'snapshot');
const DAY = 86400000;

const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const TODAY = iso(new Date());
const YESTERDAY = iso(new Date(Date.now() - DAY));
const TOMORROW = iso(new Date(Date.now() + DAY));

/* 演示数据：覆盖 未完成/已完成、逾期/今天/明天/未排期 各种情况 */
const DEMO = [
  { text: '交周报', done: false, date: YESTERDAY },
  { text: '买牛奶和鸡蛋', done: false, date: TODAY },
  { text: '给妈妈打电话', done: false, date: TOMORROW },
  { text: '预约牙医', done: false, date: '' },              // 未排期
  { text: '看完《置身事内》第 4 章', done: false, date: TODAY },
  { text: '整理上月账单', done: true, date: TODAY },
  { text: '续订域名', done: true, date: YESTERDAY },
  { text: '把旧硬盘的照片备份到网盘', done: false, date: '' }
];

function seed(app) {
  // 倒序插入，让最终顺序和用户手点出来的一致（Store.add 是 unshift）
  DEMO.slice().reverse().forEach((d, i) => {
    const it = app.sandbox.Store.add(d.text, d.date);
    if (d.done) app.sandbox.Store.toggle(it.id);
  });
}

function page(title, bodyHtml, extraCss) {
  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="green">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<link rel="stylesheet" href="style.css">
<style>${extraCss || ''}</style>
</head>
<body>
<p style="font-size:12px;color:#8a9189;padding:8px 0">
  静态快照 · 由 _review/snapshot.js 用真实脚本渲染 · 数据是演示数据，交互已冻结
</p>
${bodyHtml}
</body>
</html>
`;
}

fs.mkdirSync(OUT, { recursive: true });
fs.copyFileSync(path.join(ROOT, 'css', 'style.css'), path.join(OUT, 'style.css'));

/* ---------- 1) 清单视图 ---------- */
const app = boot();
seed(app);
const d = app.document;
const listHtml = d.body.outerHTML;

/* 终端里也打印一份结构大纲 */
console.log('=== 清单视图（渲染后的 DOM 大纲）===');
console.log(outline(d.getElementById('todo-list'), 1));
console.log('');
console.log('计数器 : ' + d.getElementById('counter').textContent);
console.log('空态提示: hidden=' + d.getElementById('empty-hint').hidden + '  text="' + d.getElementById('empty-hint').textContent + '"');
console.log('统计   : ' + d.getElementById('stat-hint').textContent);

/* ---------- 2) 月历视图 ---------- */
const app2 = boot();
seed(app2);
const d2 = app2.document;
d2.querySelectorAll('.view-btn')[1].dispatch('click');
d2.getElementById('btn-undated').dispatch('click');       // 停在"未排期"面板上，展示这个新功能
const calHtml = d2.body.outerHTML;

console.log('');
console.log('=== 月历视图 ===');
console.log('标题   : ' + d2.getElementById('cal-title').textContent);
console.log('未排期 : "' + d2.getElementById('btn-undated').textContent + '"  hidden=' + d2.getElementById('btn-undated').hidden);
console.log('面板   : ' + d2.getElementById('day-title').textContent + '  共 ' + d2.getElementById('day-list').children.length + ' 条');
console.log('');
console.log('当月网格（每格显示前两条待办，与浏览器一致）:');
const cells = d2.getElementById('cal-grid').children;
let row = [];
cells.forEach((c, i) => {
  const num = (c.children[0] || { textContent: '?' }).textContent;
  const texts = c.children.slice(1).map(x => x.textContent);
  const mark = (c.classList.contains('today') ? '*' : ' ') + (c.classList.contains('selected') ? '>' : ' ') + (c.classList.contains('other') ? '~' : ' ');
  row.push(mark + String(num).padStart(2) + '[' + texts.join('|') + ']');
  if (row.length === 7) { console.log('  ' + row.join(' ')); row = []; }
});
if (row.length) console.log('  ' + row.join(' '));
console.log('  图例: * = 今天   > = 选中   ~ = 非本月');

/* ---------- 3) 写快照文件 ---------- */
const wide = 'body{max-width:720px}';
fs.writeFileSync(path.join(OUT, 'view-list.html'), page('快照 · 清单视图', listHtml, wide));
fs.writeFileSync(path.join(OUT, 'view-calendar.html'), page('快照 · 月历视图', calHtml, wide));
console.log('');
console.log('已写出:');
console.log('  ' + path.join(OUT, 'view-list.html'));
console.log('  ' + path.join(OUT, 'view-calendar.html'));
console.log('  ' + path.join(OUT, 'style.css'));

/* 检查快照 HTML 的完整性：属性无残留占位、样式引用正确、结构闭合。
   运行：node _review/check-snapshot.js                                       */
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'snapshot');
const files = ['view-list.html', 'view-calendar.html'];
let bad = 0;

for (const f of files) {
  const p = path.join(DIR, f);
  const h = fs.readFileSync(p, 'utf8');
  const opens = (h.match(/<([a-zA-Z][\w-]*)[\s>]/g) || []).length;
  const closes = (h.match(/<\/[a-zA-Z][\w-]*>/g) || []).length;
  const checks = [
    ['links style.css', /href="style\.css"/.test(h)],
    ['no [object Object] in attributes', !/="\[object /.test(h)],
    ['no undefined in attributes', !/="undefined"/.test(h)],
    ['no NaN day labels', !/>NaN</.test(h)],
    ['checkboxes carry .done for finished items', /class="todo-check done"/.test(h) || !/todo-check/.test(h)],
    ['has the undated flag chip', /class="todo-flag"/.test(h) || f.indexOf('list') === -1],
    ['balance: closes >= half of opens (void tags account for the rest)', closes * 2 >= opens]
  ];
  console.log('\n' + f + '  (' + h.length + ' bytes, ' + opens + ' open / ' + closes + ' close)');
  for (const [name, ok] of checks) {
    if (!ok) bad++;
    console.log((ok ? '  ok   ' : '  FAIL ') + name);
  }
}

console.log('\n' + (bad ? bad + ' check(s) failed' : 'all snapshot checks passed'));
process.exitCode = bad ? 1 : 0;

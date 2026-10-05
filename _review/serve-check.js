/* Serve the app over HTTP and verify every asset actually resolves the way a browser would.
   Run: node _review/serve-check.js                                                  */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 8177;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('404');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

const get = p => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, res => {
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body: Buffer.concat(chunks) }));
  }).on('error', reject);
});

(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const base = `http://127.0.0.1:${PORT}/`;
  const urls = [
    '/', '/index.html', '/manifest.json', '/favicon.ico',
    '/css/style.css', '/js/store.js', '/js/theme.js', '/js/calendar.js', '/js/app.js', '/sw.js'
  ];
  const html = (await get('/index.html')).body.toString('utf8');
  const refs = [...html.matchAll(/(?:href|src)="([^"#]+)"/g)]
    .map(m => m[1])
    .filter(u => !/^(https?:|data:)/.test(u))
    .map(u => '/' + u.replace(/^\.?\//, ''));

  let fail = 0;
  console.log('--- direct requests ---');
  for (const u of [...new Set([...urls, ...refs])]) {
    const r = await get(u);
    const ok = r.status === 200 && r.body.length > 0;
    if (!ok) fail++;
    const extra = u === '/index.html' ? r.type : (u.endsWith('.json') ? (JSON.parse(r.body.toString('utf8')).name || 'json ok') : r.type);
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${String(r.status)}  ${String(r.body.length).padStart(6)} B  ${u.padEnd(24)} ${extra}`);
  }

  console.log('--- content sanity ---');
  const css = (await get('/css/style.css')).body.toString('utf8');
  const checks = [
    ['stylesheet has no dead .todo-check:checked rule', !/\.todo-check:checked/.test(css)],
    ['stylesheet styles .todo-check.done', /\.todo-check\.done\s*\{/.test(css)],
    ['stylesheet styles .cal-undated', /\.cal-undated\s*\{/.test(css)],
    ['index.html loads all four scripts in order', /store\.js[\s\S]*?theme\.js[\s\S]*?calendar\.js[\s\S]*?app\.js/.test(html)],
    ['theme boot script runs before the stylesheet', html.indexOf('todo_theme_v1') < html.indexOf('css/style.css')],
    ['favicon declared', /rel="icon"[^>]*favicon\.ico/.test(html)],
    ['no leftover todo-edit input in the static markup', !/class="todo-edit"/.test(html)]
  ];
  for (const [name, ok] of checks) {
    if (!ok) fail++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
  }

  const ico = (await get('/favicon.ico')).body;
  const icoOk = ico.length > 22 && ico.readUInt16LE(0) === 0 && ico.readUInt16LE(2) === 1 &&
    ico.readUInt16LE(4) === 1 && ico.readUInt32LE(14) === ico.length - 22;
  if (!icoOk) fail++;
  console.log(`${icoOk ? 'ok  ' : 'FAIL'} favicon.ico is a well-formed single-image ICO container (${ico.length} B)`);

  server.close();
  console.log(`\n${fail ? fail + ' check(s) failed' : 'all HTTP checks passed'}`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { server.close(); console.error(e); process.exitCode = 2; });

#!/usr/bin/env node
/* Мини-сервер без зависимостей: раздаёт папку app/ на http://localhost:8080.
 * localhost нужен, чтобы браузер дал доступ к камере и включил офлайн-кэш. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'app');
const PORT = Number(process.env.PORT) || 8080;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('Порт ' + PORT + ' уже занят: скорее всего, работает касса, запущенная раньше.');
    console.error('Остановите её (lsof -ti tcp:' + PORT + ' -sTCP:LISTEN | xargs kill) и запустите снова.');
    process.exit(1);
  }
  throw err;
}).listen(PORT, '127.0.0.1', () => {
  console.log('АрхБухта: откройте http://localhost:' + PORT + ' (Ctrl+C — остановить)');
});

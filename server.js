'use strict';

const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

const TORRENT_SOURCES = [
  { name: 'itorrents.net', url: (h) => 'https://itorrents.net/torrent/' + h + '.torrent' },
  { name: 'itorrents.org', url: (h) => 'https://itorrents.org/torrent/' + h + '.torrent' },
  { name: 'torrage.com',  url: (h) => 'https://torrage.com/torrent/' + h + '.torrent' },
];

function parseInfoHash(input) {
  if (!input) return null;
  input = input.trim();
  if (/^[a-fA-F0-9]{40}$/.test(input)) return input.toUpperCase();
  const m = input.match(/xt=urn:btih:([a-fA-F0-9]{40})/);
  if (m) return m[1].toUpperCase();
  return null;
}

function curlBuffer(url, timeoutSec) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const args = [
      '-s', '-L',
      '-A', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      '--max-time', String(timeoutSec),
      '--compressed',
      url
    ];
    const child = spawn('curl', args);
    child.stdout.on('data', (c) => chunks.push(c));
    child.stderr.on('data', () => {});
    child.on('error', (e) => reject(e));
    child.on('close', (code) => {
      const data = Buffer.concat(chunks);
      if (code === 0 && data.length > 100) resolve(data);
      else reject(new Error('curl exit ' + code + ' size=' + data.length));
    });
  });
}

function verifyTorrent(buf) {
  if (!buf || buf.length < 200) return false;
  if (buf[0] !== 0x64) return false;
  try {
    const marker = Buffer.from('4:info');
    const idx = buf.indexOf(marker);
    return idx > 0;
  } catch (e) { return false; }
}

function fetchTorrent(hash, overallTimeoutMs) {
  return new Promise((resolve, reject) => {
    let done = false;
    const results = new Array(TORRENT_SOURCES.length).fill(null);
    TORRENT_SOURCES.forEach((source, i) => {
      curlBuffer(source.url(hash), 15).then((data) => {
        if (done) return;
        if (verifyTorrent(data)) {
          done = true;
          resolve({ source: source.name, buffer: data });
        } else {
          results[i] = { valid: false };
        }
      }).catch(() => {
        results[i] = { valid: false };
      });
    });
    setTimeout(() => {
      if (!done) reject(new Error('无法从任何缓存源获取到有效 torrent 文件。该资源可能未被公共缓存收录。'));
    }, overallTimeoutMs);
  });
}

const PORT = process.env.PORT || 3000;
const homePage = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

const server = http.createServer(async (req, res) => {
  try {
    const parsed = new URL(req.url, 'http://' + req.headers.host);
    const pathname = parsed.pathname;

    // 首页
    if (req.method === 'GET' && (pathname === '/' || pathname === '')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(homePage);
      return;
    }

    // 健康检查
    if (req.method === 'GET' && pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    // 下载接口 - GET
    if (req.method === 'GET' && pathname === '/api/torrent') {
      const hash = parseInfoHash(parsed.searchParams.get('magnet') || parsed.searchParams.get('hash') || '');
      if (!hash) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid magnet link or info hash' }));
        return;
      }
      try {
        const result = await fetchTorrent(hash, 20000);
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': result.buffer.length,
          'Content-Disposition': 'attachment; filename="' + hash + '.torrent"',
          'Cache-Control': 'no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
        });
        res.end(result.buffer);
      } catch (err) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message, hash: hash }));
      }
      return;
    }

    // 下载接口 - POST（更可靠）
    if (req.method === 'POST' && pathname === '/api/torrent') {
      let body = '';
      req.on('data', (chunk) => { body += chunk.toString(); });
      req.on('end', async () => {
        try {
          const params = new URLSearchParams(body);
          const hash = parseInfoHash(params.get('magnet') || params.get('hash') || '');
          if (!hash) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid magnet link or info hash' }));
            return;
          }
          const result = await fetchTorrent(hash, 20000);
          res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Length': result.buffer.length,
            'Content-Disposition': 'attachment; filename="' + hash + '.torrent"',
            'Cache-Control': 'no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
          });
          res.end(result.buffer);
        } catch (err) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  } catch (e) {
    try {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    } catch (f) {}
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Server running at http://0.0.0.0:' + PORT + '/');
});
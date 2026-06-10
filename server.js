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
    if (idx < 0) return false;
    const infoStart = idx + marker.length;
    let depth = 1, pos = infoStart, iters = 0;
    while (depth > 0 && pos < buf.length && iters < 200000) {
      iters++;
      const c = buf[pos];
      if (c === 0x64 || c === 0x6c) { depth++; pos++; }
      else if (c === 0x65) { depth--; pos++; }
      else if (c === 0x69) {
        const end = buf.indexOf('e', pos + 1);
        if (end < 0) return false;
        pos = end + 1;
      } else if (c >= 0x30 && c <= 0x39) {
        const colon = buf.indexOf(':', pos);
        if (colon < 0) return false;
        const lenStr = buf.slice(pos, colon).toString();
        const len = parseInt(lenStr, 10);
        if (isNaN(len) || len < 0) return false;
        pos = colon + 1 + len;
      } else return false;
    }
    return depth === 0;
  } catch (e) { return false; }
}

function fetchFromSource(source, hash, timeoutSec) {
  return curlBuffer(source.url(hash), timeoutSec).then((data) => {
    if (verifyTorrent(data)) return { source: source.name, buffer: data };
    throw new Error('invalid torrent from ' + source.name);
  });
}

function fetchTorrent(hash, overallTimeoutMs) {
  return new Promise((resolve, reject) => {
    const promises = TORRENT_SOURCES.map((s) =>
      fetchFromSource(s, hash, 15).then((r) => { resolve(r); return r; }).catch(() => null)
    );
    const fallback = setTimeout(() => {
      Promise.all(promises).then((results) => {
        const found = results.find((r) => r);
        if (found) resolve(found);
        else reject(new Error('无法从任何缓存源获取到有效 torrent 文件。该资源可能未被公共缓存收录。'));
      });
    }, overallTimeoutMs);
  });
}

const PORT = process.env.PORT || 3000;
const homePage = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

const server = http.createServer(async (req, res) => {
  try {
    const parsed = new URL(req.url, 'http://' + req.headers.host);
    const pathname = parsed.pathname;

    if (req.method === 'GET' && (pathname === '/' || pathname === '')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(homePage);
      return;
    }

    if (req.method === 'GET' && pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

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
          'Content-Type': 'application/x-bittorrent',
          'Content-Length': result.buffer.length,
          'Content-Disposition': 'attachment; filename="' + hash + '.torrent"; filename*=UTF-8\'\'' + hash + '.torrent',
          'Content-Transfer-Encoding': 'binary',
          'Cache-Control': 'no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
          'X-Download-Options': 'noopen',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(result.buffer);
      } catch (err) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message, hash: hash }));
      }
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
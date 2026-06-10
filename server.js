'use strict';

const http = require('http');
const { spawn } = require('child_process');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

const TORRENT_SOURCES = [
  { name: 'itorrents.net', url: (h) => 'https://itorrents.net/torrent/' + h + '.torrent' },
  { name: 'itorrents.org', url: (h) => 'https://itorrents.org/torrent/' + h + '.torrent' },
  { name: 'torrage.com',  url: (h) => 'https://torrage.com/torrent/' + h + '.torrent' },
];

const TEMP_DIR = path.join(__dirname, '.tmp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

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
    TORRENT_SOURCES.forEach((source) => {
      curlBuffer(source.url(hash), 15).then((data) => {
        if (done) return;
        if (verifyTorrent(data)) {
          done = true;
          resolve({ source: source.name, buffer: data });
        }
      }).catch(() => {});
    });
    setTimeout(() => {
      if (!done) reject(new Error('无法从任何缓存源获取到有效 torrent 文件。该资源可能未被公共缓存收录。'));
    }, overallTimeoutMs);
  });
}

function sseSend(res, eventName, data) {
  res.write('event: ' + eventName + '\n');
  res.write('data: ' + JSON.stringify(data) + '\n\n');
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

    // 下载内容接口 - SSE 推送进度
    if (req.method === 'GET' && pathname === '/api/download') {
      const hash = parseInfoHash(parsed.searchParams.get('magnet') || parsed.searchParams.get('hash') || '');
      if (!hash) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid magnet link or info hash' }));
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      sseSend(res, 'state', { phase: 'fetching', message: '正在从公共缓存源获取 torrent 文件...', hash: hash });

      let torrentBuf, torrentSource;
      try {
        const result = await fetchTorrent(hash, 20000);
        torrentBuf = result.buffer;
        torrentSource = result.source;
        sseSend(res, 'state', { phase: 'got-torrent', message: '已从 ' + torrentSource + ' 下载到 torrent 文件 (' + (torrentBuf.length / 1024).toFixed(1) + ' KB)', hash: hash });
      } catch (err) {
        sseSend(res, 'error', { message: err.message });
        res.end();
        return;
      }

      const torrentPath = path.join(TEMP_DIR, hash + '.torrent');
      fs.writeFileSync(torrentPath, torrentBuf);

      const saveDir = path.join(DOWNLOAD_DIR, hash);
      if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });

      sseSend(res, 'state', { phase: 'downloading', message: '正在启动 BT 下载 (aria2c)...', saveDir: saveDir });

      let py;
      try {
        py = spawn('python3', [
          path.join(__dirname, 'torrent_dl.py'),
          torrentPath,
          '--dir', saveDir
        ]);
      } catch (e) {
        sseSend(res, 'error', { message: '无法启动下载进程: ' + e.message });
        res.end();
        return;
      }

      let lineBuf = '';
      py.stdout.on('data', (chunk) => {
        lineBuf += chunk.toString();
        let idx;
        while ((idx = lineBuf.indexOf('\n')) >= 0) {
          const line = lineBuf.substring(0, idx).trim();
          lineBuf = lineBuf.substring(idx + 1);
          if (!line) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.type === 'progress') {
              sseSend(res, 'progress', { percent: obj.percent, speed: obj.speed, info: obj.info });
            } else if (obj.type === 'start') {
              sseSend(res, 'state', { phase: 'aria2-start', message: 'aria2c 已启动，正在连接 peers...', torrent: obj.torrent });
            } else if (obj.type === 'log') {
              sseSend(res, 'log', { message: obj.message });
            } else if (obj.type === 'done') {
              sseSend(res, 'done', { saved_path: obj.saved_path, files: obj.files, hash: hash, download_api: '/api/files/' + hash });
            } else if (obj.type === 'error') {
              sseSend(res, 'error', { message: obj.message });
            }
          } catch (e) {}
        }
      });

      py.stderr.on('data', () => {});

      req.on('close', () => {
        try { py.kill('SIGKILL'); } catch (e) {}
      });

      py.on('close', () => {
        setTimeout(() => { try { res.end(); } catch (e) {} }, 500);
      });
      return;
    }

    // 列出下载目录内容
    if (req.method === 'GET' && pathname.startsWith('/api/files')) {
      const hash = pathname.split('/')[3] || '';
      if (!/^[a-fA-F0-9]{40}$/.test(hash)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid hash' }));
        return;
      }
      const dir = path.join(DOWNLOAD_DIR, hash);
      if (!fs.existsSync(dir)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Directory not found' }));
        return;
      }
      const fileList = [];
      (function walk(r) {
        let entries;
        try { entries = fs.readdirSync(r, { withFileTypes: true }); }
        catch (e) { return; }
        for (const e of entries) {
          const fp = path.join(r, e.name);
          if (e.isDirectory()) walk(fp);
          else {
            try {
              const size = fs.statSync(fp).size;
              const rel = path.relative(dir, fp);
              fileList.push({ name: rel, size: size, url: '/download/' + hash + '/' + rel.replace(/\\/g, '/') });
            } catch (e) {}
          }
        }
      })(dir);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ files: fileList, dir: dir, hash: hash }, null, 2));
      return;
    }

    // 下载具体文件
    if (req.method === 'GET' && pathname.startsWith('/download/')) {
      const rest = pathname.substring('/download/'.length);
      const slashIdx = rest.indexOf('/');
      if (slashIdx < 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid path' }));
        return;
      }
      const hash = rest.substring(0, slashIdx);
      if (!/^[a-fA-F0-9]{40}$/.test(hash)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid hash' }));
        return;
      }
      const relPath = rest.substring(slashIdx + 1);
      const filePath = path.join(DOWNLOAD_DIR, hash, relPath);
      if (!filePath.startsWith(DOWNLOAD_DIR)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden' }));
        return;
      }
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File not found' }));
        return;
      }
      const stat = fs.statSync(filePath);
      const fname = path.basename(filePath);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': stat.size,
        'Content-Disposition': 'attachment; filename="' + fname + '"',
      });
      fs.createReadStream(filePath).pipe(res);
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

'use strict';

const http = require('http');
const service = require('./index.js');

const PORT = process.env.PORT || 3000;

const homePage = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>Magnet to Torrent</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 720px; margin: 40px auto; padding: 20px; background: #f5f5f7; color: #1d1d1f; }
    h1 { font-size: 28px; }
    input[type=text] { width: 100%; padding: 12px; font-size: 14px; border: 1px solid #d2d2d7; border-radius: 8px; margin-bottom: 12px; box-sizing: border-box; }
    button { padding: 10px 20px; font-size: 14px; background: #0071e3; color: #fff; border: none; border-radius: 8px; cursor: pointer; }
    button:hover { background: #0077ed; }
    #result { margin-top: 20px; padding: 16px; background: #fff; border-radius: 8px; min-height: 40px; word-break: break-all; border: 1px solid #e5e5ea; }
    .label { font-size: 13px; color: #6e6e73; margin-bottom: 6px; }
  </style>
</head>
<body>
  <h1>磁力链接转 Torrent 下载</h1>
  <div class="label">粘贴磁力链接或 info hash:</div>
  <input id="magnet" type="text" placeholder="magnet:?xt=urn:btih:...  或直接粘贴 40 位 hash" />
  <button onclick="convert()">转换</button>
  <div id="result">等待输入...</div>
  <script>
    async function convert() {
      const magnet = document.getElementById('magnet').value.trim();
      const result = document.getElementById('result');
      if (!magnet) { result.textContent = '请输入磁力链接'; return; }
      result.textContent = '转换中...';
      try {
        const res = await fetch('/convert?magnet=' + encodeURIComponent(magnet));
        const data = await res.json();
        if (data.success) {
          result.innerHTML = '成功:<br><a href="' + data.torrentUrl + '" target="_blank">' + data.torrentUrl + '</a>';
        } else {
          result.textContent = '失败: ' + data.error;
        }
      } catch (e) {
        result.textContent = '请求错误: ' + e.message;
      }
    }
  </script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'GET' && (req.url === '/' || req.url === '')) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.writeHead(200);
    res.end(homePage);
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/convert')) {
    const urlParts = new URL(req.url, 'http://localhost');
    const magnet = urlParts.searchParams.get('magnet');
    res.setHeader('Content-Type', 'application/json');

    if (!magnet) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Missing magnet parameter' }));
      return;
    }

    service.getLink(magnet)
      .then(torrentUrl => {
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, torrentUrl }));
      })
      .catch(err => {
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: err.message }));
      });
    return;
  }

  res.setHeader('Content-Type', 'application/json');
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}/`);
  console.log(`GET /convert?magnet=<magnet_uri>`);
});

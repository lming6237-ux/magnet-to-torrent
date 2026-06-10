'use strict';

const http = require('http');
const service = require('./index.js');

const PORT = process.env.PORT || 3000;

// 首页 - 基于 WebTorrent 的纯前端磁力转 torrent
const homePage = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>磁力链接转 Torrent 文件</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; margin: 0; padding: 30px 20px; background: #f6f8fa; color: #1f2328; }
    .container { max-width: 760px; margin: 0 auto; }
    h1 { font-size: 24px; margin-bottom: 8px; }
    .sub { color: #57606a; font-size: 14px; margin-bottom: 20px; }
    .card { background: #fff; border: 1px solid #d0d7de; border-radius: 8px; padding: 24px; }
    label { display: block; font-size: 13px; color: #424a53; margin-bottom: 6px; font-weight: 500; }
    input[type=text] { width: 100%; padding: 10px 12px; font-size: 14px; border: 1px solid #d0d7de; border-radius: 6px; margin-bottom: 12px; box-sizing: border-box; font-family: ui-monospace, monospace; }
    button { padding: 10px 20px; font-size: 14px; background: #2da44e; color: #fff; border: 1px solid rgba(27,31,36,0.15); border-radius: 6px; cursor: pointer; font-weight: 500; }
    button:hover:not(:disabled) { background: #2c974b; }
    button:disabled { background: #81b196; cursor: not-allowed; }
    .info { font-size: 13px; color: #6e7781; margin-bottom: 16px; }
    #result { margin-top: 20px; padding: 16px; background: #f6f8fa; border-radius: 6px; min-height: 40px; word-break: break-all; border: 1px solid #d0d7de; }
    .log { margin-top: 16px; padding: 12px; background: #0d1117; color: #8b949e; font-family: ui-monospace, monospace; font-size: 12px; border-radius: 6px; max-height: 220px; overflow-y: auto; }
    .log div { line-height: 1.6; }
    .log .ok { color: #3fb950; }
    .log .warn { color: #d29922; }
    .log .err { color: #f85149; }
    .file-info { margin-top: 16px; padding: 14px; background: #ddf4e1; border: 1px solid #2da44e; border-radius: 6px; font-size: 13px; }
    .file-info a { display: inline-block; margin-top: 8px; padding: 8px 14px; background: #2da44e; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 500; }
    a.link { color: #0969da; text-decoration: none; }
    a.link:hover { text-decoration: underline; }
    .examples { margin-top: 20px; font-size: 12px; color: #57606a; }
    .examples code { background: #eaeef2; padding: 2px 6px; border-radius: 4px; }
    .progress-bar { width: 100%; height: 6px; background: #d0d7de; border-radius: 3px; overflow: hidden; margin: 10px 0; }
    .progress-fill { height: 100%; background: #2da44e; width: 0%; transition: width 0.3s; }
  </style>
</head>
<body>
  <div class="container">
    <h1>磁力链接转 Torrent 文件</h1>
    <div class="sub">纯前端基于 <a href="https://webtorrent.io" class="link" target="_blank">WebTorrent</a> — 连接 torrent 网络获取元数据，无需后端服务</div>

    <div class="card">
      <label for="magnet">粘贴磁力链接或 info hash</label>
      <input id="magnet" type="text" placeholder="magnet:?xt=urn:btih:4A3F5E08BCEF825718EDA30637230585E3330599" />
      <button id="btn" onclick="convert()">开始转换</button>
      <div class="progress-bar" id="progressBar"><div class="progress-fill" id="progressFill"></div></div>

      <div class="examples">
        示例:
        <code>magnet:?xt=urn:btih:4A3F5E08BCEF825718EDA30637230585E3330599</code>
        或直接粘贴 40 位 hash:
        <code>4A3F5E08BCEF825718EDA30637230585E3330599</code>
      </div>

      <div id="result" style="display:none"></div>
      <div id="fileInfo" style="display:none"></div>
      <div class="log" id="log"></div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/webtorrent@latest/webtorrent.min.js"></script>
  <script>
    let client = null;

    function log(msg, type) {
      const el = document.getElementById('log');
      const line = document.createElement('div');
      if (type) line.className = type;
      const time = new Date().toTimeString().slice(0, 8);
      line.textContent = '[' + time + '] ' + msg;
      el.appendChild(line);
      el.scrollTop = el.scrollHeight;
    }

    function setProgress(pct) {
      document.getElementById('progressFill').style.width = Math.min(100, Math.max(0, pct)) + '%';
    }

    function parseMagnet(input) {
      input = input.trim();
      if (/^[a-fA-F0-9]{40}$/.test(input)) {
        return 'magnet:?xt=urn:btih:' + input.toLowerCase();
      }
      if (input.startsWith('magnet:')) return input;
      return null;
    }

    async function convert() {
      const raw = document.getElementById('magnet').value;
      const magnet = parseMagnet(raw);
      const btn = document.getElementById('btn');
      const resultEl = document.getElementById('result');
      const fileInfoEl = document.getElementById('fileInfo');

      resultEl.style.display = 'block';
      fileInfoEl.style.display = 'none';
      resultEl.textContent = '';
      setProgress(0);

      if (!magnet) {
        resultEl.textContent = '请输入有效的磁力链接或 40 位 info hash';
        log('invalid input', 'err');
        return;
      }

      btn.disabled = true;
      btn.textContent = '转换中...';

      if (!window.WebTorrent) {
        resultEl.textContent = '正在加载 WebTorrent 库，请稍候...';
        log('waiting for WebTorrent library...', 'warn');
        setTimeout(convert, 1000);
        return;
      }

      try {
        if (!client) {
          client = new WebTorrent({ dht: true, tracker: true, webSeeds: true });
          log('WebTorrent client initialized (DHT + trackers)', 'ok');
        }

        log('Looking up peers for: ' + magnet);
        const start = Date.now();

        const torrent = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Timeout after 60s - could not find any peers. This torrent may be inactive.'));
          }, 60000);

          client.add(magnet, { announce: [
            'wss://tracker.openwebtorrent.com',
            'wss://tracker.btorrent.xyz',
            'wss://tracker.files.fm:7073/announce',
            'udp://tracker.opentrackr.org:1337',
            'udp://tracker.openbittorrent.com:80',
            'udp://open.stealth.si:80/announce',
            'udp://tracker.torrent.eu.org:451/announce',
          ]}, (t) => {
            clearTimeout(timeout);
            resolve(t);
          });

          // Wire-level events for debug
          if (client.torrents.length > 0) {
            const t = client.torrents[client.torrents.length - 1];
            t.on('wire', (wire, addr) => {
              log('Connected to peer: ' + (addr || 'unknown') + ' (' + t.numPeers + ' total)');
            });
          }
        });

        const elapsed = Math.round((Date.now() - start) / 1000);
        log('Got metadata in ' + elapsed + 's | name: ' + torrent.name + ' | pieces: ' + torrent.pieces.length, 'ok');
        setProgress(100);

        const buf = torrent.torrentFile;
        log('Torrent file size: ' + (buf.length / 1024).toFixed(2) + ' KB', 'ok');

        // 创建下载链接
        const blob = new Blob([buf], { type: 'application/x-bittorrent' });
        const url = URL.createObjectURL(blob);
        const safeName = (torrent.name || 'torrent').replace(/[\/\\:*?"<>|]/g, '_').slice(0, 120);

        resultEl.innerHTML = '<strong style="color:#2da44e">✓ 转换成功</strong>';
        fileInfoEl.style.display = 'block';
        fileInfoEl.className = 'file-info';
        let info = '<strong>' + safeName + '</strong>';
        info += '<br>文件数: ' + torrent.files.length + ' | 总大小: ' + formatBytes(torrent.length) + ' | 分片数: ' + torrent.pieces.length;
        if (torrent.infoHash) info += '<br>info hash: <code>' + torrent.infoHash + '</code>';
        info += '<br><a href="' + url + '" download="' + safeName + '.torrent">⬇ 下载 .torrent 文件</a>';
        fileInfoEl.innerHTML = info;

      } catch (err) {
        log('Error: ' + err.message, 'err');
        resultEl.innerHTML = '<strong style="color:#d1242f">✗ 转换失败</strong><br><span style="color:#57606a">' + err.message + '</span><br><br><em>提示: 小种子/无种子的磁力链接可能找不到任何 peer。请试试其他热门资源。</em>';
        setProgress(0);
      } finally {
        btn.disabled = false;
        btn.textContent = '开始转换';
      }
    }

    function formatBytes(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
      if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB';
      return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
    }

    document.getElementById('magnet').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') convert();
    });
  </script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'GET' && (req.url === '/' || req.url === '' || req.url.startsWith('/?'))) {
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

  // 兼容旧 API - 后端转换，但后端网络受限，不推荐使用
  // 返回帮助信息提示用户用前端
  if (req.method === 'GET' && req.url.startsWith('/convert')) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.writeHead(200);
    res.end(`
      <!DOCTYPE html><html><head><meta charset="UTF-8"><title>提示</title></head>
      <body style="font-family:sans-serif;padding:30px;max-width:600px;margin:0 auto">
      <h2>请使用前端界面</h2>
      <p>由于服务器网络环境限制，无法从 tracker/DHT 获取 peers。请回到 <a href="/">首页</a> 在浏览器中进行转换。</p>
      <p>浏览器拥有完整的网络访问权限，可以通过 WebTorrent (WebRTC DHT + WebSocket trackers) 直接连接 peer 获取元数据。</p>
      </body></html>
    `);
    return;
  }

  res.setHeader('Content-Type', 'application/json');
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Server running at http://0.0.0.0:' + PORT + '/');
});

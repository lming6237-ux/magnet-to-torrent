const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
  if (req.url === '/') {
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Magnet to Torrent</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; line-height: 1.6; color: #333; }
    h1 { color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 10px; }
    .card { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    code { background: #e9ecef; padding: 4px 8px; border-radius: 4px; font-family: 'Courier New', monospace; }
    pre { background: #2c3e50; color: #ecf0f1; padding: 15px; border-radius: 8px; overflow-x: auto; }
    button { background: #3498db; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-size: 16px; }
    button:hover { background: #2980b9; }
    input { width: 100%; padding: 10px; font-size: 14px; border: 2px solid #ddd; border-radius: 4px; box-sizing: border-box; }
    input:focus { outline: none; border-color: #3498db; }
    .result { margin-top: 15px; padding: 15px; background: #d4edda; border-left: 4px solid #28a745; border-radius: 4px; word-break: break-all; }
    .error { background: #f8d7da; border-left-color: #dc3545; }
  </style>
</head>
<body>
  <h1>🧲 Magnet to Torrent</h1>
  <p>将磁力链接转换为种子文件下载链接</p>

  <div class="card">
    <h3>安装</h3>
    <pre>npm install magnet-to-torrent</pre>
  </div>

  <div class="card">
    <h3>使用示例</h3>
    <pre>const magnetToTorrent = require('magnet-to-torrent');

magnetToTorrent.getLink('magnet:?xt=urn:btih:...')
  .then(url => console.log(url))
  .catch(err => console.error(err));</pre>
  </div>

  <div class="card">
    <h3>🔧 在线测试</h3>
    <p style="color: #666; font-size: 14px;">
      💡 提示：Info Hash 必须是 <strong>40 个十六进制字符</strong>（0-9, A-F）或 <strong>32 个 Base32 字符</strong>。
    </p>
    <label>磁力链接或 Info Hash:</label><br><br>
    <input type="text" id="magnetInput" placeholder="magnet:?xt=urn:btih:40个字符..." /><br><br>
    <button onclick="convert()">转换</button>
    <button onclick="fillExample()" style="background:#6c757d; margin-left: 10px;">填充示例</button>
    <div id="result" style="margin-top: 20px;"></div>
  </div>

  <div class="card">
    <h3>📦 项目信息</h3>
    <p><strong>版本:</strong> 1.0.8</p>
    <p><strong>许可证:</strong> MIT</p>
    <p><strong>作者:</strong> Layton Whiteley</p>
    <p><strong>仓库:</strong> <a href="https://github.com/lwhiteley/magnet-to-torrent" target="_blank">GitHub</a></p>
  </div>

  <script>
    function fillExample() {
      document.getElementById('magnetInput').value = 'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10';
    }
    async function convert() {
      const input = document.getElementById('magnetInput').value.trim();
      const result = document.getElementById('result');
      if (!input) {
        result.innerHTML = '<div class="result error">请输入磁力链接或 info hash</div>';
        return;
      }
      result.innerHTML = '<div class="result">正在转换（可能需要数秒查询服务）...</div>';
      try {
        const res = await fetch('/api/convert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ magnet: input })
        });
        const data = await res.json();
        if (data.url) {
          result.innerHTML = '<div class="result"><strong>✅ 成功！下载链接:</strong><br><a href="' + data.url + '" target="_blank">' + data.url + '</a></div>';
        } else {
          let msg = data.error || '转换失败';
          if (msg.includes('Invalid magnet') || msg.includes('Invalid magnet uri')) {
            msg = '❌ Info Hash 格式不正确。必须是 40 个十六进制字符（0-9, A-F）或 32 个 Base32 字符。您输入的长度不够。';
          } else if (msg.includes('All services tried')) {
            msg = '❌ 所有转换服务均未找到该种子。该种子可能较新或已失效，公共缓存服务中暂无收录。';
          }
          result.innerHTML = '<div class="result error">' + msg + '</div>';
        }
      } catch (e) {
        result.innerHTML = '<div class="result error">请求失败: ' + (e.message || '网络异常') + '</div>';
      }
    }
  </script>
</body>
</html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } else if (req.url === '/api/convert' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { magnet } = JSON.parse(body);
        const magnetToTorrent = require('./index.js');
        const url = await magnetToTorrent.getLink(magnet);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ url }));
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('Server running on port ' + PORT);
});

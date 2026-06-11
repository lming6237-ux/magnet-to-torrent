const express = require('express');
const magnetToTorrent = require('./index');

const app = express();
const port = 3000;

app.use(express.json());

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Magnet to Torrent Converter</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          max-width: 800px;
          margin: 0 auto;
          padding: 40px 20px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          box-sizing: border-box;
        }
        .container {
          background: white;
          border-radius: 16px;
          padding: 40px;
          box-shadow: 0 10px 40px rgba(0,0,0,0.2);
        }
        h1 {
          color: #333;
          text-align: center;
          margin-bottom: 30px;
          font-size: 28px;
        }
        .input-group {
          margin-bottom: 20px;
        }
        label {
          display: block;
          margin-bottom: 8px;
          color: #555;
          font-weight: bold;
        }
        input[type="text"] {
          width: 100%;
          padding: 15px;
          font-size: 16px;
          border: 2px solid #ddd;
          border-radius: 8px;
          box-sizing: border-box;
          transition: border-color 0.3s;
        }
        input[type="text"]:focus {
          outline: none;
          border-color: #667eea;
        }
        button {
          width: 100%;
          padding: 15px;
          font-size: 18px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: transform 0.2s, box-shadow 0.2s;
        }
        button:hover {
          transform: translateY(-2px);
          box-shadow: 0 5px 20px rgba(102, 126, 234, 0.4);
        }
        button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }
        .result {
          margin-top: 30px;
          padding: 20px;
          border-radius: 8px;
          display: none;
        }
        .result.success {
          background: #d4edda;
          border: 1px solid #c3e6cb;
          color: #155724;
        }
        .result.error {
          background: #f8d7da;
          border: 1px solid #f5c6cb;
          color: #721c24;
        }
        .result a {
          color: #667eea;
          word-break: break-all;
        }
        .loading {
          display: inline-block;
          width: 20px;
          height: 20px;
          border: 3px solid #f3f3f3;
          border-top: 3px solid #667eea;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🔗 Magnet to Torrent Converter</h1>
        <div class="input-group">
          <label for="magnetLink">输入磁力链接:</label>
          <input type="text" id="magnetLink" placeholder="magnet:?xt=urn:btih:..." />
        </div>
        <button id="convertBtn" onclick="convertMagnet()">
          <span id="btnText">转换为种子链接</span>
          <span id="btnLoader" class="loading" style="display:none"></span>
        </button>
        <div id="result" class="result"></div>
      </div>
      <script>
        async function convertMagnet() {
          const magnet = document.getElementById('magnetLink').value.trim();
          const btn = document.getElementById('convertBtn');
          const btnText = document.getElementById('btnText');
          const btnLoader = document.getElementById('btnLoader');
          const result = document.getElementById('result');
          
          if (!magnet) {
            showResult('请输入磁力链接', 'error');
            return;
          }
          
          btn.disabled = true;
          btnText.style.display = 'none';
          btnLoader.style.display = 'inline-block';
          result.style.display = 'none';
          
          try {
            const response = await fetch('/convert?magnet=' + encodeURIComponent(magnet));
            const data = await response.json();
            
            if (data.success) {
              showResult('转换成功！<br>种子链接: <a href="' + data.torrentUrl + '" target="_blank">' + data.torrentUrl + '</a>', 'success');
            } else {
              showResult('转换失败: ' + data.error, 'error');
            }
          } catch (error) {
            showResult('网络错误: ' + error.message, 'error');
          } finally {
            btn.disabled = false;
            btnText.style.display = 'inline';
            btnLoader.style.display = 'none';
          }
        }
        
        function showResult(message, type) {
          const result = document.getElementById('result');
          result.innerHTML = message;
          result.className = 'result ' + type;
          result.style.display = 'block';
        }
      </script>
    </body>
    </html>
  `);
});

app.get('/convert', async (req, res) => {
  const { magnet } = req.query;
  
  if (!magnet) {
    return res.status(400).json({ error: 'Missing magnet parameter' });
  }

  try {
    const torrentUrl = await magnetToTorrent.getLink(magnet);
    res.json({ success: true, torrentUrl });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${port}`);
});
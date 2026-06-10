// 简单的 WebSocket 反向隧道 - 通过 HTTP 代理连接到远程 WebSocket 服务器
// 使用 piesocket 提供的免费 WebSocket 服务做简单的反向代理

const http = require('http');
const WebSocket = require('ws');
const { HttpsProxyAgent } = require('https-proxy-agent');
const crypto = require('crypto');

const PROXY = 'http://127.0.0.1:18080';
const LOCAL_HOST = '127.0.0.1';
const LOCAL_PORT = 3000;

// 用一个唯一的通道ID
const TUNNEL_ID = 'm2t_' + crypto.randomBytes(8).toString('hex');
console.log('隧道ID:', TUNNEL_ID);

const agent = new HttpsProxyAgent(PROXY);

// 先尝试连接到 pinggy.io 的 WebSocket 隧道服务
// pinggy.io 实际上有一个 WebSocket API，可以做同样的隧道
// 但我们用更简单的方案：用一个自定义的 WebSocket 服务器做转发

// 由于没有自己的公网服务器，我们用下面的方案：
// 方案：用 localtunnel 的 WebSocket API，但确保通过代理

async function tryPinggyWebsocket() {
  return new Promise((resolve, reject) => {
    // pinggy.io 支持 WebSocket 隧道
    const urls = [
      'wss://a.pinggy.io:443/ws',
      'wss://a.pinggy.io:443/',
      'wss://pinggy.io/ws',
    ];

    let tried = 0;
    for (const url of urls) {
      tried++;
      try {
        console.log('尝试:', url);
        const ws = new WebSocket(url, {
          agent,
          handshakeTimeout: 10000,
          followRedirects: true,
          headers: {
            'User-Agent': 'Mozilla/5.0',
          },
        });

        await new Promise((res, rej) => {
          const t = setTimeout(() => { try { ws.close(); } catch(e){} rej(new Error('timeout')); }, 12000);
          ws.on('open', () => { clearTimeout(t); console.log('  ✓ 连接成功'); ws.close(); res(); });
          ws.on('error', (e) => { clearTimeout(t); console.log('  ✗ 错误:', e.message.substring(0, 50)); rej(e); });
          ws.on('message', (d) => console.log('  消息:', d.toString().substring(0, 80)));
          ws.on('unexpected-response', (req, res) => { clearTimeout(t); console.log('  HTTP', res.statusCode); rej(new Error('HTTP ' + res.statusCode)); });
        });
        resolve(url);
        return;
      } catch(e) {
        console.log('  失败');
        continue;
      }
    }
    reject(new Error('所有 WebSocket 端点都失败'));
  });
}

// 启动 localtunnel 并保持
async function startLocaltunnel() {
  const localtunnel = require('localtunnel');

  console.log('\n=== 启动 localtunnel ===\n');
  const tunnel = await localtunnel({
    port: 3000,
    host: 'http://localtunnel.me',
  });

  console.log('========================================');
  console.log('✓ localtunnel 已建立!');
  console.log('✓ 公网 URL: ' + tunnel.url);
  console.log('========================================');
  console.log('\n手机浏览器打开上面的 HTTPS 地址即可!');
  console.log('\n测试:');
  console.log('  curl ' + tunnel.url + '/health');
  console.log('  curl "' + tunnel.url + '/api/torrent?hash=4A3F5E08BCEF825718EDA30637230585E3330599" -o test.torrent');
  console.log('========================================\n');

  tunnel.on('error', (err) => {
    console.log('[隧道错误]', err.message);
  });

  tunnel.on('close', () => {
    console.log('[隧道关闭, 3秒后重连...]');
    setTimeout(startLocaltunnel, 3000);
  });

  // 每分钟检查一次
  setInterval(() => {
    const now = new Date();
    console.log('[' + now.toLocaleString('zh-CN') + '] 隧道运行中...');
  }, 120000);
}

// 主函数
async function main() {
  console.log('=== 反向隧道启动器 ===\n');
  console.log('本地服务: http://' + LOCAL_HOST + ':' + LOCAL_PORT);
  console.log('使用代理:', PROXY);
  console.log('');

  try {
    await startLocaltunnel();
  } catch(e) {
    console.error('\n启动失败:', e.message);
    process.exit(1);
  }
}

main().catch(console.error);

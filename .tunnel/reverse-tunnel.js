// 简单反向隧道：通过 HTTP 代理连接到远程隧道服务，反向代理请求到本地 3000
// 方案: 使用一个自定义基于HTTP的隧道，先建立从本地3000到公网的长连接

const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const { HttpsProxyAgent } = require('https-proxy-agent');

const PROXY = 'http://127.0.0.1:18080';
const LOCAL = 'http://127.0.0.1:3000';
const TUNNEL_SERVERS = [
  'wss://free.blr2.piesocket.com',
  'wss://free.nyc3.piesocket.com',
  'wss://free.sgp1.piesocket.com',
];

const agent = new HttpsProxyAgent(PROXY);

console.log('=== 测试可用的隧道服务 ===\n');

function proxyLocalRequest(reqData) {
  return new Promise((resolve) => {
    try {
      const req = http.request(LOCAL, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('base64')
          });
        });
      });
      req.on('error', (e) => resolve({ status: 502, headers: {}, body: Buffer.from(e.message).toString('base64') }));
      req.setTimeout(30000, () => { req.destroy(); resolve({ status: 504, headers: {}, body: Buffer.from('timeout').toString('base64') }); });
      if (reqData.body) req.write(Buffer.from(reqData.body, 'base64'));
      req.end();
    } catch(e) {
      resolve({ status: 500, headers: {}, body: Buffer.from(e.message).toString('base64') });
    }
  });
}

async function testAndConnect() {
  for (const server of TUNNEL_SERVERS) {
    console.log('测试:', server);
    try {
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(server + '/v3/tunnel?api_key=free', { agent, handshakeTimeout: 15000, followRedirects: true });
        const t = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 20000);
        ws.on('open', () => { clearTimeout(t); console.log('  ✓ 连接成功'); ws.close(); resolve(); });
        ws.on('error', (e) => { clearTimeout(t); console.log('  ✗:', e.message); reject(e); });
        ws.on('unexpected-response', (req, res) => { clearTimeout(t); console.log('  HTTP', res.statusCode); reject(new Error('HTTP ' + res.statusCode)); });
        ws.on('message', (d) => { console.log('  消息:', d.toString().substring(0, 100)); });
      });
      console.log('\n✓ 隧道服务可用:', server);
      return server;
    } catch(e) {
      continue;
    }
  }
  throw new Error('没有可用的隧道服务');
}

async function main() {
  const server = await testAndConnect();
  console.log('\n=== 建立反向隧道 ===\n');
  
  let tunnelUrl = '';
  const pendingRequests = new Map();
  let requestId = 0;
  
  function connect() {
    const ws = new WebSocket(server + '/v3/tunnel?api_key=free', { agent, handshakeTimeout: 30000, followRedirects: true });
    
    ws.on('open', () => {
      console.log('✓ WebSocket 已连接');
      ws.send(JSON.stringify({ type: 'register', service: 'torrent' }));
    });
    
    ws.on('message', async (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch(e) { return; }
      
      if (msg.type === 'url') {
        tunnelUrl = msg.url;
        console.log('\n========================================');
        console.log('✓ 公网 URL:', tunnelUrl);
        console.log('========================================\n');
        console.log('测试命令:');
        console.log('  curl ' + tunnelUrl + '/health');
        console.log('  curl "' + tunnelUrl + '/api/torrent?hash=4A3F5E08BCEF825718EDA30637230585E3330599" -o test.torrent');
        console.log('\n========================================\n');
        return;
      }
      
      if (msg.type === 'request') {
        const reqId = msg.id;
        console.log('[' + new Date().toISOString().substring(11, 19) + ']', msg.method, msg.path);
        try {
          const response = await proxyLocalRequest({
            method: msg.method,
            path: msg.path,
            headers: msg.headers,
            body: msg.body
          });
          ws.send(JSON.stringify({ type: 'response', id: reqId, ...response }));
        } catch(e) {
          ws.send(JSON.stringify({ type: 'response', id: reqId, status: 500, headers: {}, body: Buffer.from(e.message).toString('base64') }));
        }
      }
    });
    
    ws.on('error', (e) => console.error('WebSocket错误:', e.message));
    ws.on('close', () => { console.log('WebSocket断开，5秒后重连...'); setTimeout(connect, 5000); });
  }
  
  connect();
}

main().catch((e) => { console.error('启动失败:', e.message); process.exit(1); });
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { URL } = require('url');

const PROXY_URL = 'http://127.0.0.1:18080';
const LOCAL_SERVER = 'http://127.0.0.1:3000';

async function findWorkingTunnel() {
  const candidates = [
    { name: 'wss://srv.us/', follow: true },
    { name: 'wss://tunnel.pyjam.as/ws', follow: false },
    { name: 'wss://ws.postman-echo.com/raw', follow: false },
  ];
  
  const agent = new HttpsProxyAgent(PROXY_URL);
  
  for (const c of candidates) {
    console.log(`\n测试 ${c.name}...`);
    try {
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(c.name, { agent, handshakeTimeout: 15000, followRedirects: true });
        const t = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 15000);
        ws.on('open', () => { clearTimeout(t); console.log('  ✓ 连接成功'); ws.close(); resolve(); });
        ws.on('error', (e) => { clearTimeout(t); console.log('  ✗ 错误:', e.message); reject(e); });
        ws.on('close', () => { clearTimeout(t); reject(new Error('closed')); });
        ws.on('message', (d) => console.log('  消息:', d.toString().substring(0, 100)));
      });
      return c.name;
    } catch(e) {
      console.log('  ✗ 失败:', e.message);
      continue;
    }
  }
  throw new Error('没有可用的隧道服务');
}

async function main() {
  try {
    const server = await findWorkingTunnel();
    console.log('\n使用隧道服务:', server);
    
    // 建立实际的隧道连接并转发请求
    const agent = new HttpsProxyAgent(PROXY_URL);
    const ws = new WebSocket(server, { agent, handshakeTimeout: 30000, followRedirects: true });
    
    ws.on('open', () => {
      console.log('✓ 隧道已建立');
    });
    
    ws.on('message', (data) => {
      const msg = data.toString();
      console.log('收到:', msg.substring(0, 200));
      
      // 这是一个简化的HTTP-over-WS隧道
      // 需要根据实际服务调整
    });
    
    ws.on('error', (e) => console.error('错误:', e.message));
    ws.on('close', () => { console.log('断开，5秒后重连...'); setTimeout(main, 5000); });
  } catch(e) {
    console.error('启动失败:', e.message);
    process.exit(1);
  }
}

main().catch(console.error);
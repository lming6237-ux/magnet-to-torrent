const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const { HttpsProxyAgent } = require('https-proxy-agent');

const PROXY_URL = 'http://127.0.0.1:18080';
const TUNNEL_SERVER = 'wss://srv.us/';
const LOCAL_SERVER = 'http://127.0.0.1:3000';

const agent = new HttpsProxyAgent(PROXY_URL);

console.log('正在连接 srv.us WebSocket 隧道...');

const ws = new WebSocket(TUNNEL_SERVER, {
  agent: agent,
  handshakeTimeout: 30000,
});

ws.on('open', () => {
  console.log('WebSocket 已连接到 srv.us');
});

ws.on('message', (data) => {
  const msg = data.toString();
  console.log('收到消息:', msg.substring(0, 200));
  
  // srv.us 会先发送分配的URL
  // 之后会转发 HTTP 请求
});

ws.on('error', (err) => {
  console.error('WebSocket 错误:', err.message);
});

ws.on('close', () => {
  console.log('WebSocket 已断开');
  setTimeout(() => process.exit(1), 3000);
});
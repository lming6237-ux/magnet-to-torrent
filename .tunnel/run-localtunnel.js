const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const { HttpsProxyAgent } = require('https-proxy-agent');

const PROXY = 'http://127.0.0.1:18080';
const LOCAL_PORT = 3000;

async function requestTunnel() {
  return new Promise((resolve, reject) => {
    const agent = new HttpsProxyAgent(PROXY);
    const opts = {
      hostname: 'loca.lt',
      port: 443,
      path: '/?new',
      method: 'GET',
      agent: agent,
      headers: { 'User-Agent': 'curl/8.0' }
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch(e) { reject(new Error('bad JSON: ' + data)); }
      });
    });
    req.on('error', reject);
    req.end();
    setTimeout(() => reject(new Error('timeout')), 15000);
  });
}

function proxyLocalRequest(clientReq, clientRes) {
  const opts = {
    hostname: '127.0.0.1',
    port: LOCAL_PORT,
    path: clientReq.url,
    method: clientReq.method,
    headers: clientReq.headers,
  };
  delete opts.headers['host'];
  const proxy = http.request(opts, (upstream) => {
    clientRes.writeHead(upstream.statusCode, upstream.headers);
    upstream.pipe(clientRes);
  });
  proxy.on('error', (e) => {
    try { clientRes.writeHead(502, { 'Content-Type': 'text/plain' }); clientRes.end('Bad Gateway: ' + e.message); } catch(_) {}
  });
  clientReq.pipe(proxy);
}

async function main() {
  const info = await requestTunnel();
  console.log('=== PUBLIC URL ===');
  console.log(info.url);
  console.log('ID:', info.id, 'PORT:', info.port);
  console.log('==================');

  // 每隔一段时间再打印一次，便于查找
  setInterval(() => {
    console.log('URL:', info.url);
  }, 20000);

  // 建立 WebSocket 连接（通过代理）
  const agent = new HttpsProxyAgent(PROXY);
  const wsUrl = 'https://loca.lt:' + info.port;
  const ws = new WebSocket(wsUrl, { agent: agent, headers: { 'User-Agent': 'tunnel-client' } });

  // 每个 WebSocket 消息是一个请求 ID:method:path:headers JSON
  // loca.lt 协议: 先发 {"id": info.id} JSON
  ws.on('open', () => {
    console.log('Tunnel connected');
    ws.send(JSON.stringify({ id: info.id }));
  });

  // 解析请求并转发到本地
  const pendingRequests = new Map();

  ws.on('message', (data) => {
    const msg = data.toString();
    // loca.lt 协议: 第一行是 HTTP 请求头，后面是 body
    // 格式类似: "GET / HTTP/1.1\r\nHost: ...\r\n..."
    const headerEnd = msg.indexOf('\r\n\r\n');
    if (headerEnd >= 0) {
      const headerPart = msg.substring(0, headerEnd);
      const lines = headerPart.split('\r\n');
      const firstLine = lines[0]; // "GET / HTTP/1.1"
      const parts = firstLine.split(' ');
      const method = parts[0];
      const path = parts[1];
      
      // 解析 headers
      const headers = {};
      for (let i = 1; i < lines.length; i++) {
        const idx = lines[i].indexOf(':');
        if (idx > 0) {
          const k = lines[i].substring(0, idx).trim().toLowerCase();
          const v = lines[i].substring(idx + 1).trim();
          headers[k] = v;
        }
      }
      
      // 用 HTTP 代理到本地
      const reqId = Math.random().toString(36).substring(2);
      const opts = {
        hostname: '127.0.0.1',
        port: LOCAL_PORT,
        path: path,
        method: method,
        headers: headers,
      };
      
      const proxy = http.request(opts, (upstream) => {
        let responseStr = 'HTTP/1.1 ' + upstream.statusCode + ' \r\n';
        for (const [k, v] of Object.entries(upstream.headers)) {
          responseStr += k + ': ' + v + '\r\n';
        }
        responseStr += '\r\n';
        ws.send(responseStr);
        
        upstream.on('data', (chunk) => { try { ws.send(chunk); } catch(e) {} });
        upstream.on('end', () => {});
      });
      
      proxy.on('error', (e) => {
        try {
          ws.send('HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\nContent-Length: ' + e.message.length + '\r\n\r\n' + e.message);
        } catch(_) {}
      });
      
      // 如果有请求 body，剩余部分就是请求体
      if (headerEnd + 4 < msg.length) {
        proxy.write(msg.substring(headerEnd + 4));
      }
      proxy.end();
    }
  });

  ws.on('error', (err) => {
    console.error('Tunnel error:', err.message);
  });

  ws.on('close', () => {
    console.log('Tunnel closed - reconnecting in 3s...');
    setTimeout(main, 3000);
  });
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });

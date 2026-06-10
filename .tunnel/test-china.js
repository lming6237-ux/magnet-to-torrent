const http = require('http');
const https = require('https');

function testConnect(host, port) {
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1', port: 18080, method: 'CONNECT', path: host + ':' + port,
    });
    req.on('connect', (res, socket) => {
      socket.destroy();
      resolve({ ok: res.statusCode === 200, host, port, statusCode: res.statusCode });
    });
    req.on('error', (e) => resolve({ ok: false, host, port, error: e.message }));
    req.end();
    setTimeout(() => resolve({ ok: false, host, port, error: 'timeout' }), 8000);
  });
}

function testHttp(urlStr) {
  return new Promise((resolve) => {
    try {
      const u = new URL(urlStr);
      const opts = {
        host: u.hostname, port: u.port || 443, path: u.pathname, method: 'HEAD',
        headers: { 'User-Agent': 'Mozilla/5.0' },
      };
      const req = https.request({ ...opts, agent: new (require('https-proxy-agent')).HttpsProxyAgent('http://127.0.0.1:18080') }, (res) => {
        resolve({ ok: res.statusCode, url: urlStr });
        res.destroy();
      });
      req.on('error', (e) => resolve({ ok: false, url: urlStr, error: e.message }));
      req.end();
      setTimeout(() => resolve({ ok: false, url: urlStr, error: 'timeout' }), 12000);
    } catch(e) {
      resolve({ ok: false, url: urlStr, error: e.message });
    }
  });
}

(async () => {
  console.log('--- SSH / TCP 隧道测试:');
  const sshTargets = [
    ['serveo.net', 443],
    ['a.pinggy.io', 443],
    ['ssh.ngrok.cn', 443],
    ['tunnel.cpolar.cn', 443],
    ['free-ssh.bingyan.com', 443],
    ['cf-cn1.frp.net.cn', 7000],
    ['hk.frp.live', 7000],
    ['127.0.0.1', 22],
    ['sshtunnel.cn', 443],
    ['tunnel.jinhuobao.com.cn', 443],
  ];
  for (const [host, port] of sshTargets) {
    const r = await testConnect(host, port);
    const icon = r.ok ? '✓' : '✗';
    console.log('  ' + icon + '  ' + (host + ':' + port).padEnd(35), r.statusCode || r.error);
  }

  console.log('');
  console.log('--- 国内 HTTP 服务测试:');
  const httpTargets = [
    'https://www.cpolar.com',
    'https://www.natfrp.com',
    'https://www.fastnat.com',
    'https://gofrp.org',
    'https://www.aliyun.com',
    'https://gitee.com',
    'https://github.com',
    'https://pinggy.io',
    'https://serveo.net',
    'https://ngrok.com',
  ];
  for (const url of httpTargets) {
    const r = await testHttp(url);
    const icon = r.ok === 200 || r.ok === 301 || r.ok === 302 ? '✓' : '✗';
    console.log('  ' + icon + '  ' + url.padEnd(35), 'HTTP', r.ok);
  }
})();

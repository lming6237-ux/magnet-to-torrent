const { spawn } = require('child_process');

const PROXY_HOST = '127.0.0.1';
const PROXY_PORT = 18080;

console.log('=== 建立 serveo.net SSH 反向隧道 (通过代理) ===\n');

const ssh = spawn('ssh', [
  '-T',
  '-N',
  '-v',
  '-o', 'StrictHostKeyChecking=no',
  '-o', 'UserKnownHostsFile=/dev/null',
  '-o', 'ServerAliveInterval=30',
  '-o', 'ProxyCommand=nc -X connect -x ' + PROXY_HOST + ':' + PROXY_PORT + ' %h %p',
  '-p', '443',
  '-R', '80:localhost:3000',
  'serveo.net',
]);

let buffer = '';
let urlFound = false;

ssh.stdout.on('data', (data) => {
  const text = data.toString();
  process.stdout.write(text);
  buffer += text;

  if (!urlFound) {
    // serveo 输出如 "Forwarding HTTP traffic from https://xxx.serveo.net"
    const match = text.match(/(https?:\/\/[a-z0-9\-\.]+\.serveo\.[a-z]+)/i);
    if (match) {
      urlFound = true;
      console.log('\n========================================');
      console.log('✓ 公网 URL: ' + match[1]);
      console.log('========================================\n');
    }
  }
});

ssh.stderr.on('data', (data) => {
  const text = data.toString();
  process.stderr.write(text);

  if (!urlFound) {
    const match = text.match(/(https?:\/\/[a-z0-9\-\.]+\.serveo\.[a-z]+)/i);
    if (match) {
      urlFound = true;
      console.log('\n========================================');
      console.log('✓ 公网 URL: ' + match[1]);
      console.log('========================================\n');
    }
  }
});

ssh.on('close', (code) => {
  console.log('SSH 进程退出, code:', code);
  process.exit(code || 0);
});

ssh.on('error', (err) => {
  console.error('SSH 错误:', err.message);
  process.exit(1);
});

setTimeout(() => {
  if (!urlFound) {
    console.log('\n[15秒超时] 未获取到 URL, 可能连接未成功');
    console.log('[提示] 尝试访问 http://localhost:3000/health 确认本地服务正常');
  }
}, 15000);

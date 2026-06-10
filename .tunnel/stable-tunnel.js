const { spawn } = require('child_process');

function startTunnel() {
  console.log('[' + new Date().toLocaleString('zh-CN') + '] 正在建立 pinggy.io 反向隧道...');

  const ssh = spawn('ssh', [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'ProxyCommand=nc -X connect -x 127.0.0.1:18080 %h %p',
    '-p', '443',
    '-R', '0:localhost:3000',
    'a.pinggy.io',
  ]);

  let urlFound = false;

  function checkUrl(text) {
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.startsWith('http://') || line.startsWith('https://')) {
        if (!urlFound) {
          urlFound = true;
          console.log('\n========================================');
          console.log('✓ 公网 URL:');
        }
        console.log('  • ' + line.trim());
      }
    }
  }

  ssh.stdout.on('data', (d) => {
    const t = d.toString();
    process.stdout.write(t);
    checkUrl(t);
    if (urlFound) {
      console.log('========================================');
      console.log('\n手机浏览器打开上面的 HTTPS 地址即可!');
      console.log('========================================\n');
      urlFound = 'done';
    }
  });

  ssh.stderr.on('data', (d) => {
    process.stderr.write(d);
  });

  ssh.on('close', (code) => {
    console.log('\nSSH 进程退出 code: ' + code + ', 5秒后重连...');
    setTimeout(startTunnel, 5000);
  });

  ssh.on('error', (err) => console.error('SSH 错误:', err.message));
}

startTunnel();

setInterval(() => {
  console.log('[' + new Date().toLocaleString('zh-CN') + '] 隧道运行中...');
}, 60000);

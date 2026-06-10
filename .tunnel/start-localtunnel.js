const localtunnel = require('localtunnel');

process.env.HTTPS_PROXY = 'http://127.0.0.1:18080';
process.env.HTTP_PROXY = 'http://127.0.0.1:18080';

(async () => {
  try {
    console.log('正在通过代理建立 localtunnel (localtunnel.me)...\n');
    const tunnel = await localtunnel({
      port: 3000,
      host: 'http://localtunnel.me',
      subdomain: 'magnet2torrent-' + Date.now(),
    });

    console.log('========================================');
    console.log('✓ 隧道已建立!');
    console.log('✓ 公网 URL: ' + tunnel.url);
    console.log('========================================');
    console.log('\n测试命令:');
    console.log('  curl ' + tunnel.url + '/health');
    console.log('  curl "' + tunnel.url + '/api/torrent?hash=4A3F5E08BCEF825718EDA30637230585E3330599" -o test.torrent');
    console.log('\n========================================\n');

    // 验证连通性
    setTimeout(async () => {
      try {
        const http = require('http');
        const req = http.get(tunnel.url + '/health', (res) => {
          console.log('[验证] /health HTTP ' + res.statusCode);
        });
        req.on('error', (e) => console.log('[验证] 错误: ' + e.message));
      } catch(e) { console.log('[验证] 异常: ' + e.message); }
    }, 3000);

    tunnel.on('error', (err) => {
      console.error('\n[隧道错误]', err.message);
    });

    tunnel.on('close', () => {
      console.log('\n[隧道关闭]');
      process.exit(0);
    });

    // 30分钟自动重连
    setInterval(() => {
      console.log('[' + new Date().toLocaleTimeString('zh-CN') + '] 隧道仍在运行...');
    }, 60000);

  } catch (err) {
    console.error('\n启动失败:', err.message);
    console.error('错误详情:', err.message);
    process.exit(1);
  }
})();

const localtunnel = require('localtunnel');

// 配置通过HTTP代理连接
process.env.HTTPS_PROXY = 'http://127.0.0.1:18080';
process.env.HTTP_PROXY = 'http://127.0.0.1:18080';

(async () => {
  try {
    console.log('启动 localtunnel，连接到本地 3000 端口...');
    console.log('使用代理:', process.env.HTTPS_PROXY);
    
    const tunnel = await localtunnel({
      port: 3000,
      host: 'http://localtunnel.me',
    });
    
    console.log('');
    console.log('✓ 隧道已建立!');
    console.log('✓ 公网 URL:', tunnel.url);
    console.log('');
    console.log('测试命令:');
    console.log('  curl ' + tunnel.url + '/health');
    console.log('  curl "' + tunnel.url + '/api/torrent?hash=4A3F5E08BCEF825718EDA30637230585E3330599" -o test.torrent');
    console.log('');
    console.log('按 Ctrl+C 退出');
    
    tunnel.on('error', (err) => {
      console.error('隧道错误:', err.message);
    });
    
    tunnel.on('close', () => {
      console.log('隧道已关闭');
      process.exit(0);
    });
    
    // 定期打印URL
    setInterval(() => {
      console.log('[' + new Date().toISOString().substring(11, 19) + '] URL:', tunnel.url);
    }, 30000);
    
  } catch (err) {
    console.error('启动失败:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
})();
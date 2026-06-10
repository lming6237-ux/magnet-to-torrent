const localtunnel = require('localtunnel');

process.env.HTTPS_PROXY = 'http://127.0.0.1:18080';
process.env.HTTP_PROXY = 'http://127.0.0.1:18080';

async function main() {
  console.log('=== 启动 localtunnel 反向隧道 ===\n');
  try {
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
      setTimeout(main, 3000);
    });

    setInterval(() => {
      console.log('[' + new Date().toLocaleString('zh-CN') + '] 隧道运行中... URL: ' + tunnel.url);
    }, 120000);

  } catch(err) {
    console.error('\n启动失败:', err.message);
    console.error('1秒后重试...');
    setTimeout(main, 1000);
  }
}

main();

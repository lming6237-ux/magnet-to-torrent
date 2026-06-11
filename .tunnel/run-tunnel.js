const localtunnel = require('/workspace/node_modules/localtunnel');
const http = require('http');

(async () => {
  process.env.HTTPS_PROXY = 'http://127.0.0.1:18080';
  process.env.HTTP_PROXY = 'http://127.0.0.1:18080';
  
  console.log('[+] 正在通过代理申请公网隧道...');
  try {
    const t = await localtunnel({
      port: 3000,
      host: 'https://loca.lt'
    });
    console.log('\n' + '='.repeat(60));
    console.log('  🎉 公网 URL: ' + t.url);
    console.log('  测试: ' + t.url + '/health');
    console.log('  首页: ' + t.url + '/');
    console.log('='.repeat(60) + '\n');
    t.on('request', (info) => console.log('  [REQ] ' + info.method + ' ' + info.path));
    t.on('error', (err) => console.error('[ERR]', err.message));
    t.on('close', () => { console.error('[CLOSED]'); process.exit(1); });
    setInterval(() => {}, 1000000);
  } catch(e) {
    console.error('FATAL:', e.message);
    process.exit(1);
  }
})();

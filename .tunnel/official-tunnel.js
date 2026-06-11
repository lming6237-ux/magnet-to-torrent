const localtunnel = require('localtunnel');
const fs = require('fs');

process.env.HTTPS_PROXY = 'http://127.0.0.1:18080';
process.env.HTTP_PROXY = 'http://127.0.0.1:18080';

const URL_FILE = '/tmp/public-url.txt';

(async () => {
  let retry = 0;
  while (true) {
    try {
      console.log('[+] 正在申请公网隧道...');
      const t = await localtunnel({ port: 3000 });
      console.log('✅ PUBLIC_URL:', t.url);
      fs.writeFileSync(URL_FILE, t.url + '\n');
      fs.chmodSync(URL_FILE, 0o644);
      
      t.on('error', (err) => {
        console.error('[!] 隧道错误:', err.message);
      });
      t.on('request', (info) => {
        console.log(`  [↘] ${info.method} ${info.path}`);
      });
      t.on('close', () => {
        console.log('[!] 隧道关闭，正在重连...');
        throw new Error('closed');
      });
      
      // 每30秒再写一次文件，更新时间戳
      setInterval(() => {
        try { fs.writeFileSync(URL_FILE, t.url + '\n' + new Date().toISOString() + '\n'); } catch(_) {}
      }, 30000);
      
      return;
    } catch(e) {
      retry++;
      console.error('[!] 失败:', e.message, `(重试 ${retry})`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
})();

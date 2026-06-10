const localtunnel = require('localtunnel');
(async () => {
  try {
    process.env.HTTPS_PROXY = 'http://127.0.0.1:18080';
    process.env.HTTP_PROXY = 'http://127.0.0.1:18080';
    const t = await localtunnel({ port: 3000 });
    console.log('PUBLIC_URL:', t.url);
    t.on('error', (err) => console.error('ERR:', err.message));
    setInterval(() => console.log('URL:', t.url), 30000);
  } catch(e) { console.error('FAIL:', e.message); process.exit(1); }
})();

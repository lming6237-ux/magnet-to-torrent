const localtunnel = require('localtunnel');
(async () => {
  try {
    const tunnel = await localtunnel({ port: 3000 });
    console.log('TUNNEL_URL:', tunnel.url);
    tunnel.on('error', (err) => {
      console.error('TUNNEL_ERROR:', err.message);
    });
    tunnel.on('close', () => {
      console.log('TUNNEL_CLOSED');
    });
    // 每5秒打印一次URL
    setInterval(() => {
      console.log('TUNNEL_URL:', tunnel.url);
    }, 5000);
  } catch (err) {
    console.error('TUNNEL_FAILED:', err.message);
    process.exit(1);
  }
})();
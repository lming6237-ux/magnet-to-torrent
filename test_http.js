const https = require('https');

const HASH = '4A3F5E08BCEF825718EDA30637230585E3330599';
const curlUA = 'curl/8.5.0';
const browserUA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const nodeUA = 'node-fetch/1.0 (+https://github.com/bitinn/node-fetch)';

function testReq(host, path, ua) {
  return new Promise((resolve) => {
    const label = host + path + ' [UA=' + ua.slice(0, 20) + ']';
    const req = https.get({
      hostname: host,
      path: path,
      method: 'GET',
      headers: {
        'User-Agent': ua,
        'Accept': '*/*',
      },
      timeout: 15000,
    }, (res) => {
      console.log(label + ' => HTTP ' + res.statusCode + ' CT=' + (res.headers['content-type'] || '') + ' loc=' + (res.headers.location || ''));
      let size = 0;
      res.on('data', (c) => { size += c.length; });
      res.on('end', () => { console.log('  size=' + size); resolve(); });
    });
    req.on('timeout', () => { req.destroy(); console.log(label + ' TIMEOUT'); resolve(); });
    req.on('error', (e) => { console.log(label + ' ERR=' + e.message); resolve(); });
  });
}

(async () => {
  for (const ua of [curlUA, browserUA, nodeUA]) {
    console.log('\n=== UA:', ua.slice(0, 40), '===');
    await testReq('itorrents.net', '/torrent/' + HASH + '.torrent', ua);
    await testReq('itorrents.org', '/torrent/' + HASH + '.torrent', ua);
    await testReq('torrage.com', '/torrent/' + HASH + '.torrent', ua);
  }
})();

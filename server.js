'use strict';

const http = require('http');
const service = require('./index.js');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/convert')) {
    const urlParts = new URL(req.url, `http://localhost:${PORT}`);
    const magnet = urlParts.searchParams.get('magnet');

    if (!magnet) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Missing magnet parameter' }));
      return;
    }

    service.getLink(magnet)
      .then(torrentUrl => {
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, torrentUrl }));
      })
      .catch(err => {
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: err.message }));
      });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
  console.log(`Usage: GET /convert?magnet=<magnet_uri>`);
});

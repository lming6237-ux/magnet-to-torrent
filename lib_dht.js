// magnet -> torrent via HTTP tracker + ut_metadata (BEP 9/10)
'use strict';

const http = require('http');
const https = require('https');
const net = require('net');
const crypto = require('crypto');
const { URL } = require('url');
const bencode = require('./lib_bencode');

const TRACKERS = [
  'http://tracker.opentrackr.org:1337/announce',
  'http://tracker.openbittorrent.com:80/announce',
  'http://tracker1.bt.moack.co.kr:80/announce',
  'http://open.tracker.cl:1337/announce',
  'http://tracker.files.fm:6969/announce',
  'http://opentracker.i2p.rocks:6969/announce',
];

function parseInfoHash(input) {
  if (!input) return null;
  if (/^[a-fA-F0-9]{40}$/.test(input)) return input.toUpperCase();
  const m = input.match(/xt=urn:btih:([a-fA-F0-9]{40})/);
  if (m) return m[1].toUpperCase();
  return null;
}

function httpGet(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.get(url, { timeout: timeoutMs }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      });
      req.on('timeout', () => { req.destroy(new Error('http timeout')); });
      req.on('error', reject);
    } catch (e) { reject(e); }
  });
}

function queryTracker(trackerUrl, infoHashHex, timeoutMs) {
  return new Promise((resolve) => {
    const hashBuf = Buffer.from(infoHashHex, 'hex');
    let hashEncoded = '';
    for (let i = 0; i < hashBuf.length; i++) {
      hashEncoded += '%' + hashBuf[i].toString(16).padStart(2, '0').toUpperCase();
    }
    const peerId = '-MT0001-' + crypto.randomBytes(12).toString('hex');
    const port = 6881;
    const url = `${trackerUrl}?info_hash=${hashEncoded}&peer_id=${encodeURIComponent(peerId)}&port=${port}&uploaded=0&downloaded=0&left=1&event=started&compact=1&numwant=50`;

    const timer = setTimeout(() => resolve([]), timeoutMs);
    try {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.get(url, { timeout: timeoutMs }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          clearTimeout(timer);
          const body = Buffer.concat(chunks);
          try {
            const decoded = bencode.decode(body);
            let peersBuf = null;
            if (decoded && decoded.peers) {
              peersBuf = decoded.peers;
            }
            const peers = [];
            if (peersBuf && Buffer.isBuffer(peersBuf)) {
              for (let i = 0; i + 6 <= peersBuf.length; i += 6) {
                const host = `${peersBuf[i]}.${peersBuf[i + 1]}.${peersBuf[i + 2]}.${peersBuf[i + 3]}`;
                const port = peersBuf.readUInt16BE(i + 4);
                if (port > 0 && port < 65535 && host !== '0.0.0.0') {
                  peers.push({ host, port });
                }
              }
            }
            resolve(peers);
          } catch (e) { resolve([]); }
        });
      });
      req.on('timeout', () => { req.destroy(); });
      req.on('error', () => { clearTimeout(timer); resolve([]); });
    } catch (e) { clearTimeout(timer); resolve([]); }
  });
}

async function getAllPeers(infoHashHex, timeLimitMs) {
  const start = Date.now();
  const peerSet = new Set();
  const peers = [];

  const promises = TRACKERS.map((t) => queryTracker(t, infoHashHex, Math.min(8000, timeLimitMs)));
  const results = await Promise.all(promises);

  for (const list of results) {
    if (!list) continue;
    for (const p of list) {
      const key = `${p.host}:${p.port}`;
      if (!peerSet.has(key)) {
        peerSet.add(key);
        peers.push(p);
      }
    }
  }
  return peers;
}

function fetchMetadataFromPeer(peer, infoHashHex, timeLimitMs) {
  return new Promise((resolve, reject) => {
    const infoHashBuf = Buffer.from(infoHashHex, 'hex');
    const myPeerId = crypto.randomBytes(20);
    const socket = net.connect(peer.port, peer.host);
    socket.setTimeout(8000);

    let buf = Buffer.alloc(0);
    let handshakeDone = false;
    let utMetadataMsgId = 0;
    let metadataSize = 0;
    let pieces = null;
    let piecesReceived = 0;
    let finished = false;
    let requestedPieces = new Set();

    const timeout = setTimeout(() => {
      cleanup(new Error('timeout'));
    }, timeLimitMs);

    function cleanup(err, data) {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      try { socket.destroy(); } catch (e) {}
      if (err) reject(err);
      else resolve(data);
    }

    socket.on('connect', () => {
      const pstr = Buffer.from('BitTorrent protocol');
      const reserved = Buffer.alloc(8);
      reserved[5] = 0x10;
      const handshake = Buffer.concat([
        Buffer.from([19]),
        pstr,
        reserved,
        infoHashBuf,
        myPeerId
      ]);
      socket.write(handshake);
    });

    socket.on('timeout', () => cleanup(new Error('socket timeout')));
    socket.on('error', (e) => cleanup(e));
    socket.on('close', () => { if (!finished) cleanup(new Error('connection closed')); });

    socket.on('data', (data) => {
      if (finished) return;
      buf = Buffer.concat([buf, data]);
      if (!handshakeDone) {
        if (buf.length < 68) return;
        if (buf[0] !== 19 || buf.slice(1, 20).toString() !== 'BitTorrent protocol') {
          return cleanup(new Error('bad protocol'));
        }
        const supportsExt = (buf[25] & 0x10) !== 0;
        if (!supportsExt) return cleanup(new Error('peer does not support ext protocol'));
        handshakeDone = true;
        buf = buf.slice(68);
        // Send extended handshake
        const extHandshake = {
          m: { ut_metadata: 1 },
          p: 0,
          v: Buffer.from('MT 1.0'),
          yourip: Buffer.from([0, 0, 0, 0]),
          ipv4: Buffer.from([0, 0, 0, 0]),
          ipv6: Buffer.alloc(16),
          reqq: 250,
        };
        const encodedDict = bencode.encode(extHandshake);
        const extMsg = Buffer.concat([Buffer.from([20, 0]), encodedDict]);
        const lenBuf = Buffer.alloc(4);
        lenBuf.writeUInt32BE(extMsg.length);
        try { socket.write(Buffer.concat([lenBuf, extMsg])); } catch (e) {}
        processBuffer();
        return;
      }
      processBuffer();
    });

    function processBuffer() {
      while (buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (len === 0) { buf = buf.slice(4); continue; }
        if (len > 2000000) return cleanup(new Error('msg too large'));
        if (buf.length < 4 + len) return;

        const msg = buf.slice(4, 4 + len);
        buf = buf.slice(4 + len);
        const msgId = msg[0];

        if (msgId === 20) {
          const extId = msg[1];
          const payload = msg.slice(2);

          if (extId === 0) {
            try {
              const dict = bencode.decode(payload);
              if (dict && dict.m && dict.m.ut_metadata !== undefined) {
                utMetadataMsgId = Number(dict.m.ut_metadata);
              }
              if (dict && dict.metadata_size && Number(dict.metadata_size) > 0) {
                metadataSize = Number(dict.metadata_size);
                const numPieces = Math.ceil(metadataSize / (16 * 1024));
                pieces = new Array(numPieces).fill(null);
                // Request all pieces
                for (let i = 0; i < numPieces; i++) {
                  requestPiece(i);
                }
              } else {
                cleanup(new Error('no metadata_size from peer'));
              }
            } catch (e) { cleanup(new Error('bad ext handshake: ' + e.message)); }
          } else if (extId === utMetadataMsgId) {
            try {
              const dictEnd = seekBencodedDictEnd(payload);
              const dict = bencode.decode(payload.slice(0, dictEnd));
              if (Number(dict.msg_type) === 1) { // data
                const piece = Number(dict.piece);
                const pieceData = payload.slice(dictEnd);
                if (pieces !== null && piece >= 0 && piece < pieces.length && !pieces[piece]) {
                  pieces[piece] = pieceData;
                  piecesReceived++;
                  if (piecesReceived === pieces.length) {
                    const all = Buffer.concat(pieces).slice(0, metadataSize);
                    const actualHash = crypto.createHash('sha1').update(all).digest('hex').toUpperCase();
                    if (actualHash === infoHashHex) {
                      cleanup(null, all);
                    } else {
                      cleanup(new Error('hash mismatch'));
                    }
                  }
                }
              } else if (Number(dict.msg_type) === 2) {
                cleanup(new Error('peer rejected'));
              }
            } catch (e) { /* ignore */ }
          }
        }
      }
    }

    function requestPiece(i) {
      if (requestedPieces.has(i)) return;
      requestedPieces.add(i);
      const req = bencode.encode({ msg_type: 0, piece: i });
      const extMsg = Buffer.concat([Buffer.from([20, utMetadataMsgId]), req]);
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeUInt32BE(extMsg.length);
      try { socket.write(Buffer.concat([lenBuf, extMsg])); } catch (e) {}
    }
  });
}

function seekBencodedDictEnd(buf) {
  let pos = 1;
  while (pos < buf.length && buf[pos] !== 0x65) {
    let colon = pos;
    while (buf[colon] !== 0x3a) colon++;
    const klen = Number(buf.slice(pos, colon).toString());
    pos = colon + 1 + klen;
    pos = skipBencodeValue(buf, pos);
  }
  return pos + 1;
}

function skipBencodeValue(buf, pos) {
  const c = buf[pos];
  if (c === 0x69) {
    let end = pos + 1;
    while (buf[end] !== 0x65) end++;
    return end + 1;
  } else if (c === 0x6c || c === 0x64) {
    pos++;
    const isDict = c === 0x64;
    while (pos < buf.length && buf[pos] !== 0x65) {
      if (isDict) {
        let colon = pos;
        while (buf[colon] !== 0x3a) colon++;
        const klen = Number(buf.slice(pos, colon).toString());
        pos = colon + 1 + klen;
      }
      pos = skipBencodeValue(buf, pos);
    }
    return pos + 1;
  } else {
    let colon = pos;
    while (buf[colon] !== 0x3a) colon++;
    const len = Number(buf.slice(pos, colon).toString());
    return colon + 1 + len;
  }
}

async function magnetToTorrent(magnetOrHash, timeoutMs = 60000) {
  const infoHash = parseInfoHash(magnetOrHash);
  if (!infoHash) throw new Error('Invalid magnet link or info hash');

  const start = Date.now();
  const peers = await getAllPeers(infoHash, Math.min(12000, timeoutMs / 3));
  if (peers.length === 0) {
    throw new Error('No peers found from any tracker');
  }

  const remaining = timeoutMs - (Date.now() - start);

  // Try up to N peers in parallel batches
  const batchSize = 8;
  const maxAttempts = Math.min(peers.length, 40);
  let result = null;

  for (let i = 0; i < maxAttempts && !result; i += batchSize) {
    const batch = peers.slice(i, i + batchSize);
    const batchPromises = batch.map((p) =>
      fetchMetadataFromPeer(p, infoHash, Math.max(8000, remaining / 2)).catch(() => null)
    );
    const results = await Promise.all(batchPromises);
    for (const r of results) {
      if (r && r.length > 0) { result = r; break; }
    }
  }

  if (!result) {
    throw new Error('Failed to fetch metadata from any peer. Try again with a different torrent.');
  }

  // Build torrent file
  const info = bencode.decode(result);
  const torrent = {
    announce: 'udp://tracker.opentrackr.org:1337/announce',
    'announce-list': [
      ['udp://tracker.opentrackr.org:1337/announce'],
      ['udp://tracker.openbittorrent.com:80/announce'],
      ['http://tracker1.bt.moack.co.kr:80/announce'],
    ],
    info: info,
    comment: 'Retrieved via HTTP tracker + ut_metadata',
    'created by': 'magnet-to-torrent',
    'creation date': Math.floor(Date.now() / 1000),
  };
  return bencode.encode(torrent);
}

module.exports = { magnetToTorrent, parseInfoHash };

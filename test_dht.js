const DHT = require('bittorrent-dht');
const crypto = require('crypto');
const bencode = require('bencode');

const hash = '4A3F5E08BCEF825718EDA30637230585E3330599'; // ubuntu-24.04.1-desktop-amd64.iso
console.log('DHT metadata test for hash:', hash);
console.log('Starting DHT node...');

const dht = new DHT();
const start = Date.now();
let found = false;
let gotMetadata = false;

dht.on('error', (err) => console.log('DHT error:', err.message));

dht.on('peer', (peer, infoHash, from) => {
  const h = infoHash.toString('hex');
  if (!found) {
    found = true;
    console.log(`Found first peer after ${(Date.now()-start)/1000}s from ${from.address}`);
  }
  // Try ut_metadata handshake with the peer
  tryMetadata(peer, h);
});

const activeRequests = new Set();

function tryMetadata(peer, infoHashHex) {
  const key = peer.host + ':' + peer.port;
  if (activeRequests.has(key)) return;
  activeRequests.add(key);

  // Using a simple BEP 9 implementation - connect via TCP, send extended handshake,
  // request metadata
  const net = require('net');
  const socket = net.connect(peer.port, peer.host, () => {
    // Send BitTorrent handshake
    const pstr = Buffer.from('BitTorrent protocol');
    const reserved = Buffer.alloc(8);
    reserved[5] = 0x10; // Enable extended messages (BEP 10)
    const handshake = Buffer.concat([
      Buffer.from([19]),
      pstr,
      reserved,
      Buffer.from(infoHashHex, 'hex'),
      crypto.randomBytes(20) // peer id
    ]);
    socket.write(handshake);
  });

  socket.setTimeout(8000);
  let handshakeDone = false;
  let buf = Buffer.alloc(0);
  let metadataSize = 0;
  let utMetadataMsgId = 0;
  let pieces = null;
  let piecesGot = 0;

  socket.on('data', (data) => {
    buf = Buffer.concat([buf, data]);

    if (!handshakeDone) {
      if (buf.length >= 68) {
        // Check reserved bits for extended protocol support
        if (buf[25] & 0x10) {
          handshakeDone = true;
          buf = buf.slice(68);
          processBuffer();
        } else {
          socket.destroy();
        }
      }
      return;
    }
    processBuffer();
  });

  function processBuffer() {
    while (buf.length >= 4) {
      const len = buf.readUInt32BE(0);
      if (len === 0) { buf = buf.slice(4); continue; }
      if (buf.length < 4 + len) return;

      const msg = buf.slice(4, 4 + len);
      buf = buf.slice(4 + len);
      const msgId = msg[0];

      // Extended message (id=20)
      if (msgId === 20) {
        const extId = msg[1];
        const payload = msg.slice(2);

        if (extId === 0) {
          // Extended handshake
          try {
            const dict = bencode.decode(payload);
            if (dict.m && dict.m.ut_metadata !== undefined) {
              utMetadataMsgId = dict.m.ut_metadata;
            }
            if (dict.metadata_size) {
              metadataSize = dict.metadata_size;
              const numPieces = Math.ceil(metadataSize / (16 * 1024));
              pieces = new Array(numPieces).fill(null);

              // Request piece 0
              for (let i = 0; i < numPieces; i++) {
                const req = bencode.encode({ msg_type: 0, piece: i });
                const extMsg = Buffer.concat([
                  Buffer.from([20, utMetadataMsgId]),
                  req
                ]);
                const lenBuf = Buffer.alloc(4);
                lenBuf.writeUInt32BE(extMsg.length);
                socket.write(Buffer.concat([lenBuf, extMsg]));
              }
            }
          } catch (e) { socket.destroy(); }
        } else if (extId === utMetadataMsgId) {
          // ut_metadata data or reject
          try {
            let dictEnd = 0;
            while (dictEnd < payload.length && payload[dictEnd] !== 0x65) dictEnd++;
            dictEnd++;
            const dict = bencode.decode(payload.slice(0, dictEnd));
            if (dict.msg_type === 1) { // data
              const piece = dict.piece;
              const pieceData = payload.slice(dictEnd);
              pieces[piece] = pieceData;
              piecesGot++;

              if (piecesGot === pieces.length) {
                const allData = Buffer.concat(pieces).slice(0, metadataSize);
                // Verify
                const ourHash = crypto.createHash('sha1').update(allData).digest('hex');
                if (ourHash === infoHashHex.toLowerCase() && !gotMetadata) {
                  gotMetadata = true;
                  console.log(`Got metadata! size=${metadataSize} bytes, after ${(Date.now()-start)/1000}s`);
                  // Build a minimal torrent file
                  const torrent = {
                    info: bencode.decode(allData),
                    'announce': '',
                    'announce-list': [],
                    'comment': 'fetched via DHT',
                    'created by': 'magnet-converter',
                    'creation date': Math.floor(Date.now() / 1000)
                  };
                  const torrentBuf = bencode.encode(torrent);
                  require('fs').writeFileSync('/tmp/dht_test.torrent', torrentBuf);
                  console.log('Saved to /tmp/dht_test.torrent (' + torrentBuf.length + ' bytes)');
                  socket.destroy();
                  dht.destroy(() => process.exit(0));
                }
              }
            }
          } catch (e) { /* ignore */ }
        }
      }
    }
  }

  socket.on('timeout', () => socket.destroy());
  socket.on('error', () => {});
  socket.on('close', () => {
    activeRequests.delete(key);
  });
}

dht.listen(() => {
  console.log('DHT listening on port', dht.address().port);
  dht.lookup(hash, (err) => {
    if (err) console.log('lookup err:', err.message);
  });
});

setTimeout(() => {
  console.log(`Giving up after 45s. found=${found}, gotMetadata=${gotMetadata}`);
  dht.destroy(() => process.exit(1));
}, 45000);

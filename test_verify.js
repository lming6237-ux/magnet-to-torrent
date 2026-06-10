const crypto = require('crypto');
const fs = require('fs');
const buf = fs.readFileSync('/tmp/direct_curl_test.torrent');
const HASH = '4A3F5E08BCEF825718EDA30637230585E3330599';

console.log('Total size:', buf.length);
console.log('First 20 bytes:', buf.slice(0, 20).toString());
console.log('buf[0]:', buf[0], '(should be 0x64 = d)');

const marker = Buffer.from('4:info');
const idx = buf.indexOf(marker);
console.log('marker idx:', idx);

if (idx < 0) { console.log('no info dict found'); process.exit(1); }

const infoStart = idx + marker.length;
console.log('infoStart:', infoStart, 'byte:', buf[infoStart], 'char:', String.fromCharCode(buf[infoStart]));

let depth = 1, pos = infoStart, iterations = 0;
while (depth > 0 && pos < buf.length && iterations < 100000) {
  iterations++;
  const c = buf[pos];
  if (c === 0x64 || c === 0x6c) { depth++; pos++; }
  else if (c === 0x65) { depth--; pos++; }
  else if (c === 0x69) {
    const end = buf.indexOf('e', pos + 1);
    if (end < 0) { console.log('int parse failed at', pos); process.exit(1); }
    pos = end + 1;
  } else if (c >= 0x30 && c <= 0x39) {
    const colon = buf.indexOf(':', pos);
    if (colon < 0) { console.log('no colon for str at', pos); process.exit(1); }
    const lenStr = buf.slice(pos, colon).toString();
    const len = parseInt(lenStr, 10);
    if (isNaN(len) || len < 0) { console.log('bad len', lenStr, 'at', pos); process.exit(1); }
    pos = colon + 1 + len;
  } else { console.log('unknown byte', c, 'at', pos, 'depth:', depth); process.exit(1); }
}
console.log('parsed OK: depth=', depth, 'pos=', pos, 'iterations:', iterations);

const infoBuf = buf.slice(infoStart, pos - 1);
const actual = crypto.createHash('sha1').update(infoBuf).digest('hex').toUpperCase();
console.log('info SHA1:', actual);
console.log('expected:', HASH);
console.log('match:', actual === HASH);

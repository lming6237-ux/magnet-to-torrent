// Minimal bencode (BEP 3) encoder/decoder - pure JS, no deps
'use strict';

function encode(val) {
  const out = [];
  encodeItem(val, out);
  return Buffer.concat(out);
}

function encodeItem(val, out) {
  if (Buffer.isBuffer(val)) {
    out.push(Buffer.from(val.length + ':'));
    out.push(val);
  } else if (typeof val === 'string') {
    const b = Buffer.from(val, 'utf8');
    out.push(Buffer.from(b.length + ':'));
    out.push(b);
  } else if (typeof val === 'number') {
    out.push(Buffer.from('i' + Math.floor(val) + 'e'));
  } else if (Array.isArray(val)) {
    out.push(Buffer.from('l'));
    for (const v of val) encodeItem(v, out);
    out.push(Buffer.from('e'));
  } else if (val !== null && typeof val === 'object') {
    out.push(Buffer.from('d'));
    const keys = Object.keys(val).sort();
    for (const k of keys) {
      const kb = Buffer.from(k, 'utf8');
      out.push(Buffer.from(kb.length + ':'));
      out.push(kb);
      encodeItem(val[k], out);
    }
    out.push(Buffer.from('e'));
  } else {
    out.push(Buffer.from('i0e'));
  }
}

function decode(buf, start = 0) {
  const r = decodeItem(buf, start);
  return r.value;
}

function decodeItem(buf, start) {
  const c = buf[start];
  if (c === 0x69) { // 'i'
    let end = start + 1;
    while (buf[end] !== 0x65) end++;
    const num = Number(buf.slice(start + 1, end).toString('utf8'));
    return { value: num, end: end + 1 };
  } else if (c === 0x6c) { // 'l'
    const arr = [];
    let pos = start + 1;
    while (buf[pos] !== 0x65) {
      const r = decodeItem(buf, pos);
      arr.push(r.value);
      pos = r.end;
    }
    return { value: arr, end: pos + 1 };
  } else if (c === 0x64) { // 'd'
    const obj = {};
    let pos = start + 1;
    while (buf[pos] !== 0x65) {
      const kr = decodeItem(buf, pos);
      const key = Buffer.isBuffer(kr.value) ? kr.value.toString('utf8') : String(kr.value);
      const vr = decodeItem(buf, kr.end);
      obj[key] = vr.value;
      pos = vr.end;
    }
    return { value: obj, end: pos + 1 };
  } else if (c >= 0x30 && c <= 0x39) { // '0'-'9' string
    let colon = start;
    while (buf[colon] !== 0x3a) colon++;
    const len = Number(buf.slice(start, colon).toString('utf8'));
    const begin = colon + 1;
    const data = buf.slice(begin, begin + len);
    return { value: data, end: begin + len };
  }
  throw new Error('bencode decode error at ' + start + ' byte=' + c);
}

module.exports = { encode, decode };

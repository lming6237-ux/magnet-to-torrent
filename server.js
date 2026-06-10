'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { URL } = require('url');

const TORRENT_SOURCES = [
  { name: 'itorrents.net', url: (h) => 'https://itorrents.net/torrent/' + h + '.torrent' },
  { name: 'itorrents.org', url: (h) => 'https://itorrents.org/torrent/' + h + '.torrent' },
  { name: 'torrage.com',  url: (h) => 'https://torrage.com/torrent/' + h + '.torrent' },
];

function parseInfoHash(input) {
  if (!input) return null;
  input = input.trim();
  if (/^[a-fA-F0-9]{40}$/.test(input)) return input.toUpperCase();
  const m = input.match(/xt=urn:btih:([a-fA-F0-9]{40})/);
  if (m) return m[1].toUpperCase();
  return null;
}

function curlBuffer(url, timeoutSec) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const args = [
      '-s', '-L',
      '-A', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      '--max-time', String(timeoutSec),
      '--compressed',
      url
    ];
    const child = spawn('curl', args);
    child.stdout.on('data', (c) => chunks.push(c));
    child.stderr.on('data', () => {});
    child.on('error', (e) => reject(e));
    child.on('close', (code) => {
      const data = Buffer.concat(chunks);
      if (code === 0 && data.length > 100) resolve(data);
      else reject(new Error('curl exit ' + code + ' size=' + data.length));
    });
  });
}

function verifyTorrent(buf) {
  if (!buf || buf.length < 200) return false;
  if (buf[0] !== 0x64) return false;
  try {
    const marker = Buffer.from('4:info');
    const idx = buf.indexOf(marker);
    if (idx < 0) return false;
    const infoStart = idx + marker.length;
    let depth = 1, pos = infoStart, iters = 0;
    while (depth > 0 && pos < buf.length && iters < 200000) {
      iters++;
      const c = buf[pos];
      if (c === 0x64 || c === 0x6c) { depth++; pos++; }
      else if (c === 0x65) { depth--; pos++; }
      else if (c === 0x69) {
        const end = buf.indexOf('e', pos + 1);
        if (end < 0) return false;
        pos = end + 1;
      } else if (c >= 0x30 && c <= 0x39) {
        const colon = buf.indexOf(':', pos);
        if (colon < 0) return false;
        const lenStr = buf.slice(pos, colon).toString();
        const len = parseInt(lenStr, 10);
        if (isNaN(len) || len < 0) return false;
        pos = colon + 1 + len;
      } else return false;
    }
    return depth === 0;
  } catch (e) { return false; }
}

function fetchFromSource(source, hash, timeoutSec) {
  return curlBuffer(source.url(hash), timeoutSec).then((data) => {
    if (verifyTorrent(data)) return { source: source.name, buffer: data };
    throw new Error('invalid torrent from ' + source.name);
  });
}

function fetchTorrent(hash, overallTimeoutMs) {
  return new Promise((resolve, reject) => {
    const promises = TORRENT_SOURCES.map((s) =>
      fetchFromSource(s, hash, 15).then((r) => { resolve(r); return r; }).catch(() => null)
    );
    const fallback = setTimeout(() => {
      Promise.all(promises).then((results) => {
        const found = results.find((r) => r);
        if (found) resolve(found);
        else reject(new Error('无法从任何缓存源获取到有效 torrent 文件。该资源可能未被公共缓存收录。'));
      });
    }, overallTimeoutMs);
  });
}

// ============ 前端页面 ============

const homePage = '<!DOCTYPE html>\n\
<html lang="zh-CN"><head><meta charset="UTF-8" />\n\
<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n\
<title>磁力链接转 Torrent 文件</title>\n\
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;margin:0;padding:30px 20px;background:#f6f8fa;color:#1f2328}\n\
.container{max-width:760px;margin:0 auto}h1{font-size:24px}.sub{color:#57606a;font-size:14px;margin-bottom:20px}\n\
.card{background:#fff;border:1px solid #d0d7de;border-radius:8px;padding:24px}\n\
label{display:block;font-size:13px;color:#424a53;margin-bottom:6px;font-weight:500}\n\
input[type=text]{width:100%;padding:10px 12px;font-size:14px;border:1px solid #d0d7de;border-radius:6px;margin-bottom:12px;font-family:ui-monospace,monospace}\n\
button{padding:10px 24px;font-size:14px;background:#2da44e;color:#fff;border:1px solid rgba(27,31,36,0.15);border-radius:6px;cursor:pointer;font-weight:500}\n\
button:hover:not(:disabled){background:#2c974b}button:disabled{background:#81b196;cursor:not-allowed}\n\
#result{margin-top:20px;padding:16px;background:#f6f8fa;border-radius:6px;min-height:40px;word-break:break-all;border:1px solid #d0d7de}\n\
.ok{color:#1a7f37;font-weight:600}.err{color:#cf222e;font-weight:600}\n\
.log{margin-top:16px;padding:12px;background:#0d1117;color:#8b949e;font-family:ui-monospace,monospace;font-size:12px;border-radius:6px;max-height:260px;overflow-y:auto}\n\
.log div{line-height:1.8}.log .ok{color:#3fb950}.log .warn{color:#d29922}.log .err{color:#f85149}\n\
.download-btn{display:inline-block;margin-top:12px;padding:10px 20px;background:#0969da;color:#fff;text-decoration:none;border-radius:6px;font-weight:500}\n\
.download-btn:hover{background:#0759b5}\n\
.examples{margin-top:16px;font-size:12px;color:#57606a}\n\
.examples code{background:#eaeef2;padding:2px 6px;border-radius:4px}\n\
.progress{width:100%;height:6px;background:#d0d7de;border-radius:3px;overflow:hidden;margin:10px 0}\n\
.progress-fill{height:100%;background:#2da44e;width:0;transition:width .3s}</style></head><body>\n\
<div class="container"><h1>磁力链接转 Torrent 文件</h1>\n\
<div class="sub">通过多个公共 torrent 缓存源获取元数据 — 粘贴磁力链接或 info hash</div>\n\
<div class="card"><label for="magnet">磁力链接 / info hash</label>\n\
<input id="magnet" type="text" placeholder="magnet:?xt=urn:btih:4A3F5E08BCEF825718EDA30637230585E3330599" />\n\
<button id="btn" onclick="convert()">开始转换</button>\n\
<div class="progress"><div class="progress-fill" id="progressFill"></div></div>\n\
<div class="examples">示例: <code>magnet:?xt=urn:btih:4A3F5E08BCEF825718EDA30637230585E3330599</code><br/>\n\
或 40 位 hash: <code>4A3F5E08BCEF825718EDA30637230585E3330599</code></div>\n\
<div id="result" style="display:none"></div><div class="log" id="log"></div></div></div>\n\
<script>let progressTimer=null;function log(msg,type){const el=document.getElementById("log");const line=document.createElement("div");if(type)line.className=type;const t=new Date().toTimeString().slice(0,8);line.textContent="["+t+"] "+msg;el.appendChild(line);el.scrollTop=el.scrollHeight}\n\
function startProgress(){let pct=0;const f=document.getElementById("progressFill");progressTimer=setInterval(()=>{pct=Math.min(pct+Math.random()*3,95);f.style.width=pct+"%"},300)}\n\
function stopProgress(s){if(progressTimer){clearInterval(progressTimer);progressTimer=null}document.getElementById("progressFill").style.width=(s?100:0)+"%"} \n\
function parseMagnet(input){input=(input||"").trim();if(/^[a-fA-F0-9]{40}$/.test(input))return input.toUpperCase();const m=input.match(/xt=urn:btih:([a-fA-F0-9]{40})/);if(m)return m[1].toUpperCase();return null}\n\
async function convert(){const raw=document.getElementById("magnet").value;const hash=parseMagnet(raw);const btn=document.getElementById("btn");const resultEl=document.getElementById("result");resultEl.style.display="block";resultEl.innerHTML="";if(!hash){resultEl.innerHTML=\'<span class="err">请输入有效的磁力链接或 40 位 info hash</span>\';log("输入无效","err");return}\n\
btn.disabled=true;btn.textContent="转换中...";startProgress();log("目标 hash: "+hash);log("正在从缓存源获取 torrent 文件...");try{const resp=await fetch("/api/torrent?hash="+hash,{cache:"no-store"});stopProgress(true);if(!resp.ok){let msg="转换失败";try{const j=await resp.json();if(j.error)msg=j.error}catch(e){}resultEl.innerHTML=\'<span class="err">✗ \'+msg+\'</span><br/><br/><em style="color:#57606a">提示: 冷门或刚发布的资源可能还没被公共缓存收录。</em>\';log("失败: "+msg,"err");return}\n\
const blob=await resp.blob();log("成功! 大小: "+(blob.size/1024).toFixed(2)+" KB","ok");const url=URL.createObjectURL(blob);resultEl.innerHTML=\'<span class="ok">✓ 转换成功</span><br/><br/>Hash: <code>\'+hash+\'</code><br/>大小: \'+(blob.size/1024).toFixed(2)+" KB<br/>";const a=document.createElement("a");a.href=url;a.download=hash+".torrent";a.className="download-btn";a.textContent="⬇ 下载 .torrent 文件";resultEl.appendChild(a)}catch(err){stopProgress(false);resultEl.innerHTML=\'<span class="err">✗ 请求错误: \'+err.message+\'</span>\';log("请求错误: "+err.message,"err")}finally{btn.disabled=false;btn.textContent="开始转换"}}\n\
document.getElementById("magnet").addEventListener("keypress",(e)=>{if(e.key==="Enter")convert()})</script>\n\
</body></html>';

// ============ HTTP Server ============

const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  try {
    const parsed = new URL(req.url, 'http://' + req.headers.host);
    const path = parsed.pathname;

    if (req.method === 'GET' && (path === '/' || path === '')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(homePage);
      return;
    }

    if (req.method === 'GET' && path === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (req.method === 'GET' && path === '/api/torrent') {
      const hash = parseInfoHash(parsed.searchParams.get('magnet') || parsed.searchParams.get('hash') || '');
      if (!hash) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid magnet link or info hash' }));
        return;
      }
      try {
        const result = await fetchTorrent(hash, 20000);
        res.writeHead(200, {
          'Content-Type': 'application/x-bittorrent',
          'Content-Length': result.buffer.length,
          'Content-Disposition': 'attachment; filename="' + hash + '.torrent"',
          'Cache-Control': 'no-store',
        });
        res.end(result.buffer);
      } catch (err) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message, hash: hash }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  } catch (e) {
    try {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    } catch (f) {}
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Server running at http://0.0.0.0:' + PORT + '/');
});

#!/usr/bin/env python3
import json, socket, ssl, urllib.request, base64, os, sys
import websocket as ws

PROXY = 'http://127.0.0.1:18080'
LOCAL_HOST, LOCAL_PORT = '127.0.0.1', 3000

def get_info():
    proxy = urllib.request.ProxyHandler({'https': PROXY, 'http': PROXY})
    opener = urllib.request.build_opener(proxy)
    resp = opener.open(urllib.request.Request(
        'https://loca.lt/?new',
        headers={'User-Agent': 'python-ws/1.0'}
    ), timeout=15)
    return json.loads(resp.read().decode())

def forward(req_data):
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(60)
        s.connect((LOCAL_HOST, LOCAL_PORT))
        s.sendall(req_data)
        resp = b''
        while True:
            try:
                c = s.recv(65536)
                if not c: break
                resp += c
                # 读完响应
                h_end = resp.find(b'\r\n\r\n')
                if h_end >= 0:
                    h = resp[:h_end].decode('utf8', errors='replace')
                    cl = 0
                    for line in h.split('\r\n'):
                        if line.lower().startswith('content-length:'):
                            cl = int(line.split(':')[1].strip())
                    if cl > 0 and len(resp) >= h_end + 4 + cl: break
                    if b'transfer-encoding:' in resp[:h_end+4].lower(): break
            except socket.timeout: break
        s.close()
        return resp
    except:
        return b'HTTP/1.1 502\r\nContent-Length: 5\r\n\r\nError'

def main():
    print('[+] 正在申请公网 URL...')
    info = get_info()
    url = info['url']
    tid, port = info['id'], info['port']
    
    print('\n' + '='*60)
    print('  🎉 公网 URL:', url)
    print('  测试:', url + '/health')
    print('  首页:', url + '/')
    print('='*60 + '\n')
    
    # 使用 websocket-client 的 HTTP 代理支持
    ws.enableTrace(True)
    
    proxy_info = PROXY.replace('http://', '').split(':')
    proxy_host, proxy_port = proxy_info[0], int(proxy_info[1])
    
    # websocket-client 使用 http_proxy_host/http_proxy_port/http_proxy_auth
    ws_kwargs = {
        'http_proxy_host': proxy_host,
        'http_proxy_port': proxy_port,
        'proxy_type': 'http',
    }
    
    while True:
        try:
            print(f'[+] 连接到 wss://loca.lt:{port} (via proxy)...')
            wss = ws.WebSocketApp(
                f'wss://loca.lt:{port}',
                header={'User-Agent': 'python-tunnel'},
                **ws_kwargs
            )
            
            tunnel_id_sent = [False]
            
            def on_open(wss):
                print('[+] WebSocket 已打开，发送 tunnel ID:', tid)
                wss.send(json.dumps({'id': tid}), opcode=ws.ABNF.OPCODE_TEXT)
                tunnel_id_sent[0] = True
            
            def on_message(wss, msg):
                # loca.lt 协议: 先读 size\r\n\r\n，再读 DATA
                global msg_buf
                if not hasattr(on_message, 'buf'):
                    on_message.buf = b''
                on_message.buf += msg.encode('latin1') if isinstance(msg, str) else msg
                
                while True:
                    buf = on_message.buf
                    he = buf.find(b'\r\n\r\n')
                    if he < 0: break
                    try:
                        size = int(buf[:he].decode(errors='replace').strip())
                    except:
                        on_message.buf = buf[he+4:]
                        break
                    if len(buf) < he + 4 + size: break
                    req = buf[he+4:he+4+size]
                    on_message.buf = buf[he+4+size:]
                    resp = forward(req)
                    wss.send(str(len(resp)).encode() + b'\r\n\r\n' + resp)
                    # 日志
                    try:
                        p = req[:req.find(b'\r\n\r\n')].decode(errors='replace').split('\r\n')[0].split()
                        print(f'  [↩] {p[0]} {p[1]}')
                    except: pass
            
            def on_error(wss, err):
                print(f'[!] WS 错误: {err}')
            
            def on_close(wss, code, reason):
                print(f'[!] WS 关闭: {code} {reason}')
            
            wss.on_open = on_open
            wss.on_message = on_message
            wss.on_error = on_error
            wss.on_close = on_close
            
            wss.run_forever(ping_interval=30, ping_timeout=10)
            print('[!] WS 断开，5秒后重连...')
            
        except Exception as e:
            print(f'[!] 错误: {e}')
        
        import time; time.sleep(5)

if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\n退出')

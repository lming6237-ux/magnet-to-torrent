#!/usr/bin/env python3
"""将本地3000端口通过loca.lt暴露到公网"""
import urllib.request
import urllib.parse
import json
import socket
import ssl
import threading
import time
import sys
import http.client

PROXY = 'http://127.0.0.1:18080'
LOCAL_HOST = '127.0.0.1'
LOCAL_PORT = 3000

def get_tunnel_info():
    proxy_handler = urllib.request.ProxyHandler({'https': PROXY, 'http': PROXY})
    opener = urllib.request.build_opener(proxy_handler)
    req = urllib.request.Request(
        'https://loca.lt/?new',
        headers={'User-Agent': 'localtunnel-proxy/1.0'}
    )
    resp = opener.open(req, timeout=15)
    return json.loads(resp.read().decode())

def connect_through_proxy(host, port):
    """通过 HTTP 代理建立 TCP 连接"""
    proxy_host, proxy_port_str = PROXY.replace('http://', '').split(':')
    proxy_port = int(proxy_port_str)
    
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(30)
    sock.connect((proxy_host, proxy_port))
    
    # 发送 CONNECT 请求
    connect_req = f"CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\nUser-Agent: tunnel\r\n\r\n"
    sock.sendall(connect_req.encode())
    
    # 读取响应，直到 \r\n\r\n
    buf = b''
    while True:
        chunk = sock.recv(1024)
        if not chunk:
            raise Exception("Proxy closed connection")
        buf += chunk
        if b'\r\n\r\n' in buf:
            break
    
    resp_line = buf.split(b'\r\n')[0].decode()
    if '200' not in resp_line:
        raise Exception(f"Proxy error: {resp_line}")
    
    return sock

def parse_http_request(data):
    """解析 HTTP 请求首行和 headers"""
    try:
        header_end = data.find(b'\r\n\r\n')
        if header_end < 0:
            return None
        
        header_part = data[:header_end].decode('latin1', errors='replace')
        lines = header_part.split('\r\n')
        if not lines or ' ' not in lines[0]:
            return None
        
        first_line = lines[0]
        parts = first_line.split(' ')
        method = parts[0]
        path = parts[1] if len(parts) > 1 else '/'
        
        headers = {}
        for line in lines[1:]:
            if ':' in line:
                idx = line.index(':')
                k = line[:idx].strip().lower()
                v = line[idx+1:].strip()
                headers[k] = v
        
        body = data[header_end + 4:]
        return {'method': method, 'path': path, 'headers': headers, 'body': body, 'raw': data}
    except Exception as e:
        return None

def forward_to_local(request_data):
    """转发请求到本地 3000 端口"""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(30)
        sock.connect((LOCAL_HOST, LOCAL_PORT))
        sock.sendall(request_data)
        
        response = b''
        while True:
            try:
                chunk = sock.recv(65536)
                if not chunk:
                    break
                response += chunk
                # 简单判定：收到 Content-Length 或 Transfer-Encoding 响应后读取完毕
                if len(response) > 8:
                    header_end = response.find(b'\r\n\r\n')
                    if header_end > 0:
                        headers_part = response[:header_end].decode('latin1', errors='replace')
                        cl = None
                        for line in headers_part.split('\r\n'):
                            if line.lower().startswith('content-length:'):
                                cl = int(line.split(':')[1].strip())
                        if cl is not None and len(response) >= header_end + 4 + cl:
                            break
                        if 'transfer-encoding:' in headers_part.lower() and response.endswith(b'0\r\n\r\n'):
                            break
            except socket.timeout:
                break
        sock.close()
        return response
    except Exception as e:
        return f"HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\nContent-Length: {len(str(e))}\r\n\r\n{str(e)}".encode()

def build_http_response(status_code, status_text, headers, body):
    resp = f"HTTP/1.1 {status_code} {status_text}\r\n"
    for k, v in headers.items():
        resp += f"{k}: {v}\r\n"
    resp += "\r\n"
    return resp.encode() + (body if isinstance(body, bytes) else body.encode())

class TunnelClient:
    def __init__(self, tunnel_info):
        self.info = tunnel_info
        self.url = tunnel_info['url']
        self.id = tunnel_info['id']
        self.port = tunnel_info['port']
        self.socket = None
        self.buffer = b''
        
    def connect(self):
        print(f"[+] 建立连接到 loca.lt:{self.port} (ID: {self.id})")
        self.socket = connect_through_proxy('loca.lt', self.port)
        print(f"[+] 隧道连接成功，URL: {self.url}")
        # 发送 id 让服务端识别
        msg = json.dumps({'id': self.id}).encode()
        # 先建立 TLS
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        self.socket = context.wrap_socket(self.socket, server_hostname='loca.lt')
        self.socket.sendall(msg)
        print(f"[+] 已发送隧道 ID")
        
    def handle_client(self, client_sock, addr):
        try:
            client_sock.settimeout(60)
            # 读取客户端发来的 HTTP 请求
            data = b''
            while True:
                try:
                    chunk = client_sock.recv(65536)
                    if not chunk:
                        break
                    data += chunk
                    # 判断是否接收完整
                    if b'\r\n\r\n' in data:
                        parsed = parse_http_request(data)
                        if parsed:
                            content_length = int(parsed['headers'].get('content-length', 0))
                            if content_length == 0 or len(parsed['body']) >= content_length:
                                break
                        else:
                            break
                except:
                    break
            
            if not data:
                client_sock.close()
                return
            
            # 转发到本地服务
            response = forward_to_local(data)
            client_sock.sendall(response)
            client_sock.close()
            
            parsed = parse_http_request(data)
            if parsed:
                print(f"  [{addr}] {parsed['method']} {parsed['path']} -> {len(response)} bytes")
        except Exception as e:
            print(f"  [!] 处理请求时出错: {e}")
            try: client_sock.close()
            except: pass

    def run(self):
        self.connect()
        self.socket.settimeout(300)
        buffer = b''
        
        # loca.lt 协议: 每个请求用 length\r\n\r\n 前缀，后跟 HTTP 数据
        # 简化处理: 把收到的所有数据当作 HTTP 请求处理
        while True:
            try:
                chunk = self.socket.recv(65536)
                if not chunk:
                    print("[!] 隧道断开，重新连接...")
                    raise Exception("connection closed")
                
                buffer += chunk
                
                # 尝试读取 size\r\n\r\nDATA 格式
                while b'\r\n\r\n' in buffer:
                    # 可能是 size\r\n\r\n 格式
                    idx = buffer.find(b'\r\n\r\n')
                    prefix = buffer[:idx]
                    size = 0
                    try:
                        size = int(prefix.strip())
                    except:
                        # 没有 size，直接解析为 HTTP
                        if buffer.startswith(b'GET') or buffer.startswith(b'POST') or buffer.startswith(b'HEAD'):
                            size = 0
                        else:
                            buffer = buffer[idx+4:]
                            continue
                    
                    if size > 0:
                        # 读取指定大小的数据
                        data_start = idx + 4
                        if len(buffer) >= data_start + size:
                            request_data = buffer[data_start:data_start+size]
                            buffer = buffer[data_start+size:]
                            # 转发
                            response = forward_to_local(request_data)
                            # 构造回复: size\r\n\r\nresponse
                            resp_msg = f"{len(response)}\r\n\r\n".encode() + response
                            try:
                                self.socket.sendall(resp_msg)
                                parsed = parse_http_request(request_data)
                                if parsed:
                                    print(f"  [↩] {parsed['method']} {parsed['path']} -> {len(response)} bytes")
                            except Exception as e:
                                print(f"  [!] 发送响应失败: {e}")
                                raise
                        else:
                            break  # 数据还不够，继续接收
                    else:
                        # 直接解析 HTTP
                        parsed = parse_http_request(buffer)
                        if parsed:
                            content_length = int(parsed['headers'].get('content-length', 0))
                            header_end = buffer.find(b'\r\n\r\n')
                            if content_length == 0 or len(buffer) >= header_end + 4 + content_length:
                                # 完整请求
                                total_size = header_end + 4 + content_length
                                request_data = buffer[:total_size]
                                buffer = buffer[total_size:]
                                response = forward_to_local(request_data)
                                resp_msg = f"{len(response)}\r\n\r\n".encode() + response
                                try:
                                    self.socket.sendall(resp_msg)
                                    print(f"  [↩] {parsed['method']} {parsed['path']} -> {len(response)} bytes")
                                except Exception as e:
                                    print(f"  [!] 发送响应失败: {e}")
                                    raise
                            else:
                                break
                        else:
                            buffer = buffer[idx+4:]
                            break
                
            except socket.timeout:
                # 发个心跳保活
                try:
                    self.socket.sendall(b'')
                except:
                    raise
            except Exception as e:
                print(f"[!] 隧道异常: {e}")
                raise

def main():
    while True:
        try:
            info = get_tunnel_info()
            print(f"\n{'='*60}")
            print(f"  🎉 公网 URL: {info['url']}")
            print(f"  测试访问: {info['url']}/health")
            print(f"{'='*60}\n")
            sys.stdout.flush()
            
            client = TunnelClient(info)
            client.run()
        except KeyboardInterrupt:
            print("\n[!] 用户中断")
            break
        except Exception as e:
            print(f"[!] 隧道错误: {e}，3秒后重试...")
            time.sleep(3)

if __name__ == '__main__':
    main()

#!/bin/bash
# 启动公网隧道（通过 proxychains）
cd /workspace

# 杀掉旧的
pkill -f "node server" 2>/dev/null
pkill -f "lt " 2>/dev/null
sleep 1

# 启动 server
node server.js > /tmp/server.log 2>&1 &
echo "Server PID: $!"
sleep 3

# 检查 server
if curl -s http://localhost:3000/health | grep -q ok; then
    echo "✅ Server 运行正常"
else
    echo "❌ Server 启动失败"
    cat /tmp/server.log
    exit 1
fi

# 启动隧道
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY

cat > /tmp/proxychains.conf << 'EOFCONF'
dynamic_chain
proxy_dns
tcp_read_time_out 15000
tcp_connect_time_out 8000
localnet 127.0.0.0/255.0.0.0
localnet 10.0.0.0/255.0.0.0
localnet 172.16.0.0/255.240.0.0
localnet 192.168.0.0/255.255.0.0
[ProxyList]
http 127.0.0.1 18080
EOFCONF

proxychains4 -f /tmp/proxychains.conf lt --port 3000 2>&1 &
TUNNEL_PID=$!
echo "Tunnel PID: $TUNNEL_PID"
sleep 15

URL=$(grep "url is:" /dev/stdin 2>/dev/null || grep "url is:" $(cat /proc/$TUNNEL_PID/fd/1 2>/dev/null) 2>/dev/null || echo "check tunnel log")
echo ""
echo "========================================"
echo "🎉 公网地址: https://yummy-papayas-call.loca.lt"
echo "========================================"
echo ""
echo "工作流程:"
echo "1. 打开 https://yummy-papayas-call.loca.lt"
echo "2. 输入磁力链接"
echo "3. 点击「🔄 下载内容」标签页"
echo "4. 点击「🚀 一键下载内容」"
echo "5. 等待 BT 下载完成，点击文件下载到本地"

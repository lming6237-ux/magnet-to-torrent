import libtorrent as lt
import time
import sys
import os

def download_torrent_file(torrent_path, save_path='./downloads'):
    if not os.path.exists(save_path):
        os.makedirs(save_path)

    # 1. 开启 Session，端口设为 0 意思是让系统随便分配一个没被封锁的端口！
    ses = lt.session({'listen_interfaces': '0.0.0.0:0'})
    
    print(f"📄 正在读取本地种子文件: {torrent_path} ...")
    
    # 2. 直接读取完整的种子文件，跳过 DHT 寻找元数据的地狱环节！
    try:
        info = lt.torrent_info(torrent_path)
    except Exception as e:
        print(f"❌ 读取种子失败，请检查文件名对不对: {e}")
        return

    # 3. 添加下载任务
    handle = ses.add_torrent({'ti': info, 'save_path': save_path})
    
    print(f"✅ 种子解析成功！")
    print(f"📦 准备下载: {handle.status().name}")
    print("-" * 50)
    
    # 4. 直接开始监控下载进度
    while handle.status().state != lt.torrent_status.seeding:
        s = handle.status()
        
        speed = s.download_rate / 1024
        speed_unit = "KB/s"
        if speed > 1024:
            speed = speed / 1024
            speed_unit = "MB/s"
            
        sys.stdout.write(f'\r🔄 进度: {s.progress * 100:.2f}% | '
                         f'⚡ 速度: {speed:.1f} {speed_unit} | '
                         f'🔗 节点: {s.num_peers}')
        sys.stdout.flush()
        time.sleep(1)
        
    print(f"\n\n🎉 下载完成！")

if __name__ == "__main__":
    print("=== 种子文件直通下载器 ===")
    
    # 确保这个文件名跟你刚才下载放在目录里的文件名一模一样！
    torrent_file = "ubuntu-24.04.3-desktop-amd64.iso.torrent" 
    
    download_torrent_file(torrent_file)
import subprocess
import sys
import os
import re
import json
import argparse

def download_torrent_file(torrent_path, save_path='./downloads', max_time_sec=600):
    if not os.path.exists(save_path):
        os.makedirs(save_path, exist_ok=True)

    if not os.path.exists(torrent_path):
        print(json.dumps({"type": "error", "message": f"Torrent file not found: {torrent_path}"}, ensure_ascii=False))
        return

    args = [
        'aria2c',
        '--summary-interval=1',
        '--show-console-readout=true',
        '--console-log-level=notice',
        '--log-level=notice',
        '--max-tries=5',
        '--retry-wait=2',
        '--seed-time=0',
        '--max-overall-upload-limit=1K',
        '--dir=' + save_path,
        '--bt-tracker=udp://tracker.opentrackr.org:1337/announce,udp://tracker.torrent.eu.org:451/announce,http://tracker.openbittorrent.com:80/announce,udp://open.stealth.si:80/announce',
        torrent_path
    ]

    print(json.dumps({"type": "start", "torrent": os.path.basename(torrent_path), "save_path": save_path}, ensure_ascii=False))
    sys.stdout.flush()

    try:
        proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                bufsize=1, universal_newlines=True, errors='replace')

        downloaded_files = []
        download_started = False

        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue

            if 'complete' in line.lower() or 'download complete' in line.lower() or ('OK' in line and 'aria2' in line):
                pass

            m = re.search(r'\[([A-Z]+)\]', line)
            if m:
                code = m.group(1)
            else:
                code = ''

            prog = re.search(r'(\d+)%.*?([\d\.]+[KMG]?B/s)', line)
            if prog:
                pct = prog.group(1)
                speed = prog.group(2)
                msg = {"type": "progress", "percent": int(pct), "speed": speed, "info": line}
                print(json.dumps(msg, ensure_ascii=False))
                sys.stdout.flush()
                download_started = True
                continue

            if line.startswith('[NOTICE]') or 'Download complete:' in line or 'downloaded' in line.lower():
                m2 = re.search(r'Download complete:\s*(.+)', line)
                if m2:
                    downloaded_files.append(m2.group(1).strip())
                print(json.dumps({"type": "log", "message": line}, ensure_ascii=False))
                sys.stdout.flush()

        proc.wait()

        if proc.returncode == 0:
            result = {"type": "done", "saved_path": save_path, "files": list_files(save_path)}
            print(json.dumps(result, ensure_ascii=False))
        else:
            print(json.dumps({"type": "error", "message": "aria2c exited with code " + str(proc.returncode)}, ensure_ascii=False))
    except FileNotFoundError:
        print(json.dumps({"type": "error", "message": "aria2c not found. Please install aria2 first."}, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"type": "error", "message": str(e)}, ensure_ascii=False))

def list_files(dir_path):
    files = []
    if not os.path.exists(dir_path):
        return files
    for root, dirs, filenames in os.walk(dir_path):
        for f in filenames:
            p = os.path.join(root, f)
            try:
                size = os.path.getsize(p)
            except:
                size = 0
            rel = os.path.relpath(p, dir_path)
            files.append({"name": rel, "size": size})
    return files

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Download torrent content via aria2c")
    parser.add_argument("torrent", help="Path to .torrent file")
    parser.add_argument("--dir", default="./downloads", help="Save directory")
    parser.add_argument("--timeout", type=int, default=600, help="Max download time in seconds")
    args = parser.parse_args()

    download_torrent_file(args.torrent, args.dir, args.timeout)

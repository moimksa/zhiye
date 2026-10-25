#!/usr/bin/env python3
"""Open the reader, starting its local service only when necessary."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import sys
import time
from urllib.request import urlopen
import webbrowser

HERE = Path(__file__).resolve().parent
IDENTITY = hashlib.sha256(str(HERE.parent).encode()).hexdigest()[:16]


def health(port):
    try:
        with urlopen("http://127.0.0.1:%d/api/health" % port, timeout=0.6) as response:
            return json.load(response)
    except Exception:
        return None


def launch(open_browser=True):
    for port in range(8765, 8776):
        status = health(port)
        if status and status.get("app") == "zhiye-reader" and status.get("identity") == IDENTITY:
            url = "http://127.0.0.1:%d" % port
            if open_browser:
                webbrowser.open(url)
            return url
    data_dir = HERE / "data"
    data_dir.mkdir(exist_ok=True)
    for port in range(8765, 8776):
        log = (data_dir / "server.log").open("ab")
        process = subprocess.Popen([sys.executable, str(HERE / "server.py"), "--port", str(port)],
                                   cwd=HERE, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                   start_new_session=True)
        log.close()
        for _ in range(30):
            if process.poll() is not None:
                break
            status = health(port)
            if status and status.get("identity") == IDENTITY:
                url = "http://127.0.0.1:%d" % port
                (data_dir / "service.json").write_text(json.dumps({"pid": process.pid, "port": port, "identity": IDENTITY}), encoding="utf-8")
                if open_browser:
                    webbrowser.open(url)
                return url
            time.sleep(0.15)
    raise RuntimeError("阅读器未能启动。请查看阅读器/data/server.log。")


if __name__ == "__main__":
    print(launch(open_browser="--no-open" not in sys.argv))

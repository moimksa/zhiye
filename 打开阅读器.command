#!/bin/zsh
set -eu
READER_PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
if command -v python3 >/dev/null 2>&1; then
  python3 "$READER_PROJECT_DIR/阅读器/launch.py"
else
  print "没有找到 Python 3。请安装 Python 3 后再打开阅读器。"
  read -r "READER_DISMISS?按回车关闭…"
fi

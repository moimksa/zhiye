#!/usr/bin/env python3
"""Create an ignored personal workspace without overwriting existing files."""
from pathlib import Path


def initialize(root):
    root = Path(root)
    personal = root / "个人资料"
    personal.mkdir(exist_ok=True)
    created = []
    for name in ("学习档案.md", "学习记录.md", "当前重点.md"):
        target = personal / name
        try:
            with target.open("x", encoding="utf-8") as stream:
                stream.write((root / "模板" / name).read_text(encoding="utf-8"))
            created.append(name)
        except FileExistsError:
            pass
    for name in ("课程", "知识库", "练习", "备考"):
        (personal / name).mkdir(exist_ok=True)
    return created


if __name__ == "__main__":
    created = initialize(Path(__file__).resolve().parents[1])
    print("个人资料目录已就绪；新建 %d 个模板，已有文件未改动。" % len(created))

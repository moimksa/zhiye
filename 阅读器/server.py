#!/usr/bin/env python3
"""A loopback-only Markdown library, with annotations stored beside the reader."""
import argparse
import hashlib
import json
import math
import mimetypes
import os
from pathlib import Path
import re
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, unquote, urlsplit

APP_DIR = Path(__file__).resolve().parent
DEFAULT_ROOT = APP_DIR.parent
EXCLUDED = {"阅读器", "tmp", "node_modules", "__pycache__", "output", "dist", "scripts", "tests"}
PROJECT_DOCS = {"AGENTS.md", "CONTRIBUTING.md", "README.en.md", "SECURITY.md", "THIRD_PARTY_NOTICES.md"}
GROUPS = ["章节讲义", "专题笔记", "练习与解析", "课程导航", "学习与备考", "知识索引", "模板"]


def visible_path(path, root):
    try:
        parts = path.resolve().relative_to(root.resolve()).parts
    except ValueError:
        return False
    return bool(parts) and not any(p.startswith(".") or p in EXCLUDED for p in parts) and path.name not in PROJECT_DOCS


def clean_title(title):
    title = re.sub(r"[（(][A-Za-z][^）)]*[）)]", "", title)
    title = re.sub(r"[*`#]", "", title)
    return re.sub(r"\s+", " ", title).strip()


def search_excerpt(content, term):
    prose = re.sub(r"!?\[([^\]]*)\]\([^\s)]*(?:\s+\"[^\"]*\")?\)", r"\1", content)
    prose = re.sub(r"\$\$[\s\S]*?\$\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]", "〔公式〕", prose)
    prose = re.sub(r"[#*`|]", "", prose)
    prose = re.sub(r"\s+", " ", prose).strip()
    position = prose.casefold().find(term.casefold())
    if position < 0:
        return "相关公式或链接中包含检索词。" + prose[:140]
    start, end = max(0, position - 38), position + len(term) + 105
    return ("…" if start else "") + prose[start:end] + ("…" if end < len(prose) else "")


class Library:
    def __init__(self, root, data_dir):
        self.root = Path(root).resolve()
        self.data_dir = Path(data_dir)
        self.state_file = self.data_dir / "阅读记录.json"
        self.lock = threading.RLock()
        self.identity = hashlib.sha256(str(self.root).encode()).hexdigest()[:16]

    def resolve(self, name, suffix=None):
        path = (self.root / name).resolve()
        if not visible_path(path, self.root) or not path.is_file():
            raise FileNotFoundError("文件不存在或不属于学习资料。")
        if suffix and path.suffix.lower() != suffix:
            raise ValueError("文件类型不正确。")
        return path

    def index(self):
        docs = []
        for directory, dirs, names in os.walk(self.root):
            dirs[:] = sorted(d for d in dirs if not d.startswith(".") and d not in EXCLUDED and d != "docs")
            for name in sorted(names):
                if not name.lower().endswith(".md"):
                    continue
                path = Path(directory) / name
                if not visible_path(path, self.root):
                    continue
                relative = path.relative_to(self.root).as_posix()
                try:
                    raw = path.read_text(encoding="utf-8")
                    stat = path.stat()
                except (OSError, UnicodeError):
                    continue
                heading = re.search(r"^#\s+(.+)$", raw, re.M)
                title = clean_title(heading.group(1) if heading else path.stem)
                chapter = re.match(r"(\d{2})-", name)
                parts = relative.split("/")
                personal = parts[0] == "个人资料"
                scoped = parts[1:] if personal else parts
                section = scoped[0]
                if section == "知识库" and chapter:
                    group = "章节讲义"
                elif section == "知识库":
                    group = "专题笔记"
                elif section == "练习":
                    group = "练习与解析"
                elif section == "课程":
                    group = "课程导航"
                elif section in {"学习系统", "备考"} or personal:
                    group = "学习与备考"
                elif section == "模板":
                    group = "模板"
                else:
                    group = "知识索引"
                if section == "课程" and len(scoped) >= 3:
                    course = scoped[1].replace("-", " ")
                elif section == "知识库" and len(scoped) >= 3:
                    course = scoped[-2].replace("-", " ")
                else:
                    course = "我的学习" if personal else "知页"
                docs.append({"path": relative, "title": title, "group": group,
                             "chapter": chapter.group(1) if chapter else None,
                             "course": course,
                             "modified": stat.st_mtime, "size": stat.st_size,
                             "headings": len(re.findall(r"^#{2,3}\s", raw, re.M)),
                             "excerpt": re.sub(r"[#*`\[\]]", "", raw)[:240]})
        docs.sort(key=lambda d: (GROUPS.index(d["group"]), d["chapter"] or "", d["path"]))
        fingerprint = hashlib.sha256(json.dumps([(d["path"], d["modified"], d["size"]) for d in docs]).encode()).hexdigest()
        return {"documents": docs, "groups": GROUPS, "fingerprint": fingerprint}

    def read_state(self):
        with self.lock:
            if not self.state_file.exists():
                return {"version": 1, "highlights": [], "positions": {}, "preferences": {}, "lastDocument": None}
            state = json.loads(self.state_file.read_text(encoding="utf-8"))
            if not isinstance(state, dict) or not isinstance(state.get("highlights"), list):
                raise ValueError("阅读记录格式异常；原文件已保留，请先检查。")
            return state

    def mutate(self, operation):
        with self.lock:
            state = self.read_state()
            result = operation(state)
            self.data_dir.mkdir(parents=True, exist_ok=True)
            temporary = self.state_file.with_suffix(".tmp")
            temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
            os.replace(temporary, self.state_file)
            return result

    def add_highlight(self, payload):
        self.resolve(payload.get("document", ""), ".md")
        text = payload.get("quote", "")
        if not isinstance(text, str) or not text.strip() or len(text) > 20000:
            raise ValueError("请选择一段文字后再标记。")
        color = payload.get("color", "yellow")
        if color not in {"yellow", "green", "purple"}:
            raise ValueError("未知的高光颜色。")
        start, end = payload.get("start", 0), payload.get("end", 0)
        if not isinstance(start, int) or not isinstance(end, int) or start < 0 or end <= start:
            raise ValueError("选区位置无效。")
        item = {"id": uuid.uuid4().hex, "document": payload["document"], "quote": text,
                "start": start, "end": end, "prefix": str(payload.get("prefix", ""))[-80:],
                "suffix": str(payload.get("suffix", ""))[:80], "color": color,
                "note": str(payload.get("note", ""))[:4000], "created": time.time()}
        def insert(state):
            existing = next((h for h in state["highlights"] if h["document"] == item["document"] and h["start"] == start and h["end"] == end and h["quote"] == text), None)
            if existing:
                existing["color"] = color
                return existing
            state["highlights"].append(item)
            return item
        return self.mutate(insert)


def make_handler(library, web_dir=None):
    web_dir = Path(web_dir or APP_DIR / "web").resolve()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            if len(args) > 1 and str(args[1]).isdigit() and int(args[1]) >= 400:
                super().log_message(fmt, *args)

        def respond_headers(self, status, content_type, length, extra=None):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(length))
            self.send_header("Cache-Control", "no-cache")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https:; connect-src 'self'; object-src 'self'; frame-ancestors 'self'; base-uri 'none'")
            for key, value in (extra or {}).items():
                self.send_header(key, value)
            self.end_headers()

        def json_response(self, payload, status=200, extra=None):
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.respond_headers(status, "application/json; charset=utf-8", len(data), extra)
            self.wfile.write(data)

        def send_file(self, path):
            size = path.stat().st_size
            start, end, status = 0, size - 1, 200
            extra = {"Accept-Ranges": "bytes"}
            requested = self.headers.get("Range", "")
            if requested:
                match = re.fullmatch(r"bytes=(\d*)-(\d*)", requested)
                if not match or not any(match.groups()):
                    return self.json_response({"error": "无效的文件范围。"}, 416)
                left, right = match.groups()
                if left:
                    start = int(left)
                    end = min(int(right), size - 1) if right else size - 1
                else:
                    start = max(0, size - int(right))
                if start > end or start >= size:
                    return self.json_response({"error": "文件范围越界。"}, 416, {"Content-Range": "bytes */%d" % size})
                status = 206
                extra["Content-Range"] = "bytes %d-%d/%d" % (start, end, size)
            mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            if mime.startswith("text/") or mime in {"application/javascript", "application/json"}:
                mime += "; charset=utf-8"
            self.respond_headers(status, mime, end - start + 1, extra)
            with path.open("rb") as stream:
                stream.seek(start)
                remaining = end - start + 1
                while remaining > 0:
                    data = stream.read(min(65536, remaining))
                    if not data:
                        break
                    self.wfile.write(data)
                    remaining -= len(data)

        def do_GET(self):
            if not self.local_host():
                return self.json_response({"error": "仅接受本机地址请求。"}, 403)
            try:
                parsed = urlsplit(self.path)
                query = parse_qs(parsed.query)
                if parsed.path == "/api/health":
                    return self.json_response({"app": "zhiye-reader", "identity": library.identity})
                if parsed.path == "/api/index":
                    return self.json_response(library.index())
                if parsed.path == "/api/document":
                    path = library.resolve(query.get("path", [""])[0], ".md")
                    return self.json_response({"path": path.relative_to(library.root).as_posix(), "content": path.read_text(encoding="utf-8"), "modified": path.stat().st_mtime})
                if parsed.path == "/api/search":
                    term = query.get("q", [""])[0].strip()[:200]
                    results = []
                    if term:
                        for doc in library.index()["documents"]:
                            content = library.resolve(doc["path"], ".md").read_text(encoding="utf-8")
                            pos = content.casefold().find(term.casefold())
                            if pos >= 0 or term.casefold() in doc["title"].casefold():
                                results.append({**doc, "snippet": search_excerpt(content, term)})
                    return self.json_response({"results": results[:60]})
                if parsed.path == "/api/state":
                    return self.json_response(library.read_state())
                if parsed.path == "/api/export":
                    return self.json_response(library.read_state(), extra={"Content-Disposition": "attachment; filename=zhiye-highlights.json"})
                if parsed.path == "/file":
                    path = library.resolve(query.get("path", [""])[0])
                    if path.suffix.lower() not in {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".txt", ".md"}:
                        raise ValueError("暂不支持直接预览此文件。")
                    return self.send_file(path)
                relative = unquote(parsed.path).lstrip("/") or "index.html"
                path = (web_dir / relative).resolve()
                if not path.is_relative_to(web_dir) or not path.is_file():
                    raise FileNotFoundError("页面不存在。")
                return self.send_file(path)
            except (FileNotFoundError, UnicodeError) as exc:
                self.json_response({"error": str(exc)}, 404)
            except (ValueError, json.JSONDecodeError) as exc:
                self.json_response({"error": str(exc)}, 400)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def local_host(self):
            return self.headers.get("Host") in {
                "127.0.0.1:%s" % self.server.server_port,
                "localhost:%s" % self.server.server_port,
            }

        def mutate_request(self):
            if not self.local_host():
                return self.json_response({"error": "仅接受本机地址请求。"}, 403)
            incoming = self.headers
            try:
                origin = incoming.get("Origin")
                permitted = {"http://127.0.0.1:%s" % self.server.server_port, "http://localhost:%s" % self.server.server_port}
                if incoming.get("X-Reader-Request") != "1" or (origin and origin not in permitted):
                    return self.json_response({"error": "请求来源不匹配。"}, 403)
                length = int(incoming.get("Content-Length", 0))
                if length < 0 or length > 100000:
                    raise ValueError("请求内容过长。")
                data = json.loads(self.rfile.read(length) or b"{}")
                if not isinstance(data, dict):
                    raise ValueError("请求格式不正确。")
                route = urlsplit(self.path).path
                if route == "/api/highlights" and self.command == "POST":
                    return self.json_response(library.add_highlight(data), 201)
                if route.startswith("/api/highlights/") and self.command in {"PATCH", "DELETE"}:
                    identifier = route.rsplit("/", 1)[-1]
                    def edit(state):
                        item = next((h for h in state["highlights"] if h["id"] == identifier), None)
                        if not item:
                            raise FileNotFoundError("这条高光已不存在。")
                        if self.command == "DELETE":
                            state["highlights"].remove(item)
                            return {"deleted": identifier}
                        if "color" in data:
                            if data["color"] not in {"yellow", "green", "purple"}:
                                raise ValueError("未知颜色。")
                            item["color"] = data["color"]
                        if "note" in data:
                            item["note"] = str(data["note"])[:4000]
                        return item
                    return self.json_response(library.mutate(edit))
                if route == "/api/state" and self.command == "PATCH":
                    def update(state):
                        if "lastDocument" in data:
                            library.resolve(data["lastDocument"], ".md")
                            state["lastDocument"] = data["lastDocument"]
                        if "position" in data:
                            item = data["position"]
                            library.resolve(item["document"], ".md")
                            value = float(item["value"])
                            if not math.isfinite(value):
                                raise ValueError("阅读位置无效。")
                            state.setdefault("positions", {})[item["document"]] = max(0, min(1, value))
                        if "preferences" in data:
                            prefs = data["preferences"]
                            if not isinstance(prefs, dict):
                                raise ValueError("偏好格式不正确。")
                            allowed = {k: v for k, v in prefs.items() if k in {"theme", "fontSize", "focus", "wide"}}
                            state.setdefault("preferences", {}).update(allowed)
                        return {"saved": True}
                    return self.json_response(library.mutate(update))
                raise FileNotFoundError("接口不存在。")
            except FileNotFoundError as exc:
                self.json_response({"error": str(exc)}, 404)
            except (ValueError, KeyError, TypeError) as exc:
                self.json_response({"error": str(exc)}, 400)

        do_POST = mutate_request
        do_PATCH = mutate_request
        do_DELETE = mutate_request

    return Handler


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--data-dir", type=Path, default=APP_DIR / "data")
    args = parser.parse_args()
    library = Library(args.root, args.data_dir)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(library))
    print("知页阅读器：http://127.0.0.1:%s" % server.server_port, flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

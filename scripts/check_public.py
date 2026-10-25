#!/usr/bin/env python3
"""Check the intended public Git snapshot without printing matched secrets."""
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
PRIVATE_PARTS = {"个人资料", "private", "local", ".history", ".codex", "node_modules", "__pycache__", "课件", "作业"}
PRIVATE_SUFFIXES = {".pdf", ".docx", ".pptx", ".xlsx", ".csv", ".log", ".pem", ".key", ".p12", ".bak", ".zip"}
TEXT_SUFFIXES = {".md", ".py", ".js", ".cjs", ".json", ".html", ".css", ".svg", ".txt", ".yml", ".yaml", ".command"}
SECRET_PATTERNS = {
    "private key": r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
    "GitHub token": r"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b",
    "API key": r"\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b",
    "cloud access key": r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b",
    "user home path": r"/(?:Users|home)/[A-Za-z0-9_.-]+/",
    "Windows user path": r"[A-Za-z]:\\Users\\[^\\\s]+\\",
    "email address": r"\b[A-Za-z0-9._%+-]+@(?!(?:users\.)?noreply\.github\.com\b|example\.(?:com|org)\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b",
}


def tracked_files():
    result = subprocess.run(["git", "ls-files", "--stage", "-z"], cwd=ROOT, check=True, capture_output=True)
    paths = []
    for entry in result.stdout.decode("utf-8").split("\0"):
        if entry:
            metadata, name = entry.split("\t", 1)
            mode, _, stage = metadata.split()
            if stage != "0":
                raise ValueError("Resolve Git conflicts before checking the public snapshot.")
            paths.append((PurePosixPath(name), mode))
    if not paths:
        raise ValueError("No tracked files. Stage intended public files before running this check.")
    return paths


def check():
    issues = []
    paths = tracked_files()
    tracked = {str(path) for path, mode in paths}
    links = 0
    for rel, mode in paths:
        name = str(rel)
        private = any(part in PRIVATE_PARTS for part in rel.parts)
        private = private or name.startswith("阅读器/data/") or rel.suffix.lower() in PRIVATE_SUFFIXES
        private = private or any(part.startswith(".env") for part in rel.parts) or rel.name in {".DS_Store", "Thumbs.db"}
        if private:
            issues.append((name, "private file category"))
        path = ROOT / name
        if mode == "120000":
            issues.append((name, "symbolic link must be reviewed explicitly"))
            continue
        if path.suffix not in TEXT_SUFFIXES and path.name not in {"LICENSE", ".gitignore"}:
            continue
        content = subprocess.run(["git", "show", ":" + name], cwd=ROOT, check=True, capture_output=True).stdout.decode("utf-8")
        # Upstream copyright notices and dependency metadata are retained verbatim.
        third_party = name.startswith("阅读器/web/vendor/") or rel.name == "package-lock.json"
        if not third_party:
            for label, pattern in SECRET_PATTERNS.items():
                if re.search(pattern, content):
                    issues.append((name, label))
        if path.suffix != ".md" or third_party:
            continue
        prose = re.sub(r"```[\s\S]*?```|`[^`\n]*`", "", content)
        for target in re.findall(r"!?\[[^\]\n]+\]\(([^\s)]+)\)", prose):
            if target.startswith(("#", "//")) or re.match(r"[A-Za-z][A-Za-z0-9+.-]*:", target):
                continue
            destination = unquote(target.split("#", 1)[0].split("?", 1)[0]).strip("<>")
            resolved = (path.parent / destination).resolve()
            try:
                linked = resolved.relative_to(ROOT).as_posix()
            except ValueError:
                issues.append((name, "link outside repository"))
                continue
            links += 1
            if linked not in tracked and not any(item.startswith(linked.rstrip("/") + "/") for item in tracked):
                issues.append((name, "link target is not in public snapshot: " + linked))
    if issues:
        for file, reason in issues:
            print("FAIL %s: %s" % (file, reason))
        print("Matched values are intentionally not printed.")
        return 1
    print("Public snapshot check passed: %d tracked files, %d local links; no flagged patterns." % (len(paths), links))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(check())
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        print("Check could not complete: %s" % exc)
        sys.exit(1)

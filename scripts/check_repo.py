#!/usr/bin/env python3
"""Lightweight, dependency-free repository hygiene checks (not application tests)."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
MARKDOWN_LINK = re.compile(r"!?\[[^\]\n]*\]\(([^)]+)\)")
TEXT_NAMES = {".editorconfig", ".gitattributes", ".gitignore", "pre-push"}
TEXT_SUFFIXES = {".md", ".yaml", ".yml", ".py", ".toml", ".json", ".txt", ".sh", ".ps1"}
REQUIRED = {
    "README.md", "CONTRIBUTING.md", "SECURITY.md", ".gitattributes",
    ".github/workflows/repository-checks.yml", ".github/dependabot.yml",
    ".githooks/pre-push",
}


def is_text(path: Path) -> bool:
    return path.name in TEXT_NAMES or path.suffix.lower() in TEXT_SUFFIXES


def tracked_files(root: Path) -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "-z"], cwd=root, check=True, capture_output=True
    )
    return [root / Path(p.decode("utf-8", "surrogateescape"))
            for p in result.stdout.split(b"\0") if p]


def validate_text(path: Path) -> list[str]:
    content = path.read_bytes()
    errors = []
    if b"\r" in content:
        errors.append("CR detected: text files must use LF")
    if content and not content.endswith(b"\n"):
        errors.append("missing final newline")
    if b"\0" in content:
        errors.append("NUL detected in expected text file")
    try:
        content.decode("utf-8")
    except UnicodeDecodeError:
        errors.append("expected UTF-8 encoding")
    return errors


def markdown_targets(source: str) -> list[str]:
    """Find relative inline links while excluding fenced code blocks and URLs."""
    targets = []
    fenced = False
    fence_mark = ""
    for line in source.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("```") or stripped.startswith("~~~"):
            mark = stripped[:3]
            if not fenced:
                fenced, fence_mark = True, mark
            elif mark == fence_mark:
                fenced, fence_mark = False, ""
            continue
        if fenced:
            continue
        for raw in MARKDOWN_LINK.findall(line):
            raw = raw.strip().strip("<>").split(' "', 1)[0]
            if not raw or raw.startswith("#"):
                continue
            parsed = urlsplit(raw)
            if parsed.scheme or parsed.netloc or raw.startswith("//"):
                continue
            path = unquote(parsed.path)
            if path:
                targets.append(path)
    return targets


def validate_markdown_links(file: Path, root: Path) -> list[str]:
    try:
        content = file.read_text(encoding="utf-8")
    except UnicodeError:
        return []  # UTF-8 error is reported by validate_text()
    errors = []
    for relative in markdown_targets(content):
        dest = (file.parent / relative).resolve()
        try:
            dest.relative_to(root.resolve())
        except ValueError:
            errors.append(f"link escapes repo: {relative}")
            continue
        if not dest.exists():
            errors.append(f"broken relative link: {relative}")
        elif not has_exact_path_case(file.parent / relative, root):
            errors.append(f"relative link has incorrect path case: {relative}")
    return errors


def has_exact_path_case(path: Path, root: Path) -> bool:
    """Check directory entries explicitly, including on case-insensitive Windows."""
    current = root
    for part in path.relative_to(root).parts:
        if part == "..":
            current = current.parent
        elif part != ".":
            if part not in {entry.name for entry in current.iterdir()}:
                return False
            current = current / part
    return True


def path_case_collisions(names: set[str]) -> list[str]:
    """Include directory collisions (docs/a.md vs Docs/b.md)."""
    seen = {}
    problems = set()
    for name in sorted(names):
        parts = name.split("/")
        for length in range(1, len(parts) + 1):
            prefix = "/".join(parts[:length])
            key = prefix.casefold()
            if key in seen and seen[key] != prefix:
                problems.add(f"path case collision: {seen[key]} / {prefix}")
            seen[key] = prefix
    return sorted(problems)


def check_repo(root: Path) -> list[str]:
    problems = []
    paths = tracked_files(root)
    names = {p.relative_to(root).as_posix() for p in paths}
    problems.extend(path_case_collisions(names))
    hook = ".githooks/pre-push"
    if hook in names:
        mode = subprocess.run(
            ["git", "ls-files", "--stage", "--", hook], cwd=root,
            check=True, capture_output=True, text=True,
        ).stdout.split()
        if not mode or mode[0] != "100755":
            problems.append(f"{hook}: Git executable mode must be 100755")
    for expected in sorted(REQUIRED - names):
        problems.append(f"{expected}: required tracked file is missing")
    for path in paths:
        rel = path.relative_to(root).as_posix()
        if not path.is_file():
            problems.append(f"{rel}: tracked file does not exist")
            continue
        if path.name == ".env" or (path.name.startswith(".env.") and path.name != ".env.example"):
            problems.append(f"{rel}: local environment file must not be tracked")
        if not is_text(path):
            continue
        for error in validate_text(path):
            problems.append(f"{rel}: {error}")
        if path.suffix.lower() == ".md":
            for error in validate_markdown_links(path, root):
                problems.append(f"{rel}: {error}")
    return problems


def main() -> int:
    try:
        problems = check_repo(ROOT)
    except (OSError, subprocess.CalledProcessError) as exc:
        print(f"ERROR: repository check could not run: {exc}", file=sys.stderr)
        return 2
    if problems:
        print("Repository checks FAILED:")
        for p in problems:
            print(f" - {p}")
        return 1
    print("Repository checks PASSED: tracked text and relative Markdown links validated.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

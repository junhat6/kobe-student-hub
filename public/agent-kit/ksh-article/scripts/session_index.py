#!/usr/bin/env python3
"""Find article material in your own AI agent sessions — locally, nothing is uploaded.

Kobe Student Hub writing kit. Reads the session logs that Claude Code, Codex, Gemini CLI and
Antigravity CLI keep on this computer, and prints:

  index  one line per session: date, tool, project, title or first request, and a short ID
  show   one session (by that ID) as a short transcript (your requests + the agent's replies, no tool output)

Secrets and personal paths are masked in what this prints as a best effort: some will slip
through. Always read the result yourself before putting anything in an article.

  python3 session_index.py index --since 2026-10-01 --grep docker
  python3 session_index.py show <ID printed by index> --max-chars 20000
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

HOME = Path.home()

# Printed before any session content (index, show and --help), so the student decides with these
# in mind whether to let an agent read past sessions at all.
DISCLAIMER = """\
※ 過去セッションを材料にする前に
  1. ここに出る中身は、このスクリプトを動かした AI エージェントと、その提供元のサービスに渡ります。
  2. セッションには、パスワード・API キー・秘密鍵・メール・他の人の情報などが含まれることがあります。
  3. 伏せ字の補助は完全ではなく、すり抜けがあります。
  4. 参照するかどうか、記事に何を載せるかは本人が決めます（公開前に全文を読んでください）。"""

# A private-key header ("-----BEGIN RSA PRIVATE KEY-----") as people paste it: dashes on both
# sides (any number, also "\-", "\u002d" and Unicode dashes), any letter case, spaces or a line
# break inside. Dashes are required after KEY too, so a Markdown list item such as
# "- Begin by generating a private key with openssl" is left alone.
# Headers are found from the BEGIN/END word and the dashes around it are checked by hand: a regex
# with dashes and spaces repeated in a loop takes time growing with the square of a long "-----"
# or blank run (#214: 20,000 dashes took 18 seconds).
_KEY_WORDS = re.compile(r"(?i)(BEGIN|END)\s+(?:[A-Za-z0-9]+\s+){0,4}?PRIVATE\s+KEY(?:\s+BLOCK)?")
_DASHES = "-\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uff0d"
_HEADER_REACH = 200  # how far a header's dashes and spaces are looked for on each side


def _dashes_before(text: str, start: int) -> int:
    """Start of the dashes (and spaces) just before a BEGIN/END word, or -1 if there is none."""
    i, found, limit = start, -1, max(0, start - _HEADER_REACH)
    while i > limit:
        if text[i - 1].isspace():
            i -= 1
        elif text[max(0, i - 6):i].lower() == "\\u002d":
            i, found = i - 6, i - 6
        elif text[i - 1] in _DASHES:
            i, found = i - 1, i - 1
            if i > 0 and text[i - 1] == "\\":
                i, found = i - 1, i - 1
        else:
            break
    return found


def _dashes_after(text: str, end: int) -> int:
    """End of the dashes just after "PRIVATE KEY", or -1 if there is none."""
    i, found, limit = end, -1, min(len(text), end + _HEADER_REACH)
    while i < limit:
        if text[i].isspace() and found < 0:
            i += 1
        elif text[i] == "\\" and text[i + 1:i + 2] == "-":
            i, found = i + 2, i + 2
        elif text[i:i + 6].lower() == "\\u002d":
            i, found = i + 6, i + 6
        elif text[i] in _DASHES:
            i, found = i + 1, i + 1
        else:
            break
    return found


def hide_private_keys(text: str) -> str:
    """Hide private keys whole: header, body and END line.

    A key cut off before its END line is hidden from BEGIN to the end of the message (its body may
    be escaped or abridged in any way), and the second half of a key pasted in another message is
    hidden from the start of the message to its END line.
    """
    spans, opened, done = [], -1, 0
    for m in _KEY_WORDS.finditer(text):
        start, end = _dashes_before(text, m.start()), _dashes_after(text, m.end())
        if start < 0 or end < 0:
            continue
        if m.group(1).lower() == "begin":
            if opened < 0:
                opened = start
        elif opened >= 0:
            spans.append((opened, end))
            opened, done = -1, end
        else:
            spans.append((done, end))
            done = end
    if opened >= 0:
        spans.append((opened, len(text)))
    out, kept = [], 0
    for start, end in spans:
        out.append(text[kept:start] + "[秘密鍵を伏せました]")
        kept = end
    return "".join(out) + text[kept:]


SECRET_PATTERNS = [
    # Private keys are hidden first by hide_private_keys(): otherwise "PRIVATE_KEY=" below hides
    # only "-----BEGIN" and prints the body.
    # A middle part with neither BEGIN nor END: a long base64 run with upper, lower case and digits
    # (one PEM line is 64 characters; hex hashes and ordinary words are left alone).
    (re.compile(r"(?<![A-Za-z0-9+/])(?=[A-Za-z0-9+/]*[A-Z])(?=[A-Za-z0-9+/]*[a-z])(?=[A-Za-z0-9+/]*[0-9])[A-Za-z0-9+/]{56,}={0,2}"), "[秘密鍵を伏せました]"),
    # PuTTY .ppk: the private part runs from "Private-Lines:" to "Private-MAC: <hex>".
    (re.compile(r"Private-Lines:[\s\S]*?(?:Private-MAC:\s*[0-9A-Fa-f]+|$)"), "[秘密鍵を伏せました]"),
    (re.compile(r"\b(sk|rk|pk)-[A-Za-z0-9_-]{16,}"), "[秘密を伏せました]"),
    # A key glued to a word ("mykeysk-…"); a digit is required so "task-management-…" stays.
    (re.compile(r"(sk|rk|pk)-(?=[A-Za-z0-9_-]{0,200}[0-9])[A-Za-z0-9_-]{16,}"), "[秘密を伏せました]"),
    (re.compile(r"\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]{16,}"), "[秘密を伏せました]"),
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}"), "[秘密を伏せました]"),
    (re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}"), "[秘密を伏せました]"),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "[秘密を伏せました]"),
    (re.compile(r"\bAIza[0-9A-Za-z_-]{30,}"), "[秘密を伏せました]"),
    (re.compile(r"\bxox[abposr]-[A-Za-z0-9-]{10,}"), "[秘密を伏せました]"),
    (re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"), "[秘密を伏せました]"),
    (re.compile(r"(?i)(?<![A-Za-z0-9])(bearer|token|password|passwd|secret|api[_-]?key)\s+['\"]?[^\s'\"]{8,}"), r"\1 [秘密を伏せました]"),
    # Passwords inside URLs: scheme://user:password@host
    (re.compile(r"(?i)(?<![a-z0-9+.-])([a-z][a-z0-9+.-]*://)[^/\s:@]+:[^/\s@]+@"), r"\1[秘密を伏せました]@"),
    (re.compile(r"(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"), "[メールを伏せました]"),
]


# NAME=value / "name": "value" where the name contains a secret word (DB_PASSWORD, AWS_SECRET_ACCESS_KEY).
# The whole name is taken first and checked for the word afterwards; searching for the word inside
# a repeated name pattern takes time growing with the square of a long run of letters or dashes.
_ASSIGNMENT = re.compile(r"(?<![A-Za-z0-9_.-])([A-Za-z0-9_.-]+)(['\"]?\s*[:=]\s*['\"]?)(?=[^\s'\",;]{6})")
_VALUE = re.compile(r"[^\s'\",;]+")
_SECRET_NAME = re.compile(r"(?i)token|password|passwd|pwd|secret|api[_-]?key|access[_-]?key|private[_-]?key|credential")


def hide_assignments(text: str) -> str:
    out, kept, start = [], 0, 0
    while True:
        m = _ASSIGNMENT.search(text, start)
        if not m:
            break
        if _SECRET_NAME.search(m.group(1)):
            out.append(text[kept:m.end()] + "[秘密を伏せました]")
            kept = start = _VALUE.match(text, m.end()).end()
        else:
            start = m.end()  # the value itself may be another NAME=value
    return "".join(out) + text[kept:]


def mask(text: str) -> str:
    text = hide_assignments(hide_private_keys(text))
    for pattern, replacement in SECRET_PATTERNS:
        text = pattern.sub(replacement, text)
    home = str(HOME)
    if home and home != "/":
        text = text.replace(home, "~")
        # Claude Code names project folders after the path with every other character turned into "-".
        text = text.replace(re.sub(r"[^A-Za-z0-9]", "-", home), "~")
    name = HOME.name
    if len(name) >= 2:
        # Your user name on its own (e.g. a Gemini folder named after it), also in Claude Code's "-" form.
        for form in {name, re.sub(r"[^A-Za-z0-9]", "-", name)}:
            text = re.sub(r"(?i)(?<![A-Za-z0-9])" + re.escape(form) + r"(?![A-Za-z0-9])", "<you>", text)
    text = re.sub(r"(/Users/|/home/|C:\\Users\\)[^/\\\s]+", r"\1<you>", text)
    return re.sub(r"(?i)(?<![A-Za-z0-9])(-Users-|-home-|C--Users-)[^-/\\\s]+", r"\1<you>", text)


def project_name(folder: str) -> str:
    """The last folder of a working directory; your home folder itself is shown as "~"."""
    if not folder:
        return ""
    path = Path(folder)
    try:
        if path.is_absolute() and path.resolve() == HOME.resolve():
            return "~"
    except (OSError, RuntimeError):
        pass
    return "~" if path.name == HOME.name else path.name


def one_line(text: str, limit: int) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


def noise(text: str) -> bool:
    """Instructions injected by tools, not something you typed."""
    t = text.lstrip()
    return (
        not t
        or t.startswith("<")
        or t.startswith("# AGENTS.md instructions")
        or t.startswith("Caveat:")
        or t.startswith("[Request interrupted")
        or t.startswith("Name this chat from the user's first request")
        or t.startswith("You are working inside Orca")
    )


@dataclass
class Session:
    tool: str
    path: Path
    started: datetime | None
    project: str
    title: str


def parse_time(value) -> datetime | None:
    try:
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(value / 1000 if value > 1e11 else value, timezone.utc)
        if isinstance(value, str):
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, OSError):
        return None
    return None


def jsonl(path: Path):
    try:
        with path.open(encoding="utf-8", errors="replace") as handle:
            for line in handle:
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue
    except OSError:
        return


def text_of(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") in ("text", "input_text", "output_text"):
                parts.append(str(item.get("text", "")))
            elif isinstance(item, dict) and "text" in item and "type" not in item:
                parts.append(str(item["text"]))
        return "\n".join(parts)
    return ""


# ---- Claude Code: ~/.claude/projects/<project>/<session>.jsonl
def claude_messages(path: Path):
    for o in jsonl(path):
        kind = o.get("type")
        message = o.get("message") or {}
        if kind == "user" and not o.get("isMeta") and not o.get("isSidechain"):
            text = text_of(message.get("content"))
            if not noise(text):
                yield "you", text, o
        elif kind == "assistant" and not o.get("isSidechain"):
            text = text_of(message.get("content"))
            if text.strip():
                yield "agent", text, o


def claude_sessions():
    root = HOME / ".claude" / "projects"
    for path in root.glob("*/*.jsonl"):
        title, first, started, cwd = "", "", None, ""
        for o in jsonl(path):
            if o.get("type") == "ai-title" and not title:
                title = str(o.get("aiTitle", ""))
            if o.get("type") == "user" and not first and not o.get("isMeta"):
                text = text_of((o.get("message") or {}).get("content"))
                if not noise(text):
                    first, started, cwd = text, parse_time(o.get("timestamp")), o.get("cwd", "")
            if title and first:
                break
        if first:
            yield Session("claude", path, started, project_name(cwd) if cwd else path.parent.name, title or first)


# ---- Codex: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
def codex_messages(path: Path):
    for o in jsonl(path):
        payload = o.get("payload") or {}
        if o.get("type") == "response_item" and payload.get("type") == "message":
            role = payload.get("role")
            text = text_of(payload.get("content"))
            if role == "user" and not noise(text):
                yield "you", text, o
            elif role == "assistant" and text.strip():
                yield "agent", text, o


def codex_sessions():
    root = HOME / ".codex" / "sessions"
    for path in root.glob("*/*/*/rollout-*.jsonl"):
        cwd, started, first = "", None, ""
        for o in jsonl(path):
            payload = o.get("payload") or {}
            if o.get("type") == "session_meta":
                cwd, started = payload.get("cwd", ""), parse_time(payload.get("timestamp") or o.get("timestamp"))
            if o.get("type") == "response_item" and payload.get("role") == "user":
                text = text_of(payload.get("content"))
                if not noise(text):
                    first = text
                    break
        if first:
            yield Session("codex", path, started, project_name(cwd), first)


# ---- Gemini CLI: ~/.gemini/tmp/<project>/chats/session-*.json
def gemini_messages(path: Path):
    try:
        data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
    except (OSError, json.JSONDecodeError):
        return
    for m in data.get("messages", []):
        text = text_of(m.get("content"))
        if m.get("type") == "user" and not noise(text):
            yield "you", text, m
        elif m.get("type") in ("gemini", "model", "assistant") and text.strip():
            yield "agent", text, m


def gemini_sessions():
    for path in (HOME / ".gemini" / "tmp").glob("*/chats/session-*.json"):
        for _, text, m in gemini_messages(path):
            yield Session("gemini", path, parse_time(m.get("timestamp")), project_name(path.parent.parent.name), text)
            break


# ---- Antigravity CLI: only your requests are in a readable file (history.jsonl).
def antigravity_sessions():
    path = HOME / ".gemini" / "antigravity-cli" / "history.jsonl"
    days: dict[tuple[str, str], list[str]] = {}
    for o in jsonl(path):
        text = str(o.get("display", ""))
        if o.get("type") == "slash_command" or noise(text):
            continue
        when = parse_time(o.get("timestamp"))
        key = (when.strftime("%Y-%m-%d") if when else "", project_name(str(o.get("workspace", ""))))
        days.setdefault(key, []).append(text)
    for (day, project), prompts in days.items():
        yield Session("antigravity", path, parse_time(day + "T00:00:00+00:00") if day else None, project,
                      f"{len(prompts)}件の依頼: " + " / ".join(one_line(mask(p), 40) for p in prompts[:3]))


def all_sessions():
    for source in (claude_sessions, codex_sessions, gemini_sessions, antigravity_sessions):
        try:
            yield from source()
        except OSError:
            continue


def mentions(s: Session, word: str) -> bool:
    """Title and project first; then every request you typed in that session."""
    if word in (s.title + " " + s.project).lower():
        return True
    reader = {"claude": claude_messages, "codex": codex_messages, "gemini": gemini_messages}.get(s.tool)
    return bool(reader) and any(who == "you" and word in text.lower() for who, text, _ in reader(s.path))


def command_index(args):
    since = parse_time(args.since + "T00:00:00+00:00") if args.since else None
    rows = []
    for s in all_sessions():
        if since and (not s.started or s.started < since):
            continue
        if args.project and args.project.lower() not in s.project.lower():
            continue
        if args.grep and not mentions(s, args.grep.lower()):
            continue
        rows.append(s)
    print(DISCLAIMER + "\n")
    rows.sort(key=lambda s: s.started or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    for s in rows[: args.limit]:
        # Every column is masked here, in one place, before it is shortened.
        project, title, path = (mask(value) for value in (s.project, s.title, str(s.path)))
        day = s.started.strftime("%Y-%m-%d") if s.started else "----------"
        print(f"{day}  {s.tool:<11} {one_line(project, 28):<28}  {one_line(title, 90)}")
        print(f"            ID {session_id(s.path)}  {path}")
    if not rows:
        print("該当するセッションが見つかりませんでした。--since や --grep を外して試してください。")


def session_id(path: Path) -> str:
    """A short ID for show: hex digits only, so it can be passed unquoted in any shell.

    The masked path index prints contains "~" and "<you>", which a shell expands or reads as a
    redirect when it is passed without quotes (#215). The ID is a hash of the real path: it holds
    no user name, and it stays the same between runs.
    """
    return hashlib.sha256(str(path).encode("utf-8", "surrogateescape")).hexdigest()[:ID_LENGTH]


ID_LENGTH = 10
_ID = re.compile(r"[0-9a-f]{%d}" % ID_LENGTH)


def find_session_file(shown: str) -> Path | None:
    """Find the file for an ID printed by index (or, as before, its masked path or a real path)."""
    wanted = shown.lower() if _ID.fullmatch(shown.lower()) else None
    if not wanted:
        path = Path(os.path.expanduser(shown))
        if path.is_file():
            return path
    for s in all_sessions():
        if (session_id(s.path) == wanted) if wanted else (mask(str(s.path)) == shown):
            return s.path
    return None


def command_show(args):
    path = find_session_file(args.path.strip())
    if path is None:
        sys.exit("セッションが見つかりません: " + mask(args.path) + "（index の行にある ID を渡してください）")
    if ".claude" in path.parts:
        messages = claude_messages(path)
    elif ".codex" in path.parts:
        messages = codex_messages(path)
    elif path.suffix == ".json":
        messages = gemini_messages(path)
    else:
        sys.exit("この形式は show に対応していません（Antigravity は index に出る依頼文を使ってください）。")
    print(DISCLAIMER)
    used = 0
    for who, text, _ in messages:
        limit = args.agent_chars if who == "agent" else args.you_chars
        chunk = f"\n## {'あなた' if who == 'you' else 'エージェント'}\n{mask(text.strip())[:limit]}\n"
        if used + len(chunk) > args.max_chars:
            print("\n…（ここで打ち切りました。--max-chars を増やすと続きを読めます）")
            break
        print(chunk, end="")
        used += len(chunk)


def main():
    parser = argparse.ArgumentParser(description=DISCLAIMER + "\n\n" + __doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    index = sub.add_parser("index", help="セッションの一覧")
    index.add_argument("--since", help="この日以降 (YYYY-MM-DD)")
    index.add_argument("--project", help="プロジェクト名の一部")
    index.add_argument("--grep", help="タイトル・最初の依頼に含む語")
    index.add_argument("--limit", type=int, default=60)
    index.set_defaults(run=command_index)
    show = sub.add_parser("show", help="1つのセッションを短い会話録にする")
    show.add_argument("path", metavar="ID", help="index の行にある ID（伏せたパスや実際のパスでも開けます）")
    show.add_argument("--max-chars", type=int, default=30000)
    show.add_argument("--you-chars", type=int, default=2000)
    show.add_argument("--agent-chars", type=int, default=1200)
    show.set_defaults(run=command_show)
    args = parser.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    args.run(args)


if __name__ == "__main__":
    main()

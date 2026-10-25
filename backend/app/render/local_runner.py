"""Run Argon-written ffmpeg scripts locally, safely.

The script is LLM-generated, so it is never handed to a shell. Each command is
tokenised and validated against an option allowlist (so we know exactly which
arguments are files), every file must be a plain name inside the job workdir,
filter graphs are checked for file-opening or command-executing filters, and the
command runs with shell=False, no stdin, and a timeout.
"""
from __future__ import annotations

import os
import re
import shlex
import shutil
import subprocess
from pathlib import Path

from ..config import settings
from .base import CAPTIONS_NAME, FONT_NAME, OUTPUT_NAME, SOURCE_NAME, RenderError, RenderResult

MAX_COMMANDS = 20

# Options that take one value, by base name (stream specifiers like -c:v:0 are stripped).
_VALUE_OPTS = {
    "-i", "-ss", "-to", "-t", "-sseof", "-itsoffset", "-f", "-map", "-c", "-codec", "-vcodec", "-acodec",
    "-preset", "-crf", "-b", "-maxrate", "-bufsize", "-r", "-ar", "-ac", "-pix_fmt", "-movflags",
    "-profile", "-level", "-g", "-tune", "-aspect", "-s", "-threads", "-avoid_negative_ts", "-q",
    "-qscale", "-frames", "-vframes", "-fps_mode", "-vsync", "-strict", "-loop", "-framerate",
    "-stream_loop", "-filter", "-vf", "-af", "-filter_complex", "-lavfi", "-x264-params", "-sample_fmt",
    "-metadata", "-disposition", "-video_size",
}
# Options that take no value.
_FLAG_OPTS = {"-y", "-n", "-copyts", "-start_at_zero", "-shortest", "-an", "-vn", "-sn", "-dn", "-nostdin", "-re"}
# Options whose value is a filter graph.
_FILTER_OPTS = {"-filter", "-vf", "-af", "-filter_complex", "-lavfi"}
# Container formats we allow for -f; `lavfi` lets Argon make solid colour / tone inputs.
_ALLOWED_FORMATS = {"mp4", "mov", "matroska", "mpegts", "wav", "mp3", "adts", "lavfi", "null"}

# Filters that open arbitrary files, open sockets, or execute commands.
_BANNED_FILTERS = re.compile(
    r"\b(movie|amovie|sendcmd|asendcmd|zmq|azmq|ladspa|lv2|frei0r|lut3d|lut1d|haldclutsrc|openclsrc|"
    r"coreimage|coreimagesrc|vidstabdetect|vidstabtransform|signature|metadata|ametadata)\b",
    re.I,
)
# Filter options that name a file; their values must be plain names in the workdir.
_FILE_FILTER_OPTS = re.compile(r"(?:^|[:,;\[\]=])\s*(filename|f|fontfile|textfile|file|stats_file|logfile)\s*=\s*('[^']*'|[^:,;\[\]]+)", re.I)
# subtitles= / ass= take the file as their first, unnamed argument.
_SUBTITLE_FILTERS = re.compile(r"\b(subtitles|ass)\s*=\s*('[^']*'|[^:,;\[\]]+)", re.I)
_PROTOCOL = re.compile(r"[A-Za-z][A-Za-z0-9+.-]*://|(^|[=,;\[\]|])(concat|subfile|pipe|tcp|udp|http|https|ftp|file|data|async|cache|crypto|tee|fd):", re.I)
_DRIVE_PATH = re.compile(r"[A-Za-z]:[\\/]")
_SAFE_NAME = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]{0,80}$")
_WINDOWS_RESERVED = re.compile(r"^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$", re.I)
_PROTECTED_OUTPUTS = {SOURCE_NAME, CAPTIONS_NAME, FONT_NAME}


def find_ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    # winget installs Gyan.FFmpeg under the user's package dir; PATH may not be refreshed yet.
    base = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Packages"
    for cand in base.glob("Gyan.FFmpeg*/**/bin/ffmpeg.exe"):
        return str(cand)
    raise RenderError("ffmpeg not found. Install it with: winget install Gyan.FFmpeg")


def probe_duration(path: Path | str) -> float | None:
    """Media duration in seconds via ffprobe (next to ffmpeg), or None if unknown."""
    try:
        ffprobe = str(Path(find_ffmpeg()).with_name("ffprobe" + Path(find_ffmpeg()).suffix))
        out = subprocess.run(
            [ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
            capture_output=True, stdin=subprocess.DEVNULL, encoding="utf-8", errors="replace", timeout=30,
        )
        return round(float(out.stdout.strip()), 2)
    except Exception:
        return None


def parse_script(script: str) -> list[list[str]]:
    """Split a script into ffmpeg argv lists. Supports `\\` / `^` line continuations and # comments."""
    text = script.strip()
    # Strip markdown fences if the model added them.
    text = re.sub(r"^```[a-zA-Z]*\n|```$", "", text, flags=re.M)
    joined: list[str] = []
    buf = ""
    for raw in text.splitlines():
        line = raw.rstrip()
        if not buf and (not line.strip() or line.lstrip().startswith("#")):
            continue
        if line.endswith("\\") or line.endswith("^"):
            buf += line[:-1] + " "
            continue
        buf += line
        joined.append(buf.strip())
        buf = ""
    if buf.strip():
        joined.append(buf.strip())

    commands = []
    for line in joined:
        try:
            commands.append(shlex.split(line, posix=True))
        except ValueError as e:
            raise RenderError(f"Could not parse command: {line[:200]} ({e})")
    return commands


def _check_name(name: str, what: str, workdir: Path | None) -> None:
    name = name.strip().strip("'\"")
    if not _SAFE_NAME.match(name) or ".." in name or _WINDOWS_RESERVED.match(name):
        raise RenderError(f"{what} must be a plain file name inside the job folder (e.g. seg1.mp4), got: {name!r}")
    if workdir is not None:
        root = workdir.resolve()
        if root not in (root / name).resolve().parents:
            raise RenderError(f"{what} resolves outside the job folder: {name!r}")


def _check_filtergraph(graph: str, workdir: Path | None) -> None:
    if m := _BANNED_FILTERS.search(graph):
        raise RenderError(f"Filter not allowed: {m.group(1)}")
    for m in _FILE_FILTER_OPTS.finditer(graph):
        _check_name(m.group(2), f"Filter option {m.group(1)}=", workdir)
    for m in _SUBTITLE_FILTERS.finditer(graph):
        _check_name(m.group(2), f"{m.group(1)} filter file", workdir)


def _base_option(tok: str) -> str:
    return tok.split(":", 1)[0]


def validate_command(argv: list[str], workdir: Path | None = None) -> None:
    if not argv:
        raise RenderError("Empty command")
    if Path(argv[0]).name.lower() not in ("ffmpeg", "ffmpeg.exe"):
        raise RenderError(f"Only ffmpeg commands are allowed, got: {argv[0]}")

    # Defence in depth on every token, whatever position it is in.
    for tok in argv[1:]:
        if _PROTOCOL.search(tok):
            raise RenderError(f"Protocols / URLs not allowed: {tok}")
        if _DRIVE_PATH.search(tok):
            raise RenderError(f"Absolute paths not allowed: {tok}")

    outputs: list[str] = []
    fmt: str | None = None  # last -f, applies to the next input/output
    i = 1
    while i < len(argv):
        tok = argv[i]
        if not tok.startswith("-") or tok == "-":
            if tok == "-":
                raise RenderError("stdin/stdout ('-') is not allowed")
            _check_name(tok, "Output file", workdir)
            if tok in _PROTECTED_OUTPUTS:
                raise RenderError(f"{tok} is a protected input file and cannot be overwritten")
            outputs.append(tok)
            fmt = None
            i += 1
            continue

        base = _base_option(tok)
        if base in _FLAG_OPTS:
            i += 1
            continue
        if base not in _VALUE_OPTS:
            raise RenderError(
                f"ffmpeg option {tok} is not allowed. Allowed options: "
                + " ".join(sorted(_VALUE_OPTS | _FLAG_OPTS))
            )
        if i + 1 >= len(argv):
            raise RenderError(f"Option {tok} is missing its value")
        val = argv[i + 1]

        if base == "-f":
            if val not in _ALLOWED_FORMATS:
                raise RenderError(f"Format -f {val} is not allowed (allowed: {', '.join(sorted(_ALLOWED_FORMATS))})")
            fmt = val
        elif base == "-i":
            if fmt == "lavfi":
                _check_filtergraph(val, workdir)  # generated source like color=c=black:s=1080x1920
            else:
                if val == "-":
                    raise RenderError("stdin ('-') is not allowed as an input")
                _check_name(val, "Input file", workdir)
            fmt = None
        elif base in _FILTER_OPTS:
            _check_filtergraph(val, workdir)
        i += 2

    if not outputs:
        raise RenderError("Command has no output file")


class LocalRunner:
    def __init__(self, timeout: int | None = None):
        self.timeout = timeout or settings.ffmpeg_timeout

    def run(self, script: str, workdir: Path) -> RenderResult:
        commands = parse_script(script)
        if not commands:
            raise RenderError("Script contains no commands")
        if len(commands) > MAX_COMMANDS:
            raise RenderError(f"Script has {len(commands)} commands; max is {MAX_COMMANDS}")
        for argv in commands:
            validate_command(argv, workdir)

        ffmpeg = find_ffmpeg()
        output = workdir / OUTPUT_NAME
        output.unlink(missing_ok=True)
        logs: list[str] = []
        for argv in commands:
            full = [ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *argv[1:]]
            logs.append("$ " + shlex.join(argv))
            try:
                proc = subprocess.run(
                    full, cwd=workdir, capture_output=True, stdin=subprocess.DEVNULL,
                    encoding="utf-8", errors="replace", timeout=self.timeout,
                )
            except subprocess.TimeoutExpired:
                raise RenderError(f"ffmpeg timed out after {self.timeout}s", "\n".join(logs))
            if proc.stderr:
                logs.append(proc.stderr[-4000:])
            if proc.returncode != 0:
                raise RenderError(f"ffmpeg exited with code {proc.returncode}", "\n".join(logs))

        if not output.exists():
            raise RenderError(f"Script finished but did not write {OUTPUT_NAME}", "\n".join(logs))
        return RenderResult(video_path=output, logs="\n".join(logs), commands=commands)

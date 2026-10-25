"""Edit decision list: which parts of the source footage an Argon script keeps.

Used to draw the v1 vs v2 timeline ("v2 trimmed the opening filler") instead of
showing raw ffmpeg. Best effort: commands that cut from source.mp4 with -ss and
-to/-t become segments, in script order; anything else is ignored.
"""
from __future__ import annotations

import re

from ..render.base import SOURCE_NAME
from ..render.local_runner import parse_script

_TEXT = re.compile(r"drawtext=[^\"]*?text='((?:[^'\\]|\\.)*)'")


def _time(v: str) -> float | None:
    """Parse ffmpeg time: seconds ("12.5") or [HH:]MM:SS[.ms]."""
    try:
        parts = [float(p) for p in v.split(":")]
    except ValueError:
        return None
    total = 0.0
    for p in parts:
        total = total * 60 + p
    return total


def segments(script: str) -> list[dict]:
    try:
        commands = parse_script(script)
    except Exception:
        return []
    out = []
    for argv in commands:
        if SOURCE_NAME not in argv:
            continue
        i_src = argv.index(SOURCE_NAME)
        # Input options are the ones before the -i that reads source.mp4.
        opts = argv[1:i_src]
        start = end = dur = None
        for flag, val in zip(opts, opts[1:]):
            if flag == "-ss":
                start = _time(val)
            elif flag == "-to":
                end = _time(val)
            elif flag == "-t":
                dur = _time(val)
        if start is None:
            continue
        if end is None and dur is not None:
            end = start + dur
        if end is None or end <= start:
            continue
        m = _TEXT.search(" ".join(argv))
        title = m.group(1).replace("\\:", ":").replace("\\'", "'") if m else ""
        out.append({"start": round(start, 2), "end": round(end, 2), "title": title})
    return out

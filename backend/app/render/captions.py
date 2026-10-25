"""Build an SRT file (in source-footage time) from word-level timestamps."""
from __future__ import annotations

from typing import Iterable


def _ts(seconds: float) -> str:
    ms = int(round(max(seconds, 0) * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def group_words(
    words: Iterable[dict], max_words: int = 6, max_duration: float = 2.5, max_gap: float = 0.7
) -> list[dict]:
    """Group words ({word, start, end}) into short caption cues suited to vertical video."""
    cues: list[dict] = []
    cur: list[dict] = []
    for w in words:
        text = str(w.get("word", "")).strip()
        if not text:
            continue
        if cur and (
            len(cur) >= max_words
            or w["end"] - cur[0]["start"] > max_duration
            or w["start"] - cur[-1]["end"] > max_gap
        ):
            cues.append(cur)
            cur = []
        cur.append({**w, "word": text})
    if cur:
        cues.append(cur)
    return [
        {"start": c[0]["start"], "end": c[-1]["end"], "text": " ".join(w["word"] for w in c)}
        for c in cues
    ]


def words_to_srt(words: Iterable[dict]) -> str:
    lines = []
    for i, cue in enumerate(group_words(words), start=1):
        lines += [str(i), f"{_ts(cue['start'])} --> {_ts(cue['end'])}", cue["text"], ""]
    return "\n".join(lines)

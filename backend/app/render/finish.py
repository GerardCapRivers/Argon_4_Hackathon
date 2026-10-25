"""Finishing pass applied to every render: an opening title card and a fade to black.

Deterministic (not LLM-written), so the title can be edited and re-applied in seconds
without asking Argon to re-edit. Input: the job's raw `output.mp4`; output: `final.mp4`.
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from .base import FONT_NAME, OUTPUT_NAME, RenderError
from .local_runner import find_ffmpeg, probe_duration

FINAL_NAME = "final.mp4"
TITLE_SECONDS = 2.2
FADE_OUT_SECONDS = 0.8


def finish(workdir: Path, width: int, height: int, title: str, subtitle: str = "") -> Path:
    raw = workdir / OUTPUT_NAME
    out = workdir / FINAL_NAME
    duration = probe_duration(raw)
    if not duration:
        raise RenderError("Could not read the rendered video's duration for finishing")

    # Text goes through files so any characters (quotes, colons, $) need no escaping.
    (workdir / "title.txt").write_text(title.strip() or " ", encoding="utf-8")
    (workdir / "subtitle.txt").write_text(subtitle.strip() or " ", encoding="utf-8")
    fade_at = max(duration - FADE_OUT_SECONDS, 0)
    t_out = TITLE_SECONDS - 0.4
    if not (workdir / FONT_NAME).exists():
        # drawtext without a font file needs fontconfig, which Windows ffmpeg builds can't load.
        from .workspace import _FONT_CANDIDATES
        src = next((f for f in _FONT_CANDIDATES if f.exists()), None)
        if src:
            shutil.copy2(src, workdir / FONT_NAME)
    font = f"fontfile={FONT_NAME}:" if (workdir / FONT_NAME).exists() else ""

    title_v = (
        f"[0:v]drawbox=x=(iw-ih*0.06)/2:y=ih*0.36:w=ih*0.06:h=ih*0.008:color=0x22C55E:t=fill,"
        f"drawtext={font}textfile=title.txt:fontsize=h*0.068:fontcolor=white:x=(w-text_w)/2:y=h*0.42,"
        f"drawtext={font}textfile=subtitle.txt:fontsize=h*0.032:fontcolor=0xA3A3A3:x=(w-text_w)/2:y=h*0.53,"
        f"fade=t=in:st=0:d=0.4,fade=t=out:st={t_out:.2f}:d=0.4,setsar=1,format=yuv420p,fps=30[tv]"
    )
    # Scale/pad to the format so the concat never fails on a size mismatch.
    main_v = (
        f"[2:v]scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black,"
        f"fade=t=out:st={fade_at:.2f}:d={FADE_OUT_SECONDS},setsar=1,format=yuv420p,fps=30[mv]"
    )
    main_a = f"[2:a]afade=t=out:st={fade_at:.2f}:d={FADE_OUT_SECONDS},aresample=48000,aformat=channel_layouts=stereo[ma]"
    graph = ";".join([title_v, main_v, main_a, "[tv][1:a][mv][ma]concat=n=2:v=1:a=1[v][a]"])

    cmd = [
        find_ffmpeg(), "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", f"color=c=0x0A0A0A:s={width}x{height}:d={TITLE_SECONDS}:r=30",
        "-f", "lavfi", "-t", f"{TITLE_SECONDS}", "-i", "anullsrc=r=48000:cl=stereo",
        "-i", OUTPUT_NAME,
        "-filter_complex", graph, "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "160k",
        "-movflags", "+faststart", FINAL_NAME,
    ]
    proc = subprocess.run(cmd, cwd=workdir, capture_output=True, stdin=subprocess.DEVNULL,
                          encoding="utf-8", errors="replace", timeout=180)
    if proc.returncode != 0 or not out.exists():
        raise RenderError("Finishing (title card / fade) failed", proc.stderr[-1500:])
    return out

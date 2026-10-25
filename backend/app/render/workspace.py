"""Per-iteration job folders: everything an edit script may touch lives here."""
from __future__ import annotations

import os
import shutil
from pathlib import Path

from ..config import settings
from .base import CAPTIONS_NAME, FONT_NAME, SOURCE_NAME
from .captions import words_to_srt

_FONT_CANDIDATES = [
    Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts" / "arialbd.ttf",
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
]


def _link_or_copy(src: Path, dst: Path) -> None:
    if dst.exists():
        return
    try:
        os.link(src, dst)  # hard link: instant, no extra disk for big footage
    except OSError:
        shutil.copy2(src, dst)


def prepare_workdir(project_id: int, version: int, source: Path, words: list[dict], references: list[str] | None = None) -> Path:
    workdir = settings.jobs_dir / f"p{project_id}" / f"v{version}"
    workdir.mkdir(parents=True, exist_ok=True)
    _link_or_copy(source, workdir / SOURCE_NAME)
    (workdir / CAPTIONS_NAME).write_text(words_to_srt(words), encoding="utf-8")
    font = next((f for f in _FONT_CANDIDATES if f.exists()), None)
    if font:
        _link_or_copy(font, workdir / FONT_NAME)
    logo = next((Path(r) for r in references or [] if Path(r).suffix.lower() in (".png", ".jpg", ".jpeg", ".webp") and Path(r).exists()), None)
    if logo:
        shutil.copy2(logo, workdir / "logo.png" if logo.suffix.lower() == ".png" else workdir / f"logo{logo.suffix.lower()}")
    return workdir

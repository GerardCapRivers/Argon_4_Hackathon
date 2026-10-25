"""Runner interface: takes an Argon-written edit script and produces an MP4."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

# Files every job workdir provides to the edit script. Argon is told about these names.
SOURCE_NAME = "source.mp4"
CAPTIONS_NAME = "captions.srt"
FONT_NAME = "font.ttf"
OUTPUT_NAME = "output.mp4"


class RenderError(RuntimeError):
    def __init__(self, message: str, logs: str = ""):
        super().__init__(message)
        self.logs = logs


@dataclass
class RenderResult:
    video_path: Path
    logs: str = ""
    commands: list[list[str]] = field(default_factory=list)


class Runner(Protocol):
    def run(self, script: str, workdir: Path) -> RenderResult: ...


def get_runner() -> Runner:
    from ..config import settings

    if settings.render_backend == "antigravity":
        from .antigravity_runner import AntigravityRunner

        return AntigravityRunner()
    from .local_runner import LocalRunner

    return LocalRunner()

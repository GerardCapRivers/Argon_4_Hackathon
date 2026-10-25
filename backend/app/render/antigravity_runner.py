"""Render inside Google's Antigravity managed-agent sandbox (RENDER_BACKEND=antigravity).

Flow per the design doc: one API call starts a Google-hosted Linux sandbox
running `antigravity-preview-09-2026` with model `gemini-4-argon`; we upload the
job folder (source.mp4, captions.srt, font.ttf), ask the agent to run the edit
script, then download output.mp4.

The managed-agent API surface (session creation, file upload, artifact download)
is still to be confirmed with the Google mentors at kickoff, so this runner is a
stub. Until then the backend uses LocalRunner, which is the doc's fallback path.
"""
from __future__ import annotations

from pathlib import Path

from ..config import settings
from .base import OUTPUT_NAME, RenderError, RenderResult


class AntigravityRunner:
    def __init__(self) -> None:
        self.agent = settings.antigravity_agent
        self.model = settings.argon_model

    def run(self, script: str, workdir: Path) -> RenderResult:
        # TODO(kickoff): replace with the real managed-agent calls, roughly:
        #   session = client.agents.sessions.create(agent=self.agent, model=self.model)
        #   for f in workdir.iterdir(): session.files.upload(f)
        #   session.run(f"Save this as edit.sh and run it with bash:\n{script}")
        #   session.files.download(OUTPUT_NAME, workdir / OUTPUT_NAME)
        raise RenderError(
            "Antigravity runner is not configured yet; set RENDER_BACKEND=local "
            f"(would have produced {workdir / OUTPUT_NAME} via {self.agent})."
        )

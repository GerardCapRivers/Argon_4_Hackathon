"""Runtime configuration, loaded from environment / backend/.env."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")


@dataclass(frozen=True)
class Settings:
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    argon_model: str = os.getenv("ARGON_MODEL", "gemini-4-argon")
    cheap_model: str = os.getenv("CHEAP_MODEL", "gemini-3.8-flash")
    ollama_model: str = os.getenv("OLLAMA_MODEL", "gemma3n")
    # Not OLLAMA_HOST: that is often set to a bind address (0.0.0.0) for the server.
    ollama_url: str = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
    # Layers to offload to GPU; 0 = CPU only (use if Ollama's CUDA runner crashes), unset = auto.
    ollama_num_gpu: int | None = (
        int(os.environ["OLLAMA_NUM_GPU"]) if os.getenv("OLLAMA_NUM_GPU") else None
    )
    whisper_model: str = os.getenv("WHISPER_MODEL", "small")
    whisper_device: str = os.getenv("WHISPER_DEVICE", "cuda")
    render_backend: str = os.getenv("RENDER_BACKEND", "local")
    antigravity_agent: str = os.getenv("ANTIGRAVITY_AGENT", "antigravity-preview-09-2026")
    data_dir: Path = field(
        default_factory=lambda: (BACKEND_DIR / os.getenv("DATA_DIR", "../data")).resolve()
    )
    max_video_seconds: int = int(os.getenv("MAX_VIDEO_SECONDS", "30"))
    ffmpeg_timeout: int = int(os.getenv("FFMPEG_TIMEOUT", "120"))

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def jobs_dir(self) -> Path:
        return self.data_dir / "jobs"

    @property
    def samples_dir(self) -> Path:
        return self.data_dir / "samples"

    @property
    def cache_dir(self) -> Path:
        return self.data_dir / "cache"

    @property
    def db_url(self) -> str:
        return f"sqlite:///{(self.data_dir / 'pitchstudio.db').as_posix()}"


settings = Settings()
for d in (settings.data_dir, settings.uploads_dir, settings.jobs_dir, settings.samples_dir, settings.cache_dir):
    d.mkdir(parents=True, exist_ok=True)


# Output format presets. Duration is capped at max_video_seconds for the demo.
FORMATS: dict[str, dict] = {
    "short": {"label": "YouTube Short / Reels (9:16)", "width": 1080, "height": 1920},
    "landscape": {"label": "YouTube / LinkedIn (16:9)", "width": 1920, "height": 1080},
    "square": {"label": "Square feed post (1:1)", "width": 1080, "height": 1080},
}

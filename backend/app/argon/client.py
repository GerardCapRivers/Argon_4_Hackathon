"""Thin google-genai wrapper: file uploads, per-step model routing, JSON responses."""
from __future__ import annotations

import json
import subprocess
import time
from functools import lru_cache
from pathlib import Path
from typing import Any

from google import genai
from google.genai import types

from ..config import settings

# Which model handles which step. Video understanding / critique go to Argon;
# cheap text-only steps go to the lighter tier to save tokens.
ROUTES = {
    "key_moments": "argon",
    "generate": "argon",
    "critique": "argon",
    "coach_report": "argon",
    "summarize": "cheap",
}


@lru_cache(maxsize=1)
def client() -> genai.Client:
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY is not set (backend/.env)")
    return genai.Client(api_key=settings.gemini_api_key)


def model_for(step: str) -> str:
    return settings.argon_model if ROUTES.get(step, "argon") == "argon" else settings.cheap_model


VIDEO_EXTS = {".mp4", ".mov", ".webm", ".mkv", ".m4v", ".avi"}


def make_proxy(path: Path, height: int = 480) -> Path:
    """Small H.264 copy for Gemini to watch (~10x smaller). Editing still uses the original.

    Argon only needs to *see* the footage, and uploads are the slowest step on a weak
    connection, so a 480p / low-bitrate proxy keeps analysis and critique fast and reliable.
    """
    from ..render.local_runner import find_ffmpeg

    proxy = path.with_name(path.stem + f".proxy{height}.mp4")
    if proxy.exists() and proxy.stat().st_mtime >= path.stat().st_mtime:
        return proxy
    proc = subprocess.run(
        [find_ffmpeg(), "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(path),
         "-vf", f"scale=-2:'min({height},ih)'", "-r", "24", "-c:v", "libx264", "-preset", "veryfast",
         "-crf", "30", "-c:a", "aac", "-b:a", "64k", "-ac", "1", "-movflags", "+faststart", str(proxy)],
        capture_output=True, stdin=subprocess.DEVNULL, encoding="utf-8", errors="replace", timeout=300,
    )
    if proc.returncode != 0 or not proxy.exists():
        return path  # fall back to the original rather than failing the upload
    return proxy


def upload(path: Path, timeout: float = 300, retries: int = 3, proxy: bool = True) -> types.File:
    """Upload a media file (as a small proxy if it is a video) and wait until Gemini has processed it.

    Retries with backoff, since flaky connections drop large uploads mid-way.
    """
    path = Path(path)
    src = make_proxy(path) if proxy and path.suffix.lower() in VIDEO_EXTS else path
    last: Exception | None = None
    for attempt in range(retries):
        try:
            f = client().files.upload(file=str(src))
            break
        except Exception as e:
            last = e
            time.sleep(3 * (attempt + 1))
    else:
        raise RuntimeError(f"Upload to Gemini failed after {retries} tries ({src.stat().st_size / 1e6:.1f} MB): {last}")
    deadline = time.time() + timeout
    while f.state and f.state.name == "PROCESSING":
        if time.time() > deadline:
            raise TimeoutError(f"Gemini file processing timed out for {path.name}")
        time.sleep(2)
        f = client().files.get(name=f.name)
    if f.state and f.state.name == "FAILED":
        raise RuntimeError(f"Gemini failed to process {path.name}")
    return f


MIME_BY_EXT = {
    ".pdf": "application/pdf", ".txt": "text/plain", ".md": "text/plain", ".png": "image/png",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".webm": "video/webm", ".mp4": "video/mp4",
}
_upload_cache: dict[tuple[str, float], tuple[str, str, float]] = {}
UPLOAD_TTL = 46 * 3600  # Gemini deletes uploaded files after 48 h; re-upload a little before that


def cached_upload(path: Path) -> tuple[str, str]:
    """(uri, mime_type) for a reference file, re-uploading only if it changed or the upload expired."""
    path = Path(path)
    key = (str(path), path.stat().st_mtime)
    hit = _upload_cache.get(key)
    if hit and time.time() - hit[2] < UPLOAD_TTL:
        return hit[0], hit[1]
    mime = MIME_BY_EXT.get(path.suffix.lower())
    if mime and not mime.startswith("video"):
        f = client().files.upload(file=str(path), config={"mime_type": mime})
        while f.state and f.state.name == "PROCESSING":
            time.sleep(2)
            f = client().files.get(name=f.name)
    else:
        f = upload(path)
        mime = "video/mp4"
    _upload_cache[key] = (f.uri, f.mime_type or mime, time.time())
    return f.uri, f.mime_type or mime


def file_part(uri: str, mime_type: str = "video/mp4") -> types.Part:
    return types.Part.from_uri(file_uri=uri, mime_type=mime_type)


def generate_json(
    step: str,
    system: str,
    contents: list[Any],
    schema: dict,
    low_media_res: bool = False,
    retries: int = 2,
) -> dict:
    """Call the routed model and parse a JSON response that matches `schema`."""
    config = types.GenerateContentConfig(
        system_instruction=system,
        response_mime_type="application/json",
        response_json_schema=schema,
        temperature=0.4,
    )
    if low_media_res:
        config.media_resolution = types.MediaResolution.MEDIA_RESOLUTION_LOW
    last_err: Exception | None = None
    for attempt in range(retries + 1):
        try:
            resp = client().models.generate_content(
                model=model_for(step), contents=contents, config=config
            )
            return json.loads(resp.text)
        except Exception as e:  # network / quota / malformed JSON
            last_err = e
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"{step} failed: {last_err}")

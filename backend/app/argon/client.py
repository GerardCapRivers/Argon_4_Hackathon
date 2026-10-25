"""Thin google-genai wrapper: file uploads, per-step model routing, JSON responses."""
from __future__ import annotations

import json
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


def upload(path: Path, timeout: float = 300) -> types.File:
    """Upload a media file and wait until Gemini has finished processing it."""
    f = client().files.upload(file=str(path))
    deadline = time.time() + timeout
    while f.state and f.state.name == "PROCESSING":
        if time.time() > deadline:
            raise TimeoutError(f"Gemini file processing timed out for {path.name}")
        time.sleep(2)
        f = client().files.get(name=f.name)
    if f.state and f.state.name == "FAILED":
        raise RuntimeError(f"Gemini failed to process {path.name}")
    return f


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

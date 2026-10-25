"""On-device coaching with Gemma via Ollama: turns rolling metrics into one short nudge."""
from __future__ import annotations

import json

import ollama

from ..config import settings

SYSTEM = """You are a live pitch coach whispering in a presenter's ear while they rehearse.
You get delivery metrics for the last 20 seconds and what they just said.
Targets: 130-160 wpm, almost no fillers (um/uh), eye contact >= 60%, clear words (clarity >= 0.75),
varied tone (pitch_variation >= 0.12; lower sounds monotone).
Return at most ONE nudge for the single biggest problem: max 8 words, imperative, encouraging.
`kind` must name the dimension the nudge is about. If delivery is fine, return nudge "" and kind "none".
Also rate tone, pace and articulation 1-5."""

SCHEMA = {
    "type": "object",
    "properties": {
        "nudge": {"type": "string"},
        "kind": {"type": "string", "enum": ["tone", "pace", "articulation", "fillers", "eye_contact", "none"]},
        "tone": {"type": "integer"},
        "pace": {"type": "integer"},
        "articulation": {"type": "integer"},
    },
    "required": ["nudge", "kind", "tone", "pace", "articulation"],
}

_client = ollama.AsyncClient(host=settings.ollama_url)


def _options(**opts) -> dict:
    if settings.ollama_num_gpu is not None:
        opts["num_gpu"] = settings.ollama_num_gpu
    return opts


async def coach(metrics: dict) -> dict | None:
    try:
        resp = await _client.chat(
            model=settings.ollama_model,
            messages=[
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": json.dumps(metrics)},
            ],
            format=SCHEMA,
            options=_options(temperature=0.3, num_predict=80),
            keep_alive="30m",
        )
        return json.loads(resp.message.content)
    except Exception as e:  # Ollama down / model missing: rule-based nudges still work
        return {"error": str(e)}


async def warm_up() -> None:
    """Load the model into VRAM before the presenter starts talking."""
    try:
        await _client.chat(model=settings.ollama_model, messages=[{"role": "user", "content": "hi"}],
                           options=_options(num_predict=1), keep_alive="30m")
    except Exception:
        pass

"""End-of-rehearsal report: Argon watches the recording with the live feedback log."""
from __future__ import annotations

import json
from pathlib import Path

from ..argon.client import file_part, generate_json, upload

SYSTEM = """You are an investor-pitch coach reviewing a rehearsal recording.
You also get the log of live metrics and nudges the presenter received while rehearsing.
Score delivery and content honestly (0-10), cite timestamps from the recording, and give
3-5 concrete action items ordered by impact. Be specific and kind."""

SCHEMA = {
    "type": "object",
    "properties": {
        "overall_score": {"type": "number"},
        "scores": {
            "type": "object",
            "properties": {
                "tone": {"type": "number"},
                "pace": {"type": "number"},
                "articulation": {"type": "number"},
                "eye_contact": {"type": "number"},
                "content": {"type": "number"},
            },
            "required": ["tone", "pace", "articulation", "eye_contact", "content"],
        },
        "summary": {"type": "string"},
        "strengths": {"type": "array", "items": {"type": "string"}},
        "action_items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "detail": {"type": "string"},
                    "timestamps": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["title", "detail", "timestamps"],
            },
        },
    },
    "required": ["overall_score", "scores", "summary", "strengths", "action_items"],
}


def build_report(recording: Path, feedback_log: list[dict], summary: dict) -> dict:
    f = upload(recording)
    contents = [
        file_part(f.uri, f.mime_type or "video/webm"),
        "SESSION METRICS:\n" + json.dumps(summary),
        "LIVE FEEDBACK LOG (t = seconds into the rehearsal):\n" + json.dumps(feedback_log[-200:]),
        "Write the rehearsal report.",
    ]
    return generate_json("coach_report", SYSTEM, contents, SCHEMA, low_media_res=True)

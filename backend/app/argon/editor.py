"""Argon steps: key moments, generate/revise the edit script, critique a render."""
from __future__ import annotations

import json
from typing import Any

from ..config import FORMATS, settings
from . import prompts
from pathlib import Path

from .client import cached_upload, file_part, generate_json


def _fmt(project) -> dict:
    return FORMATS.get(project.format, FORMATS["short"])


def _brief(project) -> str:
    return prompts.brief(project.goal, project.audience, project.style, _fmt(project), settings.max_video_seconds)


def style_parts(project) -> list[Any]:
    """Style references (brand guide PDF, logo, palette, example videos) + typed notes, for every step."""
    paths = [Path(p) for p in (getattr(project, "reference_paths", None) or []) if Path(p).exists()]
    notes = (getattr(project, "style_notes", "") or "").strip()
    if not paths and not notes:
        return []
    parts: list[Any] = ["STYLE REFERENCES (follow these for colours, fonts, tone and caption style; "
                        "they take priority over default styling):"]
    for p in paths:
        try:
            uri, mime = cached_upload(p)
            parts.append(file_part(uri, mime))
        except Exception:
            continue  # a reference that fails to upload shouldn't block the edit
    if notes:
        parts.append("STYLE NOTES from the presenter: " + notes)
    if any(p.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp") for p in paths):
        parts.append("A logo/brand image from the references is available as logo.png in the job folder "
                     "(e.g. overlay with `-i logo.png -filter_complex \"[1:v]scale=-1:h*0.08[l];[0:v][l]overlay=W-w-40:40\"`).")
    return parts


def _reference_parts(reference_uris: list[dict]) -> list[Any]:
    """Optional reference media (images / voice note) the user gave with their goal."""
    return [file_part(r["uri"], r["mime_type"]) for r in reference_uris]


def find_key_moments(project, reference_uris: list[dict] | None = None) -> list[dict]:
    contents = [
        file_part(project.source_file_uri),
        *_reference_parts(reference_uris or []),
        *style_parts(project),
        _brief(project)
        + "\n\nList 4-8 candidate moments (each 3-12s) that together could make the final video.",
    ]
    out = generate_json(
        "key_moments", prompts.KEY_MOMENTS_SYSTEM, contents, prompts.KEY_MOMENTS_SCHEMA, low_media_res=True
    )
    moments = sorted(out.get("moments", []), key=lambda m: m["start"])
    return [m for m in moments if m["end"] > m["start"]]


def _transcript_excerpt(words: list[dict], moments: list[dict]) -> str:
    """Word timings inside the selected moments, so cuts can land on sentence boundaries."""
    lines = []
    for m in moments:
        ws = [w for w in words if w["start"] >= m["start"] - 1 and w["end"] <= m["end"] + 1]
        text = " ".join(f"{w['word']}@{w['start']:.2f}" for w in ws)
        lines.append(f"[{m['label']} {m['start']:.2f}-{m['end']:.2f}] {text}")
    return "\n".join(lines)


def generate_script(project, moments: list[dict]) -> dict:
    contents = [
        file_part(project.source_file_uri),
        _brief(project),
        *style_parts(project),
        "SELECTED MOMENTS (source time, seconds):\n" + json.dumps(moments, indent=1),
        "WORD TIMINGS (word@start):\n" + _transcript_excerpt(project.transcript, moments),
        "Write the first-draft edit script.",
    ]
    return generate_json(
        "generate", prompts.generator_rules(_fmt(project), settings.max_video_seconds), contents,
        prompts.GENERATOR_SCHEMA, low_media_res=True,
    )


MAX_HISTORY_TURNS = 20


def format_history(turns: list[dict]) -> str:
    """Chat turns ({version, feedback, changes}) as a compact transcript, oldest first."""
    lines = []
    for t in turns[-MAX_HISTORY_TURNS:]:
        lines.append(f"You (v{t['version'] - 1} -> v{t['version']}): {t['feedback']}")
        if t.get("changes"):
            lines.append("Argon: " + "; ".join(t["changes"]))
    return "\n".join(lines)


def revise_script(
    project, moments: list[dict], prev_script: str, feedback: dict | str, render_error: str = "",
    history: list[dict] | None = None,
) -> dict:
    if isinstance(feedback, dict):
        fb = "CRITIC FEEDBACK on the rendered previous version:\n" + json.dumps(feedback, indent=1)
    else:
        fb = f"HUMAN FEEDBACK from the presenter (highest priority):\n{feedback}"
    contents = [
        file_part(project.source_file_uri),
        _brief(project),
        *style_parts(project),
        "SELECTED MOMENTS (source time, seconds):\n" + json.dumps(moments, indent=1),
        "WORD TIMINGS (word@start):\n" + _transcript_excerpt(project.transcript, moments),
        "PREVIOUS SCRIPT:\n" + prev_script,
    ]
    if history:
        contents.append(
            "CONVERSATION SO FAR with the presenter (oldest first). Keep honouring earlier requests "
            "unless the new message overrides them:\n" + format_history(history)
        )
    contents += [
        fb,
    ]
    if render_error:
        contents.append("The previous script FAILED to render with this error; fix it:\n" + render_error[-2000:])
    contents.append(
        "Revise the script to address the feedback. Keep what works. "
        "change_summary must say concretely what changed."
    )
    return generate_json(
        "generate", prompts.generator_rules(_fmt(project), settings.max_video_seconds), contents,
        prompts.GENERATOR_SCHEMA, low_media_res=True,
    )


def critique(project, rendered_uri: str) -> dict:
    contents = [
        file_part(rendered_uri),
        _brief(project),
        *style_parts(project),
        "Critique this rendered video against the brief"
        + (" and the style references (flag off-brand colours, fonts or tone)." if style_parts(project) else "."),
    ]
    return generate_json("critique", prompts.CRITIC_SYSTEM, contents, prompts.CRITIC_SCHEMA)


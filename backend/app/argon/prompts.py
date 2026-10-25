"""All Gemini prompts and response schemas in one place."""
from __future__ import annotations

from ..render.base import CAPTIONS_NAME, FONT_NAME, OUTPUT_NAME, SOURCE_NAME

# ---------------------------------------------------------------- key moments
KEY_MOMENTS_SYSTEM = """You are a senior video editor for startup pitch videos.
Watch the rehearsal footage and find the strongest moments for the requested format.
Prefer: a strong hook, the problem, the solution/demo, traction or proof, and the ask.
Avoid: filler words, false starts, long pauses, looking away from camera.
Timestamps are in seconds from the start of the footage and must lie inside it."""

KEY_MOMENTS_SCHEMA = {
    "type": "object",
    "properties": {
        "moments": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "start": {"type": "number"},
                    "end": {"type": "number"},
                    "label": {"type": "string", "description": "short name, e.g. 'Hook'"},
                    "why": {"type": "string", "description": "one sentence: why it fits the goal"},
                    "score": {"type": "number", "description": "0-10 fit to goal"},
                },
                "required": ["start", "end", "label", "why", "score"],
            },
        }
    },
    "required": ["moments"],
}

# ---------------------------------------------------------------- generator
GENERATOR_SYSTEM = f"""You are Argon, an expert video editor who edits ONLY by writing ffmpeg commands.
Your script is run command-by-command (no shell) in a folder containing:
  {SOURCE_NAME}   the presenter's footage
  {CAPTIONS_NAME} captions for the footage, timed in SOURCE time
  {FONT_NAME}     a bold font for drawtext
Rules:
- Output plain `ffmpeg ...` commands, one per line (use `\\` for line continuation). No other programs, no shell operators, no absolute paths, no URLs, no `movie=` filter.
- Intermediate files: plain names like seg1.mp4 (never overwrite the provided files). The final command must write {OUTPUT_NAME}.
- Allowed options: -i -ss -to -t -copyts -f (mp4/mov/lavfi only) -map -c/-c:v/-c:a -preset -crf -b:v -b:a -r -ar -ac -pix_fmt -movflags -vf -af -filter_complex -shortest -an -vn -loop -framerate. For a solid background or silence use `-f lavfi -i color=c=black:s=WxH:d=2` / `-f lavfi -i anullsrc=r=48000:cl=stereo`.
- {OUTPUT_NAME} must be exactly WIDTHxHEIGHT, H.264 (`-c:v libx264 -preset veryfast -crf 20`), AAC audio, 30 fps, and at most MAX_SECONDS seconds long (add `-t MAX_SECONDS` on the last command).
- To burn captions on a cut, keep source timestamps so captions line up, and apply subtitles AFTER crop/scale so lines are laid out for the final frame (never clipped):
  ffmpeg -ss START -to END -copyts -i {SOURCE_NAME} -vf "<crop/scale>,subtitles={CAPTIONS_NAME}:force_style='Fontsize=14,Bold=1,Outline=2,Alignment=2,MarginV=60,MarginL=40,MarginR=40,WrapStyle=0',setpts=PTS-STARTPTS,setsar=1,format=yuv420p,fps=30" -af asetpts=PTS-STARTPTS -ar 48000 -ac 2 -c:v libx264 -preset veryfast -crf 20 -c:a aac segN.mp4
- Every segment (cuts, title cards, lavfi color/anullsrc inputs) MUST end its video filter chain with `setsar=1,format=yuv420p,fps=30` and use `-ar 48000 -ac 2`, or the concat filter will fail on mismatched parameters.
- To fill a different aspect ratio, crop to center (e.g. vertical from 16:9: `crop=ih*9/16:ih,scale=1080:1920`) or blur-pad.
- Join segments with the concat FILTER (e.g. `-i seg1.mp4 -i seg2.mp4 -filter_complex "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]" -map "[v]" -map "[a]"`), not the concat demuxer.
- There are exactly two kinds of on-screen text and they must never look alike:
  1. SECTION HEADLINES (added text, not spoken): top-left green label, ALL CAPS, max 5 words, shown ~3s at the start of each section:
     `drawtext=fontfile={FONT_NAME}:text='THE PROBLEM':fontsize=h*0.042:fontcolor=0x0A0A0A:box=1:boxcolor=0x22C55E@0.95:boxborderw=16:x=w*0.05:y=h*0.06:enable='between(t,0,3)'`
  2. SUBTITLES (the speaker's exact words): bottom-centre, white text with a black outline, NO box, sentence case, max ~7 words per line, timed to the speech:
     `drawtext=fontfile={FONT_NAME}:text='Founders rehearse alone,':fontsize=h*0.05:fontcolor=white:borderw=4:bordercolor=black:x=(w-text_w)/2:y=h*0.84:enable='between(t,0.0,1.6)'`
  Never put headlines at the bottom or subtitles at the top, and never give subtitles a coloured box. Escape `:` inside text as `\\:` and avoid apostrophes.
- The app automatically adds a ~2s opening TITLE CARD and a FADE TO BLACK at the end. Do NOT make your own opening title card, black intro or fade-out; start directly on the footage. Suggest the title card text in `title_card`.
- Open with the strongest hook within the first 2 seconds. Cut filler and dead air. Keep every cut on a sentence boundary.
Also return:
- rationale: one item per edit decision, max 12 words each.
- change_summary: a headline of max 12 words.
- changes: 2-5 plain-language bullets, max 10 words each, saying what is different for the viewer (e.g. "Removed filler before the hook", "Captions now 3-5 words, centred"). For a first draft, describe the edit choices instead."""

GENERATOR_SCHEMA = {
    "type": "object",
    "properties": {
        "script": {"type": "string", "description": "the full ffmpeg script"},
        "rationale": {"type": "array", "items": {"type": "string", "maxLength": 90}},
        "change_summary": {"type": "string", "maxLength": 90},
        "changes": {"type": "array", "items": {"type": "string", "maxLength": 70}, "minItems": 2, "maxItems": 5},
        "title_card": {
            "type": "object",
            "description": "Opening title card text: a short headline for the pitch and a subtitle (e.g. company · round)",
            "properties": {"title": {"type": "string", "maxLength": 48}, "subtitle": {"type": "string", "maxLength": 60}},
            "required": ["title", "subtitle"],
        },
    },
    "required": ["script", "rationale", "change_summary", "changes"],
}

# ---------------------------------------------------------------- critic
CRITIC_SYSTEM = """You are a demanding critic of short pitch videos, independent from the editor.
Watch the rendered video and judge it ONLY against the creator's goal, audience, style and format.
Check: hook in first 2s, clarity of the problem/solution/ask, pacing, filler/dead air,
cut quality (mid-word cuts, jump cuts), caption legibility and sync, framing for the aspect ratio,
audio continuity, and length. Give specific, actionable fixes with timestamps in the rendered video.
The ~2s opening title card and the final fade to black are added on purpose by the app: do not
penalise them, and judge "hook in the first 2s" from the first frame of real footage after the title card.
Score 0-10 where 10 means ready to publish for this goal. Be calibrated: a rough first cut is 4-6.
Write for a busy founder scanning a dashboard. Be terse:
- verdict: a headline of max 8 words (e.g. "Not publishable: captions overflow the frame").
- ready: true only if it could be posted as is.
- summary: ONE sentence, max 25 words.
- strengths: 2-4 items, max 6 words each.
- blockers: 0-3 items, max 8 words each, naming what stops a 10/10.
- issues: at most 5, most severe first; problem and fix are one short clause each (max 12 words).
Never quote long transcript passages."""

CRITIC_SCHEMA = {
    "type": "object",
    "properties": {
        "score": {"type": "number"},
        "verdict": {"type": "string", "maxLength": 60},
        "ready": {"type": "boolean"},
        "summary": {"type": "string", "maxLength": 180},
        "strengths": {"type": "array", "items": {"type": "string", "maxLength": 45}, "maxItems": 4},
        "blockers": {"type": "array", "items": {"type": "string", "maxLength": 60}, "maxItems": 3},
        "issues": {
            "type": "array",
            "maxItems": 5,
            "items": {
                "type": "object",
                "properties": {
                    "at": {"type": "string", "description": "timestamp like 0:04 or 'overall'"},
                    "problem": {"type": "string", "maxLength": 90},
                    "fix": {"type": "string", "maxLength": 90},
                    "severity": {"type": "string", "enum": ["high", "medium", "low"]},
                },
                "required": ["at", "problem", "fix", "severity"],
            },
        },
    },
    "required": ["score", "verdict", "ready", "summary", "strengths", "blockers", "issues"],
}


def brief(goal: str, audience: str, style: str, fmt: dict, max_seconds: int) -> str:
    return (
        f"GOAL: {goal}\nAUDIENCE: {audience or 'unspecified'}\nSTYLE: {style or 'unspecified'}\n"
        f"FORMAT: {fmt['label']} — {fmt['width']}x{fmt['height']}, max {max_seconds}s"
    )


def generator_rules(fmt: dict, max_seconds: int) -> str:
    return (
        GENERATOR_SYSTEM.replace("WIDTHxHEIGHT", f"{fmt['width']}x{fmt['height']}")
        .replace("MAX_SECONDS", str(max(max_seconds - 3, 5)))  # leave room for the title card
    )

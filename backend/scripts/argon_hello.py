"""Send a prompt to Gemini 4 Argon and save the request + response to a JSON file.

Usage (from backend/): python scripts/argon_hello.py ["your prompt"] [output.json]
"""
from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.argon.client import client  # noqa: E402
from app.config import settings  # noqa: E402

prompt = sys.argv[1] if len(sys.argv) > 1 else "hi"
out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parents[2] / "docs" / "samples" / "argon_hi.json"

t = time.time()
resp = client().models.generate_content(model=settings.argon_model, contents=prompt)
u = resp.usage_metadata
record = {
    "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    "request": {"model": settings.argon_model, "contents": prompt},
    "response": {"text": resp.text, "latency_seconds": round(time.time() - t, 2)},
    "usage": {"input_tokens": u.prompt_token_count, "output_tokens": u.candidates_token_count, "total_tokens": u.total_token_count},
}
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(record, indent=2, ensure_ascii=False), encoding="utf-8")
print(resp.text)
print(f"saved -> {out}")

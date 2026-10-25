"""In-memory, thread-safe event log per project, streamed to the browser over SSE.

Background work (analysis, the edit loop) runs in threads and appends events;
SSE readers replay from any index, so a page refresh catches up.
"""
from __future__ import annotations

import threading
import time
from collections import defaultdict

_events: dict[int, list[dict]] = defaultdict(list)
_generation: dict[int, int] = defaultdict(int)  # bumped on reset so streams restart from 0
_lock = threading.Lock()


def emitter(project_id: int):
    def emit(event: str, data: dict) -> None:
        with _lock:
            _events[project_id].append({"event": event, "data": data, "ts": time.time()})

    return emit


def since(project_id: int, index: int) -> tuple[int, list[dict]]:
    """Return (generation, events from index). A changed generation means the log was reset."""
    with _lock:
        return _generation[project_id], list(_events[project_id][index:])


def reset(project_id: int) -> None:
    with _lock:
        _events[project_id].clear()
        _generation[project_id] += 1

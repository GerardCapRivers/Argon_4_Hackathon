"""Per-project locks so only one edit loop / revision runs at a time for a project."""
from __future__ import annotations

import threading
from collections import defaultdict

_locks: defaultdict[int, threading.Lock] = defaultdict(threading.Lock)
_guard = threading.Lock()


def try_acquire(project_id: int) -> bool:
    with _guard:
        lock = _locks[project_id]
    return lock.acquire(blocking=False)


def release(project_id: int) -> None:
    with _guard:
        lock = _locks[project_id]
    if lock.locked():
        lock.release()

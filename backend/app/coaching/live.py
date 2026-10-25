"""One live rehearsal: PCM audio + browser signals in, metrics + nudges out.

Protocol on /ws/coach/{id}:
  client -> binary: little-endian int16 mono PCM at 16 kHz
  client -> text:   {"type":"signals","t":sec,"eye":bool|null,"rms":float|null,"pitch":float|null}
                    {"type":"stop"}
  server -> text:   {"type":"metrics", ...snapshot}
                    {"type":"nudge","kind","message","source":"rule"|"gemma","t"}
                    {"type":"transcript","text","t"}
"""
from __future__ import annotations

import asyncio
import time

import numpy as np

from . import gemma_coach
from .metrics import RollingMetrics, rule_nudges
from .transcribe import transcribe

SAMPLE_RATE = 16_000
CHUNK_SECONDS = 3.0
GEMMA_EVERY = 6.0  # seconds between Gemma calls
SCORE_EVERY = 3.0  # seconds between saved Delivery Score points
TICK_EVERY = 1.0  # evaluate rule nudges from live signals this often, independent of transcription
NUDGE_COOLDOWN = 8.0  # don't repeat the same kind of nudge more often than this
GEMMA_COOLDOWN = 15.0  # Gemma's nudges are slower; don't echo a recent rule nudge of the same kind


class LiveSession:
    def __init__(self, send):
        self.send = send  # async callable(dict)
        self.metrics = RollingMetrics()
        self.pcm = bytearray()
        self.audio_t = 0.0  # session time at the start of self.pcm
        self.log: list[dict] = []
        self.last_nudge: dict[str, float] = {}
        self.last_gemma = 0.0
        self.gemma_task: asyncio.Task | None = None
        self.transcribing = False
        self.tasks: set[asyncio.Task] = set()
        self.closing = False  # set by finish(): no new background work may start
        self.last_tick = 0.0
        self.last_score_t = -1e9

    # ------------------------------------------------------------- inputs
    async def on_audio(self, data: bytes) -> None:
        self.pcm.extend(data)
        if len(self.pcm) >= CHUNK_SECONDS * SAMPLE_RATE * 2 and not self.transcribing and not self.closing:
            chunk, start = bytes(self.pcm), self.audio_t
            self.pcm.clear()
            self.audio_t += len(chunk) / 2 / SAMPLE_RATE
            self.transcribing = True  # set before the task starts so a second chunk can't race it
            self._spawn(self._transcribe(chunk, start))

    async def on_signals(self, msg: dict) -> None:
        t = float(msg.get("t", 0))
        self.metrics.add_signals(t, msg.get("eye"), msg.get("rms"), msg.get("pitch"))
        # The browser's live Delivery Score, kept every few seconds so the report can chart progress.
        score = msg.get("score")
        if isinstance(score, (int, float)) and t - self.last_score_t >= SCORE_EVERY:
            self.last_score_t = t
            self.log.append({"type": "score", "t": round(t, 1), "score": round(float(score), 1)})
        # Eye contact (and the metrics panel) must react in real time, not wait for Whisper.
        if not self.closing and time.monotonic() - self.last_tick >= TICK_EVERY:
            await self.tick()

    # ------------------------------------------------------------- processing
    async def _transcribe(self, chunk: bytes, start: float) -> None:
        self.transcribing = True
        try:
            samples = np.frombuffer(chunk, dtype="<i2").astype(np.float32) / 32768.0
            result = await asyncio.to_thread(transcribe, samples, start)
        finally:
            self.transcribing = False
        end = start + len(chunk) / 2 / SAMPLE_RATE
        self.metrics.add_words(result["words"], end, result["avg_logprob"])
        if result["text"]:
            await self.send({"type": "transcript", "text": result["text"], "t": round(end, 1)})
        await self.tick()

    async def tick(self) -> None:
        self.last_tick = time.monotonic()
        snap = self.metrics.snapshot()
        await self.send({"type": "metrics", **{k: v for k, v in snap.items() if k != "recent_text"}})
        for n in rule_nudges(snap):
            await self._nudge(n["kind"], n["message"], "rule", snap)
        now = time.monotonic()
        has_speech = snap["words"] >= 5  # Gemma coaches on what was said; skip until there is some
        if (not self.closing and has_speech and now - self.last_gemma >= GEMMA_EVERY
                and (self.gemma_task is None or self.gemma_task.done())):
            self.last_gemma = now
            self.gemma_task = self._spawn(self._gemma(snap))

    async def _gemma(self, snap: dict) -> None:
        out = await gemma_coach.coach(snap)
        if not out or "error" in out:
            return
        self.log.append({"t": snap["t"], "type": "gemma_ratings",
                         **{k: out.get(k) for k in ("tone", "pace", "articulation")}})
        if out.get("nudge") and out.get("kind") != "none":
            await self._nudge(out["kind"], out["nudge"], "gemma", snap)

    async def _nudge(self, kind: str, message: str, source: str, snap: dict) -> None:
        now = time.monotonic()
        cooldown = GEMMA_COOLDOWN if source == "gemma" else NUDGE_COOLDOWN
        if now - self.last_nudge.get(kind, -1e9) < cooldown:
            return
        self.last_nudge[kind] = now
        entry = {"type": "nudge", "kind": kind, "message": message, "source": source, "t": snap["t"]}
        self.log.append({**entry, "metrics": {k: snap[k] for k in ("wpm", "fillers", "eye_contact", "clarity")}})
        await self.send(entry)

    def _spawn(self, coro) -> asyncio.Task:
        task = asyncio.create_task(coro)
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return task

    async def finish(self, timeout: float = 20.0) -> None:
        """On stop: wait for in-flight transcription, transcribe leftover audio, so the log is complete."""
        self.closing = True
        if self.gemma_task:
            self.gemma_task.cancel()
        pending = {t for t in self.tasks if t is not self.gemma_task}
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        if pending:
            await asyncio.wait(pending, timeout=timeout)
        if len(self.pcm) > SAMPLE_RATE:  # >0.5s of audio left
            chunk, start = bytes(self.pcm), self.audio_t
            self.pcm.clear()
            try:
                await asyncio.wait_for(self._transcribe(chunk, start), timeout=max(deadline - loop.time(), 1))
            except asyncio.TimeoutError:
                pass

    def summary(self) -> dict:
        return self.metrics.summary()

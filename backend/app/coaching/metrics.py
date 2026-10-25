"""Rolling delivery metrics computed from transcribed audio chunks + browser signals."""
from __future__ import annotations

import re
from collections import deque
from dataclasses import dataclass, field

FILLERS = {"um", "uh", "erm", "er", "ah", "like", "basically", "actually", "literally", "so", "right"}
FILLER_PHRASES = ("you know", "i mean", "kind of", "sort of")
# Words in FILLERS that are only fillers when they stand alone at a clause start
# are hard to tell apart; we only count the unambiguous ones for nudges.
STRONG_FILLERS = {"um", "uh", "erm", "er", "ah"}

PACE_FAST, PACE_SLOW = 170, 110  # words per minute
EYE_CONTACT_MIN = 0.6
EYE_RECENT_SECONDS = 4.0  # short window so looking away is flagged within seconds
CLARITY_MIN = 0.5
MIN_WORDS = 6  # speech-based nudges need this many words in the window to be trustworthy
WINDOW_SECONDS = 20.0


def _norm(w: str) -> str:
    return re.sub(r"[^a-z']", "", w.lower())


def count_fillers(words: list[str]) -> tuple[int, int]:
    """Return (strong fillers, all fillers incl. phrases) in a word list."""
    norm = [_norm(w) for w in words]
    strong = sum(1 for w in norm if w in STRONG_FILLERS)
    soft = sum(1 for w in norm if w in FILLERS)
    text = " ".join(norm)
    soft += sum(text.count(p) for p in FILLER_PHRASES)
    return strong, soft


def words_per_minute(words: list[dict], window: float) -> float:
    if not words or window <= 0:
        return 0.0
    return len(words) / window * 60.0


@dataclass
class RollingMetrics:
    words: deque = field(default_factory=deque)  # {word,start,end,prob} in session time
    eye: deque = field(default_factory=deque)  # (t, looking: bool)
    volume: deque = field(default_factory=deque)  # (t, rms)
    pitch: deque = field(default_factory=deque)  # (t, hz)
    logprobs: deque = field(default_factory=deque)  # (t, avg_logprob)
    now: float = 0.0  # latest session time seen (signals arrive in real time)
    speech_t: float = 0.0  # end of the last transcribed audio (lags `now` by transcription time)
    totals: dict = field(default_factory=lambda: {"words": 0, "fillers": 0, "eye_samples": 0, "eye_on": 0})

    def add_words(self, words: list[dict], chunk_end: float, avg_logprob: float | None) -> None:
        self.words.extend(words)
        self.speech_t = max(self.speech_t, chunk_end)
        self.now = max(self.now, chunk_end)
        if avg_logprob is not None:
            self.logprobs.append((chunk_end, avg_logprob))
        self.totals["words"] += len(words)
        self.totals["fillers"] += count_fillers([w["word"] for w in words])[0]
        self._trim()

    def add_signals(self, t: float, eye_contact: bool | None, rms: float | None, pitch_hz: float | None) -> None:
        self.now = max(self.now, t)
        if eye_contact is not None:
            self.eye.append((t, eye_contact))
            self.totals["eye_samples"] += 1
            self.totals["eye_on"] += int(eye_contact)
        if rms is not None:
            self.volume.append((t, rms))
        if pitch_hz:
            self.pitch.append((t, pitch_hz))
        self._trim()

    def _trim(self) -> None:
        # Speech is windowed on transcribed time, signals on real time, so lag doesn't skew rates.
        for dq, key, t in ((self.words, lambda w: w["end"], self.speech_t),
                           (self.logprobs, lambda x: x[0], self.speech_t),
                           (self.eye, lambda x: x[0], self.now),
                           (self.volume, lambda x: x[0], self.now),
                           (self.pitch, lambda x: x[0], self.now)):
            while dq and key(dq[0]) < t - WINDOW_SECONDS:
                dq.popleft()

    def snapshot(self) -> dict:
        words = list(self.words)
        span = min(WINDOW_SECONDS, self.speech_t)
        strong, soft = count_fillers([w["word"] for w in words])
        pitches = [p for _, p in self.pitch]
        pitch_var = 0.0
        if len(pitches) > 3:
            mean = sum(pitches) / len(pitches)
            pitch_var = (sum((p - mean) ** 2 for p in pitches) / len(pitches)) ** 0.5 / mean
        probs = [w.get("prob", 1.0) for w in words]
        eye = [v for _, v in self.eye]
        recent = [v for t, v in self.eye if t >= self.now - EYE_RECENT_SECONDS]
        eye_span = (self.eye[-1][0] - self.eye[0][0]) if self.eye else 0.0
        return {
            "t": round(self.now, 1),
            "speech_t": round(self.speech_t, 1),
            "wpm": round(words_per_minute(words, span), 0),
            "fillers": strong,
            "soft_fillers": soft,
            "eye_contact": round(sum(eye) / len(eye), 2) if eye else None,
            "eye_contact_recent": round(sum(recent) / len(recent), 2) if recent else None,
            "eye_span": round(eye_span, 1),
            "words": len(words),
            # Articulation proxy: how confident whisper is in each word (mumbling -> low).
            "clarity": round(sum(probs) / len(probs), 2) if probs else None,
            # Tone proxy: relative pitch variation (monotone -> low).
            "pitch_variation": round(pitch_var, 3),
            "volume": round(sum(v for _, v in self.volume) / len(self.volume), 3) if self.volume else None,
            "recent_text": " ".join(w["word"] for w in words[-40:]),
        }

    def summary(self) -> dict:
        t = self.totals
        return {
            "duration": round(self.now, 1),
            "total_words": t["words"],
            "avg_wpm": round(t["words"] / self.speech_t * 60, 0) if self.speech_t else 0,
            "total_fillers": t["fillers"],
            "eye_contact": round(t["eye_on"] / t["eye_samples"], 2) if t["eye_samples"] else None,
        }


def rule_nudges(m: dict) -> list[dict]:
    """Deterministic, instant nudges (no LLM)."""
    out = []
    enough_speech = m.get("words", 0) >= MIN_WORDS
    if enough_speech and m.get("speech_t", m["t"]) >= 8 and m["wpm"]:
        if m["wpm"] > PACE_FAST:
            out.append({"kind": "pace", "message": f"Slow down: {int(m['wpm'])} wpm"})
        elif m["wpm"] < PACE_SLOW:
            out.append({"kind": "pace", "message": f"Pick up the pace: {int(m['wpm'])} wpm"})
    if m["fillers"] >= 3:
        out.append({"kind": "fillers", "message": f"{m['fillers']} filler words in the last 20s, pause instead"})
    recent = m.get("eye_contact_recent", m["eye_contact"])
    if recent is not None and m.get("eye_span", EYE_RECENT_SECONDS) >= EYE_RECENT_SECONDS and recent < EYE_CONTACT_MIN:
        out.append({"kind": "eye_contact", "message": "Look at the camera"})
    if enough_speech and m["clarity"] is not None and m["clarity"] < CLARITY_MIN:
        out.append({"kind": "articulation", "message": "Enunciate: some words are hard to make out"})
    return out

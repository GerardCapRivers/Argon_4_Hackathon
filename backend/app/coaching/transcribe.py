"""Local speech-to-text with faster-whisper (word timestamps + confidence)."""
from __future__ import annotations

import os
import subprocess
import sys
import threading
from pathlib import Path

import numpy as np

from ..config import settings
from ..render.local_runner import find_ffmpeg

_lock = threading.Lock()  # one transcription at a time
_load_lock = threading.Lock()  # one model load ever: concurrent loads can deadlock ctranslate2/OpenMP
_loaded = None
# Whisper normally cleans up disfluencies; a disfluent prompt makes it keep "um"/"uh",
# which the filler-word coaching depends on.
FILLER_PROMPT = "Umm, so, uh, I mean, like, we are, um, building, uh, a product. Hmm, you know."


def _add_nvidia_dll_dirs() -> None:
    """Make pip-installed CUDA libs (nvidia-cublas-cu12, nvidia-cudnn-cu12) loadable on Windows.

    Those wheels put DLLs in site-packages/nvidia/*/bin, which is not on the DLL search path.
    ctranslate2 loads cuBLAS lazily with a plain LoadLibrary, so PATH matters as well.
    """
    if sys.platform != "win32":
        return
    for site in map(Path, sys.path):
        for bin_dir in (site / "nvidia").glob("*/bin"):
            os.add_dll_directory(str(bin_dir))
            os.environ["PATH"] = f"{bin_dir}{os.pathsep}{os.environ.get('PATH', '')}"


def _model():
    global _loaded
    if _loaded is not None:
        return _loaded
    with _load_lock:
        if _loaded is None:
            _loaded = _load_model()
    return _loaded


def _load_model():
    _add_nvidia_dll_dirs()
    from faster_whisper import WhisperModel

    if settings.whisper_device != "cpu":
        try:
            model = WhisperModel(settings.whisper_model, device=settings.whisper_device, compute_type="float16")
            # CUDA libs (cuBLAS / cuDNN) load lazily, so run one tiny pass to prove the GPU path works.
            list(model.transcribe(np.zeros(16_000, dtype=np.float32), vad_filter=False)[0])
            return model
        except Exception as e:
            print(f"[whisper] GPU unavailable ({e}); using CPU int8")
    return WhisperModel(settings.whisper_model, device="cpu", compute_type="int8")


def load_audio(path: Path | str, sr: int = 16_000) -> np.ndarray:
    """Decode any media file to 16 kHz mono float32 with ffmpeg (avoids PyAV version breakage)."""
    proc = subprocess.run(
        [find_ffmpeg(), "-nostdin", "-hide_banner", "-loglevel", "error", "-i", str(path),
         "-vn", "-ac", "1", "-ar", str(sr), "-f", "s16le", "-"],
        capture_output=True, stdin=subprocess.DEVNULL, timeout=600,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"Could not decode audio: {proc.stderr.decode(errors='ignore')[-500:]}")
    return np.frombuffer(proc.stdout, dtype="<i2").astype(np.float32) / 32768.0


def on_gpu() -> bool:
    """Non-blocking: assumes CPU until the model has finished loading."""
    return _loaded is not None and _loaded.model.device == "cuda"


def transcribe(audio: Path | str | np.ndarray, offset: float = 0.0, live: bool = False) -> dict:
    """Transcribe a media file or 16 kHz mono float32 samples.

    live=True turns off temperature-fallback retries: on noisy or filler-heavy audio they
    re-decode up to 6 times (slow) and tend to hallucinate repeated words.

    Returns {"text", "words": [{word,start,end,prob}], "avg_logprob", "duration"}.
    """
    src = audio if isinstance(audio, np.ndarray) else load_audio(audio)
    with _lock:  # one GPU, one transcription at a time
        segments, info = _model().transcribe(
            src, word_timestamps=True, vad_filter=True, language="en", beam_size=1,
            initial_prompt=FILLER_PROMPT,
            **({"temperature": 0.0, "condition_on_previous_text": False} if live else {}),
        )
        segments = list(segments)
    words, logprobs = [], []
    for seg in segments:
        logprobs.append(seg.avg_logprob)
        for w in seg.words or []:
            words.append(
                {
                    "word": w.word.strip(),
                    "start": round(w.start + offset, 2),
                    "end": round(w.end + offset, 2),
                    "prob": round(w.probability, 3),
                }
            )
    return {
        "text": " ".join(s.text.strip() for s in segments),
        "words": words,
        "avg_logprob": sum(logprobs) / len(logprobs) if logprobs else None,
        "duration": info.duration,
    }

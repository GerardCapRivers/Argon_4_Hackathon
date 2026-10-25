"""AI Pitch Studio API: video projects (Argon edit loop) and live coaching (Gemma)."""
from __future__ import annotations

import asyncio
import json
import mimetypes
import re
import shutil
import subprocess
import threading
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlmodel import Session, select
from sse_starlette.sse import EventSourceResponse

from . import events, locks
from .argon import edl, editor, loop
from .argon.client import upload
from .coaching import gemma_coach
from .coaching.live import LiveSession
from .coaching.report import build_report
from .coaching.transcribe import _model as transcribe_model
from .coaching.transcribe import transcribe
from .config import FORMATS, settings
from .db import CoachSession, Iteration, Project, engine, get_session, init_db
from .render.finish import finish
from .render.local_runner import find_ffmpeg, probe_duration

ALLOWED_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]


def _clear_stale_status() -> None:
    """Work interrupted by a server restart can never finish; mark it as failed so it can be retried."""
    with Session(engine) as session:
        for p in session.exec(select(Project).where(Project.status.in_(["rendering", "analyzing"]))).all():
            p.status = "error"
            session.add(p)
        session.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    _clear_stale_status()
    asyncio.create_task(gemma_coach.warm_up())
    # Load Whisper now so the first rehearsal chunk isn't delayed by model loading.
    asyncio.create_task(asyncio.to_thread(transcribe_model))
    yield


app = FastAPI(title="AI Pitch Studio", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _save_upload(f: UploadFile, folder: Path) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    suffix = Path(f.filename or "").suffix.lower() or mimetypes.guess_extension(f.content_type or "") or ".bin"
    # Keep a readable version of the original name (shown in the UI), prefixed so names never collide.
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(f.filename or "file").stem)[:40] or "file"
    dest = folder / f"{uuid.uuid4().hex[:8]}__{stem}{suffix}"
    with dest.open("wb") as out:
        shutil.copyfileobj(f.file, out)
    return dest


def _thread(target, *args) -> None:
    threading.Thread(target=target, args=args, daemon=True).start()


# ====================================================================== projects
@app.get("/api/formats")
def formats():
    return {"formats": FORMATS, "max_seconds": settings.max_video_seconds}


@app.get("/api/projects")
def list_projects(session: Session = Depends(get_session)):
    projects = session.exec(select(Project).order_by(Project.created_at.desc())).all()
    out = []
    for p in projects:
        its = session.exec(select(Iteration).where(Iteration.project_id == p.id)).all()
        best = max((i for i in its if i.score is not None), key=lambda i: i.score, default=None)
        out.append({
            "id": p.id, "title": p.title, "format": p.format, "status": p.status,
            "created_at": p.created_at, "versions": len(its),
            "best_score": best.score if best else None, "best_version": best.version if best else None,
        })
    return out


@app.post("/api/projects")
def create_project(
    title: str = Form("Untitled pitch"),
    goal: str = Form(...),
    audience: str = Form(""),
    style: str = Form(""),
    format: str = Form("short"),
    footage: UploadFile = File(...),
    references: list[UploadFile] = File(default=[]),
    style_notes: str = Form(""),
    session: Session = Depends(get_session),
):
    if format not in FORMATS:
        raise HTTPException(400, f"format must be one of {list(FORMATS)}")
    project = Project(title=title, goal=goal, audience=audience, style=style, format=format, status="analyzing")
    session.add(project)
    session.commit()
    session.refresh(project)
    folder = settings.uploads_dir / f"p{project.id}"
    project.source_path = str(_save_upload(footage, folder))
    project.reference_paths = [str(_save_upload(r, folder / "refs")) for r in references if r.filename]
    project.style_notes = style_notes.strip()[:2000]
    session.add(project)
    session.commit()
    _thread(_analyze, project.id)
    return {"id": project.id}


def _analyze(project_id: int) -> None:
    """Transcribe footage locally, upload it to Gemini, and ask Argon for key moments."""
    emit = events.emitter(project_id)
    with Session(engine) as session:
        p = session.get(Project, project_id)
        try:
            emit("analyzing", {"step": "transcribing"})
            p.transcript = transcribe(p.source_path)["words"]
            p.source_duration = probe_duration(p.source_path)
            emit("analyzing", {"step": "uploading"})
            p.source_file_uri = upload(Path(p.source_path)).uri
            refs = []
            for r in []:  # references now flow through editor.style_parts for every step
                f = upload(Path(r))
                refs.append({"uri": f.uri, "mime_type": f.mime_type})
            emit("analyzing", {"step": "finding key moments"})
            p.moments = editor.find_key_moments(p, refs)  # style_parts included inside
            p.selected_moments = list(range(len(p.moments)))
            p.status = "moments"
            emit("moments", {"moments": p.moments})
        except Exception as e:
            p.status = "error"
            emit("loop_error", {"error": str(e)})
        session.add(p)
        session.commit()


@app.post("/api/projects/{pid}/analyze")
def reanalyze(pid: int, session: Session = Depends(get_session)):
    """Restart analysis (transcribe, upload, key moments), e.g. after a failed upload."""
    p = session.get(Project, pid)
    if not p:
        raise HTTPException(404)
    if p.status in ("analyzing", "rendering"):
        raise HTTPException(409, "Already working on this project")
    p.status = "analyzing"
    session.add(p)
    session.commit()
    events.reset(pid)
    _thread(_analyze, pid)
    return {"ok": True}


@app.get("/api/projects/{pid}")
def get_project(pid: int, session: Session = Depends(get_session)):
    p = session.get(Project, pid)
    if not p:
        raise HTTPException(404)
    its = session.exec(select(Iteration).where(Iteration.project_id == pid).order_by(Iteration.version)).all()
    if p.source_duration is None and p.source_path and Path(p.source_path).exists():
        p.source_duration = probe_duration(p.source_path)  # older projects: fill in once
        session.add(p)
        session.commit()
    data = p.model_dump(exclude={"transcript", "source_path", "reference_paths"})
    data["references"] = [_reference_info(i, r) for i, r in enumerate(p.reference_paths or []) if Path(r).exists()]
    data["iterations"] = [
        {**i.model_dump(exclude={"video_path"}), "url": f"/api/projects/{pid}/videos/{i.version}",
         "segments": edl.segments(i.script)}
        for i in its
    ]
    return data


REFERENCE_EXTS = {".pdf", ".txt", ".md", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp3", ".wav", ".m4a", ".mp4", ".mov", ".webm"}


def _reference_info(i: int, path: str) -> dict:
    p = Path(path)
    name = p.name.split("__", 1)[-1]
    ext = p.suffix.lower()
    kind = ("document" if ext in (".pdf", ".txt", ".md") else "image" if ext in (".png", ".jpg", ".jpeg", ".webp", ".gif")
            else "audio" if ext in (".mp3", ".wav", ".m4a") else "video")
    return {"index": i, "name": name, "kind": kind, "size": p.stat().st_size}


@app.post("/api/projects/{pid}/references")
def add_references(pid: int, files: list[UploadFile] = File(...), session: Session = Depends(get_session)):
    p = session.get(Project, pid)
    if not p:
        raise HTTPException(404)
    bad = [f.filename for f in files if Path(f.filename or "").suffix.lower() not in REFERENCE_EXTS]
    if bad:
        raise HTTPException(400, f"Unsupported file type: {', '.join(bad)} (use PDF, text, images, audio or video)")
    folder = settings.uploads_dir / f"p{pid}" / "refs"
    p.reference_paths = [*(p.reference_paths or []), *(str(_save_upload(f, folder)) for f in files)]
    session.add(p)
    session.commit()
    return {"references": [_reference_info(i, r) for i, r in enumerate(p.reference_paths)]}


@app.delete("/api/projects/{pid}/references/{index}")
def remove_reference(pid: int, index: int, session: Session = Depends(get_session)):
    p = session.get(Project, pid)
    if not p or not (0 <= index < len(p.reference_paths or [])):
        raise HTTPException(404)
    p.reference_paths = [r for i, r in enumerate(p.reference_paths) if i != index]
    session.add(p)
    session.commit()
    return {"references": [_reference_info(i, r) for i, r in enumerate(p.reference_paths)]}


class StyleNotes(BaseModel):
    style_notes: str


@app.put("/api/projects/{pid}/style-notes")
def set_style_notes(pid: int, body: StyleNotes, session: Session = Depends(get_session)):
    p = session.get(Project, pid)
    if not p:
        raise HTTPException(404)
    p.style_notes = body.style_notes.strip()[:2000]
    session.add(p)
    session.commit()
    return {"ok": True}


class Selection(BaseModel):
    selected: list[int]


@app.post("/api/projects/{pid}/select")
def select_moments(pid: int, body: Selection, session: Session = Depends(get_session)):
    p = session.get(Project, pid)
    if not p:
        raise HTTPException(404)
    p.selected_moments = sorted(i for i in set(body.selected) if 0 <= i < len(p.moments))
    session.add(p)
    session.commit()
    return {"selected": p.selected_moments}


def _start_locked(pid: int, session: Session, target, *args) -> None:
    """Take the project lock, mark it rendering, and run `target` in a thread (which releases the lock)."""
    if not locks.try_acquire(pid):
        raise HTTPException(409, "This project is already rendering")
    try:
        p = session.get(Project, pid)
        p.status = "rendering"
        session.add(p)
        session.commit()
        _thread(target, pid, *args, events.emitter(pid))
    except Exception:
        locks.release(pid)
        raise


@app.post("/api/projects/{pid}/run")
def run(pid: int, session: Session = Depends(get_session)):
    p = session.get(Project, pid)
    if not p or not p.moments:
        raise HTTPException(400, "Project has no key moments yet")
    _start_locked(pid, session, loop.run_loop)
    return {"ok": True}


class Feedback(BaseModel):
    feedback: str


@app.post("/api/projects/{pid}/feedback")
def human_feedback(pid: int, body: Feedback, session: Session = Depends(get_session)):
    if not body.feedback.strip():
        raise HTTPException(400, "Feedback is empty")
    if not session.exec(select(Iteration).where(Iteration.project_id == pid)).first():
        raise HTTPException(400, "No draft to revise yet")
    _start_locked(pid, session, loop.run_human_revision, body.feedback.strip())
    return {"ok": True}


class TitleCard(BaseModel):
    title: str
    subtitle: str = ""
    version: int | None = None  # which version to re-finish now (default: latest)


@app.put("/api/projects/{pid}/title")
def set_title(pid: int, body: TitleCard, session: Session = Depends(get_session)):
    """Save the opening title and re-apply it (title card + fade only, no Argon call)."""
    p = session.get(Project, pid)
    if not p:
        raise HTTPException(404)
    title, subtitle = body.title.strip()[:80], body.subtitle.strip()[:100]
    if not title:
        raise HTTPException(400, "Title can't be empty")
    p.title_card = {"title": title, "subtitle": subtitle}
    session.add(p)
    q = select(Iteration).where(Iteration.project_id == pid)
    it = session.exec(q.where(Iteration.version == body.version) if body.version else q.order_by(Iteration.version.desc())).first()
    if it:
        fmt = FORMATS.get(p.format, FORMATS["short"])
        try:
            out = finish(Path(it.video_path).parent, fmt["width"], fmt["height"], title, subtitle)
        except Exception as e:
            raise HTTPException(500, f"Couldn't apply the title: {e}")
        it.video_path, it.title_card, it.duration = str(out), dict(p.title_card), probe_duration(out)
        session.add(it)
    session.commit()
    return {"ok": True, "version": it.version if it else None}


class Regenerate(BaseModel):
    version: int | None = None


@app.post("/api/projects/{pid}/regenerate")
def regenerate(pid: int, body: Regenerate, session: Session = Depends(get_session)):
    """New version that fixes what the critic flagged on `version` (default: the latest)."""
    q = select(Iteration).where(Iteration.project_id == pid)
    base = session.exec(
        q.where(Iteration.version == body.version) if body.version else q.order_by(Iteration.version.desc())
    ).first()
    if not base:
        raise HTTPException(404, "No such version")
    if not (base.critique or {}).get("score") and not (base.critique or {}).get("issues"):
        raise HTTPException(400, f"v{base.version} hasn't been reviewed by the critic yet")
    _start_locked(pid, session, loop.run_regeneration, base.version)
    return {"ok": True, "base": base.version}


@app.get("/api/projects/{pid}/events")
async def project_events(pid: int, request: Request, start: int = 0):
    # EventSource sends Last-Event-ID when it reconnects; resume there instead of replaying everything.
    # Ids are "<generation>:<index>" so a reset log (a fresh run) restarts streams from 0.
    gen, i = None, start
    last = request.headers.get("last-event-id", "")
    if ":" in last:
        g, idx = last.split(":", 1)
        if g.isdigit() and idx.isdigit():
            gen, i = int(g), int(idx)

    async def stream():
        nonlocal gen, i
        while True:
            cur_gen, evs = events.since(pid, i)
            if gen is not None and cur_gen != gen:
                i = 0
                cur_gen, evs = events.since(pid, 0)
            gen = cur_gen
            for ev in evs:
                i += 1
                yield {"event": ev["event"], "id": f"{gen}:{i}", "data": json.dumps({**ev["data"], "_ts": ev["ts"]})}
            await asyncio.sleep(0.4)

    return EventSourceResponse(stream())


@app.get("/api/projects/{pid}/videos/{version}")
def get_video(pid: int, version: int, download: bool = False, session: Session = Depends(get_session)):
    it = session.exec(
        select(Iteration).where(Iteration.project_id == pid, Iteration.version == version)
    ).first()
    if not it or not Path(it.video_path).exists():
        raise HTTPException(404)
    if download:
        return FileResponse(it.video_path, media_type="video/mp4", filename=f"pitch_v{version}.mp4")
    return FileResponse(_playable(Path(it.video_path)), media_type="video/mp4")


def _playable(path: Path) -> Path:
    """In-app preview with Opus audio (video copied, <1s).

    MP4s carry AAC audio, which some embedded browsers (e.g. VS Code's) can't decode, so they
    play silently. Opus plays everywhere. Downloads (?download=1) still get the AAC original.
    """
    preview = path.with_name(path.stem + ".preview.mp4")
    if preview.exists() and preview.stat().st_mtime >= path.stat().st_mtime:
        return preview
    proc = subprocess.run(
        [find_ffmpeg(), "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(path),
         "-c:v", "copy", "-c:a", "libopus", "-b:a", "128k", "-movflags", "+faststart", str(preview)],
        capture_output=True, stdin=subprocess.DEVNULL, timeout=120,
    )
    return preview if proc.returncode == 0 and preview.exists() else path


@app.get("/api/projects/{pid}/source")
def get_source(pid: int, session: Session = Depends(get_session)):
    p = session.get(Project, pid)
    if not p or not Path(p.source_path).exists():
        raise HTTPException(404)
    return FileResponse(p.source_path)


@app.get("/api/projects/{pid}/thumbs/{idx}.jpg")
def thumbnail(pid: int, idx: int, session: Session = Depends(get_session)):
    p = session.get(Project, pid)
    if not p or not (0 <= idx < len(p.moments)):
        raise HTTPException(404)
    thumb = settings.uploads_dir / f"p{pid}" / "thumbs" / f"{idx}.jpg"
    if not thumb.exists():
        thumb.parent.mkdir(parents=True, exist_ok=True)
        m = p.moments[idx]
        t = m["start"] + min(1.0, (m["end"] - m["start"]) / 2)
        subprocess.run(
            [find_ffmpeg(), "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{t:.2f}",
             "-i", p.source_path, "-frames:v", "1", "-vf", "scale=320:-2", str(thumb)],
            capture_output=True, stdin=subprocess.DEVNULL, timeout=30,
        )
    if not thumb.exists():
        raise HTTPException(500, "Thumbnail failed")
    return FileResponse(thumb, media_type="image/jpeg")


# ====================================================================== coaching
@app.get("/api/coach")
def list_coach_sessions(session: Session = Depends(get_session)):
    rows = session.exec(select(CoachSession).order_by(CoachSession.created_at.desc())).all()
    return [
        {"id": r.id, "title": r.title, "created_at": r.created_at, "metrics": r.metrics,
         "overall_score": r.report.get("overall_score"), "has_report": bool(r.report),
         "report_status": _report_status(r)}
        for r in rows
    ]


class NewCoach(BaseModel):
    title: str = "Rehearsal"


@app.post("/api/coach")
def create_coach_session(body: NewCoach, session: Session = Depends(get_session)):
    cs = CoachSession(title=body.title)
    session.add(cs)
    session.commit()
    session.refresh(cs)
    return {"id": cs.id}


@app.get("/api/coach/{cid}")
def get_coach_session(cid: int, session: Session = Depends(get_session)):
    cs = session.get(CoachSession, cid)
    if not cs:
        raise HTTPException(404)
    return cs.model_dump(exclude={"recording_path"}) | {
        "has_recording": bool(cs.recording_path),
        "report_status": _report_status(cs),
    }


# Reports being generated right now (lost on restart, which is what "interrupted" detects).
_reports_running: set[int] = set()


def _report_status(cs: CoachSession) -> str:
    if cs.report.get("overall_score") is not None:
        return "ready"
    if cs.report.get("error"):
        return "failed"
    if not cs.recording_path:
        return "no_recording"
    return "generating" if cs.id in _reports_running else "interrupted"


@app.post("/api/coach/{cid}/report")
def regenerate_report(cid: int, session: Session = Depends(get_session)):
    """(Re)build the report, e.g. after a failure or a server restart mid-generation."""
    cs = session.get(CoachSession, cid)
    if not cs:
        raise HTTPException(404)
    if not cs.recording_path or not Path(cs.recording_path).exists():
        raise HTTPException(400, "This rehearsal has no recording to review")
    if cid in _reports_running:
        return {"ok": True}
    cs.report = {}
    session.add(cs)
    session.commit()
    _reports_running.add(cid)
    _thread(_coach_report, cid)
    return {"ok": True}


@app.websocket("/ws/coach/{cid}")
async def coach_ws(ws: WebSocket, cid: int):
    # WebSockets bypass CORS, so check the origin ourselves, and only accept a live (unfinished) session.
    origin = ws.headers.get("origin")
    with Session(engine) as session:
        cs = session.get(CoachSession, cid)
        ok = cs is not None and not cs.metrics.get("finalized")
    if (origin and origin not in ALLOWED_ORIGINS) or not ok:
        await ws.close(code=4403)
        return
    await ws.accept()

    async def send(msg: dict) -> None:
        try:
            await ws.send_text(json.dumps(msg))
        except Exception:
            pass

    live = LiveSession(send)
    try:
        while True:
            msg = await ws.receive()
            if msg["type"] == "websocket.disconnect":
                break
            if msg.get("bytes"):
                await live.on_audio(msg["bytes"])
            elif msg.get("text"):
                data = json.loads(msg["text"])
                if data.get("type") == "signals":
                    await live.on_signals(data)
                elif data.get("type") == "stop":
                    break
    except WebSocketDisconnect:
        pass
    finally:
        await live.finish()
        with Session(engine) as session:
            cs = session.get(CoachSession, cid)
            if cs:
                # `finalized` tells the report task the live log is complete.
                cs.feedback_log, cs.metrics = live.log, {**live.summary(), "finalized": True}
                session.add(cs)
                session.commit()
        try:
            await ws.close()
        except Exception:
            pass


@app.post("/api/coach/{cid}/recording")
def upload_recording(cid: int, background: BackgroundTasks, recording: UploadFile = File(...),
                     session: Session = Depends(get_session)):
    cs = session.get(CoachSession, cid)
    if not cs:
        raise HTTPException(404)
    cs.recording_path = str(_save_upload(recording, settings.uploads_dir / "coach"))
    session.add(cs)
    session.commit()
    _reports_running.add(cid)
    background.add_task(_coach_report, cid)
    return {"ok": True}


def _coach_report(cid: int) -> None:
    try:
        _build_coach_report(cid)
    finally:
        _reports_running.discard(cid)


def _build_coach_report(cid: int) -> None:
    # The recording upload can beat the WebSocket's final save (leftover transcription takes a few
    # seconds), so wait for the live log to be finalized before building the report.
    for _ in range(120):
        with Session(engine) as session:
            if session.get(CoachSession, cid).metrics.get("finalized"):
                break
        time.sleep(0.5)
    with Session(engine) as session:
        cs = session.get(CoachSession, cid)
        try:
            cs.report = build_report(Path(cs.recording_path), cs.feedback_log, cs.metrics)
        except Exception as e:
            cs.report = {"error": str(e)}
        session.add(cs)
        session.commit()

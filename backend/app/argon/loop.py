"""The self-correcting edit loop: draft -> render -> critique -> revise -> render -> score.

Capped at one revision for the live demo. Human feedback runs one more
revise -> render -> score cycle on demand. Progress is reported through an
`emit(event, data)` callback (wired to SSE by the API).
"""
from __future__ import annotations

import difflib
import shutil
from pathlib import Path
from typing import Callable

from sqlmodel import Session, select

from .. import events, locks
from ..config import settings
from ..db import Iteration, Project, engine
from ..render.base import RenderError, get_runner
from ..render.local_runner import probe_duration
from ..render.workspace import prepare_workdir
from . import editor
from .client import upload

Emit = Callable[[str, dict], None]


def _noop(event: str, data: dict) -> None:
    pass


def script_diff(old: str, new: str, old_v: int, new_v: int) -> str:
    return "".join(
        difflib.unified_diff(
            old.splitlines(keepends=True), new.splitlines(keepends=True),
            fromfile=f"v{old_v}.sh", tofile=f"v{new_v}.sh",
        )
    )


def _selected(project: Project) -> list[dict]:
    if not project.selected_moments:
        return project.moments
    return [project.moments[i] for i in project.selected_moments if 0 <= i < len(project.moments)]


def _render_with_repair(project: Project, version: int, gen: dict, moments: list[dict], emit: Emit) -> tuple[dict, Path]:
    """Render; if the script fails, give Argon the error and let it fix the script once."""
    runner = get_runner()
    workdir = prepare_workdir(project.id, version, Path(project.source_path), project.transcript)
    try:
        return gen, runner.run(gen["script"], workdir).video_path
    except RenderError as e:
        emit("render_error", {"version": version, "error": str(e), "logs": e.logs[-1500:]})
        fixed = editor.revise_script(
            project, moments, gen["script"], "Fix the render error; keep the same edit.",
            render_error=f"{e}\n{e.logs}",
        )
        fixed["rationale"] = gen.get("rationale", [])
        fixed["change_summary"] = gen.get("change_summary", "")
        fixed["changes"] = gen.get("changes", [])
        return fixed, runner.run(fixed["script"], workdir).video_path


def _save_iteration(session: Session, **fields) -> Iteration:
    it = Iteration(**fields)
    session.add(it)
    session.commit()
    session.refresh(it)
    return it


def _critique_and_score(session: Session, project: Project, it: Iteration, video: Path, emit: Emit) -> dict:
    emit("critiquing", {"version": it.version})
    rendered = upload(video)
    crit = editor.critique(project, rendered.uri)
    it.critique, it.score = crit, float(crit.get("score", 0))
    session.add(it)
    session.commit()
    emit("critique", {"version": it.version, "critique": crit})
    return crit


def _video_url(project_id: int, version: int) -> str:
    return f"/api/projects/{project_id}/videos/{version}"


def _reset_project(session: Session, project: Project) -> None:
    """A fresh run replaces earlier versions, their renders, and the old event log."""
    for it in session.exec(select(Iteration).where(Iteration.project_id == project.id)).all():
        session.delete(it)
    session.commit()
    shutil.rmtree(settings.jobs_dir / f"p{project.id}", ignore_errors=True)
    events.reset(project.id)


def run_loop(project_id: int, emit: Emit = _noop) -> None:
    """Draft (v1) -> critique -> revision (v2) -> score.

    The caller must hold the project lock (see `locks`) and has already set status="rendering".
    """
    try:
        with Session(engine) as session:
            project = session.get(Project, project_id)
            _reset_project(session, project)
            moments = _selected(project)
            try:
                emit("generating", {"version": 1})
                gen, video = _render_with_repair(project, 1, editor.generate_script(project, moments), moments, emit)
                v1 = _save_iteration(
                    session, project_id=project.id, version=1, trigger="draft", script=gen["script"],
                    rationale=gen.get("rationale", []), changes=gen.get("changes", []),
                    video_path=str(video), duration=probe_duration(video),
                )
                emit("rendered", {"version": 1, "url": _video_url(project.id, 1), "rationale": v1.rationale})
                crit = _critique_and_score(session, project, v1, video, emit)

                emit("generating", {"version": 2})
                gen2, video2 = _render_with_repair(
                    project, 2, editor.revise_script(project, moments, v1.script, crit), moments, emit
                )
                v2 = _save_iteration(
                    session, project_id=project.id, version=2, trigger="critique", script=gen2["script"],
                    rationale=gen2.get("rationale", []), change_summary=gen2.get("change_summary", ""),
                    changes=gen2.get("changes", []), duration=probe_duration(video2),
                    diff=script_diff(v1.script, gen2["script"], 1, 2), video_path=str(video2),
                )
                emit("rendered", {
                    "version": 2, "url": _video_url(project.id, 2),
                    "change_summary": v2.change_summary, "changes": v2.changes,
                })
                _critique_and_score(session, project, v2, video2, emit)
                project.status = "done"
                emit("done", {"scores": {1: v1.score, 2: v2.score}})
            except Exception as e:
                project.status = "error"
                emit("loop_error", {"error": str(e), "logs": getattr(e, "logs", "")[-1500:]})
            finally:
                session.add(project)
                session.commit()
    finally:
        locks.release(project_id)


def _chat_history(session: Session, project_id: int) -> list[dict]:
    """Earlier presenter requests and Argon's resulting changes, oldest first."""
    its = session.exec(
        select(Iteration).where(Iteration.project_id == project_id, Iteration.trigger == "human").order_by(Iteration.version)
    ).all()
    return [{"version": i.version, "feedback": i.feedback, "changes": i.changes or []} for i in its if i.feedback]


def run_human_revision(project_id: int, feedback: str, emit: Emit = _noop) -> None:
    """One more revise -> render -> score pass driven by the presenter's own feedback.

    The caller must hold the project lock and has already set status="rendering".
    """
    try:
        with Session(engine) as session:
            project = session.get(Project, project_id)
            last = session.exec(
                select(Iteration).where(Iteration.project_id == project_id).order_by(Iteration.version.desc())
            ).first()
            moments = _selected(project)
            version = last.version + 1
            try:
                emit("generating", {"version": version})
                gen, video = _render_with_repair(
                    project, version,
                    editor.revise_script(project, moments, last.script, feedback, history=_chat_history(session, project.id)),
                    moments, emit,
                )
                it = _save_iteration(
                    session, project_id=project.id, version=version, trigger="human", script=gen["script"],
                    feedback=feedback,
                    rationale=gen.get("rationale", []), change_summary=gen.get("change_summary", ""),
                    changes=gen.get("changes", []), duration=probe_duration(video),
                    diff=script_diff(last.script, gen["script"], last.version, version), video_path=str(video),
                )
                emit("rendered", {
                    "version": version, "url": _video_url(project.id, version),
                    "change_summary": it.change_summary, "changes": it.changes,
                })
                _critique_and_score(session, project, it, video, emit)
                emit("done", {"scores": {version: it.score}})
            except Exception as e:
                emit("loop_error", {"error": str(e), "logs": getattr(e, "logs", "")[-1500:],
                                    "version": version, "feedback": feedback})
            finally:
                # A failed revision leaves the earlier versions intact, so the project stays usable.
                project.status = "done"
                session.add(project)
                session.commit()
    finally:
        locks.release(project_id)

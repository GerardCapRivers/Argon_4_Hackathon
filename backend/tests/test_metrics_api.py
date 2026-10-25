from app.argon.loop import script_diff
from app.coaching.metrics import RollingMetrics, count_fillers, rule_nudges


def _words(text, start=0.0, step=0.3):
    return [{"word": w, "start": start + i * step, "end": start + i * step + 0.25, "prob": 0.9}
            for i, w in enumerate(text.split())]


def test_filler_counts():
    strong, soft = count_fillers("so um we basically uh you know built it".split())
    assert strong == 2 and soft >= 4


def test_fast_pace_and_eye_contact_nudges():
    m = RollingMetrics()
    words = _words(" ".join(["word"] * 60), step=0.2)  # 60 words in 12s = 300 wpm
    m.add_words(words, chunk_end=12.0, avg_logprob=-0.2)
    for i in range(20):
        m.add_signals(i * 0.5, eye_contact=i % 4 == 0, rms=0.1, pitch_hz=150)
    snap = m.snapshot()
    kinds = {n["kind"] for n in rule_nudges(snap)}
    assert snap["wpm"] > 170 and {"pace", "eye_contact"} <= kinds


def test_script_diff():
    d = script_diff("ffmpeg -i a\nffmpeg -i b\n", "ffmpeg -i a\nffmpeg -i c\n", 1, 2)
    assert "-ffmpeg -i b" in d and "+ffmpeg -i c" in d and "v2.sh" in d


def test_api_boots(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as c:
        assert "short" in c.get("/api/formats").json()["formats"]
        assert isinstance(c.get("/api/projects").json(), list)
        cid = c.post("/api/coach", json={"title": "t"}).json()["id"]
        assert c.get(f"/api/coach/{cid}").json()["title"] == "t"


def test_concurrent_revisions_are_rejected(monkeypatch):
    import threading
    from fastapi.testclient import TestClient
    from sqlmodel import Session
    from app import locks
    from app.argon import loop
    from app.db import Iteration, Project, engine
    from app.main import app

    started, release = threading.Event(), threading.Event()

    def fake_revision(pid, feedback, emit):
        started.set()
        release.wait(5)
        locks.release(pid)

    monkeypatch.setattr(loop, "run_human_revision", fake_revision)
    with TestClient(app) as c:
        with Session(engine) as s:
            p = Project(title="lock test", goal="g", moments=[{"start": 0, "end": 1, "label": "a", "why": "", "score": 1}])
            s.add(p); s.commit(); s.refresh(p)
            s.add(Iteration(project_id=p.id, version=1, script="ffmpeg -i source.mp4 output.mp4")); s.commit()
            pid = p.id
        assert c.post(f"/api/projects/{pid}/feedback", json={"feedback": "bigger captions"}).status_code == 200
        assert started.wait(5)
        assert c.post(f"/api/projects/{pid}/feedback", json={"feedback": "again"}).status_code == 409
        assert c.post(f"/api/projects/{pid}/run").status_code == 409
        assert c.get(f"/api/projects/{pid}").json()["status"] == "rendering"
        release.set()


def test_stale_rendering_status_cleared_on_startup():
    from fastapi.testclient import TestClient
    from sqlmodel import Session
    from app.db import Project, engine
    from app.main import app

    with Session(engine) as s:
        p = Project(title="stale", goal="g", status="rendering")
        s.add(p); s.commit(); s.refresh(p)
        pid = p.id
    with TestClient(app) as c:
        assert c.get(f"/api/projects/{pid}").json()["status"] == "error"


def test_eye_contact_nudge_fires_without_speech(monkeypatch):
    """Nudges must not wait for Whisper: looking away alone should trigger one within seconds."""
    import asyncio
    from app.coaching import live as live_mod

    monkeypatch.setattr(live_mod, "TICK_EVERY", 0.0)
    sent = []

    async def send(msg):
        sent.append(msg)

    async def run():
        s = live_mod.LiveSession(send)
        for i in range(30):  # 6 s of signals at 5 Hz: 2 s looking, then looking away
            t = i * 0.2
            await s.on_signals({"t": t, "eye": t < 2, "rms": 0.1, "pitch": 140})
        return s

    asyncio.run(run())
    nudges = [m for m in sent if m["type"] == "nudge"]
    assert [n["kind"] for n in nudges] == ["eye_contact"]
    assert nudges[0]["t"] <= 6
    assert any(m["type"] == "metrics" for m in sent)  # the panel updates live too


def test_report_status_without_recording_is_not_pending():
    """A rehearsal that never uploaded its recording must not look like a report in progress."""
    from fastapi.testclient import TestClient
    from app.main import app

    with TestClient(app) as c:
        cid = c.post("/api/coach", json={"title": "no upload"}).json()["id"]
        assert c.get(f"/api/coach/{cid}").json()["report_status"] == "no_recording"
        assert c.post(f"/api/coach/{cid}/report").status_code == 400
        listed = {s["id"]: s for s in c.get("/api/coach").json()}
        assert listed[cid]["report_status"] == "no_recording"


def test_regenerate_uses_critique_and_history(monkeypatch):
    from fastapi.testclient import TestClient
    from sqlmodel import Session, select
    from app.argon import editor, loop
    from app.db import Iteration, Project, engine
    from app.main import app

    seen = {}

    def fake_revise(project, moments, prev_script, feedback, render_error="", history=None):
        seen["feedback"], seen["history"], seen["prev"] = feedback, history, prev_script
        return {"script": "ffmpeg -i source.mp4 output.mp4", "changes": ["Fixed clipped words"], "rationale": []}

    monkeypatch.setattr(editor, "revise_script", fake_revise)
    monkeypatch.setattr(loop, "_render_with_repair", lambda project, version, gen, moments, emit: (gen, __import__("pathlib").Path("x.mp4")))
    monkeypatch.setattr(loop, "probe_duration", lambda p: 20.0)

    def fake_score(session, project, it, video, emit):
        it.critique, it.score = {"score": 7.5, "issues": []}, 7.5
        session.add(it); session.commit()

    monkeypatch.setattr(loop, "_critique_and_score", fake_score)

    with TestClient(app) as c:
        with Session(engine) as s:
            p = Project(title="regen", goal="g", status="done", moments=[{"start": 0, "end": 1, "label": "a", "why": "", "score": 1}])
            s.add(p); s.commit(); s.refresh(p)
            s.add(Iteration(project_id=p.id, version=1, trigger="draft", script="v1", critique={"score": 5, "issues": [{"at": "0:01", "problem": "clipped", "fix": "pad", "severity": "high"}]}, score=5))
            s.add(Iteration(project_id=p.id, version=2, trigger="human", script="v2", feedback="bigger captions", changes=["Captions 72px"]))
            s.commit()
            pid = p.id
        assert c.post(f"/api/projects/{pid}/regenerate", json={"version": 2}).status_code == 400  # v2 not reviewed
        r = c.post(f"/api/projects/{pid}/regenerate", json={"version": 1})
        assert r.status_code == 200 and r.json()["base"] == 1
        import time
        for _ in range(50):
            if c.get(f"/api/projects/{pid}").json()["status"] == "done":
                break
            time.sleep(0.1)
        with Session(engine) as s:
            new = s.exec(select(Iteration).where(Iteration.project_id == pid, Iteration.version == 3)).first()
        assert new.trigger == "regen" and "v1" in new.feedback and new.score == 7.5
        assert seen["prev"] == "v1" and seen["feedback"]["issues"][0]["problem"] == "clipped"
        assert seen["history"] == [{"version": 2, "feedback": "bigger captions", "changes": ["Captions 72px"]}]


def test_title_card_edit_refinishes_video(tmp_path):
    """Editing the title re-applies the title card + fade with real ffmpeg, no Argon call."""
    import subprocess
    from fastapi.testclient import TestClient
    from sqlmodel import Session
    from app.db import Iteration, Project, engine
    from app.main import app
    from app.render.local_runner import find_ffmpeg, probe_duration

    job = tmp_path / "v1"
    job.mkdir()
    subprocess.run([find_ffmpeg(), "-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30",
                    "-f", "lavfi", "-i", "sine=frequency=300", "-t", "3", "-c:v", "libx264", "-preset", "ultrafast",
                    "-c:a", "aac", "-shortest", str(job / "output.mp4")], check=True)
    with TestClient(app) as c:
        with Session(engine) as s:
            p = Project(title="t", goal="g", status="done", format="landscape")
            s.add(p); s.commit(); s.refresh(p)
            s.add(Iteration(project_id=p.id, version=1, script="x", video_path=str(job / "output.mp4")))
            s.commit()
            pid = p.id
        assert c.put(f"/api/projects/{pid}/title", json={"title": "  "}).status_code == 400
        r = c.put(f"/api/projects/{pid}/title", json={"title": "Raising: $1.5M 'seed'", "subtitle": "Kayla · 2026", "version": 1})
        assert r.status_code == 200, r.text
        d = c.get(f"/api/projects/{pid}").json()
        it = d["iterations"][0]
        assert it["title_card"] == {"title": "Raising: $1.5M 'seed'", "subtitle": "Kayla · 2026"}
        assert d["title_card"]["title"].startswith("Raising")
        assert (job / "final.mp4").exists() and probe_duration(job / "final.mp4") > 4.5  # 3s + 2.2s title card


def test_create_project_from_rehearsal_recording(tmp_path, monkeypatch):
    """A rehearsal's recording becomes the footage; WebM is converted to MP4 during analysis."""
    import subprocess, time
    from fastapi.testclient import TestClient
    from sqlmodel import Session
    from app import main
    from app.db import CoachSession, engine
    from app.render.local_runner import find_ffmpeg, probe_duration

    rec = tmp_path / "rehearsal.webm"
    subprocess.run([find_ffmpeg(), "-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30",
                    "-f", "lavfi", "-i", "sine=frequency=300", "-t", "2", "-c:v", "libvpx-vp9", "-deadline", "realtime",
                    "-c:a", "libopus", "-shortest", str(rec)], check=True)
    # Stop analysis after the conversion step (no Whisper/Gemini in tests).
    monkeypatch.setattr(main, "transcribe", lambda path: (_ for _ in ()).throw(RuntimeError("stop after convert")))
    with TestClient(main.app) as c:
        with Session(engine) as s:
            cs = CoachSession(title="Seed pitch rehearsal", recording_path=str(rec))
            s.add(cs); s.commit(); s.refresh(cs)
            cid = cs.id
        assert c.get(f"/api/coach/{cid}/recording").status_code == 200
        assert c.post("/api/projects", data={"goal": "g", "format": "landscape"}).status_code == 400  # no footage
        r = c.post("/api/projects", data={"goal": "g", "format": "landscape", "title": "Seed pitch rehearsal", "from_session": str(cid)})
        assert r.status_code == 200, r.text
        pid = r.json()["id"]
        for _ in range(100):
            resp = c.get(f"/api/projects/{pid}")
            assert resp.status_code == 200, resp.text
            assert "status" in resp.json(), resp.json()
            if resp.json()["status"] != "analyzing":
                break
            time.sleep(0.1)
        with Session(engine) as s:
            from app.db import Project
            p = s.get(Project, pid)
        assert p.source_path.endswith(".mp4") and probe_duration(p.source_path) > 1.5
        assert p.title == "Seed pitch rehearsal"

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

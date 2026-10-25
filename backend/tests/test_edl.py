from pathlib import Path

from app.argon.edl import segments

FIXTURE = Path(__file__).parent / "fixtures" / "argon_v2_script.sh"


def test_real_argon_script_segments():
    segs = segments(FIXTURE.read_text())
    assert len(segs) == 8
    assert segs[0] == {"start": 6.4, "end": 10.9, "title": "THE PITCH PROBLEM"}
    assert all(s["end"] > s["start"] for s in segs)
    assert [s["start"] for s in segs] == sorted(s["start"] for s in segs)
    assert segs[-1]["title"] == "BOOK A DEMO THIS WEEK"


def test_duration_and_timestamp_forms():
    script = (
        r"""ffmpeg -ss 00:00:05.5 -t 3 -i source.mp4 -vf "drawtext=text='Hi\: there'" a.mp4""" "\n"
        "ffmpeg -i a.mp4 -i b.mp4 output.mp4\n"
    )
    assert segments(script) == [{"start": 5.5, "end": 8.5, "title": "Hi: there"}]


def test_garbage_is_empty():
    assert segments("not a script 'unclosed") == []


def test_revise_prompt_includes_chat_history(monkeypatch):
    from types import SimpleNamespace

    from app.argon import editor

    captured = {}
    monkeypatch.setattr(editor, "file_part", lambda uri, mime="video/mp4": f"<file {uri}>")
    monkeypatch.setattr(editor, "generate_json", lambda step, system, contents, schema, **kw: captured.setdefault("c", contents) or {})
    project = SimpleNamespace(source_file_uri="files/x", goal="g", audience="a", style="s", format="short", transcript=[])
    history = [
        {"version": 3, "feedback": "bigger captions", "changes": ["Captions now 72px bold"]},
        {"version": 4, "feedback": "open with traction", "changes": ["Traction moved to 0:00"]},
    ]
    editor.revise_script(project, [], "ffmpeg -i source.mp4 output.mp4", "now make it 20s", history=history)
    text = "\n".join(str(c) for c in captured["c"])
    assert "CONVERSATION SO FAR" in text
    assert text.index("bigger captions") < text.index("open with traction") < text.index("now make it 20s")
    assert "Argon: Captions now 72px bold" in text


def test_style_references_reach_editor_and_critic(monkeypatch, tmp_path):
    from types import SimpleNamespace

    from app.argon import editor

    pdf = tmp_path / "ab12cd34__brand_guide.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    logo = tmp_path / "ef56ab78__logo.png"
    logo.write_bytes(b"\x89PNG fake")
    monkeypatch.setattr(editor, "cached_upload", lambda p: (f"files/{p.name}", "application/pdf" if p.suffix == ".pdf" else "image/png"))
    monkeypatch.setattr(editor, "file_part", lambda uri, mime="video/mp4": f"<file {uri} {mime}>")
    calls = []
    monkeypatch.setattr(editor, "generate_json", lambda step, system, contents, schema, **kw: calls.append((step, contents)) or {})
    project = SimpleNamespace(source_file_uri="files/src", goal="g", audience="a", style="s", format="short", transcript=[],
                              reference_paths=[str(pdf), str(logo)], style_notes="Brand purple #7C3AED, calm tone")
    editor.generate_script(project, [])
    editor.critique(project, "files/render")
    for step, contents in calls:
        text = "\n".join(map(str, contents))
        assert "STYLE REFERENCES" in text and "brand_guide.pdf" in text and "Brand purple" in text, step
        assert "logo.png" in text  # logo overlay hint
    assert "style references" in str(calls[1][1][-1])  # critic told to check brand fit


def test_reference_upload_cache_expires(monkeypatch, tmp_path):
    from app.argon import client as c

    f = tmp_path / "notes.txt"
    f.write_text("tone: calm")
    uploads = []

    class Fake:
        class files:
            @staticmethod
            def upload(file, config=None):
                uploads.append(file)
                return type("F", (), {"uri": f"files/{len(uploads)}", "mime_type": "text/plain", "state": None, "name": "n"})()

    monkeypatch.setattr(c, "client", lambda: Fake)
    c._upload_cache.clear()
    assert c.cached_upload(f)[0] == "files/1"
    assert c.cached_upload(f)[0] == "files/1" and len(uploads) == 1  # cached
    key = next(iter(c._upload_cache))
    uri, mime, ts = c._upload_cache[key]
    c._upload_cache[key] = (uri, mime, ts - c.UPLOAD_TTL - 1)  # pretend it's 46h+ old
    assert c.cached_upload(f)[0] == "files/2" and len(uploads) == 2  # re-uploaded


def test_add_and_remove_references_api():
    from fastapi.testclient import TestClient
    from sqlmodel import Session
    from app.db import Project, engine
    from app.main import app

    with TestClient(app) as cl:
        with Session(engine) as s:
            p = Project(title="refs", goal="g", status="done")
            s.add(p); s.commit(); s.refresh(p)
            pid = p.id
        r = cl.post(f"/api/projects/{pid}/references", files=[("files", ("Brand Guide 2026.pdf", b"%PDF-1.4", "application/pdf"))])
        assert r.status_code == 200 and r.json()["references"][0]["name"] == "Brand_Guide_2026.pdf"
        assert r.json()["references"][0]["kind"] == "document"
        assert cl.post(f"/api/projects/{pid}/references", files=[("files", ("evil.exe", b"MZ", "application/octet-stream"))]).status_code == 400
        assert cl.put(f"/api/projects/{pid}/style-notes", json={"style_notes": "calm, brand purple"}).status_code == 200
        d = cl.get(f"/api/projects/{pid}").json()
        assert len(d["references"]) == 1 and d["style_notes"] == "calm, brand purple"
        assert cl.delete(f"/api/projects/{pid}/references/0").json()["references"] == []

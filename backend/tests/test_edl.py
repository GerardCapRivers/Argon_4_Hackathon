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

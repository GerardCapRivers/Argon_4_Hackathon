import pytest

from app.render.base import RenderError
from app.render.captions import group_words, words_to_srt
from app.render.local_runner import parse_script, validate_command

GOOD = r"""
# cut the hook
ffmpeg -ss 12.5 -to 20 -copyts -i source.mp4 \
  -vf "subtitles=captions.srt,setpts=PTS-STARTPTS,crop=ih*9/16:ih,scale=1080:1920" \
  -af asetpts=PTS-STARTPTS seg1.mp4
ffmpeg -i seg1.mp4 -vf "drawtext=fontfile=font.ttf:text='Hello':x=10:y=10" -t 30 output.mp4
"""


def test_parses_continuations_and_comments():
    cmds = parse_script(GOOD)
    assert len(cmds) == 2
    assert cmds[0][0] == "ffmpeg" and cmds[0][-1] == "seg1.mp4"
    for c in cmds:
        validate_command(c)


def test_strips_markdown_fences():
    cmds = parse_script("```bash\nffmpeg -i source.mp4 output.mp4\n```")
    assert cmds == [["ffmpeg", "-i", "source.mp4", "output.mp4"]]


@pytest.mark.parametrize(
    "line",
    [
        "rm -rf output.mp4",
        "ffmpeg -i source.mp4 output.mp4 ; rm x",
        "ffmpeg -i ../secret.mp4 output.mp4",
        "ffmpeg -i C:/Users/x/a.mp4 output.mp4",
        "ffmpeg -i /etc/passwd output.mp4",
        "ffmpeg -i http://evil.example/a.mp4 output.mp4",
        "ffmpeg -i source.mp4 -vf movie=other.mp4 output.mp4",
        "ffmpeg -i concat:a.mp4|b.mp4 output.mp4",
        "ffmpeg -i source.mp4 C:/Windows/out.mp4",
        "powershell -c whoami",
        # Bypasses found in code review: all must be rejected.
        r"ffmpeg -i source.mp4 -map 0 -f tee 'a.mp4|C:/\/Users/x/Desktop/pwn.mp4' output.mp4",
        "ffmpeg -i source.mp4 -vf subtitles=///etc/passwd output.mp4",
        "ffmpeg -i source.mp4 -lavfi \"zmq,movie=source.mp4\" output.mp4",
        "ffmpeg -i source.mp4 -filter:v:0 \"sendcmd=f=x.txt\" output.mp4",
        "ffmpeg -i source.mp4 -/filter_complex x.txt output.mp4",
        "ffmpeg -i seg1.mp4 source.mp4",
        "ffmpeg -i - output.mp4",
        "ffmpeg -i source.mp4 -",
        "ffmpeg -i source.mp4 -shortest /tmp/out.mp4",
        "ffmpeg -i source.mp4 -report output.mp4",
        "ffmpeg -i source.mp4 -passlogfile /tmp/x output.mp4",
        "ffmpeg -i source.mp4 -vf \"drawtext=fontfile=/windows/fonts/a.ttf:text=hi\" output.mp4",
        "ffmpeg -i source.mp4 -vf \"drawtext=textfile=../secret.txt\" output.mp4",
        "ffmpeg -f concat -i list.txt output.mp4",
        "ffmpeg -i source.mp4 CON",
        "ffmpeg -i source.mp4 -f image2 frame%03d.png",
    ],
)
def test_rejects_unsafe(line):
    with pytest.raises(RenderError):
        for c in parse_script(line):
            validate_command(c)


def test_allows_lavfi_color_source():
    validate_command(parse_script(
        "ffmpeg -f lavfi -i color=c=black:s=1080x1920:d=1 -f lavfi -i anullsrc=r=48000:cl=stereo -t 1 -shortest title.mp4"
    )[0])


def test_allows_colon_text_in_drawtext():
    validate_command(
        parse_script("ffmpeg -i source.mp4 -vf \"drawtext=text='Our data: 50%'\" output.mp4")[0]
    )


def test_captions_grouping():
    words = [{"word": f"w{i}", "start": i * 0.3, "end": i * 0.3 + 0.25} for i in range(10)]
    cues = group_words(words, max_words=4)
    assert [len(c["text"].split()) for c in cues] == [4, 4, 2]
    srt = words_to_srt(words)
    assert srt.startswith("1\n00:00:00,000 --> ")

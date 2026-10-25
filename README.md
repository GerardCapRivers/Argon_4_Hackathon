# AI Pitch Studio

Live investor coaching and self-correcting pitch video creation, built for the Gemini 4 Argon hackathon
(Problem Statement Two: *More Dimensions*).

1. **Live coaching on the device (Gemma).** Rehearse on camera and get real-time nudges on pace, filler words,
   articulation, tone and eye contact. Audio is transcribed locally (faster-whisper) and Gemma runs in Ollama.
   Eye contact is detected in the browser by a per-user model trained during a 6-second calibration.
   At the end, Gemini 4 Argon watches the recording together with the live feedback log and returns a score
   plus action items.
2. **A self-correcting editor (Gemini 4 Argon).** You give a goal, audience, style, format and footage.
   Argon finds key moments and you pick which to keep. Argon then **writes an ffmpeg script**, which is
   rendered. A separate **critic** instance watches the render and critiques it against the goal, Argon
   **revises its code**, and the critic **scores the new version**. The result is v1 → v2 with a code diff
   and before/after scores. Your own feedback triggers further revisions.

```
footage + goal ─▶ Argon: key moments ─▶ you pick ─▶ Argon writes edit code ─▶ render (sandbox)
                                                         ▲                        │
                                                         │                        ▼
                                          Argon revises code ◀── critic watches & critiques
```

## Layout

```
backend/   FastAPI · SQLite · google-genai · faster-whisper · Ollama
  app/argon/      client (model routing), prompts, editor (moments/generate/revise/critique), loop
  app/render/     LocalRunner (validated ffmpeg-only execution), Antigravity runner (flagged), captions
  app/coaching/   transcribe, metrics, gemma_coach, live (WebSocket session), report
frontend/  Next.js 15 · Tailwind 4 · MediaPipe FaceLandmarker
  app/            dashboard, /coach, /coach/[id], /create, /projects/[id]
  lib/            api, eyeContact (calibrated classifier), audio (16 kHz PCM worklet + pitch)
```

## Setup (Windows)

```powershell
winget install Gyan.FFmpeg
ollama pull gemma3n              # or a Gemma 4 small tag once available

cd backend
pip install -r requirements.txt
copy example.env .env            # then set GEMINI_API_KEY (and Kaggle keys for training)
uvicorn app.main:app --port 8000

cd ..\frontend
npm install                      # postinstall copies MediaPipe wasm + model into public/
npm run dev                      # http://localhost:3000
```

### Useful `.env` settings

| Key | Default | Notes |
|---|---|---|
| `GEMINI_API_KEY` | none | required for Argon |
| `ARGON_MODEL` | `gemini-4-argon` | key moments, generator, critic, coaching report |
| `CHEAP_MODEL` | `gemini-3.8-flash` | text-only steps |
| `OLLAMA_MODEL` | `gemma3n` | live coaching |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | set explicitly; a global `OLLAMA_HOST=0.0.0.0` is a bind address, not a URL |
| `OLLAMA_NUM_GPU` | auto | `0` forces CPU (use it if Ollama's CUDA runner crashes) |
| `WHISPER_DEVICE` | `cuda` | falls back to CPU int8 automatically when CUDA libraries are missing |
| `RENDER_BACKEND` | `local` | `antigravity` once the managed-agent API is confirmed |
| `MAX_VIDEO_SECONDS` | `30` | demo cap |

## Safety of LLM-written code

The local runner never invokes a shell. Each line of Argon's script must be an `ffmpeg` command. Absolute
paths, `..`, URLs/protocols, shell operators and file-reading filters (`movie=`, `sendcmd`, …) are rejected,
and inputs and outputs must be plain file names inside the per-version job folder. If a script fails to
render, Argon gets the error and repairs its script once.

## Tests

```powershell
cd backend; python -m pytest -q
cd frontend; npx tsc --noEmit; npm run lint
```

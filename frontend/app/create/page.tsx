"use client";

import { ClientOnly } from "@/components/ClientOnly";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { API, api, FormatPreset } from "@/lib/api";

const DEFAULTS = {
  goal: "Get a seed investor to book a follow-up call: show the problem, our traction and the ask.",
  audience: "Seed-stage VCs",
  style: "Energetic, bold captions, fast cuts",
  styleNotes: "Brand green #22C55E, clean sans-serif, calm and confident tone",
};

function CreatePage() {
  const router = useRouter();
  const [formats, setFormats] = useState<Record<string, FormatPreset>>({});
  const [maxSeconds, setMaxSeconds] = useState(30);
  const [title, setTitle] = useState("");
  // Pre-filled with a typical seed pitch so a new video can start in one click; all editable.
  const [goal, setGoal] = useState(DEFAULTS.goal);
  const [audience, setAudience] = useState(DEFAULTS.audience);
  const [style, setStyle] = useState(DEFAULTS.style);
  const [format, setFormat] = useState("landscape");
  const [footage, setFootage] = useState<File | null>(null);
  const [refs, setRefs] = useState<File[]>([]);
  const [styleNotes, setStyleNotes] = useState(DEFAULTS.styleNotes);
  const [voiceNote, setVoiceNote] = useState<File | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  // Coming from a rehearsal report: use that recording as the footage, and its name as the title.
  const [fromSession, setFromSession] = useState<{ id: number; title: string } | null>(null);

  useEffect(() => {
    api<{ formats: Record<string, FormatPreset>; max_seconds: number }>("/api/formats")
      .then((r) => {
        setFormats(r.formats);
        setMaxSeconds(r.max_seconds);
      })
      .catch((e) => setError(e.message));
    const from = Number(new URLSearchParams(window.location.search).get("from"));
    if (from) {
      api<{ id: number; title: string; has_recording: boolean }>(`/api/coach/${from}`)
        .then((s) => {
          if (!s.has_recording) return;
          setFromSession({ id: s.id, title: s.title });
          setTitle((t) => t || s.title);
        })
        .catch(() => {});
    }
  }, []);

  async function toggleVoiceNote() {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      setVoiceNote(new File(chunks, "voice-note.webm", { type: rec.mimeType }));
      setRecording(false);
    };
    rec.start();
    recorder.current = rec;
    setRecording(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if ((!footage && !fromSession) || !goal.trim()) return;
    setBusy(true);
    setError("");
    const fd = new FormData();
    fd.set("title", title || fromSession?.title || footage?.name.replace(/\.[^.]+$/, "") || "Untitled pitch");
    fd.set("goal", goal);
    fd.set("audience", audience);
    fd.set("style", style);
    fd.set("format", format);
    fd.set("style_notes", styleNotes);
    if (footage) fd.set("footage", footage);
    else if (fromSession) fd.set("from_session", String(fromSession.id));
    [...refs, ...(voiceNote ? [voiceNote] : [])].forEach((f) => fd.append("references", f));
    try {
      const res = await fetch(`${API}/api/projects`, { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json()).detail ?? res.statusText);
      const { id } = await res.json();
      router.push(`/projects/${id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-4xl space-y-14">
      <div className="rise">
        <SectionHeader
          size="h1"
          eyebrow="Stage 2 · Gemini 4 Argon"
          title="New pitch video."
          lede={<>Tell Argon what the video must achieve. It finds key moments, writes the edit as code, renders it, critiques it against your goal and revises it once. Videos are capped at {maxSeconds}s for the demo.</>}
        />
      </div>

      <ol className="divide-y divide-line border-y border-line">
        <Step n="01" title="Goal." hint="What should a viewer do after watching?">
          <div>
            <label className="label" htmlFor="goal">Goal</label>
            <textarea
              id="goal"
              className="input min-h-24"
              placeholder="e.g. Get a seed investor to book a follow-up call: show the problem, our traction and the ask."
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="label" htmlFor="audience">Target audience</label>
              <input id="audience" className="input" placeholder="Seed-stage VCs" value={audience} onChange={(e) => setAudience(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="style">Style</label>
              <input id="style" className="input" placeholder="Energetic, bold captions, fast cuts" value={style} onChange={(e) => setStyle(e.target.value)} />
            </div>
          </div>
          <div>
            <span className="label">Style references (optional)</span>
            <label htmlFor="refs" className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-line px-4 py-5 text-center transition hover:border-muted">
              <span className="text-sm font-medium">Add a brand guide, logo, colour palette or example video</span>
              <span className="mt-1 font-mono text-xs text-muted">pdf · png/jpg · txt/md · mp4 · mp3 — Argon&apos;s editor and critic both follow these</span>
              <input id="refs" type="file" multiple className="sr-only"
                accept=".pdf,.txt,.md,image/*,audio/*,video/*"
                onChange={(e) => setRefs((r) => [...r, ...Array.from(e.target.files ?? [])])} />
            </label>
            {refs.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {refs.map((f, i) => (
                  <span key={`${f.name}-${i}`} className="badge text-text">
                    {f.name}
                    <button type="button" aria-label={`Remove ${f.name}`} className="text-muted hover:text-bad" onClick={() => setRefs((r) => r.filter((_, j) => j !== i))}>✕</button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="label" htmlFor="style-notes">Style notes (optional)</label>
              <textarea id="style-notes" className="input min-h-20" value={styleNotes} onChange={(e) => setStyleNotes(e.target.value)}
                placeholder="e.g. Brand green #22C55E, clean sans-serif, calm and confident tone" />
            </div>
            <div>
              <span className="label">Or describe it out loud (optional)</span>
              <button type="button" onClick={toggleVoiceNote} className={recording ? "btn-primary w-full" : "btn-ghost w-full"}>
                {recording ? <><span className="dot-live" /> Stop recording</> : voiceNote ? "✓ Voice note recorded, re-record" : "● Record voice note"}
              </button>
            </div>
          </div>
        </Step>

        <Step n="02" title="Format." hint="Where will the video be posted?">
          <div className="grid gap-3 sm:grid-cols-3">
            {Object.entries(formats).map(([key, f]) => {
              const on = format === key;
              return (
                <button type="button" key={key} onClick={() => setFormat(key)} aria-pressed={on}
                  className={`group rounded-2xl border p-4 text-left transition ${on ? "border-text bg-panel" : "border-line hover:border-muted"}`}>
                  <div className="flex h-16 items-center">
                    <div className={`rounded-[3px] border-2 transition-all duration-300 ${on ? "border-text bg-text/5" : "border-muted/60"}`}
                      style={{ height: 52 * Math.min(1, f.height / f.width), width: 52 * Math.min(1, f.width / f.height) }} />
                  </div>
                  <div className="mt-3 text-sm font-medium">{f.label}</div>
                  <div className="mt-0.5 font-mono text-xs text-muted">{f.width}×{f.height} · ≤{maxSeconds}s</div>
                </button>
              );
            })}
          </div>
        </Step>

        <Step n="03" title="Footage." hint="Your rehearsal recording. Shorter, compressed files upload faster.">
          {fromSession && !footage ? (
            <div className="space-y-3 rounded-2xl border border-text bg-panel p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="eyebrow">Using your rehearsal</div>
                  <div className="font-medium">{fromSession.title}</div>
                </div>
                <label htmlFor="footage" className="badge cursor-pointer hover:border-text hover:text-text">Use a different file</label>
              </div>
              <video src={`${API}/api/coach/${fromSession.id}/recording`} controls preload="metadata" className="max-h-64 w-full rounded-xl bg-[#0a0a0a]" />
              <input id="footage" type="file" accept="video/*" className="sr-only" onChange={(e) => setFootage(e.target.files?.[0] ?? null)} />
            </div>
          ) : (
            <label htmlFor="footage" className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-10 text-center transition ${footage ? "border-text bg-panel" : "border-line hover:border-muted"}`}>
              <span className="text-sm font-medium">{footage ? footage.name : "Choose a video file"}</span>
              <span className="mt-1 font-mono text-xs text-muted">{footage ? `${(footage.size / 1e6).toFixed(1)} MB` : "mp4 · mov · webm"}</span>
              <input id="footage" type="file" accept="video/*" className="sr-only" onChange={(e) => setFootage(e.target.files?.[0] ?? null)} required={!fromSession} />
            </label>
          )}
          {fromSession && footage && (
            <button type="button" className="badge hover:border-text hover:text-text" onClick={() => setFootage(null)}>↺ Use the rehearsal recording instead</button>
          )}
          <div>
            <label className="label" htmlFor="title">Title (optional)</label>
            <input id="title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Seed pitch v1" />
          </div>
        </Step>
      </ol>

      {error && <p className="rounded-xl border border-bad/40 bg-bad/5 p-4 text-sm text-bad">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-muted">Argon reads the whole video, so analysis takes about a minute.</p>
        <button className="btn-mono-dark px-6 py-3" disabled={busy || (!footage && !fromSession) || !goal.trim()}>
          {busy ? "Uploading…" : <>Find key moments <span className="arrow-ne">↗</span></>}
        </button>
      </div>
    </form>
  );
}

function Step({ n, title, hint, children }: { n: string; title: string; hint: string; children: React.ReactNode }) {
  return (
    <li className="grid gap-6 py-10 md:grid-cols-[14rem_minmax(0,1fr)]">
      <div>
        <div className="font-mono text-sm text-muted">{n}</div>
        <h2 className="mt-2 text-xl font-medium tracking-[-0.01em]">{title}</h2>
        <p className="mt-1 text-sm text-muted">{hint}</p>
      </div>
      <div className="min-w-0 space-y-4">{children}</div>
    </li>
  );
}

// Client-only: browser extensions edit form fields before hydration (see ClientOnly).
export default function Page() {
  return (
    <ClientOnly>
      <CreatePage />
    </ClientOnly>
  );
}

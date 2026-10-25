"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Score } from "@/components/Score";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Terminal, TermLine } from "@/components/ui/Terminal";
import { api, ProjectSummary } from "@/lib/api";

type CoachSummary = {
  id: number;
  title: string;
  created_at: string;
  overall_score: number | null;
  has_report: boolean;
  report_status?: "ready" | "failed" | "no_recording" | "generating" | "interrupted";
  metrics: { avg_wpm?: number; eye_contact?: number | null; total_fillers?: number };
};

const STATUS: Record<string, { label: string; live?: boolean }> = {
  analyzing: { label: "Analyzing", live: true },
  moments: { label: "Pick moments" },
  rendering: { label: "Rendering", live: true },
  done: { label: "Done" },
  error: { label: "Error" },
  draft: { label: "Draft" },
};

const LOOP: TermLine[] = [
  { text: "◆ Pitch Studio · Argon edit loop", tone: "muted" },
  { text: "/help for help · footage: seed-pitch.mp4 (0:46)", tone: "muted", pause: 700 },
  { text: "make a 30s short for seed VCs", tone: "prompt" },
  { text: "◇ key moments   hook · solution · traction · ask", tone: "plain" },
  { text: "◇ draft v1      writing ffmpeg edit… rendered 0:29", tone: "plain" },
  { text: "◇ critic        5.5/10  captions clipped at edges", tone: "warn", pause: 900 },
  { text: "◇ revise v2     subtitles after crop, trim 'go back'", tone: "plain" },
  { text: "◇ critic        8.5/10  ready to publish", tone: "ok" },
  { text: "✓ shipped v2 · 9:16 · 29s", tone: "ok", pause: 1200 },
];

const STEPS = [
  { n: "01", title: "Rehearse with a live coach.", body: "Gemma runs on this laptop and nudges your pace, filler words, articulation, tone and eye contact as you speak." },
  { n: "02", title: "Argon edits by writing code.", body: "Upload the rehearsal and a goal. Argon picks the key moments and writes the ffmpeg edit that renders your cut." },
  { n: "03", title: "A critic watches. Argon fixes.", body: "A second Argon reviews the render against your goal. The editor revises its code once, and the critic scores again." },
];

export default function Dashboard() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [sessions, setSessions] = useState<CoachSummary[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<ProjectSummary[]>("/api/projects").then(setProjects).catch((e) => setError(e.message));
    api<CoachSummary[]>("/api/coach").then(setSessions).catch(() => setSessions([]));
  }, []);

  const finished = projects?.filter((p) => p.status === "done") ?? [];
  const drafts = projects?.filter((p) => p.status !== "done") ?? [];

  return (
    <div className="space-y-24 sm:space-y-28">
      {/* Hero */}
      <section className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,34rem)]">
        <div className="rise" style={{ ["--i" as string]: 0 }}>
          <div className="badge mb-6"><span className="dot-live" /> Gemma on device · Gemini 4 Argon</div>
          <h1 className="display text-5xl sm:text-6xl lg:text-7xl">
            Rehearse live.<br />Ship the cut.
          </h1>
          <p className="mt-5 max-w-[46ch] text-[18px] text-muted">
            A coach that listens while you practise, and an editor that watches its own work and fixes it.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/coach" className="btn-mono-dark px-5 py-3">Start rehearsal <span className="arrow-ne">↗</span></Link>
            <Link href="/create" className="btn-mono px-5 py-3">Make a pitch video <span className="arrow-ne">↗</span></Link>
          </div>
        </div>
        <div className="rise" style={{ ["--i" as string]: 2 }}>
          <Terminal title="argon — self-correcting loop" lines={LOOP} animate />
        </div>
      </section>

      {/* How it works */}
      <section className="space-y-10">
        <SectionHeader eyebrow="How it works" title="Three steps. One rehearsal." />
        <ol className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.n} className="rise bg-bg p-6 sm:p-8" style={{ ["--i" as string]: i + 3 }}>
              <div className="font-mono text-sm text-muted">{s.n}</div>
              <h3 className="mt-6 text-xl font-medium tracking-[-0.01em]">{s.title}</h3>
              <p className="mt-2 text-[15px] text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Two stages */}
      <section className="grid gap-4 md:grid-cols-2">
        <Link href="/coach" className="card lift group flex flex-col p-7">
          <div className="eyebrow">Stage 1 · on-device Gemma</div>
          <h2 className="mt-3 text-2xl font-medium tracking-[-0.02em]">Live coaching.</h2>
          <p className="mt-2 text-[15px] text-muted">
            Rehearse on camera. Get real-time nudges on pace, filler words, articulation, tone and eye contact,
            then an Argon score with action items.
          </p>
          <span className="link-arrow mt-6 text-sm">Start rehearsal</span>
        </Link>
        <Link href="/create" className="card lift group flex flex-col p-7">
          <div className="eyebrow">Stage 2 · Gemini 4 Argon</div>
          <h2 className="mt-3 text-2xl font-medium tracking-[-0.02em]">New pitch video.</h2>
          <p className="mt-2 text-[15px] text-muted">
            Upload footage and a goal. Argon edits by writing code, watches the render, critiques it and fixes it.
          </p>
          <span className="link-arrow mt-6 text-sm">Create video</span>
        </Link>
      </section>

      {error && (
        <p className="rounded-xl border border-bad/40 bg-bad/5 p-4 text-sm text-bad">
          Can&apos;t reach the backend ({error}). Start it with <code className="font-mono">uvicorn app.main:app</code> in <code className="font-mono">backend/</code>.
        </p>
      )}

      {/* Your work */}
      <section className="space-y-12">
        <SectionHeader eyebrow="Your work" title="Videos and rehearsals." />
        <ProjectList title="Saved videos" items={finished} loading={!projects} empty="No finished videos yet." />
        <ProjectList title="Drafts" items={drafts} loading={!projects} empty="No drafts." />
        <div>
          <ListTitle title="Rehearsals" count={sessions?.length} />
          {!sessions ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-muted">No rehearsals yet.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-3">
              {sessions.map((s) => (
                <Link key={s.id} href={`/coach/${s.id}`} className="card lift">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 break-words font-medium">{s.title}</span>
                    {s.overall_score != null && <Score value={s.overall_score} />}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {s.report_status === "no_recording" && <span className="badge">No recording</span>}
                    {s.report_status === "generating" && <span className="badge"><span className="dot-live" />Report</span>}
                    {s.metrics?.avg_wpm ? <span className="badge">{s.metrics.avg_wpm} wpm</span> : null}
                    {s.metrics?.eye_contact != null && <span className="badge">{Math.round(s.metrics.eye_contact * 100)}% eye contact</span>}
                  </div>
                  <div className="mt-3 text-xs text-muted">{new Date(s.created_at).toLocaleString()}</div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function ListTitle({ title, count }: { title: string; count?: number }) {
  return (
    <div className="mb-4 flex items-center gap-2 border-b border-line pb-3">
      <h3 className="text-[15px] font-medium">{title}</h3>
      {count != null && <span className="font-mono text-xs text-muted">{String(count).padStart(2, "0")}</span>}
    </div>
  );
}

function ProjectList({ title, items, loading, empty }: { title: string; items: ProjectSummary[]; loading: boolean; empty: string }) {
  return (
    <div>
      <ListTitle title={title} count={loading ? undefined : items.length} />
      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          {items.map((p) => {
            const st = STATUS[p.status] ?? { label: p.status };
            return (
              <Link key={p.id} href={`/projects/${p.id}`} className="card lift">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 break-words font-medium">{p.title}</span>
                  {p.best_score != null && <Score value={p.best_score} />}
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <span className="badge">{st.live && <span className="dot-live" />}{st.label}</span>
                  <span className="badge">{p.format}</span>
                  <span className="badge">v{p.versions}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

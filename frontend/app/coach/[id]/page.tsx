"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { Score } from "@/components/Score";
import { ScoreTrend } from "@/components/coach/ScoreTrend";
import { Spinner } from "@/components/Spinner";
import { api, CoachReport, postJSON } from "@/lib/api";

type Session = {
  id: number;
  title: string;
  created_at: string;
  metrics: { duration?: number; avg_wpm?: number; total_fillers?: number; eye_contact?: number | null };
  feedback_log: { type: string; t: number; message?: string; kind?: string; score?: number }[];
  report: CoachReport | Record<string, never>;
  has_recording: boolean;
  report_status: "ready" | "failed" | "no_recording" | "generating" | "interrupted";
};

const DIMENSIONS: [keyof CoachReport["scores"], string][] = [
  ["tone", "Tone"], ["pace", "Pace"], ["articulation", "Articulation"], ["eye_contact", "Eye contact"], ["content", "Content"],
];

export default function CoachReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [s, setS] = useState<Session | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const data = await api<Session>(`/api/coach/${id}`);
        setS(data);
        if (data.report_status === "generating" && !stop) setTimeout(poll, 3000);
      } catch (e) {
        setError((e as Error).message);
      }
    };
    poll();
    return () => { stop = true; };
  }, [id]);

  if (!s) return <p className="text-sm text-muted">{error || "Loading…"}</p>;

  async function regenerate() {
    try {
      await postJSON(`/api/coach/${id}/report`, {});
      const data = await api<Session>(`/api/coach/${id}`);
      setS(data);
      const again = async () => {
        const d = await api<Session>(`/api/coach/${id}`);
        setS(d);
        if (d.report_status === "generating") setTimeout(again, 3000);
      };
      setTimeout(again, 3000);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const r = s.report as CoachReport;
  const nudges = s.feedback_log.filter((e) => e.type === "nudge");
  const scorePoints = s.feedback_log.filter((e) => e.type === "score" && e.score != null).map((e) => ({ t: e.t, score: e.score! }));
  const trendDelta = scorePoints.length > 1 ? Math.round(scorePoints[scorePoints.length - 1].score - scorePoints[0].score) : null;

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="rise min-w-0">
          <div className="eyebrow mb-3">Rehearsal report · {new Date(s.created_at).toLocaleString()}</div>
          <h1 className="display text-4xl sm:text-5xl">{s.title.replace(/\.?$/, ".")}</h1>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {s.metrics.duration ? <span className="badge">{Math.round(s.metrics.duration)}s</span> : null}
            {s.metrics.avg_wpm ? <span className="badge">{s.metrics.avg_wpm} wpm avg</span> : null}
            {s.metrics.total_fillers != null && <span className="badge">{s.metrics.total_fillers} fillers</span>}
            {s.metrics.eye_contact != null && <span className="badge">{Math.round(s.metrics.eye_contact * 100)}% eye contact</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <Link href="/coach" className="btn-ghost">Rehearse again</Link>
          <Link href="/create" className="btn-primary">Turn into a video →</Link>
        </div>
      </header>

      {scorePoints.length > 1 && (
        <section className="card p-6">
          <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <div className="eyebrow">Delivery score during the rehearsal</div>
              <div className="mt-1 font-mono text-3xl font-semibold tabular-nums">{Math.round(scorePoints[scorePoints.length - 1].score)}<span className="text-base text-muted"> / 100</span></div>
            </div>
            {trendDelta != null && (
              <span className={`badge ${trendDelta >= 0 ? "text-good" : "text-warn"}`}>{trendDelta >= 0 ? "▲ +" : "▼ "}{trendDelta} from start to finish</span>
            )}
          </div>
          <ScoreTrend history={scorePoints} height={120} />
        </section>
      )}

      {s.report_status === "no_recording" ? (
        <div className="card flex flex-wrap items-center justify-between gap-4 p-6">
          <div>
            <p className="font-medium">No recording was saved for this rehearsal.</p>
            <p className="mt-1 text-sm text-muted">It ended before the video was uploaded, so Argon has nothing to review.</p>
          </div>
          <Link href="/coach" className="btn-mono-dark">Rehearse again <span className="arrow-ne">↗</span></Link>
        </div>
      ) : s.report_status === "failed" || s.report_status === "interrupted" ? (
        <div className="card flex flex-wrap items-center justify-between gap-4 p-6">
          <div>
            <p className="font-medium">{s.report_status === "failed" ? "The report couldn't be generated." : "The report was interrupted."}</p>
            <p className="mt-1 text-sm text-muted">
              {s.report_status === "failed" ? String(r.error).slice(0, 200) : "The server restarted while Argon was reviewing. Your recording is saved."}
            </p>
          </div>
          <button className="btn-mono-dark" onClick={regenerate}>Generate report <span className="arrow-ne">↗</span></button>
        </div>
      ) : r.overall_score == null ? (
        <div className="card flex items-center gap-3 text-sm"><Spinner /> Gemini 4 Argon is watching your rehearsal with the live feedback log…</div>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-[220px_1fr]">
            <div className="card flex flex-col items-center justify-center">
              <span className="label">Overall</span>
              <Score value={r.overall_score} size="lg" />
            </div>
            <div className="card grid grid-cols-2 gap-3 md:grid-cols-5">
              {DIMENSIONS.map(([k, label]) => (
                <div key={k} className="text-center">
                  <div className="text-xs text-muted">{label}</div>
                  <Score value={r.scores[k]} />
                </div>
              ))}
              <p className="col-span-full mt-2 text-sm">{r.summary}</p>
            </div>
          </section>

          <section className="card">
            <h2 className="mb-3 font-semibold">Action items</h2>
            <ol className="space-y-3">
              {r.action_items.map((a, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/20 text-xs text-accent">{i + 1}</span>
                  <div>
                    <div className="font-medium">{a.title}</div>
                    <p className="text-sm text-muted">{a.detail}</p>
                    {a.timestamps.length > 0 && <p className="mt-1 font-mono text-xs text-accent">{a.timestamps.join(" · ")}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {r.strengths.length > 0 && (
            <section className="card">
              <h2 className="mb-2 font-semibold">Strengths</h2>
              <ul className="list-inside list-disc text-sm text-muted">{r.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </section>
          )}
        </>
      )}

      <section className="card">
        <h2 className="mb-2 font-semibold">Live nudges you received</h2>
        {nudges.length === 0 ? <p className="text-sm text-muted">None, nice.</p> : (
          <ul className="space-y-1 text-sm">
            {nudges.map((n, i) => <li key={i}><span className="font-mono text-xs text-muted">{n.t.toFixed(0)}s</span> {n.message}</li>)}
          </ul>
        )}
      </section>
    </div>
  );
}

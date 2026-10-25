"use client";

import { useEffect, useState } from "react";
import type { Iteration } from "@/lib/api";

export type LoopEvent = { name: string; data: Record<string, unknown>; at: number };

type StageState = "done" | "active" | "pending" | "failed";
type Stage = {
  key: string;
  label: string;
  caption: string;
  state: StageState;
  start?: number;
  end?: number;
  score?: number;
  repaired?: boolean;
};

const genLabel = (v: number, trigger?: string) =>
  v === 1 ? { label: "Draft", caption: "Argon writes the edit code" }
    : trigger === "human" ? { label: `Your edit · v${v}`, caption: "Applying your feedback" }
      : trigger === "regen" ? { label: `Regenerate · v${v}`, caption: "Fixing the critic's notes" }
        : { label: `Revise · v${v}`, caption: "Argon fixes its code" };
const critLabel = (v: number) =>
  v === 1 ? { label: "Critique", caption: "Critic watches v1" } : { label: `Score · v${v}`, caption: `Critic scores v${v}` };

/** Builds the pipeline from live events, or from saved versions when the page is reloaded. */
function buildStages(events: LoopEvent[], iterations: Iteration[], running: boolean): Stage[] {
  const stages: Stage[] = [];
  const find = (key: string) => stages.find((s) => s.key === key);
  // Upsert by key: a repeated event (e.g. replayed after an SSE reconnect) updates the stage, never duplicates it.
  const start = (stage: Stage) => {
    const s = find(stage.key);
    if (!s) stages.push(stage);
    else if (s.state === "failed" || s.state === "pending") Object.assign(s, stage);
  };
  const finish = (key: string, at: number, extra: Partial<Stage> = {}) => {
    const s = find(key);
    if (s) Object.assign(s, { state: "done", end: at, ...extra });
  };

  for (const e of events) {
    const v = Number(e.data.version);
    if (e.name === "generating") {
      const it = iterations.find((i) => i.version === v);
      start({ key: `gen${v}`, ...genLabel(v, it?.trigger ?? (e.data.trigger as string | undefined) ?? (v > 2 ? "human" : undefined)), state: "active", start: e.at });
    } else if (e.name === "render_error") {
      const s = find(`gen${v}`);
      if (s) s.repaired = true;
    } else if (e.name === "rendered") {
      finish(`gen${v}`, e.at);
    } else if (e.name === "critiquing") {
      start({ key: `crit${v}`, ...critLabel(v), state: "active", start: e.at });
    } else if (e.name === "critique") {
      finish(`crit${v}`, e.at, { score: Number((e.data.critique as { score?: number })?.score) });
    } else if (e.name === "loop_error") {
      const active = [...stages].reverse().find((s) => s.state === "active");
      if (active) Object.assign(active, { state: "failed", end: e.at });
    }
  }

  if (!stages.length) {
    // Reloaded page: reconstruct from what was saved.
    for (const it of iterations) {
      start({ key: `gen${it.version}`, ...genLabel(it.version, it.trigger), state: "done" });
      start({ key: `crit${it.version}`, ...critLabel(it.version), state: it.score != null ? "done" : "pending", score: it.score ?? undefined });
    }
  }

  // During the first run, show what's still to come.
  if (running && !iterations.some((i) => i.version > 2)) {
    const planned = [
      { key: "gen1", ...genLabel(1) }, { key: "crit1", ...critLabel(1) },
      { key: "gen2", ...genLabel(2) }, { key: "crit2", ...critLabel(2) },
    ];
    for (const p of planned) if (!find(p.key)) stages.push({ ...p, state: "pending" });
    stages.sort((a, b) => planned.findIndex((p) => p.key === a.key) - planned.findIndex((p) => p.key === b.key));
  }
  return stages;
}

export function LoopStepper({ events, iterations, running }: { events: LoopEvent[]; iterations: Iteration[]; running: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [running]);

  const stages = buildStages(events, iterations, running);
  if (!stages.length) return null;
  const t0 = stages.find((s) => s.start)?.start;
  const tEnd = running ? now : Math.max(...stages.map((s) => s.end ?? 0));
  const total = t0 && tEnd - t0 >= 1000 ? Math.round((tEnd - t0) / 1000) : null;
  // Rail runs from the first node's centre to the last one's; fill up to the furthest finished node.
  const lastDone = stages.reduce((m, s, i) => (s.state === "done" ? i : m), -1);
  const hasActive = stages.some((s) => s.state === "active");
  const progress = Math.min(1, Math.max(0, (lastDone + (hasActive ? 0.5 : 0)) / Math.max(stages.length - 1, 1)));
  const inset = `calc(100% / ${stages.length * 2})`;

  return (
    <section aria-label="Self-correcting loop">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-mono text-xs text-muted">◆ draft → critique → revise → score</h2>
        {total != null && <span className="font-mono text-sm tabular-nums text-muted">{Math.floor(total / 60)}:{String(total % 60).padStart(2, "0")}</span>}
      </div>
      <ol className="relative grid gap-3 sm:grid-flow-col sm:auto-cols-fr sm:gap-0">
        {/* Progress rail behind the nodes (horizontal layout only). */}
        <div className="absolute top-[15px] hidden h-0.5 bg-line sm:block" style={{ left: inset, right: inset }} aria-hidden>
          <div className="h-full bg-green transition-[width] duration-700" style={{ width: `${progress * 100}%` }} />
        </div>
        {stages.map((s) => {
          const raw = s.start && (s.end || (s.state === "active" && running)) ? Math.round(((s.end ?? now) - s.start) / 1000) : null;
          const secs = raw != null && (raw > 0 || s.state === "active") ? raw : null;
          return (
            <li key={s.key} className="relative flex items-start gap-3 sm:flex-col sm:items-center sm:text-center">
              <Node state={s.state} />
              <div className="min-w-0 sm:px-2">
                <div className={`text-sm font-semibold ${s.state === "pending" ? "text-muted" : ""}`}>{s.label}</div>
                <div className="text-xs text-muted">{s.caption}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 sm:justify-center">
                  {s.score != null && !Number.isNaN(s.score) && (
                    <span className={`rounded-full px-2 py-0.5 font-mono text-xs font-semibold tabular-nums ${s.score >= 8 ? "bg-good/15 text-good" : s.score >= 5 ? "bg-warn/15 text-warn" : "bg-bad/15 text-bad"}`}>
                      {s.score.toFixed(1)}/10
                    </span>
                  )}
                  {secs != null && <span className="font-mono text-xs tabular-nums text-muted">{secs}s</span>}
                  {s.repaired && <span className="rounded-full bg-bad/15 px-2 py-0.5 text-xs text-bad">Repaired</span>}
                  {s.state === "failed" && <span className="rounded-full bg-bad/15 px-2 py-0.5 text-xs text-bad">Failed</span>}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Node({ state }: { state: StageState }) {
  const base = "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 bg-bg";
  if (state === "done")
    return (
      <span className={`${base} border-green bg-green text-[#0a0a0a]`}>
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m3.5 8.5 3 3 6-7" /></svg>
      </span>
    );
  if (state === "active")
    return (
      <span className={`${base} border-text`}>
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-text border-t-transparent" />
      </span>
    );
  if (state === "failed")
    return <span className={`${base} border-bad text-bad`}>!</span>;
  return <span className={`${base} border-line`} />;
}

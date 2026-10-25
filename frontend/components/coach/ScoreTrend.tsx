"use client";

import { useState } from "react";
import type { ScorePoint } from "@/lib/deliveryScore";

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/**
 * Delivery Score over the session on a fixed 0-100 scale (so a rise is a real rise), with
 * the 75 "pitch-ready" line, an area fill, an emphasised latest point and a hover readout.
 */
export function ScoreTrend({ history, height = 72 }: { history: ScorePoint[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (history.length < 2) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-line text-xs text-muted" style={{ height }}>
        The trend appears after a few seconds of rehearsal
      </div>
    );
  }
  const t0 = history[0].t;
  const span = Math.max(history[history.length - 1].t - t0, 1);
  const x = (t: number) => ((t - t0) / span) * 100;
  const y = (s: number) => 100 - s;
  const line = history.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(2)},${y(p.score).toFixed(2)}`).join(" ");
  const area = `${line} L100,100 L0,100 Z`;
  const last = history[history.length - 1];
  const shown = hover != null ? history[hover] : null;

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const t = t0 + ((e.clientX - r.left) / r.width) * span;
    let best = 0;
    history.forEach((p, i) => { if (Math.abs(p.t - t) < Math.abs(history[best].t - t)) best = i; });
    setHover(best);
  }

  return (
    <div className="relative select-none" style={{ height }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-label={`Delivery score over time, now ${Math.round(last.score)}`} role="img">
        {[50, 75].map((g) => (
          <line key={g} x1="0" x2="100" y1={y(g)} y2={y(g)} stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeDasharray={g === 75 ? "4 4" : undefined} />
        ))}
        <path d={area} fill="var(--accent)" fillOpacity="0.16" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        {shown && <line x1={x(shown.t)} x2={x(shown.t)} y1="0" y2="100" stroke="var(--muted)" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
      </svg>
      <span className="pointer-events-none absolute right-0 -translate-y-1/2 text-[10px] text-muted" style={{ top: `${y(75)}%` }}>75 pitch-ready</span>
      {/* Latest point, drawn in HTML so it stays round on the stretched SVG. */}
      <span
        className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-panel"
        style={{ left: `${x(last.t)}%`, top: `${y(last.score)}%` }}
      />
      {shown && (
        <div
          className="pointer-events-none absolute -top-8 -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-panel-2 px-2 py-1 text-xs tabular-nums text-text shadow-lg"
          style={{ left: `${Math.min(Math.max(x(shown.t), 8), 92)}%` }}
        >
          {fmt(shown.t)} · <span className="font-semibold">{Math.round(shown.score)}</span>
        </div>
      )}
    </div>
  );
}

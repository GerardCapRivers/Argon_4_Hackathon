"use client";

import { useState } from "react";
import type { Segment } from "@/lib/api";
import { fmtTime } from "@/lib/api";

type Row = { label: string; segments: Segment[]; emphasis?: boolean };

/**
 * Which parts of the source footage each version keeps, on one shared time axis.
 * Filled blocks are kept; empty track is cut. Hover a block for its exact in/out.
 */
export function EditTimeline({ rows, sourceDuration }: { rows: Row[]; sourceDuration: number | null }) {
  const [hover, setHover] = useState<{ row: number; seg: number } | null>(null);
  const maxEnd = Math.max(0, ...rows.flatMap((r) => r.segments.map((s) => s.end)));
  const total = Math.max(sourceDuration ?? 0, maxEnd, 1);
  const pct = (t: number) => `${(t / total) * 100}%`;
  const step = total > 90 ? 30 : total > 40 ? 10 : 5;
  const ticks = Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step);

  if (!rows.some((r) => r.segments.length)) return null;

  return (
    <div className="space-y-2">
      {rows.map((row, ri) => {
        const kept = row.segments.reduce((s, x) => s + (x.end - x.start), 0);
        return (
          <div key={row.label} className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-3">
            <div className="text-xs">
              <div className={`font-semibold ${row.emphasis ? "text-text" : "text-muted"}`}>{row.label}</div>
              <div className="font-mono tabular-nums text-muted">{kept.toFixed(0)}s</div>
            </div>
            <div className="relative h-9 rounded-md bg-panel-2" role="img" aria-label={`${row.label} keeps ${row.segments.length} segments, ${kept.toFixed(0)} seconds`}>
              {row.segments.map((s, si) => {
                const on = hover?.row === ri && hover.seg === si;
                return (
                  <div
                    key={si}
                    onMouseEnter={() => setHover({ row: ri, seg: si })}
                    onMouseLeave={() => setHover(null)}
                    className={`absolute inset-y-1 overflow-hidden rounded-[4px] px-1.5 text-[10px] font-medium leading-7 transition-colors ${
                      row.emphasis ? "bg-accent text-bg" : "bg-muted/40 text-text"
                    } ${on ? "ring-2 ring-text" : ""}`}
                    style={{ left: pct(s.start), width: `calc(${pct(s.end - s.start)} - 2px)` }}
                  >
                    <span className="block truncate" title={s.title}>{s.title}</span>
                  </div>
                );
              })}
              {hover?.row === ri && (
                <div
                  className="pointer-events-none absolute bottom-full z-10 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-panel px-2 py-1 text-xs tabular-nums shadow-lg"
                  style={{ left: pct((row.segments[hover.seg].start + row.segments[hover.seg].end) / 2) }}
                >
                  {row.segments[hover.seg].title && <span className="font-medium">{row.segments[hover.seg].title} · </span>}
                  {fmtTime(row.segments[hover.seg].start)}–{fmtTime(row.segments[hover.seg].end)}
                  <span className="text-muted"> ({(row.segments[hover.seg].end - row.segments[hover.seg].start).toFixed(1)}s)</span>
                </div>
              )}
            </div>
          </div>
        );
      })}
      <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-3">
        <div className="text-[10px] text-muted">source</div>
        <div className="relative h-4 text-[10px] tabular-nums text-muted">
          {ticks.map((t) => (
            <span key={t} className="absolute -translate-x-1/2 first:translate-x-0" style={{ left: pct(t) }}>{fmtTime(t)}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

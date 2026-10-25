"use client";

import { useEffect, useState } from "react";
import { PixelMark } from "@/components/ui/PixelMark";
import type { LoopEvent } from "./LoopStepper";

const STEPS = ["Writing edit code", "Rendering", "Critic watching"] as const;
const ASPECT: Record<string, string> = { short: "9 / 16", landscape: "16 / 9", square: "1 / 1" };

/**
 * Placeholder for the version being made: a video-shaped shimmer skeleton with the request,
 * a three-step progress line driven by the live events, and an elapsed timer.
 */
export function GeneratingCard({ events, format, fallbackVersion }: { events: LoopEvent[]; format: string; fallbackVersion: number }) {
  const gen = [...events].reverse().find((e) => e.name === "generating");
  const version = Number(gen?.data.version) || fallbackVersion;
  const since = gen ? events.slice(events.indexOf(gen)) : [];
  const has = (name: string) => since.some((e) => e.name === name && Number(e.data.version) === version);
  const failed = since.find((e) => e.name === "loop_error");
  // Card is replaced by the real version once it renders, so the critic step shows there.
  const active = has("rendered") ? 2 : has("rendering") ? 1 : 0;

  const request =
    (gen?.data.request as string | undefined) ||
    (version === 1 ? "First draft from your key moments" : version === 2 ? "Fixing what the critic flagged on v1" : "Working on your request");

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const secs = gen ? Math.max(0, Math.round((now - gen.at) / 1000)) : 0;

  if (failed) {
    return (
      <article className="rounded-2xl border border-bad/30 bg-bad/5 p-5">
        <h3 className="font-semibold">v{version} didn&apos;t finish.</h3>
        <p className="mt-1 text-sm text-muted">{String(failed.data.error).slice(0, 200)}</p>
      </article>
    );
  }

  return (
    <article className="space-y-4" aria-live="polite" aria-label={`Generating v${version}`}>
      <div className="flex items-baseline justify-between">
        <h3 className="font-semibold">
          v{version} <span className="font-normal text-muted">· generating</span>
        </h3>
        <span className="font-mono text-xs tabular-nums text-muted">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</span>
      </div>

      <div className="skeleton-shimmer relative mx-auto flex max-h-[520px] w-full items-center justify-center overflow-hidden rounded-xl border border-line bg-panel"
        style={{ aspectRatio: ASPECT[format] ?? "16 / 9" }}>
        <div className="flex flex-col items-center gap-3 text-center">
          <PixelMark size={34} live className="animate-pulse text-text" />
          <div className="display text-2xl">Generating v{version}</div>
          <p className="max-w-[32ch] px-4 text-sm text-muted">{request}</p>
        </div>
      </div>

      <ol className="grid grid-cols-3 gap-2" aria-label="Progress">
        {STEPS.map((label, i) => {
          const done = i < active;
          const now = i === active;
          return (
            <li key={label} className="space-y-1.5">
              <div className="h-1 overflow-hidden rounded-full bg-panel-2">
                <div className={`h-full rounded-full transition-all duration-700 ${done ? "w-full bg-green" : now ? "progress-indeterminate bg-text" : "w-0"}`} />
              </div>
              <div className={`text-xs ${now ? "font-medium text-text" : done ? "text-good" : "text-muted"}`}>
                {done ? "✓ " : ""}{label}
              </div>
            </li>
          );
        })}
      </ol>
    </article>
  );
}

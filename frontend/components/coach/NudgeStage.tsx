"use client";

/**
 * The live nudge, drawn on top of the camera feed so the presenter catches it in peripheral
 * vision while keeping eyes on the lens: a glow around the whole frame plus a large callout
 * with an icon, the instruction, and a bar that drains while the nudge is active.
 */

export type LiveNudge = { id: number; kind: string; message: string; source: "rule" | "gemma"; t: number };

export const NUDGE_MS = 6000;

const KIND: Record<string, { label: string; icon: React.ReactNode }> = {
  eye_contact: { label: "Eye contact", icon: <EyeIcon /> },
  pace: { label: "Pace", icon: <PaceIcon /> },
  fillers: { label: "Filler words", icon: <FillerIcon /> },
  articulation: { label: "Articulation", icon: <MouthIcon /> },
  tone: { label: "Tone", icon: <ToneIcon /> },
};

export function NudgeStage({ nudge }: { nudge: LiveNudge | null }) {
  if (!nudge) return null;
  const kind = KIND[nudge.kind] ?? { label: nudge.kind, icon: <ToneIcon /> };
  return (
    <div key={nudge.id} className="pointer-events-none absolute inset-0" role="status" aria-live="assertive">
      {/* Frame glow: noticeable without looking away from the camera. */}
      <div className="nudge-glow absolute inset-0 rounded-[inherit]" />
      <div className="absolute inset-x-0 bottom-[8%] flex justify-center px-4">
        <div className="nudge-callout flex max-w-[min(92%,44rem)] items-stretch overflow-hidden rounded-2xl bg-black/80 shadow-2xl ring-1 ring-warn/50 backdrop-blur-md">
          <div className="flex w-16 shrink-0 items-center justify-center bg-warn text-black sm:w-20">
            <span className="h-8 w-8 sm:h-10 sm:w-10">{kind.icon}</span>
          </div>
          <div className="min-w-0 px-5 py-3 sm:px-6 sm:py-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-warn">
              {kind.label}
              <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] tracking-wider text-muted">
                {nudge.source === "gemma" ? "Gemma" : "Live check"}
              </span>
            </div>
            <p className="mt-1 text-2xl font-semibold leading-tight text-white text-balance sm:text-3xl lg:text-4xl">
              {nudge.message}
            </p>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10">
              <div className="nudge-drain h-full rounded-full bg-warn" style={{ animationDuration: `${NUDGE_MS}ms` }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="h-full w-full" aria-hidden>
      {children}
    </svg>
  );
}
function EyeIcon() {
  return <Svg><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></Svg>;
}
function PaceIcon() {
  return <Svg><path d="M12 21a9 9 0 1 1 9-9" /><path d="m12 12 4-4" /><path d="M21 16v5h-5" /></Svg>;
}
function FillerIcon() {
  return <Svg><path d="M4 5h16v11H9l-5 4V5Z" /><path d="M9 10h.01M12 10h.01M15 10h.01" /></Svg>;
}
function MouthIcon() {
  return <Svg><path d="M3 12c3 4 15 4 18 0" /><path d="M3 12c3-3 15-3 18 0" /><path d="M8 12h8" /></Svg>;
}
function ToneIcon() {
  return <Svg><path d="M2 12h3l3-7 4 14 3-9 2 2h5" /></Svg>;
}

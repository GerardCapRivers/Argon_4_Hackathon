import type { Critique } from "@/lib/api";

/** Score ring + verdict headline + what works / what holds it back. The critique at a glance. */
export function CriticVerdict({ critique, previousScore }: { critique: Critique; previousScore?: number | null }) {
  const score = critique.score;
  const ready = critique.ready ?? score >= 8;
  const verdict = critique.verdict || (ready ? "Ready to publish" : "Needs another pass");
  const delta = previousScore != null ? score - previousScore : null;
  const strengths = (critique.strengths ?? []).slice(0, 4);
  const blockers = (critique.blockers ?? []).slice(0, 3);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <ScoreRing score={score} />
        <div className="min-w-0">
          <p className="text-lg font-semibold leading-snug text-balance">{verdict}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${ready ? "bg-good/15 text-good" : "bg-warn/15 text-warn"}`}>
              {ready ? <CheckIcon /> : <AlertIcon />}
              {ready ? "Ready to publish" : "Needs fixes"}
            </span>
            {delta != null && delta !== 0 && (
              <span className={`font-mono text-xs tabular-nums ${delta > 0 ? "text-good" : "text-bad"}`}>
                {delta > 0 ? "▲ +" : "▼ "}{delta.toFixed(1)} vs v1
              </span>
            )}
          </div>
        </div>
      </div>

      {(strengths.length > 0 || blockers.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {strengths.length > 0 && (
            <ul className="space-y-1.5">
              <li className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">What works</li>
              {strengths.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-sm"><span className="mt-0.5 text-good"><CheckIcon /></span>{s}</li>
              ))}
            </ul>
          )}
          {blockers.length > 0 && (
            <ul className="space-y-1.5">
              <li className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Holding it back</li>
              {blockers.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-sm"><span className="mt-0.5 text-warn"><AlertIcon /></span>{s}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {critique.summary && <p className="text-sm text-muted">{critique.summary}</p>}
    </div>
  );
}

function ScoreRing({ score }: { score: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const color = score >= 8 ? "var(--good)" : score >= 5 ? "var(--warn)" : "var(--bad)";
  return (
    <div className="relative h-16 w-16 shrink-0" role="img" aria-label={`Critic score ${score} out of 10`}>
      <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--line)" strokeWidth="6" />
        <circle cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(score, 10) / 10)} className="transition-[stroke-dashoffset] duration-700" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="font-mono text-lg font-semibold tabular-nums">{score.toFixed(1)}</span>
        <span className="text-[9px] text-muted">/ 10</span>
      </div>
    </div>
  );
}

export function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m3.5 8.5 3 3 6-7" />
    </svg>
  );
}

export function AlertIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <path d="M8 4.5v4.5M8 11.5v.01" /><circle cx="8" cy="8" r="6.5" />
    </svg>
  );
}

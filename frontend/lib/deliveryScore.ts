/**
 * Live Delivery Score (0-100) from the rolling metrics, so presenters can watch themselves
 * improve during a rehearsal. Each dimension maps to 0..1 against the coaching targets;
 * dimensions without data yet (e.g. pace before enough words) are left out and the
 * remaining weights renormalised.
 */
import type { HudMetrics } from "@/components/coach/LiveHud";

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export const WEIGHTS = { eye: 0.3, pace: 0.2, fillers: 0.2, clarity: 0.15, tone: 0.15 } as const;

export function dimensionScores(m: HudMetrics): Partial<Record<keyof typeof WEIGHTS, number>> {
  const out: Partial<Record<keyof typeof WEIGHTS, number>> = {};
  const eye = m.eye_contact_recent ?? m.eye_contact;
  if (eye != null) out.eye = clamp01(eye / 0.8); // 80%+ of the time on the lens is full marks
  const speech = (m.words ?? 0) >= 12;
  if (speech && m.wpm) {
    // Full marks in the 130-160 wpm band, falling to 0 at 80 and 220.
    out.pace = m.wpm < 130 ? clamp01((m.wpm - 80) / 50) : m.wpm > 160 ? clamp01((220 - m.wpm) / 60) : 1;
  }
  if (speech || m.fillers > 0) out.fillers = clamp01(1 - m.fillers / 5);
  if (speech && m.clarity != null) out.clarity = clamp01((m.clarity - 0.4) / 0.45);
  if (speech) out.tone = clamp01(m.pitch_variation / 0.12);
  return out;
}

export function deliveryScore(m: HudMetrics): number | null {
  const dims = dimensionScores(m);
  let total = 0;
  let weight = 0;
  for (const [k, v] of Object.entries(dims)) {
    const w = WEIGHTS[k as keyof typeof WEIGHTS];
    total += w * v;
    weight += w;
  }
  return weight ? Math.round((100 * total) / weight) : null;
}

/** Exponential smoothing so the number moves steadily instead of jittering each second. */
export function smooth(prev: number | null, next: number, alpha = 0.35): number {
  return prev == null ? next : prev + alpha * (next - prev);
}

export type ScorePoint = { t: number; score: number };

/** Change from the session's opening (first 15 s average) to now. */
export function sinceStart(history: ScorePoint[]): number | null {
  if (history.length < 5) return null;
  const opening = history.filter((p) => p.t <= history[0].t + 15);
  const base = opening.reduce((s, p) => s + p.score, 0) / opening.length;
  return Math.round(history[history.length - 1].score - base);
}

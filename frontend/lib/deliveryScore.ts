/**
 * Live Delivery Score (0-100) from the rolling metrics, so presenters can watch themselves
 * improve during a rehearsal. Each dimension maps to 0..1 against the coaching targets;
 * dimensions without data yet (e.g. pace before enough words) are left out and the
 * remaining weights renormalised.
 */
import type { HudMetrics } from "@/components/coach/LiveHud";

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export const WEIGHTS = { eye: 0.25, voice: 0.15, pace: 0.15, fillers: 0.15, clarity: 0.15, tone: 0.15 } as const;

/**
 * Voice projection from the mic level, measured in the browser so it reacts instantly.
 * `rmsAvg` is the loudness averaged over ~1 s; `speakingRef` is the presenter's own recent
 * speaking level (see VoiceTracker), so a quiet laptop mic isn't penalised while silence or
 * mumbling still pulls the score to 0 within ~2 s.
 */
const NOISE_FLOOR = 0.004;
const MIN_REF = 0.012;

export function voiceScore(rmsAvg: number, speakingRef = MIN_REF): number {
  return clamp01((rmsAvg - NOISE_FLOOR) / (0.55 * Math.max(speakingRef, MIN_REF) - NOISE_FLOOR));
}

/** ~1 s moving average of loudness + a slowly decaying reference of the speaker's normal level. */
export class VoiceTracker {
  avg = 0;
  ref = MIN_REF;
  push(rms: number) {
    this.avg += 0.12 * (rms - this.avg); // frames arrive every ~100 ms
    this.ref = Math.max(MIN_REF, this.avg, this.ref * 0.995);
  }
  get score() {
    return voiceScore(this.avg, this.ref);
  }
}

export const EMPTY_METRICS: HudMetrics = { wpm: 0, fillers: 0, eye_contact: null, clarity: null, pitch_variation: 0, words: 0 };

export function dimensionScores(m: HudMetrics, voice?: number | null): Partial<Record<keyof typeof WEIGHTS, number>> {
  const out: Partial<Record<keyof typeof WEIGHTS, number>> = {};
  if (voice != null) out.voice = clamp01(voice);
  const eye = m.eye_contact_recent ?? m.eye_contact;
  if (eye != null) out.eye = clamp01(eye / 0.8); // 80%+ of the time on the lens is full marks
  const speech = (m.words ?? 0) >= 6;
  if (speech && m.wpm) {
    // Full marks in the 130-160 wpm band, falling to 0 at 80 and 220.
    out.pace = m.wpm < 130 ? clamp01((m.wpm - 80) / 50) : m.wpm > 160 ? clamp01((220 - m.wpm) / 60) : 1;
  }
  if (speech || m.fillers > 0) out.fillers = clamp01(1 - m.fillers / 5);
  if (speech && m.clarity != null) out.clarity = clamp01((m.clarity - 0.4) / 0.45);
  if (speech) out.tone = clamp01(m.pitch_variation / 0.12);
  return out;
}

export function deliveryScore(m: HudMetrics, voice?: number | null): number | null {
  const dims = dimensionScores(m, voice);
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

"use client";

/**
 * Live delivery meters under the camera feed. Each meter draws its real scale with the
 * target range shaded, a marker at the current value, and a status word, so state reads
 * from position and text, not color alone.
 */

export type HudMetrics = {
  wpm: number;
  fillers: number;
  eye_contact: number | null;
  eye_contact_recent?: number | null;
  clarity: number | null;
  pitch_variation: number;
  words?: number;
};

type Status = { word: string; tone: "good" | "warn" | "idle" };

const IDLE: Status = { word: "Listening", tone: "idle" };

function Meter({
  label, value, display, unit, min, max, band, status, ticks,
}: {
  label: string;
  value: number | null;
  display: string;
  unit?: string;
  min: number;
  max: number;
  band: [number, number];
  status: Status;
  ticks: [number, string][];
}) {
  const pct = (v: number) => `${((Math.min(Math.max(v, min), max) - min) / (max - min)) * 100}%`;
  const chip =
    status.tone === "good" ? "bg-good/15 text-good" : status.tone === "warn" ? "bg-warn/15 text-warn" : "bg-line text-muted";
  return (
    <div className="min-w-0 rounded-xl border border-line bg-panel px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${chip}`}>{status.word}</span>
      </div>
      <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-text">
        {display}
        {unit && value != null && <span className="ml-1 text-sm font-normal text-muted">{unit}</span>}
      </div>
      <div className="relative mt-2 h-2 rounded-full bg-panel-2" aria-hidden>
        <div className="absolute inset-y-0 rounded-full bg-good/25" style={{ left: pct(band[0]), width: `calc(${pct(band[1])} - ${pct(band[0])})` }} />
        {value != null && (
          <div
            className={`absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-[left] duration-500 ease-out ${status.tone === "warn" ? "bg-warn" : "bg-text"}`}
            style={{ left: pct(value) }}
          />
        )}
      </div>
      <div className="relative mt-1 h-3 text-[10px] tabular-nums text-muted">
        {ticks.map(([v, t]) => (
          <span key={t} className="absolute -translate-x-1/2" style={{ left: pct(v) }}>{t}</span>
        ))}
      </div>
    </div>
  );
}

export function LiveHud({ m }: { m: HudMetrics | null }) {
  const hasSpeech = (m?.words ?? 0) >= 6;
  const wpm = hasSpeech ? m!.wpm : null;
  const eye = m?.eye_contact_recent ?? m?.eye_contact ?? null;
  const clarity = hasSpeech ? m!.clarity : null;
  const tone = hasSpeech ? m!.pitch_variation : null;
  const fillers = m ? m.fillers : null;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      <Meter
        label="Pace" value={wpm} display={wpm == null ? "—" : wpm.toFixed(0)} unit="wpm"
        min={80} max={220} band={[130, 160]}
        ticks={[[80, "80"], [130, "130"], [160, "160"], [220, "220"]]}
        status={wpm == null ? IDLE : wpm > 170 ? { word: "Too fast", tone: "warn" } : wpm < 110 ? { word: "Too slow", tone: "warn" } : { word: "On pace", tone: "good" }}
      />
      <Meter
        label="Eye contact" value={eye == null ? null : eye * 100} display={eye == null ? "—" : `${Math.round(eye * 100)}%`}
        min={0} max={100} band={[60, 100]}
        ticks={[[0, "0"], [60, "60"], [100, "100"]]}
        status={eye == null ? { word: "No face", tone: "idle" } : eye >= 0.6 ? { word: "Locked in", tone: "good" } : { word: "Look up", tone: "warn" }}
      />
      <Meter
        label="Fillers · 20s" value={fillers} display={fillers == null ? "—" : String(fillers)}
        min={0} max={6} band={[0, 1]}
        ticks={[[0, "0"], [1, "1"], [3, "3"], [6, "6+"]]}
        status={fillers == null ? IDLE : fillers <= 1 ? { word: "Clean", tone: "good" } : { word: fillers >= 3 ? "Pause instead" : "Watch it", tone: "warn" }}
      />
      <Meter
        label="Clarity" value={clarity == null ? null : clarity * 100} display={clarity == null ? "—" : `${Math.round(clarity * 100)}%`}
        min={30} max={100} band={[75, 100]}
        ticks={[[30, "30"], [75, "75"], [100, "100"]]}
        status={clarity == null ? IDLE : clarity >= 0.75 ? { word: "Crisp", tone: "good" } : { word: "Enunciate", tone: "warn" }}
      />
      <Meter
        label="Tone" value={tone} display={tone == null ? "—" : tone >= 0.12 ? "Dynamic" : tone >= 0.07 ? "Flat" : "Monotone"}
        min={0} max={0.25} band={[0.12, 0.25]}
        ticks={[[0, "flat"], [0.12, "varied"], [0.25, "max"]]}
        status={tone == null ? IDLE : tone >= 0.12 ? { word: "Engaging", tone: "good" } : { word: "Vary pitch", tone: "warn" }}
      />
    </div>
  );
}

type Row = { label: string; value: number | null; display: string; min: number; max: number; band: [number, number]; status: Status };

/** Compact one-line-per-metric list for the single-screen live view. */
export function LiveMeterList({ m, voice }: { m: HudMetrics | null; voice?: number | null }) {
  const hasSpeech = (m?.words ?? 0) >= 6;
  const wpm = hasSpeech ? m!.wpm : null;
  const eye = m?.eye_contact_recent ?? m?.eye_contact ?? null;
  const clarity = hasSpeech ? m!.clarity : null;
  const tone = hasSpeech ? m!.pitch_variation : null;
  const fillers = m ? m.fillers : null;
  const rows: Row[] = [
    { label: "Voice", value: voice == null ? null : voice * 100, display: voice == null ? "—" : `${Math.round(voice * 100)}%`, min: 0, max: 100, band: [60, 100],
      status: voice == null ? IDLE : voice >= 0.6 ? { word: "Projecting", tone: "good" } : voice >= 0.2 ? { word: "Speak up", tone: "warn" } : { word: "Silent", tone: "warn" } },
    { label: "Pace", value: wpm, display: wpm == null ? "—" : `${wpm.toFixed(0)} wpm`, min: 80, max: 220, band: [130, 160],
      status: wpm == null ? IDLE : wpm > 170 ? { word: "Too fast", tone: "warn" } : wpm < 110 ? { word: "Too slow", tone: "warn" } : { word: "On pace", tone: "good" } },
    { label: "Eye contact", value: eye == null ? null : eye * 100, display: eye == null ? "—" : `${Math.round(eye * 100)}%`, min: 0, max: 100, band: [60, 100],
      status: eye == null ? { word: "No face", tone: "idle" } : eye >= 0.6 ? { word: "Locked in", tone: "good" } : { word: "Look up", tone: "warn" } },
    { label: "Fillers · 20s", value: fillers, display: fillers == null ? "—" : String(fillers), min: 0, max: 6, band: [0, 1],
      status: fillers == null ? IDLE : fillers <= 1 ? { word: "Clean", tone: "good" } : { word: fillers >= 3 ? "Pause instead" : "Watch it", tone: "warn" } },
    { label: "Clarity", value: clarity == null ? null : clarity * 100, display: clarity == null ? "—" : `${Math.round(clarity * 100)}%`, min: 30, max: 100, band: [75, 100],
      status: clarity == null ? IDLE : clarity >= 0.75 ? { word: "Crisp", tone: "good" } : { word: "Enunciate", tone: "warn" } },
    { label: "Tone", value: tone, display: tone == null ? "—" : tone >= 0.12 ? "Dynamic" : tone >= 0.07 ? "Flat" : "Monotone", min: 0, max: 0.25, band: [0.12, 0.25],
      status: tone == null ? IDLE : tone >= 0.12 ? { word: "Engaging", tone: "good" } : { word: "Vary pitch", tone: "warn" } },
  ];
  const pct = (r: Row, v: number) => `${((Math.min(Math.max(v, r.min), r.max) - r.min) / (r.max - r.min)) * 100}%`;
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => {
        const chip = r.status.tone === "good" ? "bg-good/15 text-good" : r.status.tone === "warn" ? "bg-warn/15 text-warn" : "bg-panel-2 text-muted";
        return (
          <li key={r.label} className="py-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted">{r.label}</span>
              <span className="flex items-center gap-2">
                <span className="font-mono text-sm font-semibold tabular-nums">{r.display}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${chip}`}>{r.status.word}</span>
              </span>
            </div>
            <div className="relative mt-1 h-1.5 rounded-full bg-panel-2" aria-hidden>
              <div className="absolute inset-y-0 rounded-full bg-good/25" style={{ left: pct(r, r.band[0]), width: `calc(${pct(r, r.band[1])} - ${pct(r, r.band[0])})` }} />
              {r.value != null && (
                <div className={`absolute top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full transition-[left] duration-500 ${r.status.tone === "warn" ? "bg-warn" : "bg-text"}`}
                  style={{ left: pct(r, r.value) }} />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

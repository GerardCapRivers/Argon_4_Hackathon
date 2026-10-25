"use client";

import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { HudMetrics, LiveHud } from "@/components/coach/LiveHud";
import { LiveNudge, NUDGE_MS, NudgeStage } from "@/components/coach/NudgeStage";
import { ScoreTrend } from "@/components/coach/ScoreTrend";
import { Spinner } from "@/components/Spinner";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { API, postJSON, WS_API } from "@/lib/api";
import { startAudio } from "@/lib/audio";
import { deliveryScore, ScorePoint, sinceStart, smooth } from "@/lib/deliveryScore";
import { createLandmarker, EyeContactModel, extractSample, Sample } from "@/lib/eyeContact";

type Phase = "setup" | "calibrating" | "live" | "uploading";
type Metrics = HudMetrics & { t: number };

const CALIBRATION_STEPS = [
  { label: "Look straight at the camera", positive: true },
  { label: "Now look around the room: at your notes, the screen, the ceiling", positive: false },
];
const STEP_MS = 3000;

export default function CoachPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lmRef = useRef<FaceLandmarker | null>(null);
  const modelRef = useRef(new EyeContactModel());
  // The setup and live layouts render different trees, so React mounts a fresh <video> when the
  // phase changes. Re-attach the camera stream to whichever element is mounted.
  const attachVideo = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el && streamRef.current && el.srcObject !== streamRef.current) el.srcObject = streamRef.current;
  }, []);
  const stopRef = useRef<() => Promise<void>>(async () => {});
  // Stops everything a live session started; also run if the page unmounts mid-rehearsal.
  const teardownRef = useRef<() => void>(() => {});
  const mountedRef = useRef(true);

  const [phase, setPhase] = useState<Phase>("setup");
  const [title, setTitle] = useState("Investor pitch rehearsal");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [calStep, setCalStep] = useState(0);
  const [calResult, setCalResult] = useState<{ before: number; after: number } | null>(null);
  const [pretrainedAuc, setPretrainedAuc] = useState<number | null | undefined>(undefined);
  const [eyeNow, setEyeNow] = useState<boolean | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [nudges, setNudges] = useState<LiveNudge[]>([]);
  const [activeNudge, setActiveNudge] = useState<LiveNudge | null>(null);
  const [scoreHistory, setScoreHistory] = useState<ScorePoint[]>([]);
  const [level, setLevel] = useState(0);
  const scoreRef = useRef<number | null>(null);
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [transcript, setTranscript] = useState("");
  const [elapsed, setElapsed] = useState(0);

  // Camera + face model.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720 },
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        const [landmarker, auc] = await Promise.all([createLandmarker(), modelRef.current.loadPretrained()]);
        lmRef.current = landmarker;
        setPretrainedAuc(auc);
        setReady(true);
      } catch (e) {
        setError(`Camera / microphone unavailable: ${(e as Error).message}`);
      }
    })();
    mountedRef.current = true;
    return () => {
      cancelled = true;
      mountedRef.current = false;
      teardownRef.current();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      lmRef.current?.close();
      lmRef.current = null;
    };
  }, []);

  /** Sample face features at ~10 Hz while `active()` returns true. */
  function sampleLoop(onSample: (f: Sample | null) => void, active: () => boolean) {
    let last = 0;
    const tick = (now: number) => {
      if (!mountedRef.current || !active()) return;
      const v = videoRef.current;
      if (v && lmRef.current && now - last > 100 && v.readyState >= 2) {
        last = now;
        onSample(extractSample(lmRef.current, v, now));
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  async function calibrate() {
    setPhase("calibrating");
    setError("");
    const pos: Sample[] = [];
    const neg: Sample[] = [];
    for (let s = 0; s < CALIBRATION_STEPS.length; s++) {
      setCalStep(s);
      await new Promise((r) => setTimeout(r, 700)); // time to move the eyes
      const until = performance.now() + STEP_MS;
      await new Promise<void>((resolve) =>
        sampleLoop(
          (f) => f && (CALIBRATION_STEPS[s].positive ? pos : neg).push(f),
          () => (performance.now() < until ? true : (resolve(), false)),
        ),
      );
    }
    try {
      setCalResult(modelRef.current.calibrate(pos, neg));
    } catch (e) {
      setError((e as Error).message);
    }
    setPhase("setup");
  }

  async function start() {
    const stream = streamRef.current;
    if (!stream) return;
    setError("");
    const { id } = await postJSON<{ id: number }>("/api/coach", { title });
    const ws = new WebSocket(`${WS_API}/ws/coach/${id}`);
    ws.binaryType = "arraybuffer";
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("Coaching server unreachable")); });

    const t0 = performance.now();
    const now = () => (performance.now() - t0) / 1000;
    let live = true;

    scoreRef.current = null;
    setScoreHistory([]);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "metrics") {
        setMetrics(msg);
        const raw = deliveryScore(msg);
        if (raw != null) {
          scoreRef.current = smooth(scoreRef.current, raw);
          const point = { t: msg.t, score: scoreRef.current };
          setScoreHistory((h) => [...h, point].slice(-600));
        }
      } else if (msg.type === "transcript") setTranscript((t) => (t + " " + msg.text).slice(-400));
      else if (msg.type === "nudge") {
        const n: LiveNudge = { ...msg, id: Date.now() + Math.random() };
        setNudges((list) => [...list, n].slice(-30));
        setActiveNudge(n);
        if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
        nudgeTimer.current = setTimeout(() => setActiveNudge(null), NUDGE_MS);
      }
    };

    // Full recording (video + audio) for the end-of-session Argon report.
    const rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm" });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.start(1000);

    // Audio → backend (whisper + metrics), plus volume / pitch.
    let lastRms: number | null = null;
    let lastPitch: number | null = null;
    let lastLevelAt = 0;
    const stopAudio = await startAudio(stream, (f) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(f.pcm);
      lastRms = f.rms;
      lastPitch = f.pitch;
      const nowMs = performance.now();
      if (nowMs - lastLevelAt > 100) {
        lastLevelAt = nowMs;
        setLevel(Math.min(1, f.rms * 8)); // speech RMS is ~0.02-0.15
      }
    });

    // Eye contact → backend every ~200 ms (never sends frames).
    let eyeVotes: boolean[] = [];
    sampleLoop((f) => {
      const looking = f ? modelRef.current.predict(f) : false;
      eyeVotes.push(looking);
      setEyeNow(looking);
      if (eyeVotes.length >= 2 && ws.readyState === WebSocket.OPEN) {
        const eye = eyeVotes.filter(Boolean).length / eyeVotes.length >= 0.5;
        ws.send(JSON.stringify({ type: "signals", t: now(), eye, rms: lastRms, pitch: lastPitch, score: scoreRef.current }));
        eyeVotes = [];
      }
    }, () => live);

    const timer = setInterval(() => setElapsed(now()), 250);
    setPhase("live");

    let tornDown = false;
    teardownRef.current = () => {
      if (tornDown) return;
      tornDown = true;
      live = false;
      clearInterval(timer);
      if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
      stopAudio();
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
      if (rec.state !== "inactive") rec.stop();
    };

    stopRef.current = async () => {
      live = false;
      clearInterval(timer);
      stopAudio();
      tornDown = true; // from here on, the stop flow below owns cleanup
      setPhase("uploading");
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "stop" }));
      await new Promise<void>((res) => {
        if (ws.readyState === WebSocket.CLOSED) return res();
        ws.onclose = () => res();
        setTimeout(res, 3000);
      });
      await new Promise<void>((res) => { rec.onstop = () => res(); rec.stop(); });
      const fd = new FormData();
      fd.set("recording", new File(chunks, "rehearsal.webm", { type: "video/webm" }));
      await fetch(`${API}/api/coach/${id}/recording`, { method: "POST", body: fd });
      router.push(`/coach/${id}`);
    };
  }

  const liveView = phase === "live" || phase === "uploading";
  const score = scoreHistory.length ? Math.round(scoreHistory[scoreHistory.length - 1].score) : null;
  const delta = sinceStart(scoreHistory);
  const best = scoreHistory.length ? Math.round(Math.max(...scoreHistory.map((p) => p.score))) : null;

  const stage = (
    <div className="surface-dark relative overflow-hidden rounded-2xl border border-line">
      <video ref={attachVideo} autoPlay muted playsInline className="aspect-video w-full -scale-x-100 object-cover" />
      {liveView && (
        <>
          <div className="absolute left-3 top-3 flex items-center gap-2">
            <div className="flex items-center gap-2 rounded-full bg-black/65 px-3 py-1.5 text-xs font-medium tabular-nums text-white backdrop-blur">
              <span className="h-2 w-2 animate-pulse rounded-full bg-bad" />
              REC {Math.floor(elapsed / 60)}:{String(Math.floor(elapsed % 60)).padStart(2, "0")}
              <LevelBars level={level} />
            </div>
            {score != null && (
              <div className="flex items-center gap-1.5 rounded-full bg-black/65 px-3 py-1.5 text-xs backdrop-blur">
                <span className="text-white/70">Score</span>
                <span className="font-mono text-sm font-semibold tabular-nums text-white">{score}</span>
                {delta != null && delta !== 0 && (
                  <span className={`font-mono tabular-nums ${delta > 0 ? "text-good" : "text-warn"}`}>
                    {delta > 0 ? "▲" : "▼"}{Math.abs(delta)}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className={`absolute right-3 top-3 flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium backdrop-blur transition-colors ${eyeNow ? "bg-good/85 text-black" : "bg-black/65 text-white"}`}>
            <span className={`h-2 w-2 rounded-full ${eyeNow ? "bg-black" : "bg-warn"}`} />
            {eyeNow ? "Eye contact" : "Look at the lens"}
          </div>
          <NudgeStage nudge={activeNudge} />
        </>
      )}
      {phase === "calibrating" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 text-center">
          {CALIBRATION_STEPS[calStep].positive && <div className="absolute left-1/2 top-2 h-4 w-4 -translate-x-1/2 animate-ping rounded-full bg-accent" />}
          <p className="text-2xl font-semibold">{CALIBRATION_STEPS[calStep].label}</p>
          <p className="mt-2 text-sm text-muted">Personalising the eye-contact model · step {calStep + 1}/2</p>
        </div>
      )}
      {!ready && !error && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted"><Spinner /> Loading camera and face model…</div>
      )}
    </div>
  );

  if (liveView) {
    return (
      <div className="space-y-4">
        {error && <p className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{error}</p>}
        {stage}

        <div className="grid gap-3 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <section className="rounded-xl border border-line bg-panel px-4 py-3" aria-label="Delivery score">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Delivery score</div>
                <div className="mt-0.5 flex items-baseline gap-2">
                  <span className="font-mono text-5xl font-semibold tabular-nums text-text">{score ?? "—"}</span>
                  <span className="text-sm text-muted">/ 100</span>
                </div>
              </div>
              <div className="text-right text-xs tabular-nums">
                {delta != null && (
                  <div className={delta >= 0 ? "text-good" : "text-warn"}>
                    {delta >= 0 ? "▲ +" : "▼ "}{delta} since start
                  </div>
                )}
                {best != null && <div className="mt-0.5 text-muted">Best {best}</div>}
              </div>
            </div>
            <div className="mt-4">
              <ScoreTrend history={scoreHistory} />
            </div>
          </section>
          <LiveHud m={metrics} />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-1" aria-label="Nudge history">
            <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Nudges</span>
            {nudges.length === 0 && <span className="text-sm text-muted">None yet</span>}
            {[...nudges].reverse().map((n) => (
              <span key={n.id} className="shrink-0 rounded-full border border-line bg-panel px-3 py-1 text-xs">
                <span className="mr-1.5 font-mono tabular-nums text-muted">{n.t.toFixed(0)}s</span>{n.message}
              </span>
            ))}
          </div>
          <button className="btn-mono-dark px-6 py-3" onClick={() => stopRef.current()} disabled={phase === "uploading"}>
            {phase === "uploading" ? <><Spinner /> Saving…</> : <>Finish &amp; get report <span className="arrow-ne">↗</span></>}
          </button>
        </div>
        {phase === "live" && <p className="min-h-6 text-sm leading-relaxed text-muted">{transcript || "Start talking…"}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <div className="rise">
        <SectionHeader
          size="h1"
          eyebrow="Stage 1 · on-device Gemma"
          title="Live coaching."
          lede="Rehearse on camera. Nudges appear on the video as you speak; your Delivery Score updates every second."
        />
      </div>
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">{stage}</div>

      <aside className="space-y-4">
        {error && <p className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{error}</p>}
        <div className="card space-y-4">
          <div>
            <label className="label" htmlFor="session-title">Session name</label>
            <input id="session-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <button className="btn-ghost w-full" onClick={calibrate} disabled={!ready || phase === "calibrating"}>
              {calResult != null ? "Recalibrate eye contact" : "Calibrate eye contact (6s)"}
            </button>
            <p className="mt-2 text-xs text-muted">
              {pretrainedAuc === undefined
                ? "Loading eye-contact model…"
                : pretrainedAuc != null
                  ? `Pretrained on the Columbia Gaze dataset (AUC ${pretrainedAuc.toFixed(2)} on unseen people).`
                  : "Pretrained model unavailable; using a simple rule."}
              {calResult != null
                ? ` Personalised to you: ${Math.round(calResult.before * 100)}% → ${Math.round(calResult.after * 100)}% on calibration.`
                : " Optional: calibrate to adapt it to your face and lighting. Runs entirely in your browser."}
            </p>
          </div>
          <button className="btn-mono-dark w-full py-3" onClick={() => start().catch((e) => setError(e.message))} disabled={!ready || phase === "calibrating"}>
            Start rehearsal <span className="arrow-ne">↗</span>
          </button>
          <p className="text-xs text-muted">
            Audio is transcribed locally (Whisper) and coached by Gemma on this device. The recording goes to Gemini only
            when you finish, for your report.
          </p>
        </div>
      </aside>
    </div>
    </div>
  );
}

/** Five-bar mic level, so the presenter can see they are being heard. */
function LevelBars({ level }: { level: number }) {
  return (
    <span className="ml-1 flex h-3 items-end gap-[2px]" aria-hidden>
      {[0.1, 0.25, 0.45, 0.65, 0.85].map((th, i) => (
        <span key={i} className={`w-[3px] rounded-sm transition-colors ${level > th ? "bg-good" : "bg-white/25"}`} style={{ height: `${40 + i * 15}%` }} />
      ))}
    </span>
  );
}

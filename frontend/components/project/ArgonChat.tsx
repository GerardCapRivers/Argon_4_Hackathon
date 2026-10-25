"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { API, Critique, Iteration } from "@/lib/api";
import type { LoopEvent } from "./LoopStepper";

const SUGGESTIONS = ["Bigger captions", "Open with the traction number", "Cut it to 20 seconds", "More energy", "Calmer pace"];

type Msg =
  | { kind: "user"; key: string; text: string; at?: string; pending?: boolean }
  | { kind: "argon"; key: string; it: Iteration; title: string; previousScore?: number | null }
  | { kind: "working"; key: string; version: number; step: string }
  | { kind: "error"; key: string; text: string; retry?: string }
  | { kind: "system"; key: string; text: string };

const STEP: Record<string, string> = {
  generating: "Writing the edit code",
  rendering: "Rendering the video",
  rendered: "Rendered, sending to the critic",
  render_error: "Render failed, repairing the script",
  critiquing: "Critic is watching",
};

/** Chat-style history of every version, plus a composer that sends feedback for the next one. */
export function ArgonChat({
  iterations, events, running, onSend, onCompare, onRegenerate, referenceCount = 0,
}: {
  iterations: Iteration[];
  events: LoopEvent[];
  running: boolean;
  onSend: (text: string) => Promise<boolean>;
  onCompare: (version: number) => void;
  onRegenerate: (version: number) => void;
  referenceCount?: number;
}) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<{ text: string; version: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const latest = iterations[iterations.length - 1];
  const nextVersion = (latest?.version ?? 0) + 1;

  // The optimistic message disappears once the server has saved the version it produced.
  useEffect(() => {
    if (pending && iterations.some((i) => i.version >= pending.version && i.feedback)) setPending(null);
  }, [iterations, pending]);

  const messages = useMemo(() => {
    const out: Msg[] = [];
    for (const it of iterations) {
      const prev = iterations.find((i) => i.version === it.version - 1);
      if (it.trigger === "regen") {
        out.push({ kind: "system", key: `s${it.version}`, text: `↻ ${it.feedback || "Regenerated from the critic's notes"}` });
      }
      if (it.trigger === "human" && it.feedback) {
        out.push({ kind: "user", key: `u${it.version}`, text: it.feedback, at: it.created_at });
      }
      const title = it.trigger === "draft" ? `Draft v${it.version} is ready.`
        : it.trigger === "regen" ? `I fixed what the critic flagged. Here's v${it.version}.`
        : it.trigger === "critique" ? `I fixed what the critic flagged. Here's v${it.version}.`
          : `Done. Here's v${it.version}.`;
      out.push({ kind: "argon", key: `a${it.version}`, it, title, previousScore: prev?.score });
    }
    // Live progress for the version being worked on.
    const live = [...events].reverse().find((e) => ["generating", "rendering", "rendered", "render_error", "critiquing", "loop_error", "done"].includes(e.name));
    const failed = events.filter((e) => e.name === "loop_error");
    const lastFail = failed[failed.length - 1];
    if (pending) out.push({ kind: "user", key: "pending", text: pending.text, pending: true });
    const liveGen = [...events].reverse().find((e) => e.name === "generating");
    if (running && liveGen?.data.trigger === "regen" && !iterations.some((i) => i.version === Number(liveGen.data.version))) {
      out.push({ kind: "system", key: "sregen", text: `↻ ${String(liveGen.data.request ?? "Regenerating from the critic's notes")}` });
    }
    if (running && live && live.name !== "loop_error" && live.name !== "done") {
      const v = Number(live.data.version) || nextVersion;
      const done = iterations.find((i) => i.version === v);
      const step = live.name === "critiquing" || (live.name === "rendered" && done) ? STEP.critiquing : STEP[live.name] ?? "Working";
      out.push({ kind: "working", key: `w${v}`, version: v, step });
    } else if (running) {
      out.push({ kind: "working", key: "w", version: nextVersion, step: "Starting" });
    }
    if (!running && lastFail && Number(lastFail.data.version ?? 0) >= nextVersion) {
      const fb = lastFail.data.feedback as string | undefined;
      if (fb && !pending) out.push({ kind: "user", key: "ufail", text: fb });
      out.push({ kind: "error", key: "err", text: String(lastFail.data.error).slice(0, 140), retry: fb });
    }
    return out;
  }, [iterations, events, running, pending, nextVersion]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, running]);

  async function send(message?: string) {
    const body = (message ?? text).trim();
    if (!body || running) return;
    setPending({ text: body, version: nextVersion });
    setText("");
    const ok = await onSend(body);
    if (!ok) setPending(null);
  }

  return (
    <section aria-label="Edit with Argon" className="flex h-full min-h-[36rem] flex-col overflow-hidden rounded-3xl border border-line bg-bg shadow-[0_24px_60px_-30px_rgb(0_0_0/0.35)]">
      <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold">Edit with Argon</div>
          <div className="font-mono text-[11px] leading-snug text-muted">gemini-4-argon · 1M-token context · remembers this chat</div>
        </div>
        <span className="badge shrink-0 whitespace-nowrap">{running ? <><span className="dot-live" /> working</> : `${iterations.length} versions`}</span>
      </header>

      <div ref={listRef} className="flex-1 space-y-5 overflow-y-auto px-5 py-6" aria-live="polite">
        {messages.length === 0 && (
          <p className="text-center text-sm text-muted">Your first draft will appear here.</p>
        )}
        {messages.map((m) => {
          if (m.kind === "user")
            return (
              <div key={m.key} className="flex justify-end">
                <div className={`max-w-[85%] rounded-2xl rounded-br-md bg-[#0a0a0a] px-3.5 py-2.5 text-sm text-white ${m.pending ? "opacity-70" : ""}`}>
                  {m.text}
                  {m.at && <div className="mt-1 text-right font-mono text-[10px] text-white/50">{new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>}
                </div>
              </div>
            );
          if (m.kind === "system")
            return (
              <div key={m.key} className="flex justify-center">
                <span className="rounded-full border border-line bg-panel px-3 py-1 font-mono text-[11px] text-muted">{m.text}</span>
              </div>
            );
          if (m.kind === "working")
            return (
              <ArgonBubble key={m.key}>
                <div className="flex items-center gap-2 text-sm">
                  <TypingDots />
                  <span className="text-muted">{m.step} · v{m.version}</span>
                </div>
              </ArgonBubble>
            );
          if (m.kind === "error")
            return (
              <ArgonBubble key={m.key} tone="bad">
                <p className="text-sm">Couldn&apos;t finish that version: {m.text}</p>
                {m.retry && (
                  <button className="mt-2 text-xs font-medium underline underline-offset-2" onClick={() => send(m.retry)}>Try again</button>
                )}
              </ArgonBubble>
            );
          const c = m.it.critique as Critique;
          const delta = m.previousScore != null && m.it.score != null ? m.it.score - m.previousScore : null;
          return (
            <ArgonBubble key={m.key}>
              <p className="text-sm font-medium">{m.title}</p>
              {(m.it.changes?.length ?? 0) > 0 && (
                <ul className="mt-2 space-y-1">
                  {m.it.changes!.slice(0, 4).map((ch, i) => (
                    <li key={i} className="flex gap-2 text-[13px] text-muted"><span className="text-good">→</span>{ch}</li>
                  ))}
                </ul>
              )}
              <video src={`${API}${m.it.url}?tc=${encodeURIComponent(`${m.it.title_card?.title ?? ""}|${m.it.title_card?.subtitle ?? ""}`)}`} controls preload="metadata" className="mt-3 max-h-80 w-full rounded-xl bg-[#0a0a0a]" />
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {m.it.score != null ? (
                  <span className="badge text-text">{m.it.score.toFixed(1)}/10</span>
                ) : (
                  <span className="badge"><TypingDots /> scoring</span>
                )}
                {delta != null && delta !== 0 && (
                  <span className={`badge ${delta > 0 ? "text-good" : "text-bad"}`}>{delta > 0 ? "▲ +" : "▼ "}{delta.toFixed(1)}</span>
                )}
                {c?.verdict && <span className="text-xs text-muted">{c.verdict}</span>}
                <span className="ml-auto flex items-center gap-3">
                  {m.it.score != null && (
                    <button className="text-xs font-medium hover:underline disabled:opacity-40 disabled:no-underline" disabled={running}
                      onClick={() => onRegenerate(m.it.version)} title="Make a new version that fixes what the critic flagged">
                      ↻ Regenerate
                    </button>
                  )}
                  <button className="text-xs font-medium hover:underline" onClick={() => onCompare(m.it.version)}>Compare ↗</button>
                </span>
              </div>
            </ArgonBubble>
          );
        })}
      </div>

      <div className="space-y-2 border-t border-line p-3">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" disabled={running} onClick={() => setText((t) => (t ? `${t}, ${s.toLowerCase()}` : s))}
              className="shrink-0 rounded-full border border-line px-2.5 py-1 text-xs text-muted transition hover:border-text hover:text-text disabled:opacity-40">
              + {s}
            </button>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-end gap-2 rounded-2xl border border-line bg-panel py-1.5 pl-4 pr-1.5 transition focus-within:border-text">
          <label htmlFor="argon-chat-input" className="sr-only">Message Argon</label>
          <textarea
            id="argon-chat-input"
            rows={1}
            value={text}
            disabled={running}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={running ? `Argon is working on v${nextVersion}…` : `Ask for changes to v${latest?.version ?? 1}…`}
            className="max-h-32 min-h-9 flex-1 resize-none bg-transparent py-2 text-sm outline-none placeholder:text-muted disabled:opacity-60"
          />
          <button type="submit" disabled={running || !text.trim()} aria-label={`Send and render v${nextVersion}`}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0a0a0a] text-white transition hover:opacity-85 disabled:opacity-30">
            {running ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : (
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" /></svg>
            )}
          </button>
        </form>
        <p className="px-1 font-mono text-[10.5px] text-muted">
          Enter to send · Shift+Enter for a new line · renders v{nextVersion}
          {referenceCount > 0 && <> · follows {referenceCount} style reference{referenceCount === 1 ? "" : "s"}</>}
        </p>
      </div>
    </section>
  );
}

function ArgonBubble({ children, tone }: { children: React.ReactNode; tone?: "bad" }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#0a0a0a] font-mono text-[11px] font-semibold text-white" aria-hidden>Ar</span>
      <div className={`min-w-0 max-w-[88%] rounded-2xl rounded-tl-md border px-3.5 py-2.5 ${tone === "bad" ? "border-bad/30 bg-bad/5 text-bad" : "border-line bg-panel"}`}>
        {children}
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label="working">
      {[0, 1, 2].map((i) => (
        <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" style={{ animationDelay: `${i * 120}ms` }} />
      ))}
    </span>
  );
}

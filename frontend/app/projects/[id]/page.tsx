"use client";

import { use, useCallback, useEffect, useState } from "react";
import { DiffView } from "@/components/DiffView";
import { CriticVerdict } from "@/components/project/CriticVerdict";
import { CritiqueList } from "@/components/project/CritiqueList";
import { EditTimeline } from "@/components/project/EditTimeline";
import { ArgonChat } from "@/components/project/ArgonChat";
import { GeneratingCard } from "@/components/project/GeneratingCard";
import { StyleReferences } from "@/components/project/StyleReferences";
import { TitleCardEditor } from "@/components/project/TitleCardEditor";
import { LoopEvent, LoopStepper } from "@/components/project/LoopStepper";
import { Score } from "@/components/Score";
import { Spinner } from "@/components/Spinner";
import { API, api, Critique, fmtTime, Iteration, postJSON, Project } from "@/lib/api";

const EVENT_NAMES = ["analyzing", "moments", "generating", "rendering", "rendered", "render_error", "critiquing", "critique", "done", "loop_error"];

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [project, setProject] = useState<Project | null>(null);
  const [events, setEvents] = useState<LoopEvent[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  const [compare, setCompare] = useState<number[] | null>(null); // versions picked for side-by-side

  const refresh = useCallback(async () => {
    try {
      const p = await api<Project>(`/api/projects/${id}`);
      setProject(p);
      return p;
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    refresh().then((p) => p && setSelected(new Set(p.selected_moments)));
    const es = new EventSource(`${API}/api/projects/${id}/events`);
    // Ids are "<generation>:<index>". Skip repeats (reconnect replays); a new generation means a fresh run.
    const seen = new Set<string>();
    let generation: string | null = null;
    EVENT_NAMES.forEach((name) =>
      es.addEventListener(name, (e) => {
        const msg = e as MessageEvent;
        if (msg.lastEventId) {
          if (seen.has(msg.lastEventId)) return;
          seen.add(msg.lastEventId);
        }
        const gen = msg.lastEventId.split(":")[0] || null;
        const fresh = generation !== null && gen !== null && gen !== generation;
        if (gen) generation = gen;
        const data = JSON.parse(msg.data);
        // Server time, so replayed events (after a reload) keep their real durations.
        const at = typeof data._ts === "number" ? data._ts * 1000 : Date.now();
        setEvents((prev) => [...(fresh ? [] : prev), { name, data, at }]);
        if (name === "moments") refresh().then((p) => p && setSelected(new Set(p.selected_moments)));
        if (["rendered", "critique", "done", "loop_error"].includes(name)) refresh();
      }),
    );
    return () => es.close();
  }, [id, refresh]);

  if (!project) return <p className="text-sm text-muted">{error || "Loading…"}</p>;

  const iterations = project.iterations;
  const busy = project.status === "rendering" || project.status === "analyzing";
  const loopEvents = events.filter((e) => e.name !== "analyzing" && e.name !== "moments");
  const analyzingStep = [...events].reverse().find((e) => e.name === "analyzing")?.data.step as string | undefined;
  const v1 = iterations.find((i) => i.version === 1);
  const latest = iterations[iterations.length - 1];
  // A version is being made and hasn't rendered yet: show the animated placeholder on the left.
  const lastGen = [...loopEvents].reverse().find((e) => e.name === "generating");
  const generatingNew = project.status === "rendering" &&
    !(lastGen && iterations.some((i) => i.version === Number(lastGen.data.version)));

  // Two versions side by side: the user's pick, or the latest two.
  const picked = (compare ?? iterations.slice(-2).map((i) => i.version))
    .map((v) => iterations.find((i) => i.version === v))
    .filter((i): i is Iteration => !!i)
    .sort((a, b) => a.version - b.version);
  const pair = picked.length ? picked : iterations.slice(-2);
  const [older, newer] = pair.length === 2 ? pair : [undefined, undefined];

  function toggleCompare(v: number) {
    const cur = pair.map((p) => p.version);
    if (cur.includes(v)) setCompare(cur.filter((x) => x !== v));
    else setCompare([...cur.slice(-1), v]);
  }

  async function reanalyze() {
    setError("");
    try {
      setEvents([]);
      await postJSON(`/api/projects/${id}/analyze`, {});
    } catch (e) {
      setError((e as Error).message);
    }
    refresh();
  }

  async function run() {
    setError("");
    try {
      await postJSON(`/api/projects/${id}/select`, { selected: [...selected] });
      setEvents([]); // the server starts a fresh event log for a new run
      await postJSON(`/api/projects/${id}/run`, {});
    } catch (e) {
      setError((e as Error).message);
    }
    refresh();
  }

  async function regenerate(version: number) {
    setError("");
    try {
      await postJSON(`/api/projects/${id}/regenerate`, { version });
      setCompare(null);
      document.getElementById("versions")?.scrollIntoView({ behavior: "smooth" });
    } catch (e) {
      setError((e as Error).message);
    }
    refresh();
  }

  async function sendFeedback(text: string): Promise<boolean> {
    setError("");
    try {
      await postJSON(`/api/projects/${id}/feedback`, { feedback: text });
      setCompare(null); // follow the newest versions again
      refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 rise">
          <div className="eyebrow mb-3 flex items-center gap-2">
            Pitch video · {project.format}
            {busy && <span className="badge"><span className="dot-live" />{project.status === "analyzing" ? "Analyzing" : "Rendering"}</span>}
          </div>
          <h1 className="display text-4xl sm:text-5xl">{project.title.replace(/\.?$/, ".")}</h1>
          <p className="mt-3 max-w-[65ch] text-[17px] text-muted">{project.goal}</p>
        </div>
        {v1?.score != null && latest && latest.version > 1 && latest.score != null && (
          <div className="flex items-center gap-3 rounded-full border border-line bg-panel py-1.5 pl-4 pr-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Critic</span>
            <Score value={v1.score} />
            <span className="text-muted">→</span>
            <Score value={latest.score} />
            <span className={`rounded-full px-2 py-0.5 font-mono text-xs font-semibold tabular-nums ${latest.score >= v1.score ? "bg-good/15 text-good" : "bg-bad/15 text-bad"}`}>
              {latest.score >= v1.score ? "+" : ""}{(latest.score - v1.score).toFixed(1)}
            </span>
          </div>
        )}
      </header>

      {error && <p className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{error}</p>}

      {project.status === "analyzing" && (
        <div className="flex items-center gap-3 text-sm text-muted">
          <Spinner /> Argon is watching your footage{analyzingStep ? ` · ${analyzingStep}` : ""}…
        </div>
      )}

      {project.status === "error" && project.moments.length === 0 && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-bad/30 bg-bad/5 px-5 py-4 text-sm">
          <div>
            <p className="font-medium">Analysis didn&apos;t finish.</p>
            <p className="mt-0.5 text-muted">{(() => { const err = [...events].reverse().find((e) => e.name === "loop_error")?.data.error; return err ? String(err).slice(0, 160) : "The upload to Gemini was interrupted."; })()}</p>
          </div>
          <button className="btn-mono-dark" onClick={reanalyze}>Retry analysis <span className="arrow-ne">↗</span></button>
        </div>
      )}

      {project.status === "error" && project.moments.length > 0 && iterations.length > 0 && (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-bad/30 bg-bad/5 px-4 py-3 text-sm">
          <span>The last run didn&apos;t finish. Running again replaces the versions below.</span>
          <button className="btn-primary" onClick={run}>Retry</button>
        </div>
      )}

      {project.moments.length > 0 && iterations.length === 0 && (
        <MomentPicker project={project} selected={selected} setSelected={setSelected} busy={busy} onRun={run} />
      )}

      {(loopEvents.length > 0 || iterations.length > 0) && (
        <div className="grid items-start gap-8 lg:grid-cols-2">
          <div className="min-w-0 space-y-12">
            <StyleReferences projectId={id} references={project.references ?? []} notes={project.style_notes ?? ""}
              disabled={busy} onChanged={refresh} />
            <div className="rounded-2xl border border-line bg-panel">
              <div className="flex items-center gap-1.5 border-b border-line px-4 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-line" /><span className="h-2.5 w-2.5 rounded-full bg-line" /><span className="h-2.5 w-2.5 rounded-full bg-line" />
                <p className="mx-auto pr-8 font-mono text-xs text-muted">argon — self-correcting loop</p>
              </div>
              <div className="p-5 sm:p-7">
                <LoopStepper events={loopEvents} iterations={iterations} running={project.status === "rendering"} />
              </div>
            </div>

            {(pair.length > 0 || generatingNew) && (
              <section id="versions" className="scroll-mt-28 space-y-5" aria-label="Compare versions">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <div className="eyebrow mb-2">Versions</div>
                    <h2 className="display text-3xl">Side by side.</h2>
                  </div>
                  {iterations.length > 2 && (
                    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Choose two versions to compare">
                      {iterations.map((it) => {
                        const on = pair.some((p) => p.version === it.version);
                        return (
                          <button key={it.version} onClick={() => toggleCompare(it.version)} aria-pressed={on}
                            className={`rounded-full border px-3 py-1 font-mono text-xs transition ${on ? "border-text bg-text text-bg" : "border-line text-muted hover:border-text hover:text-text"}`}>
                            v{it.version}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className="grid gap-10">
                  {generatingNew && (
                    <GeneratingCard events={loopEvents} format={project.format} fallbackVersion={(latest?.version ?? 0) + 1} />
                  )}
                  {(generatingNew ? pair.slice(-1) : pair).map((it) => (
                    <VersionCard key={it.version} it={it} running={busy} onRegenerate={regenerate} projectId={id} onChanged={refresh}
                      previousScore={it.version > 1 ? iterations.find((i) => i.version === it.version - 1)?.score : null} />
                  ))}
                </div>
              </section>
            )}

            {older && newer && (
              <section className="space-y-4" aria-label="What changed">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <div className="eyebrow mb-2">Edit decisions</div>
                    <h2 className="display text-3xl">What changed in v{newer.version}.</h2>
                  </div>
                  {newer.change_summary && <p className="text-sm text-good">{newer.change_summary}</p>}
                </div>
                <div className="grid gap-6">
                  <EditTimeline
                    sourceDuration={project.source_duration}
                    rows={[
                      { label: `v${older.version}`, segments: older.segments ?? [] },
                      { label: `v${newer.version}`, segments: newer.segments ?? [], emphasis: true },
                    ]}
                  />
                  {(newer.changes?.length ?? 0) > 0 && (
                    <ul className="space-y-2">
                      {newer.changes!.map((c, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-green" />{c}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {newer.diff && newer.version - older.version === 1 && (
                  <details className="group">
                    <summary className="cursor-pointer select-none text-xs text-muted hover:text-text">View code diff</summary>
                    <div className="mt-2"><DiffView diff={newer.diff} /></div>
                  </details>
                )}
              </section>
            )}
          </div>

          <aside className="lg:sticky lg:top-24 lg:h-[calc(100vh-7.5rem)]" aria-label="Chat with Argon">
            <ArgonChat
              iterations={iterations}
              events={loopEvents}
              running={project.status === "rendering"}
              onSend={sendFeedback}
              onRegenerate={regenerate}
              referenceCount={(project.references?.length ?? 0) + (project.style_notes ? 1 : 0)}
              onCompare={(v) => {
                setCompare(v > 1 ? [v - 1, v] : [v]);
                document.getElementById("versions")?.scrollIntoView({ behavior: "smooth" });
              }}
            />
          </aside>
        </div>
      )}
    </div>
  );
}

function VersionCard({ it, previousScore, running, onRegenerate, projectId, onChanged }: {
  it: Iteration;
  projectId: string;
  onChanged: () => void;
  previousScore?: number | null;
  running: boolean;
  onRegenerate: (version: number) => void;
}) {
  const crit = it.critique as Critique;
  const label = it.trigger === "draft" ? "First draft" : it.trigger === "critique" ? "After critique" : "After your feedback";
  return (
    <article className="space-y-5">
      <div className="flex items-baseline justify-between">
        <h3 className="font-semibold">
          v{it.version} <span className="font-normal text-muted">· {label}</span>
        </h3>
        <span className="flex items-center gap-3">
          {it.duration != null && <span className="font-mono text-xs tabular-nums text-muted">{it.duration.toFixed(1)}s</span>}
          {it.score != null && (
            <button onClick={() => onRegenerate(it.version)} disabled={running}
              title="Make a new version that fixes what the critic flagged"
              className="font-mono text-xs uppercase tracking-[0.08em] hover:underline disabled:opacity-40 disabled:no-underline">
              ↻ Regenerate
            </button>
          )}
          <a href={`${API}${it.url}?download=1`} className="font-mono text-xs uppercase tracking-[0.08em] hover:underline">Download MP4 <span className="arrow-ne">↗</span></a>
        </span>
      </div>
      {/* Title text in the URL busts the browser cache after the title card is re-applied. */}
      <video key={`${it.url}-${it.title_card?.title ?? ""}`} src={`${API}${it.url}?tc=${encodeURIComponent(`${it.title_card?.title ?? ""}|${it.title_card?.subtitle ?? ""}`)}`}
        controls className="mx-auto max-h-[520px] w-full rounded-xl bg-black" />
      <TitleCardEditor projectId={projectId} version={it.version} card={it.title_card} disabled={running} onSaved={onChanged} />
      {crit?.score != null ? (
        <>
          <CriticVerdict critique={crit} previousScore={previousScore} />
          <CritiqueList issues={crit.issues} />
        </>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted"><Spinner /> The critic is watching v{it.version}…</p>
      )}
      <details>
        <summary className="cursor-pointer select-none text-xs text-muted hover:text-text">Show edit code</summary>
        <pre className="mt-2 max-h-64 overflow-auto surface-dark rounded-xl p-4 font-mono text-xs">{it.script}</pre>
      </details>
    </article>
  );
}

function MomentPicker({ project, selected, setSelected, busy, onRun }: {
  project: Project;
  selected: Set<number>;
  setSelected: React.Dispatch<React.SetStateAction<Set<number>>>;
  busy: boolean;
  onRun: () => void;
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold">Key moments</h2>
          <p className="text-xs text-muted">Pick what goes into the {project.format} video.</p>
        </div>
        <button className="btn-primary" onClick={onRun} disabled={busy || selected.size === 0}>
          {busy ? <><Spinner /> Running…</> : "Generate video →"}
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {project.moments.map((m, i) => {
          const on = selected.has(i);
          return (
            <button key={i} disabled={busy}
              onClick={() => setSelected((s) => { const n = new Set(s); if (on) n.delete(i); else n.add(i); return n; })}
              className={`flex gap-3 rounded-xl border p-2 text-left transition ${on ? "border-accent bg-accent/10" : "border-line bg-panel opacity-60"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`${API}/api/projects/${project.id}/thumbs/${i}.jpg`} alt="" className="h-20 w-32 rounded-lg object-cover" />
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span className={`h-3 w-3 rounded-sm border ${on ? "border-accent bg-accent" : "border-muted"}`} />
                  {m.label}
                  <span className="font-mono text-xs text-muted">{fmtTime(m.start)}–{fmtTime(m.end)}</span>
                </div>
                <p className="mt-1 text-xs text-muted">{m.why}</p>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

"use client";

import { useState } from "react";
import { Spinner } from "@/components/Spinner";
import { API, api, Reference } from "@/lib/api";

const ICON: Record<Reference["kind"], string> = { document: "▤", image: "▣", audio: "♪", video: "▶" };

/** Brand/style references Argon's editor and critic follow: file chips, add/remove, and typed notes. */
export function StyleReferences({ projectId, references, notes, disabled, onChanged }: {
  projectId: string;
  references: Reference[];
  notes: string;
  disabled: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(notes);

  async function add(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError("");
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append("files", f));
    try {
      const res = await fetch(`${API}/api/projects/${projectId}/references`, { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json()).detail ?? res.statusText);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(index: number) {
    setBusy(true);
    try {
      await api(`/api/projects/${projectId}/references/${index}`, { method: "DELETE" });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function saveNotes(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/api/projects/${projectId}/style-notes`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ style_notes: draft }),
      });
      setEditing(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-panel px-4 py-3" aria-label="Style references">
      <div className="flex flex-wrap items-center gap-2">
        <span className="eyebrow mr-1">Style references</span>
        {references.length === 0 && !notes && <span className="text-sm text-muted">None. Add a brand guide, logo or example.</span>}
        {references.map((r) => (
          <span key={r.index} className="badge text-text" title={`${r.name} · ${(r.size / 1e6).toFixed(1)} MB`}>
            <span aria-hidden>{ICON[r.kind]}</span>{r.name}
            <button type="button" aria-label={`Remove ${r.name}`} disabled={busy || disabled} className="text-muted hover:text-bad" onClick={() => remove(r.index)}>✕</button>
          </span>
        ))}
        <label className={`badge cursor-pointer hover:border-text hover:text-text ${busy || disabled ? "pointer-events-none opacity-40" : ""}`}>
          {busy ? <Spinner /> : "+"} Add
          <input type="file" multiple className="sr-only" accept=".pdf,.txt,.md,image/*,audio/*,video/*" onChange={(e) => add(e.target.files)} />
        </label>
        {!editing && (
          <button type="button" className="badge hover:border-text hover:text-text" disabled={disabled} onClick={() => { setDraft(notes); setEditing(true); }}>
            ✎ {notes ? "Edit notes" : "Add notes"}
          </button>
        )}
      </div>
      {notes && !editing && <p className="mt-2 text-sm text-muted">“{notes}”</p>}
      {editing && (
        <form onSubmit={saveNotes} className="mt-2 space-y-2">
          <label htmlFor="style-notes-edit" className="sr-only">Style notes</label>
          <textarea id="style-notes-edit" className="input min-h-16" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus
            placeholder="e.g. Brand green #22C55E, clean sans-serif, calm and confident tone" />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setEditing(false)}>Cancel</button>
            <button type="submit" className="btn-mono-dark px-3 py-1.5" disabled={busy}>Save notes</button>
          </div>
        </form>
      )}
      {error && <p className="mt-2 text-xs text-bad">{error}</p>}
      <p className="mt-2 text-[11px] text-muted">Used by Argon&apos;s editor and critic from the next version on.</p>
    </section>
  );
}

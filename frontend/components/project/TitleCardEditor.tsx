"use client";

import { useState } from "react";
import { Spinner } from "@/components/Spinner";
import { api } from "@/lib/api";

export type TitleCard = { title?: string; subtitle?: string };

/** The opening title card text for a version, editable in place. Saving re-applies it in a few seconds. */
export function TitleCardEditor({ projectId, version, card, disabled, onSaved }: {
  projectId: string;
  version: number;
  card: TitleCard | null | undefined;
  disabled: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(card?.title ?? "");
  const [subtitle, setSubtitle] = useState(card?.subtitle ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError("");
    try {
      await api(`/api/projects/${projectId}/title`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, subtitle, version }),
      });
      setEditing(false);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-panel px-3.5 py-2.5">
        <div className="min-w-0">
          <div className="eyebrow text-[11px]">Opening title</div>
          <div className="text-sm font-medium">{card?.title || "—"}</div>
          {card?.subtitle && <div className="text-xs text-muted">{card.subtitle}</div>}
        </div>
        <button type="button" disabled={disabled} onClick={() => { setTitle(card?.title ?? ""); setSubtitle(card?.subtitle ?? ""); setEditing(true); }}
          className="shrink-0 font-mono text-xs uppercase tracking-[0.08em] hover:underline disabled:opacity-40 disabled:no-underline">
          ✎ Edit
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={save} className="space-y-2 rounded-xl border border-text/30 bg-panel px-3.5 py-3">
      <div className="eyebrow text-[11px]">Opening title · v{version}</div>
      <label className="sr-only" htmlFor={`title-${version}`}>Title</label>
      <input id={`title-${version}`} className="input" value={title} maxLength={80} autoFocus
        onChange={(e) => setTitle(e.target.value)} placeholder="AI Pitch Studio: rehearse live, ship the cut" />
      <label className="sr-only" htmlFor={`subtitle-${version}`}>Subtitle</label>
      <input id={`subtitle-${version}`} className="input" value={subtitle} maxLength={100}
        onChange={(e) => setSubtitle(e.target.value)} placeholder="Your name · Pre-seed 2026" />
      {error && <p className="text-xs text-bad">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-mono-dark px-3 py-1.5" disabled={saving || !title.trim()}>
          {saving ? <><Spinner /> Applying…</> : "Save title"}
        </button>
      </div>
      <p className="text-[11px] text-muted">Re-applies the title card only (a few seconds). Later versions use this title too.</p>
    </form>
  );
}

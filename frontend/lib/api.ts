export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";
export const WS_API = API.replace(/^http/, "ws");

export type Moment = { start: number; end: number; label: string; why: string; score: number };

export type CritiqueIssue = { at: string; problem: string; fix: string; severity: "high" | "medium" | "low" };
export type Critique = {
  score: number;
  verdict?: string;
  ready?: boolean;
  summary: string;
  strengths: string[];
  blockers?: string[];
  issues: CritiqueIssue[];
};

export type Segment = { start: number; end: number; title: string };

export type Iteration = {
  id: number;
  version: number;
  trigger: "draft" | "critique" | "human";
  script: string;
  rationale: string[];
  change_summary: string;
  changes: string[] | null;
  duration: number | null;
  segments: Segment[];
  diff: string;
  critique: Critique | Record<string, never>;
  score: number | null;
  feedback?: string;
  created_at?: string;
  url: string;
};

export type Project = {
  id: number;
  title: string;
  goal: string;
  audience: string;
  style: string;
  format: string;
  status: "analyzing" | "moments" | "rendering" | "done" | "error" | "draft";
  moments: Moment[];
  selected_moments: number[];
  source_duration: number | null;
  iterations: Iteration[];
};

export type ProjectSummary = {
  id: number;
  title: string;
  format: string;
  status: Project["status"];
  created_at: string;
  versions: number;
  best_score: number | null;
  best_version: number | null;
};

export type FormatPreset = { label: string; width: number; height: number };

export type CoachReport = {
  overall_score: number;
  scores: Record<"tone" | "pace" | "articulation" | "eye_contact" | "content", number>;
  summary: string;
  strengths: string[];
  action_items: { title: string; detail: string; timestamps: string[] }[];
  error?: string;
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, init);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {}
    throw new Error(detail);
  }
  return res.json();
}

export const postJSON = <T,>(path: string, body: unknown) =>
  api<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

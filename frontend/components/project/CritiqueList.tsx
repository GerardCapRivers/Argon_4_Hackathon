"use client";

import { useState } from "react";
import type { CritiqueIssue } from "@/lib/api";

const SEVERITY: Record<CritiqueIssue["severity"], { label: string; dot: string; text: string }> = {
  high: { label: "High", dot: "bg-bad", text: "text-bad" },
  medium: { label: "Med", dot: "bg-warn", text: "text-warn" },
  low: { label: "Low", dot: "bg-muted", text: "text-muted" },
};
const ORDER = { high: 0, medium: 1, low: 2 };

/** Each issue on three short lines: where + severity, the problem, the fix. */
export function CritiqueList({ issues }: { issues: CritiqueIssue[] }) {
  const [all, setAll] = useState(false);
  if (!issues?.length) return null;
  const sorted = [...issues].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  const shown = all ? sorted : sorted.slice(0, 3);

  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Specific fixes</div>
      <ul className="divide-y divide-line">
        {shown.map((iss, i) => {
          const sev = SEVERITY[iss.severity] ?? SEVERITY.low;
          return (
            <li key={i} className="py-3">
              <div className="flex items-center gap-2 text-xs">
                <span className="rounded bg-panel-2 px-1.5 py-0.5 font-mono tabular-nums text-text">{iss.at}</span>
                <span className={`inline-flex items-center gap-1.5 font-medium ${sev.text}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${sev.dot}`} />{sev.label}
                </span>
              </div>
              <p className="mt-1.5 text-sm font-medium leading-snug">{iss.problem}</p>
              <p className="mt-1 text-sm leading-snug text-muted"><span className="text-accent">Fix:</span> {iss.fix}</p>
            </li>
          );
        })}
      </ul>
      {sorted.length > 3 && (
        <button className="mt-1 text-xs text-accent hover:underline" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show ${sorted.length - 3} more`}
        </button>
      )}
    </div>
  );
}

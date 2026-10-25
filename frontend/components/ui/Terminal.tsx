"use client";

import { useEffect, useState } from "react";

export type TermLine = { text: string; tone?: "prompt" | "ok" | "muted" | "warn" | "plain"; pause?: number };

const TONE: Record<NonNullable<TermLine["tone"]>, string> = {
  prompt: "text-text",
  ok: "text-good",
  muted: "text-muted",
  warn: "text-warn",
  plain: "text-text",
};

/**
 * A dark terminal window (docs/DESIGN.md §7). With `animate`, lines type in one after another and
 * then loop, the page's one orchestrated motion moment. Reduced-motion users see the final state.
 */
export function Terminal({ title, lines, animate = false, className = "" }: { title: string; lines: TermLine[]; animate?: boolean; className?: string }) {
  const [shown, setShown] = useState(animate ? 0 : lines.length);
  const [chars, setChars] = useState(0);

  useEffect(() => {
    if (!animate) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setShown(lines.length);
      return;
    }
    let line = 0;
    let ch = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (line >= lines.length) {
        timer = setTimeout(() => { line = 0; ch = 0; setShown(0); setChars(0); tick(); }, 3500);
        return;
      }
      const l = lines[line];
      if (l.tone === "prompt" && ch < l.text.length) {
        ch += 1;
        setShown(line);
        setChars(ch);
        timer = setTimeout(tick, 28);
        return;
      }
      line += 1;
      ch = 0;
      setShown(line);
      setChars(0);
      timer = setTimeout(tick, l.pause ?? 420);
    };
    timer = setTimeout(tick, 500);
    return () => clearTimeout(timer);
  }, [animate, lines]);

  return (
    <div className={`surface-dark overflow-hidden rounded-2xl border border-line shadow-[0_30px_80px_-40px_rgb(0_0_0/0.6)] ${className}`}>
      <div className="flex items-center gap-1.5 border-b border-line px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#333]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#333]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#333]" />
        <p className="mx-auto pr-8 font-mono text-xs text-muted">{title}</p>
      </div>
      <pre className="min-h-[18rem] overflow-x-auto p-5 font-mono text-[13px] leading-relaxed">
        {lines.map((l, i) => {
          if (i > shown) return null;
          const typing = i === shown && l.tone === "prompt" && animate;
          if (i === shown && !typing && shown < lines.length) return null;
          const text = typing ? l.text.slice(0, chars) : l.text;
          return (
            <div key={i} className={`${TONE[l.tone ?? "plain"]} ${typing ? "caret" : ""}`}>
              {l.tone === "prompt" && <span className="text-green">&gt; </span>}
              {text || " "}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

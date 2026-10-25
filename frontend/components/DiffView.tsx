export function DiffView({ diff }: { diff: string }) {
  return (
    <pre className="max-h-80 surface-dark overflow-auto rounded-xl p-4 font-mono text-xs leading-relaxed">
      {diff.split("\n").map((line, i) => {
        const cls = line.startsWith("+++") || line.startsWith("---")
          ? "text-muted"
          : line.startsWith("+")
            ? "bg-good/10 text-good"
            : line.startsWith("-")
              ? "bg-bad/10 text-bad"
              : line.startsWith("@@")
                ? "text-accent"
                : "text-muted";
        return <div key={i} className={`whitespace-pre-wrap break-all ${cls}`}>{line || " "}</div>;
      })}
    </pre>
  );
}

/** Eyebrow → headline. → lede (docs/DESIGN.md §4 "Section anatomy"). */
export function SectionHeader({
  eyebrow, title, lede, size = "h2", action,
}: {
  eyebrow?: string;
  title: string;
  lede?: React.ReactNode;
  size?: "h1" | "h2" | "h3";
  action?: React.ReactNode;
}) {
  const Tag = size;
  const cls =
    size === "h1" ? "display text-4xl sm:text-5xl lg:text-6xl"
      : size === "h2" ? "display text-3xl sm:text-4xl"
        : "text-xl font-medium tracking-[-0.01em]";
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl min-w-0">
        {eyebrow && <div className="eyebrow mb-3">{eyebrow}</div>}
        <Tag className={cls}>{title}</Tag>
        {lede && <p className="mt-3 max-w-[60ch] text-[17px] text-muted">{lede}</p>}
      </div>
      {action}
    </div>
  );
}

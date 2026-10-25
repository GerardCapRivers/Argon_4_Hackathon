/** Our mark: a microphone drawn as square pixel tiles (see docs/DESIGN.md, "Pixel mark"). */
const GRID = [
  "..###..",
  ".#####.",
  ".#####.",
  ".#####.",
  "#.###.#",
  "#.....#",
  ".#...#.",
  "..###..",
  "...#...",
  ".#####.",
];

export function PixelMark({ size = 22, live = false, className = "" }: { size?: number; live?: boolean; className?: string }) {
  const cols = GRID[0].length;
  const rows = GRID.length;
  return (
    <svg viewBox={`0 0 ${cols} ${rows}`} width={(size * cols) / rows} height={size} className={className} aria-hidden shapeRendering="crispEdges">
      {GRID.flatMap((row, y) =>
        [...row].map((c, x) =>
          c === "#" ? (
            <rect key={`${x}-${y}`} x={x + 0.08} y={y + 0.08} width={0.84} height={0.84}
              fill={live && y < 4 ? "var(--green)" : "currentColor"} />
          ) : null,
        ),
      )}
    </svg>
  );
}

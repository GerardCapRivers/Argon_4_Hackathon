export function Score({ value, size = "sm" }: { value: number; size?: "sm" | "lg" }) {
  const color = value >= 7.5 ? "text-good" : value >= 5 ? "text-warn" : "text-bad";
  const text = size === "lg" ? "text-4xl" : "text-sm";
  return <span className={`font-mono font-semibold ${text} ${color}`}>{value.toFixed(1)}</span>;
}

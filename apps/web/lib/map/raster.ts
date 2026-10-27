export const RASTER_KIND_LABELS: Record<string, string> = {
  lst: "Surface temperature",
  canopy: "Tree canopy",
  impervious: "Impervious surface",
  elevation: "Elevation",
};

/** Display order for the layer picker; unknown kinds sort last. */
const ORDER = ["lst", "canopy", "impervious", "elevation"];

export const kindLabel = (kind: string): string => RASTER_KIND_LABELS[kind] ?? kind;

export function sortKinds(kinds: readonly string[]): string[] {
  const rank = (k: string) => (ORDER.includes(k) ? ORDER.indexOf(k) : ORDER.length);
  return [...kinds].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** The kind to preselect: surface temperature when available, else the first listed. */
export function defaultKind(kinds: readonly string[]): string | undefined {
  const sorted = sortKinds(kinds);
  return sorted[0];
}

export function tileUrlTemplate(origin: string, region: string, kind: string): string {
  return `${origin}/api/raster/tile/${encodeURIComponent(region)}/${encodeURIComponent(kind)}/{z}/{x}/{y}.png`;
}

export interface LegendStop {
  value: number;
  color: string;
  alpha: number;
}

const rgba = (hex: string, a: number) => `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")}, ${a})`;

/** CSS gradient for a legend: stop positions follow the values' share of the domain; alpha is preserved. */
export function legendGradient(stops: readonly LegendStop[], domain: readonly [number, number]): string {
  const span = domain[1] - domain[0] || 1;
  const parts = stops.map((s) => `${rgba(s.color, s.alpha)} ${(((s.value - domain[0]) / span) * 100).toFixed(1)}%`);
  return `linear-gradient(to right, ${parts.join(", ")})`;
}

export function formatDomainValue(v: number, unit: string): string {
  const n = Number.isInteger(v) ? String(v) : v.toFixed(1);
  if (unit === "percent") return `${n}%`;
  if (unit === "celsius") return `${n} °C`;
  if (unit === "meters") return `${n} m`;
  return `${n} ${unit}`;
}

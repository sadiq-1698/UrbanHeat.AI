// Temperature -> color. A ColorBrewer RdYlBu ramp reversed (cool blue -> pale yellow -> warm red): it is
// diverging-looking but monotonic in lightness at the ends, and stays distinguishable under the common
// forms of color-vision deficiency (blue vs. orange/red rather than red vs. green).
export const RAMP = ["#2c7bb6", "#abd9e9", "#ffffbf", "#fdae61", "#d7191c"] as const;
export const NO_DATA_COLOR = "#9aa0a6";

export type Domain = [min: number, max: number];

const DEFAULT_DOMAIN: Domain = [20, 40];
const MIN_SPAN = 4; // °C: a tight cluster still gets visible contrast instead of one flat color

/**
 * A readable [min, max] for the values: rounded out to whole degrees and widened to at least
 * MIN_SPAN around the middle. No values -> a default summer range.
 */
export function niceDomain(values: readonly (number | null | undefined)[]): Domain {
  const v = values.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  if (v.length === 0) return [...DEFAULT_DOMAIN];
  let lo = Math.floor(Math.min(...v));
  let hi = Math.ceil(Math.max(...v));
  if (hi - lo < MIN_SPAN) {
    const mid = (lo + hi) / 2;
    lo = Math.floor(mid - MIN_SPAN / 2);
    hi = lo + MIN_SPAN;
  }
  return [lo, hi];
}

const hex = (c: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as [number, number, number];
const toHex = (rgb: number[]) => `#${rgb.map((x) => Math.round(x).toString(16).padStart(2, "0")).join("")}`;

/** Stop positions of the ramp across the domain: evenly spaced temperatures. */
export function rampStops(domain: Domain): [number, string][] {
  const [lo, hi] = domain;
  return RAMP.map((c, i) => [lo + ((hi - lo) * i) / (RAMP.length - 1), c]);
}

/** Interpolated color for a temperature (clamped to the domain's ends). */
export function colorAt(value: number, domain: Domain): string {
  const stops = rampStops(domain);
  if (value <= stops[0]![0]) return stops[0]![1];
  if (value >= stops.at(-1)![0]) return stops.at(-1)![1];
  const i = stops.findIndex(([t]) => t > value);
  const [t0, c0] = stops[i - 1]!;
  const [t1, c1] = stops[i]!;
  const f = (value - t0) / (t1 - t0);
  const a = hex(c0);
  const b = hex(c1);
  return toHex(a.map((x, k) => x + (b[k]! - x) * f));
}

/** MapLibre expression coloring by a numeric property; non-numeric (null) values get NO_DATA_COLOR. */
export function colorExpression(domain: Domain, property = "temp_c"): unknown[] {
  return [
    "case",
    ["==", ["typeof", ["get", property]], "number"],
    ["interpolate", ["linear"], ["get", property], ...rampStops(domain).flat()],
    NO_DATA_COLOR,
  ];
}

/** CSS gradient string matching the ramp, for legends. */
export function gradientCss(): string {
  return `linear-gradient(to right, ${RAMP.join(", ")})`;
}

export const formatTemp = (v: number | null | undefined, digits = 1): string => (typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(digits)} °C` : "—");

import type { RasterGrid } from "./raster-grid.js";

/** RGBA, each 0..255. */
export type RGBA = [number, number, number, number];

export interface ColorStop {
  value: number;
  color: RGBA;
}

/** Piecewise-linear color ramp over ascending stop values; values outside clamp to the end colors. */
export interface Colormap {
  stops: ColorStop[];
}

export type Domain = [min: number, max: number];

const hex = (c: string, alpha = 255): RGBA => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)).concat(alpha) as RGBA;

/** Evenly spaced stops across `domain`. `alphas` (0..255, default opaque) lets a ramp fade to transparent. */
export function colormapFromHex(domain: Domain, colors: readonly string[], alphas: readonly number[] = []): Colormap {
  if (colors.length < 2) throw new RangeError("a colormap needs at least two colors");
  if (!(domain[0] < domain[1])) throw new RangeError("colormap domain must have min < max");
  const last = colors.length - 1;
  return { stops: colors.map((c, i) => ({ value: domain[0] + ((domain[1] - domain[0]) * i) / last, color: hex(c, alphas[i] ?? 255) })) };
}

/** Interpolated color at `v`. Channels interpolate independently (alpha included). */
export function colorAtValue(cm: Colormap, v: number): RGBA {
  const s = cm.stops;
  if (v <= s[0]!.value) return [...s[0]!.color];
  if (v >= s.at(-1)!.value) return [...s.at(-1)!.color];
  let i = 1;
  while (s[i]!.value < v) i++;
  const a = s[i - 1]!;
  const b = s[i]!;
  const f = (v - a.value) / (b.value - a.value);
  return a.color.map((c, k) => Math.round(c + (b.color[k]! - c) * f)) as RGBA;
}

/** p-th percentile (0..100) of the valid cells, by nearest rank; NaN if there are none. */
export function percentile(grid: RasterGrid, p: number): number {
  const vals = Float32Array.from(grid.data.filter((v) => !Number.isNaN(v))).sort();
  if (vals.length === 0) return NaN;
  const rank = Math.min(Math.max(Math.ceil((p / 100) * vals.length) - 1, 0), vals.length - 1);
  return vals[rank]!;
}

/**
 * A robust color domain: the low/high percentiles (default 2..98) rounded outward to whole units, so a few
 * outlier cells don't flatten the ramp. Guarantees min < max.
 */
export function robustDomain(grid: RasterGrid, low = 2, high = 98): Domain {
  const lo = Math.floor(percentile(grid, low));
  let hi = Math.ceil(percentile(grid, high));
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw new RangeError("raster has no valid cells");
  if (hi <= lo) hi = lo + 1;
  return [lo, hi];
}

/** Ramps per raster kind. Percent layers fade to transparent at 0 so bare ground shows the basemap. */
export const RAMPS = {
  // reversed ColorBrewer RdYlBu: blue -> pale yellow -> red (matches the station circles)
  lst: { colors: ["#2c7bb6", "#abd9e9", "#ffffbf", "#fdae61", "#d7191c"], alphas: [255, 255, 255, 255, 255] },
  // ColorBrewer Greens
  canopy: { colors: ["#f7fcf5", "#c7e9c0", "#74c476", "#238b45", "#00441b"], alphas: [0, 140, 200, 230, 245] },
  // ColorBrewer Purples
  impervious: { colors: ["#fcfbfd", "#dadaeb", "#9e9ac8", "#6a51a3", "#3f007d"], alphas: [0, 140, 200, 230, 245] },
  // light sand -> dark brown
  elevation: { colors: ["#f7f4e9", "#d9c9a0", "#b08a5a", "#7a5a3a", "#3b2a1a"], alphas: [255, 255, 255, 255, 255] },
} as const;

export type RampKind = keyof typeof RAMPS;
export const isRampKind = (k: string): k is RampKind => Object.prototype.hasOwnProperty.call(RAMPS, k);

/** Fixed domains for layers whose units have natural bounds (percent); others derive from the data. */
export const FIXED_DOMAINS: Partial<Record<RampKind, Domain>> = { canopy: [0, 100], impervious: [0, 100] };

export function colormapForKind(kind: RampKind, domain: Domain): Colormap {
  return colormapFromHex(domain, RAMPS[kind].colors, RAMPS[kind].alphas);
}

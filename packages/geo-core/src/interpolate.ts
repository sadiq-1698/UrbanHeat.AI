import { metersPerDegree } from "./geometry.js";
import { type BBox, RasterGrid } from "./raster-grid.js";

export interface SamplePoint {
  lon: number;
  lat: number;
  value: number;
}

export interface IdwOptions {
  /** Distance exponent: higher = more local (nearest stations dominate). Default 2. */
  power?: number;
  /** Use only this many nearest stations per location (Infinity = all). Default 12. */
  neighbors?: number;
  /** Return null/NaN where the nearest station is farther than this (metres). Default: no limit. */
  maxDistanceM?: number;
}

const EXACT_M = 1; // closer than this to a station: return the station's value (avoids 1/0)

function validate(points: readonly SamplePoint[], { power = 2, neighbors = 12 }: IdwOptions): void {
  if (points.length === 0) throw new RangeError("interpolation needs at least one point");
  if (!points.every((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat) && Number.isFinite(p.value))) {
    throw new RangeError("all points need finite lon, lat and value");
  }
  if (!(power > 0)) throw new RangeError("power must be > 0");
  if (!(neighbors >= 1)) throw new RangeError("neighbors must be >= 1");
}

/** Metres between two nearby points (equirectangular at the mean latitude; fine at city scale). */
export function approxDistanceM(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const m = metersPerDegree((lat1 + lat2) / 2);
  return Math.hypot((lon2 - lon1) * m.x, (lat2 - lat1) * m.y);
}

/**
 * Inverse-distance-weighted estimate at one location from the k nearest points. Never extrapolates beyond the
 * data range (a weighted average). Exact (the station's own value) within ~1 m of a station; if several
 * stations are that close their values are averaged.
 */
export function idwAt(points: readonly SamplePoint[], lon: number, lat: number, opts: IdwOptions = {}): number | null {
  return idwDetail(points, lon, lat, opts)?.value ?? null;
}

/** Like idwAt, but also reports the distance (m) to the nearest station. Null when beyond maxDistanceM. */
export function idwDetail(points: readonly SamplePoint[], lon: number, lat: number, opts: IdwOptions = {}): { value: number; nearestM: number } | null {
  const { power = 2, neighbors = 12, maxDistanceM = Infinity } = opts;
  const k = Math.min(neighbors, points.length);
  const m = metersPerDegree(lat);
  // Keep the k smallest distances with an insertion list: O(n*k), and k is small.
  const bestD: number[] = [];
  const bestV: number[] = [];
  for (const p of points) {
    const d = Math.hypot((p.lon - lon) * m.x, (p.lat - lat) * m.y);
    if (bestD.length === k && d >= bestD[k - 1]!) continue;
    let i = bestD.length;
    while (i > 0 && bestD[i - 1]! > d) i--;
    bestD.splice(i, 0, d);
    bestV.splice(i, 0, p.value);
    if (bestD.length > k) {
      bestD.pop();
      bestV.pop();
    }
  }
  const nearestM = bestD[0]!;
  if (nearestM > maxDistanceM) return null;
  if (nearestM < EXACT_M) {
    let s = 0;
    let c = 0;
    for (let i = 0; i < bestD.length && bestD[i]! < EXACT_M; i++, c++) s += bestV[i]!;
    return { value: s / c, nearestM };
  }
  let num = 0;
  let den = 0;
  for (let i = 0; i < bestD.length; i++) {
    if (bestD[i]! > maxDistanceM) break;
    const w = 1 / bestD[i]! ** power;
    num += w * bestV[i]!;
    den += w;
  }
  return { value: num / den, nearestM };
}

/** IDW surface on a regular grid (cell centres; row 0 = north). NaN where the nearest station exceeds maxDistanceM. */
export function idwGrid(points: readonly SamplePoint[], bbox: BBox, width: number, height: number, opts: IdwOptions = {}): RasterGrid {
  validate(points, opts);
  const [west, south, east, north] = bbox;
  const data = new Float32Array(width * height);
  const dx = (east - west) / width;
  const dy = (north - south) / height;
  for (let r = 0; r < height; r++) {
    const lat = north - (r + 0.5) * dy;
    for (let c = 0; c < width; c++) {
      data[r * width + c] = idwAt(points, west + (c + 0.5) * dx, lat, opts) ?? NaN;
    }
  }
  return new RasterGrid(data, width, height, bbox);
}

export interface CvResult {
  n: number;
  /** Root-mean-square error of held-out predictions. */
  rmse: number;
  /** Mean absolute error. */
  mae: number;
  /** Mean signed error (prediction - truth): positive = the method runs warm. */
  bias: number;
  /** Per-point held-out predictions (null where the method returned nothing). */
  predictions: (number | null)[];
}

/**
 * Leave-one-out cross-validation: for each point, predict it from all the others. This is an honest error
 * estimate for interpolating at an unobserved location, unlike the (zero) error at the stations themselves.
 * Points whose prediction is null are excluded from the metrics.
 */
export function leaveOneOut(
  points: readonly SamplePoint[],
  predict: (train: SamplePoint[], target: SamplePoint, index: number) => number | null,
): CvResult {
  if (points.length < 2) throw new RangeError("leave-one-out needs at least two points");
  const predictions = points.map((p, i) => predict(points.filter((_, j) => j !== i), p, i));
  const errs = predictions.flatMap((pred, i) => (pred === null || !Number.isFinite(pred) ? [] : [pred - points[i]!.value]));
  const n = errs.length;
  return {
    n,
    rmse: n ? Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / n) : NaN,
    mae: n ? errs.reduce((s, e) => s + Math.abs(e), 0) / n : NaN,
    bias: n ? errs.reduce((s, e) => s + e, 0) / n : NaN,
    predictions,
  };
}

/** Leave-one-out error of plain IDW with the given options. */
export const idwLeaveOneOut = (points: readonly SamplePoint[], opts: IdwOptions = {}): CvResult => {
  validate(points, opts);
  return leaveOneOut(points, (train, t) => idwAt(train, t.lon, t.lat, opts));
};

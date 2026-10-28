import { approxDistanceM, type CvResult, type IdwOptions, idwDetail, leaveOneOut, type SamplePoint } from "./interpolate.js";
import { fitLinear, type LinearModel, predictLinear } from "./regression.js";
import { RasterGrid } from "./raster-grid.js";

export interface RegressionIdwOptions extends IdwOptions {
  /** Ridge penalty for the covariate fit (see fitLinear). */
  ridge?: number;
  /**
   * Distance (m) over which a station's residual influences the estimate; beyond it the surface relaxes to the
   * covariate trend (weight exp(-(d/range)^2) on the interpolated residual). Default: twice the mean
   * nearest-neighbour station spacing. Infinity disables the fade.
   */
  residualRangeM?: number;
  /**
   * Clamp each covariate to the range seen at the training stations before applying the trend (default true).
   * A linear model extrapolated to conditions no station experienced (e.g. open water: zero canopy, zero
   * impervious, zero elevation) can be wildly wrong; clamping bounds the damage.
   */
  clamp?: boolean;
}

export interface PreparedRegression {
  model: LinearModel;
  /** Stations with their regression residuals as `value`. */
  residuals: SamplePoint[];
  rangeM: number;
  /** [min, max] of each covariate across the training stations. */
  bounds: [number, number][];
  clamp: boolean;
  opts: IdwOptions;
}

/** Mean distance (m) from each point to its nearest other point; NaN for fewer than 2 points. */
export function meanNearestNeighborM(points: readonly SamplePoint[]): number {
  if (points.length < 2) return NaN;
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    let best = Infinity;
    for (let j = 0; j < points.length; j++) {
      if (i !== j) best = Math.min(best, approxDistanceM(points[i]!.lon, points[i]!.lat, points[j]!.lon, points[j]!.lat));
    }
    total += best;
  }
  return total / points.length;
}

/**
 * Fit value ~ covariates at the stations and compute each station's residual. `covariates[i]` are the covariate
 * values at `points[i]`; stations with a non-finite covariate are skipped (and the fit needs at least one left).
 */
export function prepareRegression(points: readonly SamplePoint[], covariates: readonly (readonly number[])[], opts: RegressionIdwOptions = {}): PreparedRegression {
  if (covariates.length !== points.length) throw new RangeError("covariates must have one row per point");
  const keep = points.map((_, i) => covariates[i]!.every(Number.isFinite));
  const pts = points.filter((_, i) => keep[i]);
  const X = covariates.filter((_, i) => keep[i]);
  if (pts.length === 0) throw new RangeError("no stations with valid covariates");
  const model = fitLinear(X, pts.map((p) => p.value), { ridge: opts.ridge });
  const residuals = pts.map((p, i) => ({ ...p, value: p.value - predictLinear(model, X[i]!) }));
  const nn = meanNearestNeighborM(pts);
  const rangeM = opts.residualRangeM ?? (Number.isFinite(nn) ? 2 * nn : Infinity);
  const bounds = X[0]!.map((_, j): [number, number] => [Math.min(...X.map((r) => r[j]!)), Math.max(...X.map((r) => r[j]!))]);
  const { ridge: _r, residualRangeM: _rr, clamp: _c, ...idw } = opts;
  return { model, residuals, rangeM, bounds, clamp: opts.clamp ?? true, opts: idw };
}

/**
 * Estimate at one location given its covariate values; also reports whether any covariate had to be clamped to
 * the training range. Null if they are non-finite or the IDW mask excludes the location.
 */
export function regressionPredictDetail(prep: PreparedRegression, lon: number, lat: number, covariates: readonly number[]): { value: number; clamped: boolean } | null {
  if (!covariates.every(Number.isFinite)) return null;
  let clamped = false;
  const x = prep.clamp
    ? covariates.map((v, j) => {
        const [lo, hi] = prep.bounds[j]!;
        const c = Math.min(Math.max(v, lo), hi);
        if (c !== v) clamped = true;
        return c;
      })
    : covariates;
  const trend = predictLinear(prep.model, x);
  const r = idwDetail(prep.residuals, lon, lat, prep.opts);
  if (!r) return null;
  const fade = Number.isFinite(prep.rangeM) ? Math.exp(-((r.nearestM / prep.rangeM) ** 2)) : 1;
  return { value: trend + r.value * fade, clamped };
}

/** Estimate at one location (see regressionPredictDetail). */
export function regressionPredict(prep: PreparedRegression, lon: number, lat: number, covariates: readonly number[]): number | null {
  return regressionPredictDetail(prep, lon, lat, covariates)?.value ?? null;
}

export interface RegressionGrid {
  grid: RasterGrid;
  model: LinearModel;
  /** The covariate-only surface (no residual correction). */
  trend: RasterGrid;
  rangeM: number;
  /** Share (0..1) of estimated cells where a covariate was clamped to the station range, i.e. where the model extrapolates. */
  clampedShare: number;
}

/**
 * Regression + residual-IDW surface. `covariateGrids` must share one geometry (the output grid): one per
 * covariate, in the same order as the columns of `covariates`. Cells with a NaN covariate are NaN.
 */
export function regressionIdwGrid(
  points: readonly SamplePoint[],
  covariates: readonly (readonly number[])[],
  covariateGrids: readonly RasterGrid[],
  opts: RegressionIdwOptions = {},
): RegressionGrid {
  if (covariateGrids.length === 0) throw new RangeError("need at least one covariate grid");
  const ref = covariateGrids[0]!;
  for (const g of covariateGrids) {
    const same = g.width === ref.width && g.height === ref.height && g.bbox.every((v, i) => Math.abs(v - ref.bbox[i]!) < 1e-9);
    if (!same) throw new RangeError("covariate grids must share one geometry");
  }
  if (covariates[0] && covariates[0].length !== covariateGrids.length) throw new RangeError("station covariates and covariate grids must have the same number of covariates");
  const prep = prepareRegression(points, covariates, opts);
  const [west, south, east, north] = ref.bbox;
  const dx = (east - west) / ref.width;
  const dy = (north - south) / ref.height;
  const out = new Float32Array(ref.width * ref.height);
  const trend = new Float32Array(ref.width * ref.height);
  const cov = new Array<number>(covariateGrids.length);
  let estimated = 0;
  let clampedCells = 0;
  for (let r = 0; r < ref.height; r++) {
    const lat = north - (r + 0.5) * dy;
    for (let c = 0; c < ref.width; c++) {
      const i = r * ref.width + c;
      for (let k = 0; k < covariateGrids.length; k++) cov[k] = covariateGrids[k]!.data[i]!;
      const est = regressionPredictDetail(prep, west + (c + 0.5) * dx, lat, cov);
      out[i] = est?.value ?? NaN;
      // The trend is the covariate-only surface (same clamping), for diagnostics.
      trend[i] = cov.every(Number.isFinite) ? predictLinear(prep.model, prep.clamp ? cov.map((v, j) => Math.min(Math.max(v, prep.bounds[j]![0]), prep.bounds[j]![1])) : cov) : NaN;
      if (est) {
        estimated++;
        if (est.clamped) clampedCells++;
      }
    }
  }
  return { grid: new RasterGrid(out, ref.width, ref.height, ref.bbox), trend: new RasterGrid(trend, ref.width, ref.height, ref.bbox), model: prep.model, rangeM: prep.rangeM, clampedShare: estimated ? clampedCells / estimated : 0 };
}

/** Leave-one-out error of regression + residual-IDW: the model is re-fitted on each fold's training stations. */
export function regressionLeaveOneOut(points: readonly SamplePoint[], covariates: readonly (readonly number[])[], opts: RegressionIdwOptions = {}): CvResult {
  if (covariates.length !== points.length) throw new RangeError("covariates must have one row per point");
  const index = new Map(points.map((p, i) => [p, i]));
  return leaveOneOut(points, (train, target) => {
    const idx = train.map((p) => index.get(p)!);
    let prep: PreparedRegression;
    try {
      prep = prepareRegression(train, idx.map((i) => covariates[i]!), opts);
    } catch {
      return null;
    }
    return regressionPredict(prep, target.lon, target.lat, covariates[index.get(target)!]!);
  });
}

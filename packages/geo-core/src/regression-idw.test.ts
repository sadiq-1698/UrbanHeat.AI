import { test } from "node:test";
import assert from "node:assert/strict";
import { idwGrid, idwLeaveOneOut, type SamplePoint } from "./interpolate.js";
import { RasterGrid } from "./raster-grid.js";
import { meanNearestNeighborM, prepareRegression, regressionIdwGrid, regressionLeaveOneOut, regressionPredict } from "./regression-idw.js";

const BBOX: [number, number, number, number] = [-122.5, 47.55, -122.4, 47.65];
const W = 50;
const H = 50;
const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const blob = (lon: number, lat: number, cx: number, cy: number, s: number) => Math.exp(-(((lon - cx) / s) ** 2 + ((lat - cy) / s) ** 2));

// A world with known truth: temperature = 25 + 0.08*impervious - 0.05*canopy + a local 1.2 °C bump.
const imp = (lon: number, lat: number) => 90 * blob(lon, lat, -122.45, 47.6, 0.03) + 40 * blob(lon, lat, -122.48, 47.57, 0.02);
const canopy = (lon: number, lat: number) => 70 * blob(lon, lat, -122.42, 47.63, 0.03) + 30 * blob(lon, lat, -122.47, 47.62, 0.025);
const bump = (lon: number, lat: number) => 1.2 * blob(lon, lat, -122.43, 47.58, 0.012);
const truth = (lon: number, lat: number) => 25 + 0.08 * imp(lon, lat) - 0.05 * canopy(lon, lat) + bump(lon, lat);

function grid(f: (lon: number, lat: number) => number): RasterGrid {
  const d = new Float32Array(W * H);
  const dx = (BBOX[2] - BBOX[0]) / W;
  const dy = (BBOX[3] - BBOX[1]) / H;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) d[r * W + c] = f(BBOX[0] + (c + 0.5) * dx, BBOX[3] - (r + 0.5) * dy);
  return new RasterGrid(d, W, H, BBOX);
}

function stations(n: number, seed: number): { pts: SamplePoint[]; cov: number[][] } {
  const r = rng(seed);
  const pts: SamplePoint[] = [];
  for (let i = 0; i < n; i++) {
    const lon = BBOX[0] + 0.005 + r() * 0.09;
    const lat = BBOX[1] + 0.005 + r() * 0.09;
    pts.push({ lon, lat, value: truth(lon, lat) });
  }
  return { pts, cov: pts.map((p) => [imp(p.lon, p.lat), canopy(p.lon, p.lat)]) };
}

const rmseVs = (g: RasterGrid, ref: RasterGrid) => {
  let s = 0;
  let n = 0;
  g.data.forEach((v, i) => {
    if (!Number.isNaN(v)) {
      s += (v - ref.data[i]!) ** 2;
      n++;
    }
  });
  return Math.sqrt(s / n);
};

test("regression recovers the covariate effects", () => {
  const { pts, cov } = stations(30, 11);
  const prep = prepareRegression(pts, cov, { ridge: 1e-6 });
  assert.ok(Math.abs(prep.model.coefficients[1]! - 0.08) < 0.01, `${prep.model.coefficients}`);
  assert.ok(Math.abs(prep.model.coefficients[2]! + 0.05) < 0.01, `${prep.model.coefficients}`);
  assert.ok(prep.model.r2 > 0.9);
});

test("it is an exact interpolator at the stations", () => {
  const { pts, cov } = stations(20, 5);
  const prep = prepareRegression(pts, cov);
  for (const [i, p] of pts.entries()) {
    const v = regressionPredict(prep, p.lon, p.lat, cov[i]!)!;
    assert.ok(Math.abs(v - p.value) < 1e-6, `${v} vs ${p.value}`);
  }
});

test("with informative covariates it beats plain IDW: held-out stations and the whole surface", () => {
  const { pts, cov } = stations(30, 21);
  const idwCv = idwLeaveOneOut(pts);
  const regCv = regressionLeaveOneOut(pts, cov);
  assert.equal(regCv.n, 30);
  assert.ok(regCv.rmse < idwCv.rmse * 0.5, `regression ${regCv.rmse.toFixed(3)} vs idw ${idwCv.rmse.toFixed(3)}`);

  const ref = grid(truth);
  const reg = regressionIdwGrid(pts, cov, [grid(imp), grid(canopy)]);
  const idw = idwGrid(pts, BBOX, W, H);
  const regErr = rmseVs(reg.grid, ref);
  const idwErr = rmseVs(idw, ref);
  assert.ok(regErr < idwErr * 0.5, `grid RMSE vs truth: regression ${regErr.toFixed(3)} vs idw ${idwErr.toFixed(3)}`);
  assert.ok(regErr < 0.5);
});

test("far from every station the surface relaxes to the covariate trend", () => {
  // Stations only in the south-west corner; evaluate in the north-east.
  const pts: SamplePoint[] = [];
  const r = rng(3);
  for (let i = 0; i < 12; i++) {
    const lon = -122.495 + r() * 0.02;
    const lat = 47.555 + r() * 0.02;
    // An unexplained, spatially varying local effect (a constant offset would just be absorbed by the intercept).
    pts.push({ lon, lat, value: truth(lon, lat) + 1.5 * blob(lon, lat, -122.49, 47.56, 0.006) });
  }
  const cov = pts.map((p) => [imp(p.lon, p.lat), canopy(p.lon, p.lat)]);
  const reg = regressionIdwGrid(pts, cov, [grid(imp), grid(canopy)], { residualRangeM: 1500, neighbors: 3 });
  const far = (W - 3) * 1 + 2 + 3 * W; // row 3, col W-3: north-east corner
  assert.ok(Math.abs(reg.grid.data[far]! - reg.trend.data[far]!) < 1e-3, "residual influence should have faded");
  // whereas next to a station the residual is applied
  const near = reg.grid.valueAt(pts[0]!.lon, pts[0]!.lat)!;
  assert.ok(Math.abs(near - pts[0]!.value) < 0.3);
  // and with the fade disabled the far field keeps the residual
  const noFade = regressionIdwGrid(pts, cov, [grid(imp), grid(canopy)], { residualRangeM: Infinity, neighbors: 3 });
  assert.ok(Math.abs(noFade.grid.data[far]! - noFade.trend.data[far]!) > 0.01);
});

test("stations with non-finite covariates are skipped; none valid throws", () => {
  const { pts, cov } = stations(10, 2);
  const withNaN = cov.map((c, i) => (i === 0 ? [NaN, c[1]!] : c));
  const prep = prepareRegression(pts, withNaN);
  assert.equal(prep.residuals.length, 9);
  assert.throws(() => prepareRegression(pts, cov.map(() => [NaN, NaN])), RangeError);
  assert.equal(regressionPredict(prep, pts[3]!.lon, pts[3]!.lat, [NaN, 1]), null);
});

test("cells with a NaN covariate are NaN in both the surface and the trend", () => {
  const { pts, cov } = stations(15, 8);
  const impG = grid(imp);
  impG.data[10] = NaN;
  const reg = regressionIdwGrid(pts, cov, [impG, grid(canopy)]);
  assert.ok(Number.isNaN(reg.grid.data[10]!) && Number.isNaN(reg.trend.data[10]!));
  assert.ok(!Number.isNaN(reg.grid.data[11]!));
});

test("input validation", () => {
  const { pts, cov } = stations(8, 4);
  assert.throws(() => prepareRegression(pts, cov.slice(1)), RangeError);
  assert.throws(() => regressionIdwGrid(pts, cov, []), RangeError);
  assert.throws(() => regressionIdwGrid(pts, cov, [grid(imp)]), RangeError); // 2 covariates per station, 1 grid
  const other = new RasterGrid(new Float32Array(4), 2, 2, BBOX);
  assert.throws(() => regressionIdwGrid(pts, cov, [grid(imp), other]), RangeError);
  assert.throws(() => regressionLeaveOneOut(pts, cov.slice(1)), RangeError);
});

test("meanNearestNeighborM", () => {
  assert.ok(Number.isNaN(meanNearestNeighborM([{ lon: 0, lat: 0, value: 0 }])));
  const d = meanNearestNeighborM([{ lon: 0, lat: 0, value: 0 }, { lon: 0.001, lat: 0, value: 0 }, { lon: 0.01, lat: 0, value: 0 }]);
  // nearest distances: ~111 m, ~111 m, ~1000 m
  assert.ok(Math.abs(d - (111.2 + 111.2 + 1000.8) / 3) < 5, `${d}`);
});

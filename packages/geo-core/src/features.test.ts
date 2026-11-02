import { test } from "node:test";
import assert from "node:assert/strict";
import { DIST_CAP_M, FEATURE_NAMES, boxFraction, boxMean, buildFeatures, cellSizeM, distanceToMask, halfWidths } from "./features.js";
import { RasterGrid } from "./raster-grid.js";

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);
const SIZE = { dxM: 100, dyM: 100 };
const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

test("cell size shrinks with latitude; half-widths round half up and floor at one cell", () => {
  const eq = cellSizeM(0.001, 0.001, 0);
  const n = cellSizeM(0.001, 0.001, 60);
  near(eq.dxM, 111.195, 0.01);
  near(n.dxM / eq.dxM, 0.5, 1e-9);
  near(n.dyM, eq.dyM);
  assert.deepEqual(halfWidths(150, { dxM: 100, dyM: 100 }), [2, 2]); // 1.5 -> 2 (Math.round would also give 2, but -1.5 would not)
  assert.deepEqual(halfWidths(250, { dxM: 100, dyM: 100 }), [3, 3]);
  assert.deepEqual(halfWidths(10, { dxM: 100, dyM: 100 }), [1, 1]);
  assert.deepEqual(halfWidths(1000, { dxM: 50, dyM: 200 }), [20, 5]);
});

test("boxMean matches a brute-force window average, with NaN, a valid mask, and edge clipping", () => {
  const w = 11;
  const h = 9;
  const r = rng(5);
  const a = Float64Array.from({ length: w * h }, () => (r() < 0.2 ? NaN : r() * 100));
  const valid = Uint8Array.from({ length: w * h }, () => (r() < 0.8 ? 1 : 0));
  for (const [kx, ky] of [[1, 1], [2, 1], [1, 3], [4, 4]] as const) {
    for (const mask of [undefined, valid]) {
      const got = boxMean(a, w, h, kx, ky, mask);
      for (let row = 0; row < h; row++) {
        for (let col = 0; col < w; col++) {
          let s = 0;
          let c = 0;
          for (let rr = Math.max(0, row - ky); rr <= Math.min(h - 1, row + ky); rr++) {
            for (let cc = Math.max(0, col - kx); cc <= Math.min(w - 1, col + kx); cc++) {
              const v = a[rr * w + cc]!;
              if (!Number.isNaN(v) && (!mask || mask[rr * w + cc])) {
                s += v;
                c++;
              }
            }
          }
          const g = got[row * w + col]!;
          if (c === 0) assert.ok(Number.isNaN(g), `k=${kx},${ky} r=${row} c=${col}`);
          else near(g, s / c, 1e-9);
        }
      }
    }
  }
});

test("boxMean: a window with no valid cell is NaN; boxFraction uses the clipped window size", () => {
  const out = boxMean([1, 2, 3, 4, 5], 5, 1, 1, 1, [1, 0, 0, 0, 0]);
  assert.equal(out[0], 1);
  assert.ok(Number.isNaN(out[3]) && Number.isNaN(out[4]));
  const m = [1, 0, 0, 0, 0, 0, 0, 0, 0];
  const f = boxFraction(m, 3, 3, 1, 1);
  near(f[0]!, 1 / 4);
  near(f[4]!, 1 / 9);
  near(f[8]!, 0);
});

test("distanceToMask: isotropic, capped, anisotropic, and the empty mask", () => {
  const d = distanceToMask([1, 0, 0, 0, 0, 0, 0], 7, 1, { dxM: 100, dyM: 100 }, 350);
  assert.deepEqual(Array.from(d), [0, 100, 200, 300, 350, 350, 350]);
  const m = new Uint8Array(25);
  m[2 * 5 + 2] = 1;
  const a = distanceToMask(m, 5, 5, { dxM: 50, dyM: 200 });
  near(a[2 * 5 + 3]!, 50);
  near(a[3 * 5 + 2]!, 200);
  near(a[3 * 5 + 3]!, Math.hypot(50, 200));
  assert.ok(distanceToMask(new Uint8Array(9), 3, 3, SIZE).every((v) => v === DIST_CAP_M));
});

test("distanceToMask equals brute-force nearest-cell distance on a random scene with anisotropic cells", () => {
  const w = 23;
  const h = 17;
  const r = rng(11);
  const mask = Uint8Array.from({ length: w * h }, () => (r() < 0.06 ? 1 : 0));
  const size = { dxM: 57, dyM: 93 };
  const got = distanceToMask(mask, w, h, size, 1e9);
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      let best = Infinity;
      for (let rr = 0; rr < h; rr++) for (let cc = 0; cc < w; cc++) if (mask[rr * w + cc]) best = Math.min(best, Math.hypot((cc - col) * size.dxM, (rr - row) * size.dyM));
      near(got[row * w + col]!, best, 1e-6);
    }
  }
});

function scene() {
  const w = 14;
  const h = 12;
  const r = rng(3);
  const mk = (max: number) => Float32Array.from({ length: w * h }, () => r() * max);
  const canopy = mk(80);
  const imp = mk(90);
  const elev = mk(100);
  const water = new Uint8Array(w * h);
  for (let row = 0; row < h; row++) for (const c of [6, 7]) water[row * w + c] = 1;
  for (let i = 0; i < w * h; i++) if (water[i]) canopy[i] = imp[i] = elev[i] = 0;
  const bbox: [number, number, number, number] = [0, 0, 1, 1];
  const g = (d: Float32Array) => new RasterGrid(d, w, h, bbox);
  return { w, h, canopy, imp, elev, water, grids: { canopy: g(canopy), impervious: g(imp), elevation: g(elev) } };
}

test("buildFeatures: names, order, shapes, pass-through values", () => {
  const s = scene();
  const f = buildFeatures({ ...s.grids, water: s.water }, SIZE);
  assert.deepEqual([...f.names], [...FEATURE_NAMES]);
  assert.equal(FEATURE_NAMES.length, 12);
  for (const n of FEATURE_NAMES) assert.equal(f.data[n].length, s.w * s.h);
  assert.deepEqual(Array.from(f.data.canopy_pct), Array.from(s.canopy));
  assert.deepEqual(Array.from(f.data.elevation_m), Array.from(s.elev));
});

test("buildFeatures: neighbourhood means ignore water; water features behave", () => {
  const s = scene();
  const f = buildFeatures({ ...s.grids, water: s.water }, SIZE);
  const r = 5;
  const c = 5; // k = 2 at 150 m with 100 m cells
  let sum = 0;
  let n = 0;
  let naive = 0;
  let nn = 0;
  for (let rr = r - 2; rr <= r + 2; rr++) for (let cc = c - 2; cc <= c + 2; cc++) {
    naive += s.canopy[rr * s.w + cc]!;
    nn++;
    if (!s.water[rr * s.w + cc]) {
      sum += s.canopy[rr * s.w + cc]!;
      n++;
    }
  }
  near(f.data.canopy_mean_150m[r * s.w + c]!, sum / n, 1e-6);
  assert.ok(Math.abs(f.data.canopy_mean_150m[r * s.w + c]! - naive / nn) > 1e-3, "must differ from the naive mean that counts water zeros");
  assert.equal(f.data.dist_water_m[0 * s.w + 6], 0);
  near(f.data.dist_water_m[0 * s.w + 4]!, 200);
  near(f.data.dist_water_m[0 * s.w + 9]!, 200);
  assert.ok(f.data.water_frac_500m[5]! > f.data.water_frac_500m[0]!);
});

test("buildFeatures: flat terrain has no relief; a peak stands out; NaN inputs propagate only where needed", () => {
  const s = scene();
  const flat = buildFeatures({ ...s.grids, elevation: new RasterGrid(new Float32Array(s.w * s.h).fill(40), s.w, s.h, [0, 0, 1, 1]), water: s.water }, SIZE);
  assert.ok(Array.from(flat.data.elev_rel_1000m).every((v) => Math.abs(v) < 1e-9));
  const peak = Float32Array.from(s.elev);
  peak[6 * s.w + 3] = 500;
  const rel = buildFeatures({ ...s.grids, elevation: new RasterGrid(peak, s.w, s.h, [0, 0, 1, 1]), water: s.water }, SIZE).data.elev_rel_1000m;
  assert.ok(rel[6 * s.w + 3]! > 300);
  const can = Float32Array.from(s.canopy);
  can[2 * s.w + 2] = NaN;
  const f = buildFeatures({ ...s.grids, canopy: new RasterGrid(can, s.w, s.h, [0, 0, 1, 1]), water: s.water }, SIZE);
  assert.ok(Number.isNaN(f.data.canopy_pct[2 * s.w + 2]!));
  assert.ok(!Number.isNaN(f.data.canopy_mean_150m[2 * s.w + 2]!));
  assert.ok(!Number.isNaN(f.data.impervious_pct[2 * s.w + 2]!));
});

test("buildFeatures rejects mismatched grids", () => {
  const s = scene();
  const small = new RasterGrid(new Float32Array(4), 2, 2, [0, 0, 1, 1]);
  assert.throws(() => buildFeatures({ ...s.grids, elevation: small, water: s.water }, SIZE), RangeError);
});

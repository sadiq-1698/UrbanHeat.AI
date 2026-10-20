import { test } from "node:test";
import assert from "node:assert/strict";
import { RasterGrid } from "./raster-grid.js";
import { cropGrid, resampleGrid, windowForBBox } from "./resample.js";

// 4x4 over lon 0..4, lat 0..4; value = row*4+col+1 (row 0 = north).
const g4 = () => new RasterGrid(Float32Array.from({ length: 16 }, (_, i) => i + 1), 4, 4, [0, 0, 4, 4]);

test("windowForBBox snaps outward, clamps, and rejects disjoint boxes", () => {
  const g = g4();
  assert.deepEqual(windowForBBox(g, [1, 1, 3, 3]), [1, 1, 3, 3]);
  assert.deepEqual(windowForBBox(g, [0.5, 0.5, 2.5, 2.5]), [0, 1, 3, 4]); // outward
  assert.deepEqual(windowForBBox(g, [-10, -10, 10, 10]), [0, 0, 4, 4]);
  assert.equal(windowForBBox(g, [5, 5, 6, 6]), null);
  assert.equal(windowForBBox(g, [4, 0, 5, 4]), null); // touching edge only
});

test("cropGrid returns the right cells and a snapped bbox", () => {
  const c = cropGrid(g4(), [1, 1, 3, 3])!;
  assert.deepEqual([c.width, c.height], [2, 2]);
  assert.deepEqual(c.bbox, [1, 1, 3, 3]);
  // rows 1..2 (from north), cols 1..2 -> values 6,7 / 10,11
  assert.deepEqual(Array.from(c.data), [6, 7, 10, 11]);
  assert.equal(cropGrid(g4(), [9, 9, 10, 10]), null);
});

test("cropGrid keeps georeferencing consistent with the source", () => {
  const g = g4();
  const c = cropGrid(g, [2.2, 0.2, 3.9, 1.8])!;
  for (const [lon, lat] of [[2.5, 1.5], [3.5, 0.5], [2.5, 0.5]] as const) {
    assert.equal(c.valueAt(lon, lat), g.valueAt(lon, lat));
  }
});

test("average downsampling integrates blocks", () => {
  const out = resampleGrid(g4(), 2, 2, "average");
  assert.deepEqual(Array.from(out.data), [3.5, 5.5, 11.5, 13.5]);
  assert.deepEqual(out.bbox, [0, 0, 4, 4]);
});

test("average ignores no-data and renormalizes; all-NaN stays NaN", () => {
  const g = new RasterGrid(Float32Array.from([NaN, 4, NaN, NaN]), 2, 2, [0, 0, 2, 2]);
  assert.equal(resampleGrid(g, 1, 1, "average").data[0], 4);
  const dead = new RasterGrid(Float32Array.from([NaN, NaN]), 2, 1, [0, 0, 2, 1]);
  assert.ok(Number.isNaN(resampleGrid(dead, 1, 1, "average").data[0]!));
});

test("average handles non-integer ratios with fractional weights", () => {
  const g = new RasterGrid(Float32Array.from([0, 3, 6]), 3, 1, [0, 0, 3, 1]);
  const out = resampleGrid(g, 2, 1, "average");
  // dest cell 0 covers src [0,1.5): (0*1 + 3*0.5)/1.5 = 1; cell 1 covers [1.5,3): (3*.5+6)/1.5 = 5
  assert.ok(Math.abs(out.data[0]! - 1) < 1e-6);
  assert.ok(Math.abs(out.data[1]! - 5) < 1e-6);
});

test("nearest preserves categorical values; bilinear smooths", () => {
  const cats = new RasterGrid(Float32Array.from([10, 20]), 2, 1, [0, 0, 2, 1]);
  const up = resampleGrid(cats, 4, 1, "nearest");
  assert.deepEqual(Array.from(up.data), [10, 10, 20, 20]);
  const smooth = resampleGrid(cats, 4, 1, "bilinear");
  assert.ok(smooth.data[1]! > 10 && smooth.data[1]! < 20);
  assert.equal(new Set(Array.from(smooth.data)).size, 4);
});

test("resampling to the same size is the identity", () => {
  const g = g4();
  for (const m of ["nearest", "bilinear", "average"] as const) {
    const out = resampleGrid(g, 4, 4, m);
    out.data.forEach((v, i) => assert.ok(Math.abs(v - g.data[i]!) < 1e-5, `${m}[${i}]`));
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { RasterGrid } from "./raster-grid.js";

// 4 cols x 2 rows over lon 0..4, lat 0..2 (cell = 1°). Row 0 is the north row.
//   row0: 1 2 3 4
//   row1: 5 6 7 8
const grid = () => new RasterGrid(Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8]), 4, 2, [0, 0, 4, 2]);

test("computes cell size and validates input", () => {
  const g = grid();
  assert.equal(g.resX, 1);
  assert.equal(g.resY, 1);
  assert.throws(() => new RasterGrid(new Float32Array(3), 2, 2, [0, 0, 1, 1]), RangeError);
  assert.throws(() => new RasterGrid(new Float32Array(4), 2, 2, [1, 0, 0, 1]), RangeError);
  assert.throws(() => new RasterGrid(new Float32Array(0), 0, 0, [0, 0, 1, 1]), RangeError);
});

test("valueAt picks the containing cell, north row first", () => {
  const g = grid();
  assert.equal(g.valueAt(0.5, 1.5), 1); // NW
  assert.equal(g.valueAt(3.5, 1.5), 4); // NE
  assert.equal(g.valueAt(0.5, 0.5), 5); // SW
  assert.equal(g.valueAt(2.2, 0.2), 7);
});

test("valueAt handles edges, outside points, and no-data", () => {
  const g = grid();
  assert.equal(g.valueAt(4, 0), 8); // exact SE corner belongs to the last cell
  assert.equal(g.valueAt(4.01, 1), null);
  assert.equal(g.valueAt(1, -0.01), null);
  const holes = new RasterGrid(Float32Array.from([NaN, 2]), 2, 1, [0, 0, 2, 1]);
  assert.equal(holes.valueAt(0.5, 0.5), null);
  assert.equal(holes.valueAt(1.5, 0.5), 2);
});

test("bilinearAt is exact at cell centres and linear between them", () => {
  const g = grid();
  assert.equal(g.bilinearAt(0.5, 1.5), 1);
  assert.equal(g.bilinearAt(1.5, 1.5), 2);
  assert.ok(Math.abs(g.bilinearAt(1.0, 1.5)! - 1.5) < 1e-6); // halfway 1..2
  assert.ok(Math.abs(g.bilinearAt(1.0, 1.0)! - 3.5) < 1e-6); // centre of 1,2,5,6
});

test("bilinearAt clamps near borders and renormalizes around no-data", () => {
  const g = grid();
  assert.equal(g.bilinearAt(0.1, 1.9), 1); // within half a cell of NW corner
  const g2 = new RasterGrid(Float32Array.from([NaN, 10, 10, 10]), 2, 2, [0, 0, 2, 2]);
  assert.equal(g2.bilinearAt(1, 1), 10); // NaN neighbour dropped, not averaged in
  const dead = new RasterGrid(Float32Array.from([NaN, NaN, NaN, NaN]), 2, 2, [0, 0, 2, 2]);
  assert.equal(dead.bilinearAt(1, 1), null);
  assert.equal(g.bilinearAt(9, 9), null);
});

test("stats ignores NaN and reports counts", () => {
  const g = new RasterGrid(Float32Array.from([2, 4, NaN, 6]), 2, 2, [0, 0, 2, 2]);
  const s = g.stats();
  assert.deepEqual([s.count, s.nodata, s.min, s.max, s.mean], [3, 1, 2, 6, 4]);
  assert.ok(Math.abs(s.std - Math.sqrt(8 / 3)) < 1e-9);
  const empty = new RasterGrid(Float32Array.from([NaN]), 1, 1, [0, 0, 1, 1]).stats();
  assert.equal(empty.count, 0);
  assert.ok(Number.isNaN(empty.mean));
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { type Area, cellAreaM2, circlePolygon } from "./geometry.js";
import { RasterGrid } from "./raster-grid.js";
import { coverageMask, zonalShare, zonalStats } from "./zonal.js";

// 10x10 grid over lon 0..10, lat 0..10 (1° cells); value = row*10 + col, row 0 = north.
const grid = (mutate?: (d: Float32Array) => void) => {
  const d = Float32Array.from({ length: 100 }, (_, i) => i);
  mutate?.(d);
  return new RasterGrid(d, 10, 10, [0, 0, 10, 10]);
};
const rect = (x0: number, y0: number, x1: number, y1: number): Area => ({
  type: "Polygon",
  coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
});
const near = (a: number, b: number, eps = 1e-5) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test("polygon aligned to cells averages exactly those cells", () => {
  // lon 2..4, lat 2..4 -> cols 2,3 and rows 6,7 -> values 62,63,72,73
  const s = zonalStats(grid(), rect(2, 2, 4, 4))!;
  near(s.mean, 67.5);
  assert.equal(s.cells, 4);
  near(s.weight, 4);
  assert.equal(s.min, 62);
  assert.equal(s.max, 73);
  near(s.std, Math.sqrt(((62 - 67.5) ** 2 + (63 - 67.5) ** 2 + (72 - 67.5) ** 2 + (73 - 67.5) ** 2) / 4));
  assert.equal(s.nodataShare, 0);
  assert.ok(s.areaM2 > 0);
});

test("partial cell coverage weights edge cells fractionally", () => {
  // lon 2.5..4.5 (cols 2,3,4 weights .5,1,.5), lat 2.5..4.5 (rows 5,6,7 weights .5,1,.5)
  const wx = [0.5, 1, 0.5];
  const wy = [0.5, 1, 0.5];
  let num = 0;
  let den = 0;
  wy.forEach((y, j) => wx.forEach((x, i) => { num += x * y * ((5 + j) * 10 + (2 + i)); den += x * y; }));
  const s = zonalStats(grid(), rect(2.5, 2.5, 4.5, 4.5))!;
  near(s.mean, num / den);
  near(s.weight, 4);
  assert.equal(s.cells, 9);
});

test("holes are excluded", () => {
  const donut: Area = {
    type: "Polygon",
    coordinates: [
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[3, 3], [3, 7], [7, 7], [7, 3], [3, 3]],
    ],
  };
  const s = zonalStats(grid(), donut)!;
  near(s.weight, 100 - 16);
  // hole removes rows 3..6, cols 3..6; mean of the rest = (4950 - sum(hole)) / 84
  let hole = 0;
  for (let r = 3; r < 7; r++) for (let c = 3; c < 7; c++) hole += r * 10 + c;
  near(s.mean, (4950 - hole) / 84);
});

test("no-data cells are skipped and reported as nodataShare", () => {
  const g = grid((d) => { d[62] = NaN; }); // one of the four cells
  const s = zonalStats(g, rect(2, 2, 4, 4))!;
  near(s.mean, (63 + 72 + 73) / 3);
  assert.equal(s.cells, 3);
  near(s.nodataShare, 0.25);
  const dead = zonalStats(grid((d) => d.fill(NaN)), rect(2, 2, 4, 4))!;
  assert.ok(Number.isNaN(dead.mean) && Number.isNaN(dead.min) && dead.cells === 0);
  assert.equal(dead.nodataShare, 1);
});

test("MultiPolygon sums its parts; overlap with the grid edge is clipped", () => {
  const multi: Area = {
    type: "MultiPolygon",
    coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]], [[[9, 9], [10, 9], [10, 10], [9, 10], [9, 9]]]],
  };
  const s = zonalStats(grid(), multi)!;
  near(s.mean, (90 + 9) / 2); // SW cell row 9 col 0, NE cell row 0 col 9
  const edge = zonalStats(grid(), rect(8, 8, 14, 14))!; // half outside the grid
  near(edge.weight, 4);
  assert.equal(zonalStats(grid(), rect(20, 20, 21, 21)), null);
});

test("polygons smaller than a cell fall back to the cell at their centre", () => {
  const s = zonalStats(grid(), rect(4.45, 4.45, 4.55, 4.55), { supersample: 2 })!;
  assert.equal(s.mean, 5 * 10 + 4); // lat 4.5 -> row 5, lon 4.5 -> col 4
  assert.equal(s.cells, 1);
});

test("supersample refines coverage of diagonal edges", () => {
  const tri: Area = { type: "Polygon", coordinates: [[[0, 0], [10, 0], [0, 10], [0, 0]]] };
  const coarse = coverageMask(grid(), tri, { supersample: 1 })!.totalWeight;
  const fine = coverageMask(grid(), tri, { supersample: 8 })!.totalWeight;
  assert.ok(Math.abs(fine - 50) < Math.abs(coarse - 50) + 1e-9);
  assert.ok(Math.abs(fine - 50) < 1);
  assert.throws(() => coverageMask(grid(), tri, { supersample: 0 }), RangeError);
});

test("covered cell-area matches the geodesic polygon area for a circle", () => {
  // 0.001° cells around Seattle; a 400 m circle.
  const g = new RasterGrid(new Float32Array(400 * 400).fill(1), 400, 400, [-122.5, 47.4, -122.1, 47.8]);
  const circle = circlePolygon(-122.3, 47.6, 400);
  const s = zonalStats(g, circle)!;
  const cellArea = cellAreaM2(47.6, g.resX, g.resY);
  assert.ok(Math.abs((s.weight * cellArea) / s.areaM2 - 1) < 0.03, `${(s.weight * cellArea) / s.areaM2}`);
});

test("zonalShare reports the weighted fraction passing a predicate", () => {
  // columns 2..3 within rows 6..7: values 62,63,72,73 -> >=70 is half
  near(zonalShare(grid(), rect(2, 2, 4, 4), (v) => v >= 70)!, 0.5);
  assert.equal(zonalShare(grid(), rect(20, 20, 21, 21), () => true), null);
  assert.equal(zonalShare(grid((d) => d.fill(NaN)), rect(2, 2, 4, 4), () => true), null);
});

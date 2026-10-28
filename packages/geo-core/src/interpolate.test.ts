import { test } from "node:test";
import assert from "node:assert/strict";
import { approxDistanceM, idwAt, idwGrid, idwLeaveOneOut, leaveOneOut, type SamplePoint } from "./interpolate.js";

const near = (a: number | null, b: number, eps = 1e-6) => assert.ok(a !== null && Math.abs(a - b) < eps, `${a} !~ ${b}`);
// ~0.01° apart at 47.6°N is ~750 m E-W.
const A: SamplePoint = { lon: -122.40, lat: 47.60, value: 10 };
const B: SamplePoint = { lon: -122.38, lat: 47.60, value: 20 };

test("exact at a station, and the midpoint of two equidistant stations is their mean", () => {
  near(idwAt([A, B], A.lon, A.lat), 10);
  near(idwAt([A, B], B.lon + 0.00000001, B.lat), 20);
  near(idwAt([A, B], -122.39, 47.6), 15);
});

test("a single point gives a constant surface; coincident stations are averaged", () => {
  near(idwAt([A], -120, 40), 10);
  near(idwAt([A, { ...A, value: 30 }], A.lon, A.lat), 20);
});

test("result is a weighted average: never outside the data range", () => {
  const pts: SamplePoint[] = [A, B, { lon: -122.39, lat: 47.62, value: 15 }];
  for (const [lon, lat] of [[-122.5, 47.5], [-122.39, 47.605], [-122.3, 47.7], [-122.41, 47.59]] as const) {
    const v = idwAt(pts, lon, lat)!;
    assert.ok(v >= 10 && v <= 20, `${v}`);
  }
});

test("higher power is more local; lower power is smoother", () => {
  const q = [-122.395, 47.6] as const; // closer to A
  const p1 = idwAt([A, B], q[0], q[1], { power: 1 })!;
  const p2 = idwAt([A, B], q[0], q[1], { power: 2 })!;
  const p6 = idwAt([A, B], q[0], q[1], { power: 6 })!;
  assert.ok(p1 > p2 && p2 > p6 && p6 >= 10, `${p1} ${p2} ${p6}`);
  assert.ok(p1 > 12.5 && p6 < 10.1);
});

test("neighbors limits the stations used; neighbors >= n equals using all", () => {
  const pts: SamplePoint[] = [A, B, { lon: -122.0, lat: 47.9, value: 100 }]; // far outlier
  const q = [-122.39, 47.6] as const;
  const all = idwAt(pts, q[0], q[1], { neighbors: Infinity })!;
  assert.equal(idwAt(pts, q[0], q[1], { neighbors: 3 }), all);
  assert.equal(idwAt(pts, q[0], q[1], { neighbors: 99 }), all);
  const two = idwAt(pts, q[0], q[1], { neighbors: 2 })!; // outlier excluded
  near(two, 15);
  assert.ok(all > two);
});

test("maxDistanceM masks locations far from every station and trims far neighbours", () => {
  assert.equal(idwAt([A, B], -122.39, 47.6, { maxDistanceM: 100 }), null);
  near(idwAt([A, B], -122.39, 47.6, { maxDistanceM: 5000 }), 15);
  // one station within range, one beyond: only the near one contributes
  near(idwAt([A, { lon: -122.0, lat: 47.9, value: 99 }], -122.399, 47.6, { maxDistanceM: 2000 }), 10);
});

test("distance accounts for longitude shrinking with latitude", () => {
  const eq = approxDistanceM(0, 0, 1, 0);
  const north = approxDistanceM(0, 60, 1, 60);
  assert.ok(Math.abs(eq - 111_195) < 100);
  assert.ok(Math.abs(north / eq - 0.5) < 0.01);
  assert.ok(Math.abs(approxDistanceM(0, 0, 0, 1) - 111_195) < 100);
});

test("idwGrid: shape, cell-centre sampling, and NaN beyond maxDistanceM", () => {
  const bbox: [number, number, number, number] = [-122.42, 47.58, -122.36, 47.62];
  const g = idwGrid([A, B], bbox, 6, 4);
  assert.deepEqual([g.width, g.height], [6, 4]);
  assert.deepEqual(g.bbox, bbox);
  // cell (row 1, col 2): centre lon = west + 2.5*dx, lat = north - 1.5*dy
  const lon = -122.42 + 2.5 * (0.06 / 6);
  const lat = 47.62 - 1.5 * (0.04 / 4);
  assert.equal(g.at(1, 2), Math.fround(idwAt([A, B], lon, lat)!));
  const masked = idwGrid([A], bbox, 6, 4, { maxDistanceM: 800 }) // nearest cell centre is ~670 m away;
  const s = masked.stats();
  assert.ok(s.nodata > 0 && s.count > 0, JSON.stringify(s));
  assert.ok(s.min === 10 && s.max === 10);
});

test("rejects bad input", () => {
  const bbox: [number, number, number, number] = [0, 0, 1, 1];
  assert.throws(() => idwGrid([], bbox, 2, 2), RangeError);
  assert.throws(() => idwGrid([{ lon: 0, lat: 0, value: NaN }], bbox, 2, 2), RangeError);
  assert.throws(() => idwGrid([A], bbox, 2, 2, { power: 0 }), RangeError);
  assert.throws(() => idwGrid([A], bbox, 2, 2, { neighbors: 0 }), RangeError);
  assert.throws(() => idwLeaveOneOut([A]), RangeError);
});

test("leave-one-out: three collinear stations have known errors", () => {
  // values 0,1,2 at equal spacing along a parallel; power 1, all neighbours.
  const step = 0.01;
  const pts: SamplePoint[] = [0, 1, 2].map((i) => ({ lon: -122.4 + i * step, lat: 47.6, value: i }));
  const cv = idwLeaveOneOut(pts, { power: 1, neighbors: Infinity });
  near(cv.predictions[1], 1, 1e-6); // middle from two equidistant ends
  near(cv.predictions[0], (1 / 1 + 2 / 2) / (1 + 1 / 2), 1e-3); // ends: weights 1 and 1/2 -> 1.333
  near(cv.predictions[2], (1 / 1 + 0 / 2) / (1 + 1 / 2), 1e-3); // 0.667
  assert.equal(cv.n, 3);
  near(cv.mae, (1.3333 + 0 + 1.3333) / 3, 1e-3);
  near(cv.bias, (1.3333 - 1.3333) / 3, 1e-3); // end errors cancel: +1.33 and -1.33
  near(cv.rmse, Math.sqrt((1.3333 ** 2 * 2) / 3), 1e-3);
});

test("leaveOneOut skips null predictions and passes training sets without the held-out point", () => {
  const pts: SamplePoint[] = [A, B, { lon: -122.39, lat: 47.61, value: 12 }];
  const sizes: number[] = [];
  const cv = leaveOneOut(pts, (train, t, i) => {
    sizes.push(train.length);
    assert.ok(!train.includes(t));
    return i === 0 ? null : t.value + 1;
  });
  assert.deepEqual(sizes, [2, 2, 2]);
  assert.equal(cv.n, 2);
  near(cv.bias, 1);
  near(cv.rmse, 1);
  assert.equal(cv.predictions[0], null);
});

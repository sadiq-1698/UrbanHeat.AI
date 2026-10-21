import { test } from "node:test";
import assert from "node:assert/strict";
import area from "@turf/area";
import { boundsOf, cellAreaM2, circlePolygon, haversineM, metersPerDegree, pointInPolygons, polygonsOf, toArea } from "./geometry.js";

const square = (x0: number, y0: number, x1: number, y1: number) => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]];
const donut = {
  type: "Polygon" as const,
  coordinates: [...square(0, 0, 10, 10), ...[[[4, 4], [4, 6], [6, 6], [6, 4], [4, 4]]]],
};

test("toArea unwraps features and rejects bad input", () => {
  const g = { type: "Polygon" as const, coordinates: square(0, 0, 1, 1) };
  assert.deepEqual(toArea({ type: "Feature", properties: {}, geometry: g }), g);
  assert.throws(() => toArea({ type: "Point", coordinates: [0, 0] } as never), TypeError);
  assert.throws(() => toArea({ type: "Polygon", coordinates: [[[0, 0], [1, 1], [0, 0]]] }), RangeError);
  assert.throws(() => toArea({ type: "Polygon", coordinates: [] }), RangeError);
});

test("pointInPolygons honours holes and multipolygons", () => {
  const polys = polygonsOf(donut);
  assert.equal(pointInPolygons(1, 1, polys), true);
  assert.equal(pointInPolygons(5, 5, polys), false); // in the hole
  assert.equal(pointInPolygons(11, 5, polys), false);
  const multi = polygonsOf({ type: "MultiPolygon", coordinates: [square(0, 0, 1, 1), square(5, 5, 6, 6)] });
  assert.equal(pointInPolygons(5.5, 5.5, multi), true);
  assert.equal(pointInPolygons(3, 3, multi), false);
});

test("boundsOf spans all member polygons", () => {
  assert.deepEqual(boundsOf({ type: "MultiPolygon", coordinates: [square(0, 1, 2, 3), square(-4, 0, 1, 9)] }), [-4, 0, 2, 9]);
});

test("metres per degree and cell area shrink with latitude", () => {
  assert.ok(Math.abs(metersPerDegree(0).x - 111_195) < 50);
  assert.ok(Math.abs(metersPerDegree(60).x / metersPerDegree(0).x - 0.5) < 1e-9);
  const eq = cellAreaM2(0, 0.001, 0.001);
  assert.ok(Math.abs(eq - 111.195 ** 2) / eq < 1e-3);
  assert.ok(cellAreaM2(47.6, 0.001, 0.001) < eq);
});

test("haversine matches known distances", () => {
  assert.ok(Math.abs(haversineM([0, 0], [1, 0]) - 111_195) < 50);
  assert.equal(haversineM([-122.3, 47.6], [-122.3, 47.6]), 0);
  // Seattle -> Portland, ~233 km
  assert.ok(Math.abs(haversineM([-122.33, 47.61], [-122.68, 45.52]) - 233_000) < 3_000);
});

test("circlePolygon area is close to pi r^2 and centred", () => {
  const c = circlePolygon(-122.45, 47.6, 500);
  assert.ok(Math.abs(area({ type: "Feature", properties: {}, geometry: c }) / (Math.PI * 500 ** 2) - 1) < 0.01);
  assert.equal(pointInPolygons(-122.45, 47.6, polygonsOf(c)), true);
  assert.throws(() => circlePolygon(0, 0, 0), RangeError);
});

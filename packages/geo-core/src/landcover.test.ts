import { test } from "node:test";
import assert from "node:assert/strict";
import { type Area, circlePolygon } from "./geometry.js";
import { type LandCoverFeature, summarizeLandCover } from "./landcover.js";

// Boxes near 47.6°N; equal-latitude strips so area ratios follow longitude extents.
const box = (w: number, s: number, e: number, n: number): Area => ({
  type: "Polygon",
  coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
});
const lc = (geometry: Area, cls: string, canopy: number | string, imp: number | string): LandCoverFeature => ({
  geometry,
  properties: { class: cls, canopy_pct: canopy, impervious_pct: imp },
});
const near = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

const FOREST = lc(box(0, 47, 1, 48), "forest", 80, 5);
const CITY = lc(box(1, 47, 2, 48), "developed_high", 10, 85);

test("weights attributes by intersection area", () => {
  // Query spans 0.75..1.25 lon: 0.25 in forest, 0.25 in city -> 50/50.
  const s = summarizeLandCover(box(0.75, 47.2, 1.25, 47.8), [FOREST, CITY])!;
  near(s.canopyPct, 45, 0.05);
  near(s.imperviousPct, 45, 0.05);
  near(s.classShares.forest!, 0.5, 1e-3);
  near(s.classShares.developed_high!, 0.5, 1e-3);
  near(s.coveredShare, 1, 1e-6);
  assert.equal(s.polygons, 2);
  assert.equal(s.skipped, 0);
});

test("unequal split follows area and ignores non-overlapping polygons", () => {
  const far = lc(box(10, 47, 11, 48), "water", 0, 0);
  const s = summarizeLandCover(box(0.5, 47.2, 1.1, 47.8), [FOREST, CITY, far])!; // 0.5 forest : 0.1 city
  near(s.classShares.forest!, 5 / 6, 2e-3);
  near(s.canopyPct, (80 * 5 + 10) / 6, 0.1);
  assert.equal(s.polygons, 2);
  assert.equal(s.classShares.water, undefined);
});

test("reports the uncovered part of the query and accepts string attributes (pg NUMERIC)", () => {
  const s = summarizeLandCover(box(0.5, 47.2, 1.5, 47.8), [lc(box(0.5, 47, 1, 48), "forest", "80.00", "5.00")])!;
  near(s.coveredShare, 0.5, 1e-3);
  near(s.canopyPct, 80, 1e-6);
  assert.ok(s.coveredAreaM2 < s.queryAreaM2);
});

test("null when nothing overlaps; handles MultiPolygon query and circles", () => {
  assert.equal(summarizeLandCover(box(20, 20, 21, 21), [FOREST, CITY]), null);
  assert.equal(summarizeLandCover(box(0, 47, 1, 48), []), null);
  const multi: Area = {
    type: "MultiPolygon",
    coordinates: [[[[0.1, 47.1], [0.2, 47.1], [0.2, 47.2], [0.1, 47.2], [0.1, 47.1]]], [[[1.1, 47.1], [1.2, 47.1], [1.2, 47.2], [1.1, 47.2], [1.1, 47.1]]]],
  };
  const s = summarizeLandCover(multi, [FOREST, CITY])!;
  near(s.classShares.forest!, 0.5, 1e-3);
  const c = summarizeLandCover(circlePolygon(1, 47.5, 2000), [FOREST, CITY])!;
  near(c.classShares.forest! + c.classShares.developed_high!, 1, 1e-9);
  near(c.classShares.forest!, 0.5, 0.02);
});

test("a geometry turf cannot process is skipped and counted, not fatal", () => {
  const broken: Area = { type: "Polygon", coordinates: [[[NaN, 47], [1, 47], [1, 48], [0, 48], [NaN, 47]]] };
  const s = summarizeLandCover(box(0, 47, 1, 48), [lc(broken, "barren", 0, 0), FOREST])!;
  assert.equal(s.skipped, 1);
  assert.equal(s.polygons, 1);
  near(s.classShares.forest!, 1, 1e-9);
  // Only broken input: still reports the skip rather than pretending nothing overlapped.
  const only = summarizeLandCover(box(0, 47, 1, 48), [lc(broken, "barren", 0, 0)])!;
  assert.equal(only.skipped, 1);
  assert.equal(only.coveredShare, 0);
  assert.ok(Number.isNaN(only.canopyPct));
});

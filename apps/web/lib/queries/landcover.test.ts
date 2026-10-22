import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLandCoverSql, landCoverQuery, rowsToLandCover } from "./landcover";

const parse = (q: Record<string, string>) => landCoverQuery.parse(q);

test("defaults and parsing", () => {
  const p = parse({ bbox: "-122.5,47.5,-122.4,47.6" });
  assert.deepEqual(p.bbox, [-122.5, 47.5, -122.4, 47.6]);
  assert.equal(p.limit, 1000);
  assert.equal(p.simplify, 0);
  assert.equal(p.class, undefined);
  assert.deepEqual(parse({ bbox: "0,0,1,1", class: "forest, water" }).class, ["forest", "water"]);
});

test("rejects bad input", () => {
  for (const q of [
    {},
    { bbox: "0,0,1,1", class: "forest,lava" },
    { bbox: "0,0,1,1", class: "" },
    { bbox: "0,0,1,1", limit: "0" },
    { bbox: "0,0,1,1", limit: "99999" },
    { bbox: "0,0,1,1", simplify: "-1" },
    { bbox: "0,0,1,1", region: "x'; DROP TABLE land_cover;--" },
  ]) {
    assert.equal(landCoverQuery.safeParse(q).success, false, JSON.stringify(q));
  }
});

test("SQL is parameterized: user values never appear in the text", () => {
  const p = parse({ bbox: "0,0,1,1", region: "demo-city", class: "forest,water", simplify: "0.001", limit: "10" });
  const { text, values } = buildLandCoverSql(p);
  assert.deepEqual(values, [0, 0, 1, 1, "demo-city", ["forest", "water"], 0.001, 11]);
  assert.match(text, /region = \$5/);
  assert.match(text, /class = ANY\(\$6::text\[\]\)/);
  assert.match(text, /ST_SimplifyPreserveTopology\(geom, \$7\)/);
  assert.match(text, /LIMIT \$8/);
  assert.ok(!text.includes("demo-city") && !text.includes("forest"));
});

test("minimal query has only the bbox filter and no simplification", () => {
  const { text, values } = buildLandCoverSql(parse({ bbox: "0,0,1,1" }));
  assert.deepEqual(values, [0, 0, 1, 1, 1001]);
  assert.ok(!/region =|ANY|Simplify/.test(text));
});

const geom = { type: "MultiPolygon" as const, coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]] };
const row = (id: number, g: typeof geom | null = geom) => ({
  id: String(id), region: "r", class: "forest", canopy_pct: 50, impervious_pct: 5, area_m2: 10, geometry: g,
});

test("rowsToLandCover maps rows, coerces bigint ids, and flags truncation", () => {
  const fc = rowsToLandCover([row(1), row(2), row(3)], 2);
  assert.equal(fc.features.length, 2);
  assert.equal(fc.truncated, true);
  assert.equal(fc.features[0]!.id, 1);
  assert.equal(fc.features[0]!.properties!.canopy_pct, 50);
  assert.equal(rowsToLandCover([row(1)], 2).truncated, false);
});

test("geometries that collapsed to null are dropped", () => {
  assert.equal(rowsToLandCover([row(1, null), row(2)], 5).features.length, 1);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { type Area, RasterStore } from "@urbanheat/geo-core";
import { ApiError } from "./http";
import { areaFromGetQuery, areaSchema, type CatalogRow, computeRasterStats, MAX_RADIUS_M, statsGetQuery, statsPostBody } from "./raster-stats";

// geo-core's fixtures: grid4.tif is 4x4 over lon 10..14, lat 50..54, value = row*4+col+1 (row 0 north).
const store = new RasterStore(path.resolve(__dirname, "../../../packages/geo-core/test-fixtures"));
const row = (kind: CatalogRow["kind"], file: string): CatalogRow => ({ name: `t-${kind}`, region: "t", kind, path: file, unit: "u" });
const catalog = [row("lst", "grid4.tif"), row("canopy", "grid4-nodata.tif")];
const rect = (w: number, s: number, e: number, n: number): Area => ({ type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] });
const near = (a: number | null, b: number, eps = 1e-4) => assert.ok(a !== null && Math.abs(a - b) < eps, `${a} !~ ${b}`);

test("computes stats for each layer, with no-data excluded", async () => {
  // lon 11..13, lat 51..53 covers cells 6,7,10,11 in both files; canopy file has cell 6 as nodata.
  const r = await computeRasterStats({ catalog, store }, "t", rect(11, 51, 13, 53), undefined, 4);
  assert.deepEqual(Object.keys(r.layers).sort(), ["canopy", "lst"]);
  near(r.layers.lst!.mean, 8.5);
  assert.equal(r.layers.lst!.min, 6);
  assert.equal(r.layers.lst!.max, 11);
  assert.equal(r.layers.lst!.unit, "u");
  assert.equal(r.layers.lst!.name, "t-lst");
  near(r.layers.canopy!.mean, (7 + 10 + 11) / 3);
  near(r.layers.canopy!.nodataShare, 0.25);
  assert.ok(r.areaM2 > 0);
});

test("layer selection and unknown kinds", async () => {
  const only = await computeRasterStats({ catalog, store }, "t", rect(11, 51, 13, 53), ["lst"], 4);
  assert.deepEqual(Object.keys(only.layers), ["lst"]);
  await assert.rejects(computeRasterStats({ catalog, store }, "t", rect(11, 51, 13, 53), ["impervious"], 4), (e) =>
    e instanceof ApiError && e.status === 404 && /no impervious layer/.test(e.message));
  await assert.rejects(computeRasterStats({ catalog: [], store }, "nowhere", rect(11, 51, 13, 53), undefined, 4), (e) =>
    e instanceof ApiError && e.status === 404 && /No raster layers/.test(e.message));
});

test("polygon outside the raster is a 404; partial overlap is clipped", async () => {
  await assert.rejects(computeRasterStats({ catalog, store }, "t", rect(50, 50, 51, 51), undefined, 4), (e) => e instanceof ApiError && e.status === 404);
  const edge = await computeRasterStats({ catalog, store }, "t", rect(13, 50, 20, 51), ["lst"], 4);
  assert.equal(edge.layers.lst!.mean, 16); // only the SE cell is inside
});

test("a catalog entry whose file is gone is a 503, not a leaked path", async () => {
  const log = console.error;
  console.error = () => {};
  try {
    await assert.rejects(computeRasterStats({ catalog: [row("lst", "missing.tif")], store }, "t", rect(11, 51, 13, 53), undefined, 4), (e) =>
      e instanceof ApiError && e.status === 503 && !/missing\.tif/.test(e.message));
  } finally {
    console.error = log;
  }
});

test("all-nodata zones return null statistics rather than NaN", async () => {
  const dead = new RasterStore(path.resolve(__dirname, "../../../packages/geo-core/test-fixtures"));
  const r = await computeRasterStats({ catalog: [row("canopy", "grid4-nodata.tif")], store: dead }, "t", rect(11.1, 52.1, 11.9, 52.9), undefined, 4);
  assert.equal(r.layers.canopy!.mean, null);
  assert.equal(r.layers.canopy!.min, null);
  assert.equal(r.layers.canopy!.nodataShare, 1);
  assert.ok(!JSON.stringify(r).includes("NaN"));
});

test("GET query: point+radius xor bbox", () => {
  const ok = statsGetQuery.parse({ region: "r", point: "-122.4,47.6", radius_m: "500", layers: "lst,canopy" });
  assert.deepEqual(ok.layers, ["lst", "canopy"]);
  assert.equal(areaFromGetQuery(ok).type, "Polygon");
  const box = areaFromGetQuery(statsGetQuery.parse({ region: "r", bbox: "0,0,1,1" })) as { coordinates: number[][][] };
  assert.deepEqual(box.coordinates[0]![2], [1, 1]);
  for (const q of [
    { region: "r" },
    { region: "r", point: "0,0" },
    { region: "r", radius_m: "5" },
    { region: "r", point: "0,0", radius_m: "5", bbox: "0,0,1,1" },
    { region: "r", bbox: "0,0,1,1", radius_m: "5" },
    { region: "r", point: "0,0", radius_m: String(MAX_RADIUS_M + 1) },
    { region: "r", point: "0,0", radius_m: "-1" },
    { region: "r", bbox: "0,0,1,1", layers: "lst,mars" },
    { region: "r", bbox: "0,0,1,1", supersample: "99" },
  ]) assert.equal(statsGetQuery.safeParse(q).success, false, JSON.stringify(q));
});

test("POST geometry validation", () => {
  const good = { region: "r", geometry: rect(0, 0, 1, 1) };
  assert.equal(statsPostBody.safeParse(good).success, true);
  assert.equal(statsPostBody.parse(good).supersample, 4);
  const multi = { type: "MultiPolygon", coordinates: [rect(0, 0, 1, 1).coordinates, rect(2, 2, 3, 3).coordinates] };
  assert.equal(areaSchema.safeParse(multi).success, true);
  for (const geometry of [
    { type: "Point", coordinates: [0, 0] },
    { type: "Polygon", coordinates: [] },
    { type: "Polygon", coordinates: [[[0, 0], [1, 1], [0, 0]]] },
    { type: "Polygon", coordinates: [[[0, 0], [999, 0], [999, 1], [0, 0]]] },
    { type: "Polygon", coordinates: [[["a", 0], [1, 0], [1, 1], [0, 0]]] },
    { type: "Polygon", coordinates: [Array.from({ length: 10_001 }, (_, i) => [i % 100, 0])] },
    "nope",
  ]) assert.equal(areaSchema.safeParse(geometry).success, false, JSON.stringify(geometry).slice(0, 60));
});

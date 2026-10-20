import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RasterStore } from "./raster-store.js";

// Integration check against the generated demo city (db/ingest: demo_city.generate).
// Skipped when data/ has not been generated, since it is gitignored.
const root = fileURLToPath(new URL("../../../data/", import.meta.url));
const have = existsSync(`${root}rasters/demo-city-lst.tif`) && existsSync(`${root}demo-city/stations.json`);
const opts = { skip: have ? false : "demo data not generated (see db/ingest/README.md)" };

test("demo rasters share a grid and have plausible values", opts, async () => {
  const store = new RasterStore(`${root}rasters`);
  const [lst, canopy, imp] = await Promise.all(
    ["lst", "canopy", "impervious"].map((k) => store.get(`demo-city-${k}.tif`)),
  );
  for (const r of [lst!, canopy!, imp!]) {
    assert.deepEqual([r.width, r.height], [240, 180]);
    assert.deepEqual(r.bbox.map((v) => +v.toFixed(4)), [-122.55, 47.55, -122.35, 47.7]);
  }
  const lstStats = (await lst!.read())!.stats();
  assert.equal(lstStats.nodata, 0);
  assert.ok(lstStats.min > 15 && lstStats.max < 45, JSON.stringify(lstStats));
  const c = (await canopy!.read())!.stats();
  assert.ok(c.min >= 0 && c.max <= 100);
  await store.closeAll();
});

test("sampling stations matches a full-grid lookup and tracks surface heat", opts, async () => {
  const store = new RasterStore(`${root}rasters`);
  const lst = await store.get("demo-city-lst.tif");
  const { stations } = JSON.parse(readFileSync(`${root}demo-city/stations.json`, "utf8")) as {
    stations: { lon: number; lat: number }[];
  };
  const pts = stations.map((s) => [s.lon, s.lat] as [number, number]);
  const sampled = await lst.sampleMany(pts);
  const whole = (await lst.read())!;
  assert.deepEqual(sampled, pts.map(([x, y]) => whole.valueAt(x, y)));
  assert.ok(sampled.every((v) => v !== null && v > 15 && v < 45));
  // Whole-raster average downsample to 1 cell == the grid mean.
  const one = (await lst.readResampled(lst.bbox, 1, 1, "average"))!;
  assert.ok(Math.abs(one.data[0]! - whole.stats().mean) < 1e-3);
  await store.closeAll();
});

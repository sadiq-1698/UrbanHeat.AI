import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Area } from "./geometry.js";
import { assertSameGrid, bufferStats, zonalStatsLayers, zonalStatsMany } from "./layers.js";
import { RasterGrid } from "./raster-grid.js";
import { RasterStore } from "./raster-store.js";
import { zonalStats } from "./zonal.js";

const mk = (f: (i: number) => number, bbox: [number, number, number, number] = [0, 0, 10, 10]) =>
  new RasterGrid(Float32Array.from({ length: 100 }, (_, i) => f(i)), 10, 10, bbox);
const rect = (x0: number, y0: number, x1: number, y1: number): Area => ({
  type: "Polygon",
  coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
});

test("assertSameGrid rejects misaligned layers", () => {
  assert.doesNotThrow(() => assertSameGrid({ a: mk((i) => i), b: mk((i) => -i) }));
  assert.throws(() => assertSameGrid({ a: mk((i) => i), b: mk((i) => i, [0, 0, 10, 10.5]) }), /not aligned/);
  assert.throws(() => assertSameGrid({ a: mk((i) => i), b: new RasterGrid(new Float32Array(4), 2, 2, [0, 0, 10, 10]) }), /not aligned/);
  assert.throws(() => assertSameGrid({}), RangeError);
});

test("zonalStatsLayers equals per-layer zonalStats", () => {
  const layers = { a: mk((i) => i), b: mk((i) => 100 - i) };
  const poly = rect(2.5, 2.5, 6.2, 5.1);
  const multi = zonalStatsLayers(layers, poly)!;
  for (const k of ["a", "b"] as const) {
    const single = zonalStats(layers[k], poly)!;
    assert.deepEqual(multi[k], single);
  }
  assert.equal(zonalStatsLayers(layers, rect(50, 50, 51, 51)), null);
});

test("zonalStatsMany keeps order and nulls out misses", () => {
  const out = zonalStatsMany({ a: mk((i) => i) }, [rect(0, 9, 1, 10), rect(80, 80, 81, 81), rect(9, 0, 10, 1)]);
  assert.equal(out[0]!.a!.mean, 0);
  assert.equal(out[1], null);
  assert.equal(out[2]!.a!.mean, 99);
});

test("bufferStats summarizes a metre-radius circle", () => {
  // ~111 km cells at the equator -> a 5 km circle is smaller than a cell: fallback to its centre cell.
  const g = mk((i) => i, [0, 0, 10, 10]);
  const r = bufferStats({ a: g }, 4.5, 4.5, 5000)!;
  assert.equal(r.stats.a!.mean, 5 * 10 + 4);
  assert.equal(r.buffer.type, "Polygon");
  assert.equal(bufferStats({ a: g }, 50, 50, 1000), null);
  assert.throws(() => bufferStats({ a: g }, 4.5, 4.5, -1), RangeError);
});

// Integration on the generated demo city (skipped if data/ hasn't been generated).
const root = fileURLToPath(new URL("../../../data/rasters", import.meta.url));
const haveDemo = existsSync(`${root}/demo-city-lst.tif`);

test("demo city: dense core is hotter, less green than the leafy fringe", { skip: haveDemo ? false : "demo data not generated" }, async () => {
  const store = new RasterStore(root);
  const read = async (k: string) => (await (await store.get(`demo-city-${k}.tif`)).read())!;
  const layers = { lst: await read("lst"), canopy: await read("canopy"), impervious: await read("impervious") };
  const core = bufferStats(layers, -122.45, 47.625, 800)!.stats; // downtown peak of the urban field
  const fringe = bufferStats(layers, -122.38, 47.58, 800)!.stats;
  assert.ok(core.impervious!.mean > fringe.impervious!.mean + 20, `${core.impervious!.mean} vs ${fringe.impervious!.mean}`);
  assert.ok(core.lst!.mean > fringe.lst!.mean + 1, `${core.lst!.mean} vs ${fringe.lst!.mean}`);
  assert.ok(core.canopy!.mean < fringe.canopy!.mean);
  assert.equal(core.lst!.nodataShare, 0);
  await store.closeAll();
});

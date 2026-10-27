import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RasterStore, emptyTilePng, lonLatToTile } from "@urbanheat/geo-core";
import type { Pool } from "pg";
import { ApiError } from "./http";
import { type LayerRow, createTileService, findLayer, legendQuery, tileParams } from "./raster-tiles";

const FIXTURES = path.resolve(__dirname, "../../../packages/geo-core/test-fixtures");
const row = (kind: LayerRow["kind"], file: string): LayerRow => ({ name: `t-${kind}`, path: file, unit: "u", kind });
// grid4.tif spans lon 10..14, lat 50..54 (values 1..16). A z8 tile around (12, 52) is fully inside it.
const inside = lonLatToTile(12, 52, 8);
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

test("tileParams accepts valid tiles (with or without .png) and rejects bad ones", () => {
  const ok = tileParams.parse({ region: "demo-city", kind: "lst", z: "10", x: "164", y: "357.png" });
  assert.deepEqual(ok, { region: "demo-city", kind: "lst", z: 10, x: 164, y: 357 });
  assert.equal(tileParams.parse({ region: "r", kind: "canopy", z: "0", x: "0", y: "0" }).y, 0);
  for (const bad of [
    { region: "r", kind: "lst", z: "3", x: "8", y: "0.png" }, // x out of range for z3
    { region: "r", kind: "lst", z: "23", x: "0", y: "0" },
    { region: "r", kind: "nope", z: "3", x: "1", y: "1" },
    { region: "r", kind: "lst", z: "3", x: "1", y: "1.jpg" },
    { region: "r", kind: "lst", z: "3", x: "-1", y: "1" },
    { region: "r", kind: "lst", z: "3.5", x: "1", y: "1" },
    { region: "../etc", kind: "lst", z: "3", x: "1", y: "1" },
    { region: "r", kind: "toString", z: "3", x: "1", y: "1" },
    { region: "r", kind: "lst", z: "3", x: "1", y: "99999999999" },
  ]) assert.equal(tileParams.safeParse(bad).success, false, JSON.stringify(bad));
  assert.equal(legendQuery.safeParse({ region: "r", kind: "lst" }).success, true);
  assert.equal(legendQuery.safeParse({ region: "r", kind: "x" }).success, false);
});

test("renders a PNG with caching headers, then serves repeats from the LRU", async () => {
  const svc = createTileService(new RasterStore(FIXTURES));
  const a = await svc.tile(row("lst", "grid4.tif"), 8, inside.x, inside.y);
  assert.equal(a.status, 200);
  assert.deepEqual([...a.body!.subarray(1, 4)], [0x50, 0x4e, 0x47]);
  assert.equal(a.headers["Content-Type"], "image/png");
  assert.match(a.headers["Cache-Control"]!, /max-age=\d+/);
  assert.match(a.headers.ETag!, /^W\/"/);
  const b = await svc.tile(row("lst", "grid4.tif"), 8, inside.x, inside.y);
  assert.equal(b.body, a.body); // same Buffer instance => cache hit
});

test("If-None-Match yields 304 without a body; a different tile has a different ETag", async () => {
  const svc = createTileService(new RasterStore(FIXTURES));
  const a = await svc.tile(row("lst", "grid4.tif"), 8, inside.x, inside.y);
  const again = await svc.tile(row("lst", "grid4.tif"), 8, inside.x, inside.y, a.headers.ETag);
  assert.equal(again.status, 304);
  assert.equal(again.body, null);
  assert.equal((await svc.tile(row("lst", "grid4.tif"), 8, inside.x, inside.y, `W/"stale", ${a.headers.ETag}`)).status, 304);
  const other = await svc.tile(row("lst", "grid4.tif"), 8, inside.x + 1, inside.y);
  assert.notEqual(other.headers.ETag, a.headers.ETag);
  assert.equal((await svc.tile(row("lst", "grid4.tif"), 8, inside.x, inside.y, other.headers.ETag)).status, 200);
});

test("tiles that miss the raster are the shared transparent tile", async () => {
  const svc = createTileService(new RasterStore(FIXTURES));
  const far = lonLatToTile(-100, 40, 8);
  const r = await svc.tile(row("lst", "grid4.tif"), 8, far.x, far.y);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, emptyTilePng(256));
  assert.ok(r.body!.length < 400);
});

test("a missing file is a 503 that doesn't leak the path", async () => {
  const svc = createTileService(new RasterStore(FIXTURES));
  const log = console.error;
  console.error = () => {};
  try {
    await assert.rejects(svc.tile(row("lst", "gone.tif"), 8, inside.x, inside.y), (e) => e instanceof ApiError && e.status === 503 && !/gone\.tif/.test(e.message));
    await assert.rejects(svc.legend(row("lst", "gone.tif")), (e) => e instanceof ApiError && e.status === 503);
  } finally {
    console.error = log;
  }
});

test("replacing the GeoTIFF invalidates cached tiles (cache key includes mtime)", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "uh-tiles-"));
  copyFileSync(path.join(FIXTURES, "grid4.tif"), path.join(dir, "layer.tif"));
  const svc = createTileService(new RasterStore(dir));
  const first = await svc.tile(row("lst", "layer.tif"), 8, inside.x, inside.y);
  const t = new Date(Date.now() + 60_000);
  utimesSync(path.join(dir, "layer.tif"), t, t); // simulate a re-ingest
  const second = await svc.tile(row("lst", "layer.tif"), 8, inside.x, inside.y);
  assert.notEqual(second.headers.ETag, first.headers.ETag);
  assert.notEqual(second.body, first.body); // re-rendered, not the stale cached Buffer
  assert.equal((await svc.tile(row("lst", "layer.tif"), 8, inside.x, inside.y, first.headers.ETag)).status, 200); // old ETag no longer matches
});

test("legend: percent layers use fixed 0..100 with an alpha fade; continuous layers derive the domain from the data", async () => {
  const svc = createTileService(new RasterStore(FIXTURES));
  const canopy = await svc.legend(row("canopy", "grid4.tif"));
  assert.deepEqual(canopy.domain, [0, 100]);
  assert.equal(canopy.stops.length, 5);
  assert.equal(canopy.stops[0]!.alpha, 0);
  assert.ok(canopy.stops.at(-1)!.alpha > 0.9);
  assert.match(canopy.stops[0]!.color, /^#[0-9a-f]{6}$/);
  const lst = await svc.legend(row("lst", "grid4.tif")); // values 1..16
  assert.deepEqual(lst.domain, [1, 16]);
  assert.deepEqual(lst.stops.map((s) => s.value), [1, 4.75, 8.5, 12.25, 16]);
  assert.ok(lst.stops.every((s) => s.alpha === 1));
  assert.equal(lst.unit, "u");
});

test("findLayer caches catalog rows briefly, refetches after the TTL, and 404s unknown layers", async () => {
  let calls = 0;
  const hit: LayerRow = row("lst", "x.tif");
  const pool = { query: async (_sql: string, p: unknown[]) => { calls++; return { rows: p[0] === "known" ? [hit] : [] }; } } as unknown as Pool;
  const t0 = 1_000_000;
  assert.equal(await findLayer(pool, "known", "lst", t0), hit);
  assert.equal(await findLayer(pool, "known", "lst", t0 + 10_000), hit);
  assert.equal(calls, 1);
  await findLayer(pool, "known", "lst", t0 + 31_000);
  assert.equal(calls, 2);
  await assert.rejects(findLayer(pool, "other", "lst", t0), (e) => e instanceof ApiError && e.status === 404);
  await assert.rejects(findLayer(pool, "other", "lst", t0 + 1), (e) => e instanceof ApiError && e.status === 404);
  assert.equal(calls, 3); // the miss was cached too
});

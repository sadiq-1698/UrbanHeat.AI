import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { RasterStore } from "./raster-store.js";

const dir = fileURLToPath(new URL("../test-fixtures/", import.meta.url));

test("opens rasters relative to the root and caches handles", async () => {
  const store = new RasterStore(dir);
  const a = await store.get("grid4.tif");
  assert.equal(a.width, 4);
  assert.equal(await store.get("grid4.tif"), a);
  assert.equal(await store.get("./grid4.tif"), a); // same file, different spelling
  await store.closeAll();
});

test("rejects traversal, absolute escapes, and non-tiff files", async () => {
  const store = new RasterStore(dir);
  for (const bad of ["../package.json", "../../../etc/passwd", "/etc/passwd", "make_fixtures.py", "grid4.tif/../../x.tif"]) {
    assert.throws(() => store.get(bad), /not allowed/, bad);
  }
});

test("does not cache failures", async () => {
  const store = new RasterStore(dir);
  await assert.rejects(store.get("missing.tif"));
  await assert.rejects(store.get("grid4-nad83.tif"), /only EPSG:4326/);
  assert.equal((await store.get("grid4.tif")).width, 4); // other entries unaffected
  await assert.rejects(store.get("missing.tif")); // retried, still fails, no stale promise
});

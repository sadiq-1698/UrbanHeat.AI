import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { GeoTiffRaster } from "./geotiff-raster.js";

// Fixtures are GDAL-written (see test-fixtures/make_fixtures.py). grid4.tif is 4x4 over
// lon 10..14, lat 50..54 with value = row*4+col+1 (row 0 = north), nodata -9999.
const fixture = (name: string) => fileURLToPath(new URL(`../test-fixtures/${name}`, import.meta.url));
const open = (name = "grid4.tif") => GeoTiffRaster.open(fixture(name));
const VALUES = Array.from({ length: 16 }, (_, i) => i + 1);
const BBOX = [10, 50, 14, 54];

test("reads georeferencing from the file", async () => {
  const r = await open();
  assert.deepEqual([r.width, r.height], [4, 4]);
  assert.deepEqual(r.bbox, BBOX);
  assert.deepEqual([r.resX, r.resY], [1, 1]);
  assert.equal(r.nodata, -9999);
  r.close();
});

test("read() returns the whole raster or a snapped window", async () => {
  const r = await open();
  const all = (await r.read())!;
  assert.deepEqual(Array.from(all.data), VALUES);
  const win = (await r.read([11, 51, 13, 53]))!;
  assert.deepEqual([win.width, win.height], [2, 2]);
  assert.deepEqual(win.bbox, [11, 51, 13, 53]);
  assert.deepEqual(Array.from(win.data), [6, 7, 10, 11]);
  assert.equal(await r.read([0, 0, 1, 1]), null);
});

test("no-data cells become NaN", async () => {
  const r = await open("grid4-nodata.tif");
  const all = (await r.read())!;
  assert.ok(Number.isNaN(all.data[5]!));
  assert.equal(all.stats().nodata, 1);
  assert.equal(await r.sample(11.5, 52.5), null);
  assert.equal(await r.sample(10.5, 53.5), 1);
});

test("integer rasters are converted to float and nodata applied", async () => {
  const r = await open("grid4-uint8.tif");
  assert.equal(await r.sample(13.5, 50.5), 16);
  assert.equal(r.nodata, 0);
});

test("readResampled averages down to a coarser grid", async () => {
  const r = await open();
  const out = (await r.readResampled(BBOX as never, 2, 2, "average"))!;
  assert.deepEqual(Array.from(out.data), [3.5, 5.5, 11.5, 13.5]);
});

test("sample: nearest, bilinear, outside, and edge points", async () => {
  const r = await open();
  assert.equal(await r.sample(10.5, 53.5), 1);
  assert.equal(await r.sample(13.5, 50.5), 16);
  assert.equal(await r.sample(14, 50), 16); // SE corner
  assert.equal(await r.sample(9, 52), null);
  assert.equal(await r.sample(12, 56), null);
  const mid = await r.sample(11, 53, { method: "bilinear" }); // between 1,2,5,6
  assert.ok(Math.abs(mid! - 3.5) < 1e-5);
  assert.equal(await r.sample(10.1, 53.9, { method: "bilinear" }), 1);
});

test("sampleMany keeps input order and mixes in/out points", async () => {
  const r = await open();
  const out = await r.sampleMany([[13.5, 50.5], [99, 99], [10.5, 53.5], [12.5, 52.5]]);
  assert.deepEqual(out, [16, null, 1, 7]);
  assert.deepEqual(await r.sampleMany([]), []);
  assert.deepEqual(await r.sampleMany([[99, 99]]), [null]);
});

test("tiled, compressed rasters decode correctly across tile borders", async () => {
  const r = await open("ramp-tiled.tif"); // value = row*1000 + col, 0.001° cells from (-122.55, 47.70)
  assert.deepEqual([r.width, r.height], [300, 200]);
  const at = (row: number, col: number) => r.sample(-122.55 + (col + 0.5) * 0.001, 47.7 - (row + 0.5) * 0.001);
  assert.equal(await at(0, 0), 0);
  assert.equal(await at(127, 127), 127127); // last cell of tile (0,0)
  assert.equal(await at(128, 128), 128128); // first cell of tile (1,1)
  assert.equal(await at(199, 299), 199299);
  const win = (await r.read([-122.55 + 0.126, 47.7 - 0.130, -122.55 + 0.130, 47.7 - 0.126]))!; // straddles tiles
  assert.deepEqual([win.width, win.height], [4, 4]);
  assert.equal(win.at(0, 0), 126126);
  assert.equal(win.at(3, 3), 129129);
});

test("sampleMany over a wide spread matches single-point reads", async () => {
  const r = await open("ramp-tiled.tif");
  const pts: [number, number][] = [[-122.5495, 47.6995], [-122.2505, 47.5005], [-122.4, 47.6], [-122.3, 47.65]];
  const many = await r.sampleMany(pts);
  const single = await Promise.all(pts.map(([x, y]) => r.sample(x, y)));
  assert.deepEqual(many, single);
  assert.ok(many.every((v) => v !== null));
});

test("rejects rasters that are not EPSG:4326", async () => {
  await assert.rejects(open("grid4-nad83.tif"), /only EPSG:4326/);
});

test("enforces maxPixels and band range", async () => {
  const r = await open();
  await assert.rejects(r.read(BBOX as never, { maxPixels: 4 }), RangeError);
  await assert.rejects(r.read(BBOX as never, { band: 2 }), /band 2/);
});

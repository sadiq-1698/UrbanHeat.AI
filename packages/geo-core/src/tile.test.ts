import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidTile, pixelLat, pixelLon, tileBBox, tileXToLon, tileYToLat } from "./tile.js";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test("z0 covers the Web Mercator world", () => {
  const [w, s, e, n] = tileBBox(0, 0, 0);
  assert.deepEqual([w, e], [-180, 180]);
  near(n, 85.0511287798, 1e-6);
  near(s, -85.0511287798, 1e-6);
});

test("z1 quadrants split at the equator and prime meridian", () => {
  const [w, s, e, n] = tileBBox(1, 0, 0); // north-west
  assert.deepEqual([w, e], [-180, 0]);
  near(s, 0);
  near(n, 85.0511287798, 1e-6);
  assert.deepEqual(tileBBox(1, 1, 1).slice(0, 3).map((v) => Math.round(v)), [0, -85, 180]);
});

test("known tile: Seattle area at z10", () => {
  // lon -122.33, lat 47.61 -> tile x = floor((lon+180)/360*1024), y from the Mercator formula
  const z = 10;
  const x = Math.floor(((-122.33 + 180) / 360) * 2 ** z);
  const latRad = (47.61 * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 2 ** z);
  assert.deepEqual([x, y], [164, 357]);
  const [w, s, e, n] = tileBBox(z, x, y);
  assert.ok(w <= -122.33 && -122.33 < e && s <= 47.61 && 47.61 < n);
});

test("neighbouring tiles share edges and latitude rows are not evenly spaced", () => {
  const a = tileBBox(8, 100, 100);
  const b = tileBBox(8, 101, 100);
  const c = tileBBox(8, 100, 101);
  assert.equal(a[2], b[0]);
  near(a[1], c[3]);
  // At high latitude a degree of latitude spans more tile height than near the equator: row spacing differs.
  const north = pixelLat(5, 2, 0, 256) - pixelLat(5, 2, 1, 256);
  const equator = pixelLat(5, 15, 0, 256) - pixelLat(5, 15, 1, 256);
  assert.ok(north > 0 && equator > 0 && north !== equator);
});

test("pixel centres lie strictly inside the tile and are monotonic", () => {
  const [w, s, e, n] = tileBBox(12, 656, 1429);
  for (const col of [0, 100, 255]) {
    const lon = pixelLon(12, 656, col, 256);
    assert.ok(lon > w && lon < e);
  }
  const lats = [0, 1, 128, 255].map((r) => pixelLat(12, 1429, r, 256));
  assert.ok(lats.every((l) => l < n && l > s));
  assert.ok(lats[0]! > lats[1]! && lats[1]! > lats[2]! && lats[2]! > lats[3]!);
  near(pixelLon(0, 0, 0, 1), 0); // a single pixel is centred on the world
});

test("tileXToLon / tileYToLat invert the forward formulas", () => {
  near(tileXToLon(0, 3), -180);
  near(tileXToLon(8, 3), 180);
  near(tileYToLat(4, 3), 0);
});

test("isValidTile bounds and types", () => {
  assert.equal(isValidTile(0, 0, 0), true);
  assert.equal(isValidTile(3, 7, 7), true);
  for (const [z, x, y] of [[3, 8, 0], [3, 0, 8], [-1, 0, 0], [23, 0, 0], [1.5, 0, 0], [2, 0.5, 0], [2, -1, 0], [NaN, 0, 0]] as const) {
    assert.equal(isValidTile(z, x, y), false, `${z}/${x}/${y}`);
  }
});

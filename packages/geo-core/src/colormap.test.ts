import { test } from "node:test";
import assert from "node:assert/strict";
import { FIXED_DOMAINS, RAMPS, colorAtValue, colormapForKind, colormapFromHex, isRampKind, percentile, robustDomain } from "./colormap.js";
import { RasterGrid } from "./raster-grid.js";

test("colormapFromHex spaces stops evenly and parses hex with alpha", () => {
  const cm = colormapFromHex([0, 100], ["#000000", "#ff0000", "#ffffff"], [0, 128, 255]);
  assert.deepEqual(cm.stops.map((s) => s.value), [0, 50, 100]);
  assert.deepEqual(cm.stops[1]!.color, [255, 0, 0, 128]);
  assert.deepEqual(colormapFromHex([0, 1], ["#112233", "#445566"]).stops[0]!.color, [17, 34, 51, 255]);
  assert.throws(() => colormapFromHex([0, 1], ["#000000"]), RangeError);
  assert.throws(() => colormapFromHex([1, 1], ["#000000", "#ffffff"]), RangeError);
});

test("colorAtValue hits stops exactly, clamps, and interpolates every channel including alpha", () => {
  const cm = colormapFromHex([0, 10], ["#000000", "#ff8000"], [0, 200]);
  assert.deepEqual(colorAtValue(cm, 0), [0, 0, 0, 0]);
  assert.deepEqual(colorAtValue(cm, 10), [255, 128, 0, 200]);
  assert.deepEqual(colorAtValue(cm, 5), [128, 64, 0, 100]);
  assert.deepEqual(colorAtValue(cm, -5), [0, 0, 0, 0]);
  assert.deepEqual(colorAtValue(cm, 99), [255, 128, 0, 200]);
  const a = colorAtValue(cm, 3);
  a[0] = 7; // returned arrays are copies
  assert.deepEqual(colorAtValue(cm, 3), [77, 38, 0, 60]);
});

test("percentile and robustDomain ignore NaN and resist outliers", () => {
  const vals = Float32Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
  const g = new RasterGrid(vals, 10, 10, [0, 0, 1, 1]);
  assert.equal(percentile(g, 50), 50);
  assert.equal(percentile(g, 100), 100);
  assert.equal(percentile(g, 0), 1);
  const withOutlier = new RasterGrid(Float32Array.from([...Array.from({ length: 98 }, () => 30), 1000, NaN]), 10, 10, [0, 0, 1, 1]);
  assert.deepEqual(robustDomain(withOutlier), [30, 31]); // flat data still gets a non-empty domain
  const spread = new RasterGrid(Float32Array.from({ length: 100 }, (_, i) => 20 + i * 0.1 + (i === 99 ? 500 : 0)), 10, 10, [0, 0, 1, 1]);
  const [lo, hi] = robustDomain(spread);
  assert.ok(lo >= 20 && hi < 40, `${lo}..${hi}`); // the 500 °C outlier doesn't stretch the ramp
  assert.throws(() => robustDomain(new RasterGrid(Float32Array.from([NaN]), 1, 1, [0, 0, 1, 1])), RangeError);
  assert.ok(Number.isNaN(percentile(new RasterGrid(Float32Array.from([NaN]), 1, 1, [0, 0, 1, 1]), 50)));
});

test("percent layers fade to transparent at zero; continuous ones are opaque; kinds are recognised", () => {
  for (const k of ["canopy", "impervious"] as const) {
    assert.equal(colorAtValue(colormapForKind(k, FIXED_DOMAINS[k]!), 0)[3], 0);
    assert.ok(colorAtValue(colormapForKind(k, FIXED_DOMAINS[k]!), 100)[3] > 200);
  }
  assert.equal(colorAtValue(colormapForKind("lst", [20, 40]), 20)[3], 255);
  assert.equal(FIXED_DOMAINS.lst, undefined);
  assert.ok(isRampKind("lst") && isRampKind("elevation") && !isRampKind("toString") && !isRampKind("nope"));
  for (const r of Object.values(RAMPS)) assert.equal(r.colors.length, r.alphas.length);
});

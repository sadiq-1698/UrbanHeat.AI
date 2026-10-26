import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_DATA_COLOR, RAMP, colorAt, colorExpression, formatTemp, niceDomain, rampStops } from "./temperature";

test("niceDomain rounds outward, widens tight clusters, and handles empty/invalid input", () => {
  assert.deepEqual(niceDomain([27.2, 33.8, 30]), [27, 34]);
  assert.deepEqual(niceDomain([30.1, 30.3]), [28, 32]); // widened to 4 °C around the middle
  assert.deepEqual(niceDomain([null, undefined, NaN, 25, 29]), [25, 29]);
  assert.deepEqual(niceDomain([]), [20, 40]);
  assert.deepEqual(niceDomain([null]), [20, 40]);
  const [lo, hi] = niceDomain([31, 31]);
  assert.ok(hi - lo >= 4 && lo <= 31 && hi >= 31);
});

test("rampStops are evenly spaced and cover the domain", () => {
  const s = rampStops([20, 40]);
  assert.deepEqual(s.map(([t]) => t), [20, 25, 30, 35, 40]);
  assert.deepEqual(s.map(([, c]) => c), [...RAMP]);
});

test("colorAt hits stop colors exactly, clamps, and blends in between", () => {
  assert.equal(colorAt(20, [20, 40]), RAMP[0]);
  assert.equal(colorAt(40, [20, 40]), RAMP[4]);
  assert.equal(colorAt(30, [20, 40]), RAMP[2]);
  assert.equal(colorAt(-50, [20, 40]), RAMP[0]);
  assert.equal(colorAt(99, [20, 40]), RAMP[4]);
  const mid = colorAt(27.5, [20, 40]); // halfway between stop 1 (#abd9e9) and stop 2 (#ffffbf)
  assert.equal(mid, "#d5ecd4");
  assert.match(mid, /^#[0-9a-f]{6}$/);
});

test("hotter temperatures are redder: red channel rises, blue channel falls across the ramp", () => {
  const rgb = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const cold = rgb(colorAt(21, [20, 40]));
  const hot = rgb(colorAt(39, [20, 40]));
  assert.ok(hot[0]! > cold[0]!);
  assert.ok(hot[2]! < cold[2]!);
});

test("colorExpression guards null temperatures", () => {
  const e = colorExpression([20, 40]) as unknown[];
  assert.equal(e[0], "case");
  assert.deepEqual(e[1], ["==", ["typeof", ["get", "temp_c"]], "number"]);
  const interp = e[2] as unknown[];
  assert.deepEqual(interp.slice(0, 3), ["interpolate", ["linear"], ["get", "temp_c"]]);
  assert.equal(interp.length, 3 + 10); // 5 stops x (temp, color)
  assert.equal(e[3], NO_DATA_COLOR);
});

test("formatTemp", () => {
  assert.equal(formatTemp(28.08), "28.1 °C");
  assert.equal(formatTemp(28.08, 2), "28.08 °C");
  assert.equal(formatTemp(null), "—");
  assert.equal(formatTemp(NaN), "—");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { INTENSITY_EXPRESSION, MIN_WEIGHT, RADIUS_EXPRESSION, colorExpression, weightExpression } from "./heatmap";
import { RAMP } from "./temperature";

test("weightExpression maps the temperature domain to [MIN_WEIGHT, 1] and ignores missing readings", () => {
  const e = weightExpression([27, 33]) as unknown[];
  assert.equal(e[0], "case");
  assert.deepEqual(e[1], ["==", ["typeof", ["get", "temp_c"]], "number"]);
  assert.deepEqual(e[2], ["interpolate", ["linear"], ["get", "temp_c"], 27, MIN_WEIGHT, 33, 1]);
  assert.equal(e[3], 0);
  assert.ok(MIN_WEIGHT > 0 && MIN_WEIGHT < 0.5);
});

test("colorExpression is a valid, increasing density ramp from transparent to the hot end", () => {
  const e = colorExpression();
  assert.deepEqual(e.slice(0, 3), ["interpolate", ["linear"], ["heatmap-density"]]);
  const pairs = e.slice(3);
  assert.equal(pairs.length % 2, 0);
  const stops = pairs.filter((_, i) => i % 2 === 0) as number[];
  assert.equal(stops[0], 0);
  assert.ok(stops.every((s, i) => i === 0 || s > stops[i - 1]!), `strictly increasing: ${stops}`);
  assert.ok(stops.at(-1)! <= 1);
  const colors = pairs.filter((_, i) => i % 2 === 1) as string[];
  assert.match(colors[0]!, /, 0\)$/); // fully transparent at zero density
  const alpha = (c: string) => Number(c.match(/, ([\d.]+)\)$/)![1]);
  assert.ok(colors.slice(1).every((c, i) => alpha(c) > 0 && (i === 0 || alpha(c) >= alpha(colors[i]!))), "alpha never decreases above zero");
  // ends on the hottest ramp colour (#d7191c = 215, 25, 28)
  assert.ok(RAMP.at(-1) === "#d7191c" && colors.at(-1)!.startsWith("rgba(215, 25, 28"));
  assert.ok(colors[1]!.startsWith("rgba(44, 123, 182")); // starts at the cool blue
});

test("radius and intensity grow with zoom", () => {
  for (const e of [RADIUS_EXPRESSION, INTENSITY_EXPRESSION]) {
    assert.deepEqual(e.slice(0, 3), ["interpolate", ["linear"], ["zoom"]]);
    const vals = e.slice(3).filter((_, i) => i % 2 === 1) as number[];
    assert.ok(vals.every((v, i) => i === 0 || v > vals[i - 1]!));
  }
});

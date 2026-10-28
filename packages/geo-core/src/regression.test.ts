import { test } from "node:test";
import assert from "node:assert/strict";
import { fitLinear, predictLinear } from "./regression.js";

const near = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

// Deterministic pseudo-random so tests are stable.
const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

test("recovers coefficients of a noise-free linear relationship in original units", () => {
  const r = rng(1);
  const X = Array.from({ length: 40 }, () => [r() * 100, r() * 50 - 20, r() * 1000]);
  const y = X.map(([a, b, c]) => 3 + 0.5 * a! - 0.2 * b! + 0.004 * c!);
  const m = fitLinear(X, y, { ridge: 1e-9 });
  near(m.coefficients[0]!, 3, 1e-3);
  near(m.coefficients[1]!, 0.5, 1e-4);
  near(m.coefficients[2]!, -0.2, 1e-4);
  near(m.coefficients[3]!, 0.004, 1e-5);
  near(m.r2, 1, 1e-6);
  near(m.rmse, 0, 1e-3);
  near(predictLinear(m, [10, 5, 200]), 3 + 5 - 1 + 0.8, 1e-3);
});

test("noisy data: r2 and rmse reflect the noise, and the slope is still close", () => {
  const r = rng(7);
  const X = Array.from({ length: 200 }, () => [r() * 10]);
  const y = X.map(([a]) => 2 * a! + 1 + (r() - 0.5) * 2); // uniform noise sd ~0.58
  const m = fitLinear(X, y);
  near(m.coefficients[1]!, 2, 0.05);
  assert.ok(m.r2 > 0.95 && m.r2 < 1);
  assert.ok(m.rmse > 0.4 && m.rmse < 0.7, `${m.rmse}`);
});

test("a constant feature gets coefficient 0 and does not break the fit", () => {
  const X = [[1, 5], [2, 5], [3, 5], [4, 5]];
  const m = fitLinear(X, [2, 4, 6, 8], { ridge: 1e-9 });
  assert.equal(m.coefficients[2], 0);
  near(m.coefficients[1]!, 2, 1e-4);
  near(predictLinear(m, [10, 5]), 20, 1e-3);
});

test("collinear features and fewer samples than features stay finite with ridge", () => {
  const X = [[1, 2, 3], [2, 4, 6], [3, 6, 9], [4, 8, 12]]; // col2 = 2*col1, col3 = 3*col1
  const m = fitLinear(X, [1, 2, 3, 4]);
  assert.ok(m.coefficients.every(Number.isFinite));
  near(predictLinear(m, [5, 10, 15]), 5, 0.05);
  const few = fitLinear([[1, 2, 3, 4, 5]], [10]); // 1 sample, 5 features
  assert.ok(few.coefficients.every(Number.isFinite));
  near(predictLinear(few, [1, 2, 3, 4, 5]), 10, 0.05);
});

test("a single sample or constant y yields the mean and NaN r2", () => {
  const m = fitLinear([[1], [2], [3]], [5, 5, 5]);
  near(m.coefficients[0]!, 5);
  near(m.coefficients[1]!, 0);
  assert.ok(Number.isNaN(m.r2));
});

test("rejects malformed input", () => {
  assert.throws(() => fitLinear([], []), RangeError);
  assert.throws(() => fitLinear([[1]], [1, 2]), RangeError);
  assert.throws(() => fitLinear([[1], [2, 3]], [1, 2]), RangeError);
  assert.throws(() => fitLinear([[NaN]], [1]), RangeError);
  assert.throws(() => predictLinear({ coefficients: [1, 2] }, [1, 2]), RangeError);
});

test("ridge shrinks coefficients toward zero", () => {
  const r = rng(3);
  const X = Array.from({ length: 30 }, () => [r(), r()]);
  const y = X.map(([a, b]) => 10 * a! + 5 * b!);
  const loose = fitLinear(X, y, { ridge: 1e-9 });
  const tight = fitLinear(X, y, { ridge: 5 });
  assert.ok(Math.abs(tight.coefficients[1]!) < Math.abs(loose.coefficients[1]!));
});

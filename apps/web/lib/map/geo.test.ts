import { test } from "node:test";
import assert from "node:assert/strict";
import { bboxContains, bboxToParam, padBBox, unionBBox, viewportToBBox } from "./geo";

const bounds = (w: number, s: number, e: number, n: number) => ({ getWest: () => w, getSouth: () => s, getEast: () => e, getNorth: () => n });

test("unionBBox", () => {
  assert.equal(unionBBox([]), null);
  assert.deepEqual(unionBBox([[0, 0, 1, 1], [-2, 0.5, 0.5, 3]]), [-2, 0, 1, 3]);
  const one: [number, number, number, number] = [1, 2, 3, 4];
  const u = unionBBox([one])!;
  assert.deepEqual(u, one);
  assert.notEqual(u, one); // a copy, not the caller's array
});

test("viewportToBBox clamps out-of-range viewports so the API accepts them", () => {
  assert.deepEqual(viewportToBBox(bounds(-122.6, 47.5, -122.3, 47.7)), [-122.6, 47.5, -122.3, 47.7]);
  assert.deepEqual(viewportToBBox(bounds(-540, -89, 540, 95)), [-180, -89, 180, 90]);
});

test("bboxContains and padBBox", () => {
  assert.equal(bboxContains([0, 0, 10, 10], [1, 1, 9, 9]), true);
  assert.equal(bboxContains([0, 0, 10, 10], [1, 1, 11, 9]), false);
  assert.equal(bboxContains([0, 0, 10, 10], [0, 0, 10, 10]), true);
  assert.deepEqual(padBBox([0, 0, 10, 20], 0.1), [-1, -2, 11, 22]);
  assert.deepEqual(padBBox([-179, -89, 179, 89], 0.5), [-180, -90, 180, 90]);
});

test("bboxToParam trims float noise", () => {
  assert.equal(bboxToParam([-122.55, 47.550000000000004, -122.35, 47.7]), "-122.55,47.55,-122.35,47.7");
  assert.equal(bboxToParam([-122.123456789, 47.1, -122, 47.2]), "-122.12346,47.1,-122,47.2");
});

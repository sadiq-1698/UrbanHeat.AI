import { test } from "node:test";
import assert from "node:assert/strict";
import { statusText } from "./status";

test("statusText covers every state", () => {
  assert.equal(statusText({ state: "ready", count: 92, truncated: false }, false), "Hidden");
  assert.equal(statusText({ state: "loading", count: 0, truncated: false }, true), "Loading…");
  assert.equal(statusText({ state: "loading", count: 12, truncated: false }, true), "Updating… (12 polygons shown)");
  assert.equal(statusText({ state: "ready", count: 92, truncated: false }, true), "92 polygons");
  assert.equal(statusText({ state: "ready", count: 1, truncated: false }, true), "1 polygon");
  assert.match(statusText({ state: "ready", count: 2000, truncated: true }, true), /truncated, zoom in/);
  assert.match(statusText({ state: "error", count: 0, truncated: false, message: "HTTP 500" }, true), /HTTP 500/);
  assert.match(statusText({ state: "error", count: 0, truncated: false }, true), /unknown error/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { statusText, stationsStatusText } from "./status";

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


test("stationsStatusText covers every state", () => {
  const d: [number, number] = [20, 40];
  assert.equal(stationsStatusText({ state: "ready", count: 24, withReading: 24, domain: d }, false), "Hidden");
  assert.equal(stationsStatusText({ state: "loading", count: 0, withReading: 0, domain: d }, true), "Loading…");
  assert.equal(stationsStatusText({ state: "ready", count: 24, withReading: 24, domain: d }, true), "24 stations");
  assert.equal(stationsStatusText({ state: "ready", count: 1, withReading: 1, domain: d }, true), "1 station");
  assert.equal(stationsStatusText({ state: "ready", count: 24, withReading: 20, domain: d }, true), "20 of 24 stations have a reading");
  assert.equal(stationsStatusText({ state: "ready", count: 0, withReading: 0, domain: d }, true), "No stations in this region");
  assert.match(stationsStatusText({ state: "error", count: 0, withReading: 0, domain: d, message: "HTTP 500" }, true), /HTTP 500/);
});

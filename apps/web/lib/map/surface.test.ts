import { test } from "node:test";
import assert from "node:assert/strict";
import { interpolateQuery } from "../interpolation";
import { LATEST } from "./stations";
import { accuracyNote, imageCoordinates, methodSummary, parseSurfaceHeaders, surfaceUrl } from "./surface";

const headers = (o: Record<string, string>) => new Headers(o);
const GOOD = { "X-Temp-Min": "27", "X-Temp-Max": "35", "X-Bbox": "-122.55,47.55,-122.35,47.7", "X-Method": "regression", "X-Stations": "24", "X-Cv-Rmse": "0.504", "X-Cv-Idw-Rmse": "0.965", "X-Water-Masked-Cells": "271", "X-Extrapolated-Share": "0.166" };

test("surfaceUrl builds requests the API accepts for every reading mode and method", () => {
  for (const mode of [LATEST, { kind: "hour", date: "2025-07-15", hour: 7 }, { kind: "day", date: "2025-07-15", agg: "mean" }] as const) {
    for (const method of ["auto", "idw", "regression"] as const) {
      const u = new URL(surfaceUrl("demo-city", mode, method), "http://x");
      assert.equal(u.pathname, "/api/interpolate");
      const parsed = interpolateQuery.safeParse(Object.fromEntries(u.searchParams));
      assert.equal(parsed.success, true, `${mode.kind}/${method}: ${JSON.stringify(parsed.error?.issues)}`);
      assert.equal(parsed.data!.format, "png");
    }
  }
  const hour = new URL(surfaceUrl("r", { kind: "hour", date: "2025-07-15", hour: 9 }, "idw", 128), "http://x");
  assert.equal(hour.searchParams.get("at"), "2025-07-15T09:00:00Z");
  assert.equal(hour.searchParams.get("size"), "128");
  assert.equal(hour.searchParams.has("date"), false);
});

test("imageCoordinates are TL, TR, BR, BL", () => {
  assert.deepEqual(imageCoordinates([-122.55, 47.55, -122.35, 47.7]), [[-122.55, 47.7], [-122.35, 47.7], [-122.35, 47.55], [-122.55, 47.55]]);
});

test("parseSurfaceHeaders reads the API's metadata and rejects malformed responses", () => {
  const m = parseSurfaceHeaders(headers(GOOD))!;
  assert.deepEqual(m.domain, [27, 35]);
  assert.deepEqual(m.bbox, [-122.55, 47.55, -122.35, 47.7]);
  assert.equal(m.method, "regression");
  assert.equal(m.stations, 24);
  assert.equal(m.cvRmse, 0.504);
  assert.equal(m.idwRmse, 0.965);
  assert.equal(m.waterMaskedCells, 271);
  assert.equal(m.extrapolatedShare, 0.166);
  const idw = parseSurfaceHeaders(headers({ ...GOOD, "X-Method": "idw", "X-Cv-Rmse": "", "X-Extrapolated-Share": "" }))!;
  assert.equal(idw.cvRmse, null);
  assert.equal(idw.extrapolatedShare, null);
  for (const bad of [{ ...GOOD, "X-Temp-Min": "40" }, { ...GOOD, "X-Temp-Max": "" }, { ...GOOD, "X-Bbox": "1,2,3" }, { ...GOOD, "X-Method": "magic" }, { ...GOOD, "X-Temp-Min": "NaN" }]) {
    assert.equal(parseSurfaceHeaders(headers(bad)), null, JSON.stringify(bad));
  }
  assert.equal(parseSurfaceHeaders(headers({})), null);
});

test("accuracyNote and methodSummary state the numbers plainly", () => {
  const m = parseSurfaceHeaders(headers(GOOD))!;
  assert.equal(accuracyNote(m), `Held-out error (each station predicted from the others): 0.50 °C with regression vs ${(0.965).toFixed(2)} °C for plain IDW.`);
  assert.equal(methodSummary(m), "Regression · 24 stations · 17% extrapolated");
  const idw = parseSurfaceHeaders(headers({ ...GOOD, "X-Method": "idw", "X-Cv-Rmse": "0.965", "X-Extrapolated-Share": "" }))!;
  assert.equal(accuracyNote(idw), `Held-out error (each station predicted from the others): ${(0.965).toFixed(2)} °C.`);
  assert.equal(methodSummary(idw), "IDW · 24 stations");
  const few = parseSurfaceHeaders(headers({ ...GOOD, "X-Method": "idw", "X-Cv-Rmse": "", "X-Stations": "2", "X-Extrapolated-Share": "" }))!;
  assert.match(accuracyNote(few), /too few stations/);
  assert.match(methodSummary({ ...few, extrapolatedShare: 0 }), /^IDW · 2 stations$/);
});

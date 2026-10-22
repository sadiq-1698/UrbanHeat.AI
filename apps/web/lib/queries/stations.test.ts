import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStationsSql, rowsToStations, stationsQuery } from "./stations";

const parse = (q: Record<string, string>) => stationsQuery.parse(q);

test("defaults: latest reading per station, no filters", () => {
  const p = parse({});
  assert.equal(p.agg, "max");
  assert.equal(p.observed_only, false);
  const { text, values } = buildStationsSql(p);
  assert.deepEqual(values, [1001]);
  assert.match(text, /DISTINCT ON \(station_id\)/);
  assert.ok(!/WHERE s\./.test(text) && !/WHERE o\./.test(text));
});

test("`at` selects an exact timestamp; params stay out of the SQL text", () => {
  const { text, values } = buildStationsSql(parse({ at: "2025-07-15T22:00:00Z", bbox: "0,0,1,1", region: "demo-city", observed_only: "true" }));
  assert.deepEqual(values, [0, 0, 1, 1, "demo-city", "2025-07-15T22:00:00Z", 1001]);
  assert.match(text, /observed_at = \$6/);
  assert.match(text, /o\.station_id IS NOT NULL/);
  assert.ok(!text.includes("2025") && !text.includes("demo-city"));
});

test("`date` aggregates over a UTC day with the chosen function", () => {
  for (const [agg, fn] of [["max", "max"], ["mean", "avg"], ["min", "min"]] as const) {
    const { text, values } = buildStationsSql(parse({ date: "2025-07-15", agg }));
    assert.deepEqual(values, ["2025-07-15", 1001]);
    assert.match(text, new RegExp(`${fn}\\(temp_c\\)`));
    assert.match(text, /AT TIME ZONE 'UTC'/);
  }
});

test("rejects conflicting or malformed time params", () => {
  for (const q of [
    { at: "2025-07-15T22:00:00Z", date: "2025-07-15" },
    { at: "yesterday" },
    { at: "2025-07-15 22:00" },
    { date: "07/15/2025" },
    { date: "2025-02-31" },
    { date: "2025-07-15", agg: "sum" },
    { observed_only: "maybe" },
    { limit: "0" },
  ]) {
    assert.equal(stationsQuery.safeParse(q).success, false, JSON.stringify(q));
  }
});

test("rowsToStations builds point features and handles stations without readings", () => {
  const base = { station_id: "A", name: "A", region: "r", elevation_m: 5, source: "synthetic", lon: -122.4, lat: 47.6 };
  const fc = rowsToStations([
    { ...base, observed_at: new Date("2025-07-15T22:00:00Z"), temp_c: 31.2, humidity_pct: 40, wind_ms: 2, n_obs: 1 },
    { ...base, station_id: "B", observed_at: null, temp_c: null, humidity_pct: null, wind_ms: null, n_obs: null },
    { ...base, station_id: "C", observed_at: null, temp_c: null, humidity_pct: null, wind_ms: null, n_obs: null },
  ], 2);
  assert.equal(fc.features.length, 2);
  assert.equal(fc.truncated, true);
  assert.deepEqual(fc.features[0]!.geometry.coordinates, [-122.4, 47.6]);
  assert.equal(fc.features[0]!.properties!.observed_at, "2025-07-15T22:00:00.000Z");
  assert.equal(fc.features[1]!.properties!.temp_c, null);
  assert.equal(fc.features[1]!.properties!.n_obs, 0);
});

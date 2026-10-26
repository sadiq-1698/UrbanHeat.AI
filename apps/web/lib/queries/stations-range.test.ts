import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStationsRangeSql, rowToRange, stationsRangeQuery } from "./stations-range";

test("requires a slug region", () => {
  assert.equal(stationsRangeQuery.safeParse({}).success, false);
  assert.equal(stationsRangeQuery.safeParse({ region: "x'; --" }).success, false);
  assert.equal(stationsRangeQuery.parse({ region: "demo-city" }).region, "demo-city");
});

test("SQL is parameterized by region only", () => {
  const sql = buildStationsRangeSql();
  assert.match(sql, /s\.region = \$1/);
  assert.match(sql, /LEFT JOIN station_observations/); // stations without readings still count
});

test("rowToRange formats timestamps, sorts days, and handles empty regions", () => {
  const r = rowToRange("r", { stations: 2, observations: 5, first: new Date("2025-07-15T00:00:00Z"), last: new Date("2025-07-16T05:00:00Z"), days: ["2025-07-16", "2025-07-15"] });
  assert.deepEqual(r, { region: "r", stations: 2, observations: 5, first: "2025-07-15T00:00:00.000Z", last: "2025-07-16T05:00:00.000Z", days: ["2025-07-15", "2025-07-16"] });
  assert.deepEqual(rowToRange("r", { stations: 3, observations: 0, first: null, last: null, days: [] }), { region: "r", stations: 3, observations: 0, first: null, last: null, days: [] });
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { stationsQuery } from "../queries/stations";
import { LATEST, defaultMode, describeMode, hourToIso, latestDay, stationPopup, stationsUrl, withAgg, withDate, withHour } from "./stations";

test("stationsUrl builds requests the API accepts, for every mode", () => {
  const modes = [LATEST, { kind: "hour", date: "2025-07-15", hour: 7 }, { kind: "day", date: "2025-07-15", agg: "mean" }] as const;
  for (const mode of modes) {
    const u = new URL(stationsUrl("demo-city", mode), "http://x");
    assert.equal(u.pathname, "/api/stations");
    const parsed = stationsQuery.safeParse(Object.fromEntries(u.searchParams));
    assert.equal(parsed.success, true, `${mode.kind}: ${JSON.stringify(parsed.error?.issues)}`);
  }
  const hour = new URL(stationsUrl("r", { kind: "hour", date: "2025-07-15", hour: 7 }), "http://x");
  assert.equal(hour.searchParams.get("at"), "2025-07-15T07:00:00Z");
  assert.equal(hour.searchParams.has("date"), false);
  const day = new URL(stationsUrl("r", { kind: "day", date: "2025-07-15", agg: "min" }), "http://x");
  assert.equal(day.searchParams.get("agg"), "min");
  assert.equal(day.searchParams.has("at"), false);
  const latest = new URL(stationsUrl("r", LATEST), "http://x");
  assert.equal(latest.searchParams.has("at") || latest.searchParams.has("date"), false);
});

test("hourToIso pads and describeMode reads well", () => {
  assert.equal(hourToIso("2025-07-15", 0), "2025-07-15T00:00:00Z");
  assert.equal(describeMode(LATEST), "Latest reading");
  assert.equal(describeMode({ kind: "hour", date: "2025-07-15", hour: 9 }), "2025-07-15 09:00 UTC");
  assert.equal(describeMode({ kind: "day", date: "2025-07-15", agg: "max" }), "Daily max, 2025-07-15 (UTC)");
});

test("defaultMode falls back to latest without a day", () => {
  assert.deepEqual(defaultMode("hour", undefined), LATEST);
  assert.deepEqual(defaultMode("hour", "2025-07-15"), { kind: "hour", date: "2025-07-15", hour: 22 });
  assert.deepEqual(defaultMode("day", "2025-07-15", "mean"), { kind: "day", date: "2025-07-15", agg: "mean" });
  assert.deepEqual(defaultMode("latest", "2025-07-15"), LATEST);
});

test("stationPopup: a reading, a daily aggregate, and a station with no reading", () => {
  const base = { station_id: "A", name: "Demo Station 01", humidity_pct: 40.4, wind_ms: 2.25, elevation_m: 61.1, source: "synthetic" };
  const at = stationPopup({ ...base, temp_c: 31.24, observed_at: "2025-07-15T22:00:00.000Z", n_obs: 1 }, { kind: "hour", date: "2025-07-15", hour: 22 });
  assert.equal(at.title, "Demo Station 01");
  assert.equal(at.subtitle, "2025-07-15 22:00 UTC");
  assert.deepEqual(at.rows.map((r) => r.value), ["31.2 °C", "40%", "2.3 m/s", "61 m", "synthetic"]);
  const day = stationPopup({ ...base, temp_c: 33, observed_at: null, n_obs: 24 }, { kind: "day", date: "2025-07-15", agg: "max" });
  assert.equal(day.subtitle, "Daily max, 2025-07-15 (UTC) · 24 readings");
  const none = stationPopup({ ...base, temp_c: null, humidity_pct: null, wind_ms: null, observed_at: null, n_obs: 0 }, LATEST);
  assert.match(none.subtitle, /No reading/);
  assert.equal(none.rows[0]!.value, "—");
  assert.equal(stationPopup({}, LATEST).title, "Station");
});


test("mode editors only touch the fields their kind has", () => {
  const hour = { kind: "hour", date: "2025-07-15", hour: 22 } as const;
  const day = { kind: "day", date: "2025-07-15", agg: "max" } as const;
  assert.deepEqual(withDate(hour, "2025-07-16"), { kind: "hour", date: "2025-07-16", hour: 22 });
  assert.deepEqual(withDate(day, "2025-07-16"), { kind: "day", date: "2025-07-16", agg: "max" });
  assert.deepEqual(withDate(LATEST, "2025-07-16"), LATEST);
  assert.deepEqual(withHour(hour, 3.6), { kind: "hour", date: "2025-07-15", hour: 4 });
  assert.deepEqual(withHour(hour, 99), { kind: "hour", date: "2025-07-15", hour: 23 });
  assert.deepEqual(withHour(hour, -5), { kind: "hour", date: "2025-07-15", hour: 0 });
  assert.deepEqual(withHour(day, 5), day);
  assert.deepEqual(withAgg(day, "min"), { kind: "day", date: "2025-07-15", agg: "min" });
  assert.deepEqual(withAgg(hour, "min"), hour);
});

test("latestDay picks the last day or nothing", () => {
  assert.equal(latestDay(["2025-07-14", "2025-07-15"]), "2025-07-15");
  assert.equal(latestDay([]), undefined);
});

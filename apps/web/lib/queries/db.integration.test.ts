import { after, before, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { config } from "dotenv";
import { Pool } from "pg";
import { fetchLandCover, landCoverQuery } from "./landcover";
import { fetchStations, stationsQuery } from "./stations";

// Runs against the demo city loaded by db/ingest; skips when the DB (or data) isn't there.
config({ path: path.resolve(__dirname, "../../../../.env"), quiet: true });

let pool: Pool | undefined;
let skip: string | false = "no APP_DATABASE_URL";

before(async () => {
  if (!process.env.APP_DATABASE_URL) return;
  const p = new Pool({ connectionString: process.env.APP_DATABASE_URL, connectionTimeoutMillis: 2000 });
  try {
    const { rows } = await p.query("SELECT count(*)::int AS n FROM land_cover WHERE region = 'demo-city'");
    if (rows[0].n > 0) {
      pool = p;
      skip = false;
    } else {
      skip = "demo-city not loaded (see db/ingest/README.md)";
      await p.end();
    }
  } catch (e) {
    skip = `database unreachable: ${(e as Error).message}`;
    await p.end().catch(() => {});
  }
});
after(async () => {
  await pool?.end();
});

/** Skips the calling test (reported as skipped, not passed) when the DB probe in `before` failed. */
const ready = (t: TestContext): boolean => {
  if (skip) t.skip(skip);
  return !skip;
};

const BBOX = "-122.55,47.55,-122.35,47.7";

test("landcover: whole demo bbox returns every polygon", async (t) => {
  if (!ready(t)) return;
  const fc = await fetchLandCover(pool!, landCoverQuery.parse({ bbox: BBOX, region: "demo-city" }));
  assert.equal(fc.features.length, 92);
  assert.equal(fc.truncated, false);
  assert.equal(fc.features[0]!.geometry.type, "MultiPolygon");
  assert.equal(typeof fc.features[0]!.properties!.canopy_pct, "number");
});

test("landcover: class filter, limit/truncation, simplify, and empty bbox", async (t) => {
  if (!ready(t)) return;
  const water = await fetchLandCover(pool!, landCoverQuery.parse({ bbox: BBOX, class: "water" }));
  assert.ok(water.features.length >= 1 && water.features.every((f) => f.properties!.class === "water"));
  const some = await fetchLandCover(pool!, landCoverQuery.parse({ bbox: BBOX, limit: "5" }));
  assert.equal(some.features.length, 5);
  assert.equal(some.truncated, true);
  const exact = await fetchLandCover(pool!, landCoverQuery.parse({ bbox: BBOX, class: "developed_high" }));
  const simp = await fetchLandCover(pool!, landCoverQuery.parse({ bbox: BBOX, class: "developed_high", simplify: "0.01" }));
  const verts = (fc: typeof exact) => JSON.stringify(fc.features.map((f) => f.geometry.coordinates)).split("],[").length;
  assert.ok(verts(simp) < verts(exact));
  const none = await fetchLandCover(pool!, landCoverQuery.parse({ bbox: "10,10,11,11" }));
  assert.equal(none.features.length, 0);
});

test("landcover: a hostile region value is just a non-matching string", async (t) => {
  if (!ready(t)) return;
  // Bypass the zod slug check to prove the SQL layer itself is parameterized.
  const p = { ...landCoverQuery.parse({ bbox: BBOX }), region: "x' OR '1'='1" };
  assert.equal((await fetchLandCover(pool!, p)).features.length, 0);
});

test("stations: latest reading by default; at/date modes agree with the data", async (t) => {
  if (!ready(t)) return;
  const latest = await fetchStations(pool!, stationsQuery.parse({ region: "demo-city" }));
  assert.equal(latest.features.length, 24);
  assert.ok(latest.features.every((f) => typeof f.properties!.temp_c === "number"));
  const at = await fetchStations(pool!, stationsQuery.parse({ region: "demo-city", at: "2025-07-15T22:00:00Z" }));
  assert.equal(at.features.length, 24);
  assert.ok(at.features.every((f) => f.properties!.n_obs === 1 && f.properties!.observed_at === "2025-07-15T22:00:00.000Z"));
  const max = await fetchStations(pool!, stationsQuery.parse({ region: "demo-city", date: "2025-07-15", agg: "max" }));
  const min = await fetchStations(pool!, stationsQuery.parse({ region: "demo-city", date: "2025-07-15", agg: "min" }));
  for (let i = 0; i < 24; i++) {
    assert.equal(max.features[i]!.properties!.n_obs, 24);
    assert.ok(max.features[i]!.properties!.temp_c > min.features[i]!.properties!.temp_c);
    assert.ok(max.features[i]!.properties!.temp_c >= at.features[i]!.properties!.temp_c);
  }
});

test("stations: observed_only and day boundaries", async (t) => {
  if (!ready(t)) return;
  const none = await fetchStations(pool!, stationsQuery.parse({ region: "demo-city", at: "2030-01-01T00:00:00Z" }));
  assert.equal(none.features.length, 24);
  assert.ok(none.features.every((f) => f.properties!.temp_c === null));
  const dropped = await fetchStations(pool!, stationsQuery.parse({ region: "demo-city", at: "2030-01-01T00:00:00Z", observed_only: "true" }));
  assert.equal(dropped.features.length, 0);
  const nextDay = await fetchStations(pool!, stationsQuery.parse({ region: "demo-city", date: "2025-07-16", observed_only: "true" }));
  assert.equal(nextDay.features.length, 0);
});

test("stations: bbox filter", async (t) => {
  if (!ready(t)) return;
  const west = await fetchStations(pool!, stationsQuery.parse({ bbox: "-122.55,47.55,-122.45,47.7" }));
  const east = await fetchStations(pool!, stationsQuery.parse({ bbox: "-122.45,47.55,-122.35,47.7" }));
  assert.ok(west.features.length > 0 && east.features.length > 0);
  assert.ok(west.features.length + east.features.length >= 24);
  assert.ok(west.features.every((f) => f.geometry.coordinates[0]! <= -122.45));
});

import { after, before, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { Pool } from "pg";
import { RasterStore } from "@urbanheat/geo-core";
import { interpolateQuery, runInterpolation } from "./interpolation";

// Needs the loaded demo city (stations, land cover, rasters); reports skips otherwise.
const ROOT = path.resolve(__dirname, "../../..");
config({ path: path.join(ROOT, ".env"), quiet: true });
const RASTER_DIR = path.join(ROOT, "data/rasters");

let pool: Pool | undefined;
let skip: string | false = "no APP_DATABASE_URL";

before(async () => {
  if (!process.env.APP_DATABASE_URL) return;
  if (!existsSync(path.join(RASTER_DIR, "demo-city-lst.tif"))) {
    skip = "demo rasters not generated (see db/ingest/README.md)";
    return;
  }
  const p = new Pool({ connectionString: process.env.APP_DATABASE_URL, connectionTimeoutMillis: 2000 });
  try {
    const { rows } = await p.query("SELECT (SELECT count(*) FROM weather_stations WHERE region='demo-city')::int AS s, (SELECT count(*) FROM raster_layers WHERE region='demo-city')::int AS r");
    if (rows[0].s === 24 && rows[0].r === 4) {
      pool = p;
      skip = false;
    } else {
      skip = "demo-city not loaded";
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

const ready = (t: TestContext): boolean => {
  if (skip) t.skip(skip);
  return !skip;
};
const run = (q: Record<string, string>) => runInterpolation({ pool: pool!, store: new RasterStore(RASTER_DIR) }, interpolateQuery.parse({ region: "demo-city", size: "64", ...q }));

test("demo city: regression on land cover beats plain IDW at held-out stations, at several times of day", async (t) => {
  if (!ready(t)) return;
  for (const at of ["2025-07-15T22:00:00Z", "2025-07-15T14:00:00Z", "2025-07-15T06:00:00Z"]) {
    const r = await run({ at });
    assert.equal(r.method, "regression");
    assert.ok(r.cv.idw && r.cv.regression, at);
    assert.ok(r.cv.regression!.rmse < r.cv.idw!.rmse, `${at}: regression ${r.cv.regression!.rmse.toFixed(3)} vs idw ${r.cv.idw!.rmse.toFixed(3)}`);
    assert.equal(r.cv.regression!.n, 24);
  }
});

test("demo city: fitted effects have the physically expected signs; the river is masked", async (t) => {
  if (!ready(t)) return;
  const r = await run({ at: "2025-07-15T22:00:00Z" });
  const c = r.model!.coefficients;
  assert.ok(c.impervious! > 0, "more pavement => warmer");
  assert.ok(c.canopy! < 0, "more canopy => cooler");
  assert.ok(r.model!.r2 > 0.6);
  assert.ok(r.waterMaskedCells > 100, `${r.waterMaskedCells} water cells`);
  assert.equal(r.grid.stats().nodata, r.waterMaskedCells);
  const unmasked = await run({ at: "2025-07-15T22:00:00Z", mask_water: "false" });
  assert.equal(unmasked.waterMaskedCells, 0);
  assert.equal(unmasked.grid.stats().nodata, 0);
});

test("demo city: the surface agrees with the stations where they are (within a cell's variation)", async (t) => {
  if (!ready(t)) return;
  const r = await run({ at: "2025-07-15T22:00:00Z", size: "128" });
  const { rows } = await pool!.query("SELECT ST_X(s.geom) AS lon, ST_Y(s.geom) AS lat, o.temp_c::float8 AS t FROM weather_stations s JOIN station_observations o USING (station_id) WHERE s.region='demo-city' AND o.observed_at = '2025-07-15T22:00:00Z'");
  let worst = 0;
  for (const s of rows) {
    const v = r.grid.valueAt(s.lon, s.lat);
    assert.ok(v !== null, "station inside the surface");
    worst = Math.max(worst, Math.abs(v - s.t));
  }
  assert.ok(worst < 0.7, `worst station-vs-surface difference ${worst.toFixed(2)} °C`);
});

test("demo city: explicit method=idw is honoured and carries no auto note", async (t) => {
  if (!ready(t)) return;
  const r = await run({ method: "idw" });
  assert.equal(r.method, "idw");
  assert.equal(r.methodNote, null);
});

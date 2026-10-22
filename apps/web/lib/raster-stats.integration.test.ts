import { after, before, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { Pool } from "pg";
import { RasterStore } from "@urbanheat/geo-core";
import { areaFromGetQuery, computeRasterStats, fetchCatalog, statsGetQuery } from "./raster-stats";

// Needs the loaded demo city (DB rows) and its generated GeoTIFFs; reports skips otherwise.
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
    const { rows } = await p.query("SELECT count(*)::int AS n FROM raster_layers WHERE region = 'demo-city'");
    if (rows[0].n === 4) {
      pool = p;
      skip = false;
    } else {
      skip = "demo-city raster catalog not loaded";
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

test("catalog + zonal stats over the demo city: dense core vs leafy fringe", async (t) => {
  if (!ready(t)) return;
  const store = new RasterStore(RASTER_DIR);
  const catalog = await fetchCatalog(pool!, "demo-city");
  assert.deepEqual(catalog.map((c) => c.kind).sort(), ["canopy", "elevation", "impervious", "lst"]);
  const stats = (point: string) => {
    const q = statsGetQuery.parse({ region: "demo-city", point, radius_m: "800" });
    return computeRasterStats({ catalog, store }, "demo-city", areaFromGetQuery(q), undefined, 4);
  };
  const core = await stats("-122.45,47.625");
  const fringe = await stats("-122.38,47.58");
  assert.ok(core.layers.impervious!.mean! > fringe.layers.impervious!.mean! + 20);
  assert.ok(core.layers.lst!.mean! > fringe.layers.lst!.mean! + 1);
  assert.ok(core.layers.canopy!.mean! < fringe.layers.canopy!.mean!);
  assert.ok(core.layers.lst!.nodataShare === 0 && core.layers.lst!.cells > 100);
  await store.closeAll();
});

test("fetchCatalog filters by kind and region", async (t) => {
  if (!ready(t)) return;
  assert.deepEqual((await fetchCatalog(pool!, "demo-city", ["lst"])).map((c) => c.kind), ["lst"]);
  assert.deepEqual(await fetchCatalog(pool!, "no-such-region"), []);
});

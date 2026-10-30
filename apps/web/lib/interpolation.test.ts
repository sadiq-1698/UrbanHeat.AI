import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { RasterStore } from "@urbanheat/geo-core";
import type { Pool } from "pg";
import { ApiError } from "./http";
import { gridSize, interpolateQuery, pngHeaders, runInterpolation, toGeoJson, toJson, toPng, type InterpolateParams } from "./interpolation";

const FIXTURES = path.resolve(__dirname, "../../../packages/geo-core/test-fixtures");
const store = new RasterStore(FIXTURES);
const BBOX = [10, 50, 11, 51] as const;
const CATALOG = [
  { name: "t-impervious", region: "t", kind: "impervious", path: "cov-impervious.tif", unit: "percent" },
  { name: "t-canopy", region: "t", kind: "canopy", path: "cov-canopy.tif", unit: "percent" },
  { name: "t-elevation", region: "t", kind: "elevation", path: "cov-elevation.tif", unit: "meters" },
];

// Station readings follow a planted linear model of the covariates, sampled the way the API samples them.
const TRUE = { intercept: 18, impervious: 0.1, canopy: -0.05, elevation: -0.004 };
async function plantedStations(n = 14) {
  const imp = await store.get("cov-impervious.tif");
  const can = await store.get("cov-canopy.tif");
  const ele = await store.get("cov-elevation.tif");
  let seed = 9;
  const r = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const pts = Array.from({ length: n }, (_, i) => [10.05 + r() * 0.9, 50.05 + r() * 0.9, `S${i}`] as const);
  const ll = pts.map(([x, y]) => [x, y] as [number, number]);
  const [I, C, E] = await Promise.all([imp, can, ele].map((x) => x.sampleMany(ll, { method: "bilinear" })));
  return pts.map(([lon, lat, id], i) => ({
    station_id: id, name: id, region: "t", elevation_m: 0, source: "test", lon, lat, observed_at: new Date("2025-07-15T22:00:00Z"),
    temp_c: TRUE.intercept + TRUE.impervious * I[i]! + TRUE.canopy * C[i]! + TRUE.elevation * E[i]!,
    humidity_pct: 40, wind_ms: 2, n_obs: 1,
  }));
}

/** A pool that answers the three queries the interpolation makes. */
function fakePool(stations: unknown[], catalog = CATALOG, bbox: readonly number[] | null = BBOX, water: unknown[] = []): Pool {
  return {
    query: async (sql: string) => {
      if (sql.includes("FROM weather_stations")) return { rows: stations };
      if (sql.includes("FROM land_cover")) return { rows: water.map((geometry) => ({ geometry })) };
      if (sql.includes("ST_Extent")) return { rows: [{ bbox: bbox ? [...bbox] : [null, null, null, null] }] };
      if (sql.includes("FROM raster_layers")) return { rows: catalog };
      throw new Error(`unexpected SQL: ${sql.slice(0, 60)}`);
    },
  } as unknown as Pool;
}
const params = (q: Record<string, string> = {}): InterpolateParams => interpolateQuery.parse({ region: "t", ...q });

test("query validation", () => {
  assert.equal(params().method, "auto");
  assert.equal(params().size, 128);
  for (const bad of [
    { region: "t", at: "2025-07-15T22:00:00Z", date: "2025-07-15" },
    { region: "t", method: "kriging" },
    { region: "t", power: "0" },
    { region: "t", neighbors: "0" },
    { region: "t", size: "4" },
    { region: "t", size: "9999" },
    { region: "t", format: "geojson", size: "500" },
    { region: "t", vmin: "20" },
    { region: "t", vmin: "30", vmax: "20" },
    { region: "x'; --" },
    { region: "t", bbox: "5,0,1,1" },
  ]) assert.equal(interpolateQuery.safeParse(bad).success, false, JSON.stringify(bad));
  assert.equal(interpolateQuery.safeParse({ region: "t", format: "geojson", size: "100" }).success, true);
});

test("gridSize: longer side = size, cells roughly square on the ground", () => {
  const g = gridSize([-122.55, 47.55, -122.35, 47.7], 120);
  assert.equal(Math.max(g.width, g.height), 120);
  const lonM = 0.2 * 75_000; // ~0.2° at 47.6°N
  const latM = 0.15 * 111_195;
  assert.ok(Math.abs(g.width / g.height - lonM / latM) < 0.05, `${g.width}x${g.height}`);
  assert.deepEqual(gridSize([0, 0, 1, 1], 10), { width: 10, height: 10 });
  assert.deepEqual(gridSize([0, 0, 1e-9, 1], 10), { width: 1, height: 10 });
});

test("auto picks regression when covariates exist and recovers the planted coefficients", async () => {
  const stations = await plantedStations();
  const r = await runInterpolation({ pool: fakePool(stations), store }, params({ size: "40" }));
  assert.equal(r.method, "regression");
  assert.match(r.methodNote!, /auto chose regression/);
  assert.equal(r.stationsUsed, stations.length);
  const c = r.model!.coefficients;
  assert.ok(Math.abs(c.intercept! - TRUE.intercept) < 0.05, JSON.stringify(c));
  assert.ok(Math.abs(c.impervious! - TRUE.impervious) < 0.002, JSON.stringify(c));
  assert.ok(Math.abs(c.canopy! - TRUE.canopy) < 0.002, JSON.stringify(c));
  assert.ok(Math.abs(c.elevation! - TRUE.elevation) < 0.0005, JSON.stringify(c));
  assert.ok(r.model!.r2 > 0.999);
  // Held-out error: regression should be far better than IDW on data that is exactly covariate-driven.
  assert.ok(r.cv.regression && r.cv.idw);
  assert.ok(r.cv.regression!.rmse < r.cv.idw!.rmse * 0.3, `${r.cv.regression!.rmse} vs ${r.cv.idw!.rmse}`);
  assert.deepEqual([r.grid.width, r.grid.height], [25, 40]); // square on the ground at 50.5°N: narrower in longitude
  assert.deepEqual(r.bbox, [...BBOX]);
});

test("the regression surface follows the covariates between stations; clamping bounds extrapolation", async () => {
  const stations = await plantedStations(20);
  // The truth on the output grid's own cells: the covariates resampled exactly as the API does.
  const mk = async (q: Record<string, string>) => runInterpolation({ pool: fakePool(stations), store }, params({ size: "40", method: "regression", ...q }));
  const free = await mk({ clamp: "false" });
  const clamped = await mk({});
  const [imp, can, ele] = await Promise.all(["cov-impervious.tif", "cov-canopy.tif", "cov-elevation.tif"].map(async (f) => (await (await store.get(f)).readResampled([...BBOX], free.grid.width, free.grid.height, "average"))!));
  const worst = (g: typeof free.grid) => {
    let w = 0;
    for (let i = 0; i < g.data.length; i++) {
      const t = TRUE.intercept + TRUE.impervious * imp.data[i]! + TRUE.canopy * can.data[i]! + TRUE.elevation * ele.data[i]!;
      w = Math.max(w, Math.abs(g.data[i]! - t));
    }
    return w;
  };
  assert.ok(worst(free.grid) < 0.2, `unclamped worst cell error ${worst(free.grid)}`); // exact linear truth is recovered everywhere
  assert.equal(free.extrapolatedShare, 0); // nothing is clamped when clamping is off
  assert.ok(clamped.extrapolatedShare! > 0, "stations don't span the raster's full covariate range");
  assert.ok(worst(clamped.grid) >= worst(free.grid) && worst(clamped.grid) < 1.5, `clamped worst ${worst(clamped.grid)}`);
});

test("explicit idw skips the covariate lookup; auto falls back to idw without covariates and says why", async () => {
  const stations = await plantedStations();
  let catalogQueried = false;
  const pool = { query: async (sql: string) => { if (sql.includes("FROM raster_layers") && !sql.includes("ST_Extent")) catalogQueried = true; return fakePool(stations).query(sql, []); } } as unknown as Pool;
  const idw = await runInterpolation({ pool, store }, params({ method: "idw", size: "20" }));
  assert.equal(idw.method, "idw");
  assert.equal(idw.methodNote, null);
  assert.equal(catalogQueried, false);
  assert.equal(idw.model, undefined);
  assert.equal(idw.cv.regression, null);
  assert.ok(idw.cv.idw);

  const noElev = await runInterpolation({ pool: fakePool(stations, CATALOG.slice(0, 2)), store }, params({ size: "20" }));
  assert.equal(noElev.method, "idw");
  assert.match(noElev.methodNote!, /fell back to idw.*elevation/);
  await assert.rejects(runInterpolation({ pool: fakePool(stations, CATALOG.slice(0, 2)), store }, params({ method: "regression" })), (e) => e instanceof ApiError && e.status === 422 && /lacks the covariate rasters/.test(e.message));
});

test("error cases: no readings, no extent, huge bbox, bbox off the rasters", async () => {
  const stations = await plantedStations(6);
  await assert.rejects(runInterpolation({ pool: fakePool([]), store }, params()), (e) => e instanceof ApiError && e.status === 404);
  await assert.rejects(runInterpolation({ pool: fakePool(stations, CATALOG, null), store }, params()), (e) => e instanceof ApiError && e.status === 404 && /bbox/.test(e.message));
  await assert.rejects(runInterpolation({ pool: fakePool(stations), store }, params({ bbox: "0,0,5,5" })), (e) => e instanceof ApiError && e.status === 422);
  await assert.rejects(runInterpolation({ pool: fakePool(stations), store }, params({ bbox: "100,0,101,1", method: "regression" })), (e) => e instanceof ApiError && e.status === 422);
});

test("stations without a reading are ignored; one or two stations skip cross-validation", async () => {
  const stations = await plantedStations(5);
  const mixed = [...stations, { ...stations[0]!, station_id: "X", temp_c: null }];
  const r = await runInterpolation({ pool: fakePool(mixed), store }, params({ size: "16" }));
  assert.equal(r.stationsUsed, 5);
  const two = await runInterpolation({ pool: fakePool(stations.slice(0, 2)), store }, params({ method: "idw", size: "16" }));
  assert.equal(two.cv.idw, null);
  assert.match(two.cv.skipped!, /at least 3/);
  const one = await runInterpolation({ pool: fakePool(stations.slice(0, 1)), store }, params({ method: "idw", size: "16" }));
  assert.ok(Math.abs(one.grid.stats().min - stations[0]!.temp_c) < 1e-4); // one station => constant surface
});

test("max_distance_m leaves far cells empty", async () => {
  const stations = (await plantedStations(4)).slice(0, 2);
  const r = await runInterpolation({ pool: fakePool(stations), store }, params({ method: "idw", size: "20", max_distance_m: "20000" }));
  assert.ok(r.grid.stats().nodata > 0 && r.grid.stats().count > 0);
});

test("output formats: json (with/without values), geojson, png", async () => {
  const stations = await plantedStations(10);
  const r = await runInterpolation({ pool: fakePool(stations), store }, params({ size: "16" }));
  const j = toJson(r, false) as Record<string, any>;
  assert.equal(j.values, undefined);
  assert.equal(j.method, "regression");
  assert.equal(j.stats.nodataCells, 0);
  assert.ok(j.stats.min < j.stats.max);
  assert.equal(j.cv.regression.n, 10);
  const jv = toJson(r, true) as Record<string, any>;
  assert.equal(jv.values.length, r.grid.width * r.grid.height);
  assert.ok(jv.values.every((v: unknown) => typeof v === "number"));
  assert.ok(!JSON.stringify(jv).includes("NaN"));

  const gj = toGeoJson(r);
  assert.equal(gj.features.length, r.grid.width * r.grid.height);
  const f0 = gj.features[0]!;
  assert.ok(f0.geometry.coordinates[0]! > 10 && f0.geometry.coordinates[0]! < 11);
  assert.equal(typeof f0.properties!.temp_c, "number");
  assert.ok(f0.geometry.coordinates[1]! > 50.9); // first cell is the north row

  const { png, domain } = toPng(r);
  assert.deepEqual([...png.subarray(1, 4)], [0x50, 0x4e, 0x47]);
  assert.ok(domain[0] < domain[1]);
  assert.deepEqual(toPng(r, 10, 30).domain, [10, 30]);
});

test("geojson omits no-data cells", async () => {
  const stations = (await plantedStations(4)).slice(0, 2);
  const r = await runInterpolation({ pool: fakePool(stations), store }, params({ method: "idw", size: "20", max_distance_m: "20000" }));
  const gj = toGeoJson(r);
  assert.equal(gj.features.length, r.grid.stats().count);
  assert.ok(gj.features.length < r.grid.width * r.grid.height);
});

// A lake covering the middle third of the fixture extent (lon 10.3..10.6, lat 50.3..50.6).
const LAKE = { type: "Polygon", coordinates: [[[10.3, 50.3], [10.6, 50.3], [10.6, 50.6], [10.3, 50.6], [10.3, 50.3]]] };

test("open water is masked by default (both methods), and mask_water=false keeps it", async () => {
  const stations = await plantedStations();
  for (const method of ["regression", "idw"] as const) {
    const masked = await runInterpolation({ pool: fakePool(stations, CATALOG, BBOX, [LAKE]), store }, params({ size: "40", method }));
    assert.ok(masked.waterMaskedCells > 0, method);
    const g = masked.grid;
    const lonAt = (c: number) => 10 + (c + 0.5) * (1 / g.width);
    const latAt = (r: number) => 51 - (r + 0.5) * (1 / g.height);
    let inside = 0;
    let wrong = 0;
    for (let r = 0; r < g.height; r++) {
      for (let c = 0; c < g.width; c++) {
        const lake = lonAt(c) > 10.31 && lonAt(c) < 10.59 && latAt(r) > 50.31 && latAt(r) < 50.59;
        if (lake) {
          inside++;
          if (!Number.isNaN(g.at(r, c))) wrong++;
        } else if (Number.isNaN(g.at(r, c)) && !(lonAt(c) > 10.28 && lonAt(c) < 10.62 && latAt(r) > 50.28 && latAt(r) < 50.62)) wrong++; // nothing emptied away from the lake
      }
    }
    assert.ok(inside > 20 && wrong === 0, `${method}: inside=${inside} wrong=${wrong}`);
    assert.equal(masked.grid.stats().nodata, masked.waterMaskedCells);
    const open = await runInterpolation({ pool: fakePool(stations, CATALOG, BBOX, [LAKE]), store }, params({ size: "40", method, mask_water: "false" }));
    assert.equal(open.waterMaskedCells, 0);
    assert.equal(open.grid.stats().nodata, 0);
  }
});

test("no water polygons => nothing masked; json reports the mask and extrapolation", async () => {
  const stations = await plantedStations();
  const r = await runInterpolation({ pool: fakePool(stations), store }, params({ size: "24" }));
  assert.equal(r.waterMaskedCells, 0);
  const j = toJson(r, false) as Record<string, any>;
  assert.equal(j.waterMaskedCells, 0);
  assert.equal(typeof j.extrapolatedShare, "number");
  assert.ok(j.extrapolatedShare >= 0 && j.extrapolatedShare <= 1);
  const idw = toJson(await runInterpolation({ pool: fakePool(stations), store }, params({ size: "24", method: "idw" })), false) as Record<string, any>;
  assert.equal(idw.extrapolatedShare, undefined);
});

test("pngHeaders describe the image: domain, method, CV error, and exposed header names", async () => {
  const stations = await plantedStations();
  const reg = await runInterpolation({ pool: fakePool(stations, CATALOG, BBOX, [LAKE]), store }, params({ size: "24" }));
  const h = pngHeaders(reg, [20, 30]);
  assert.equal(h["X-Temp-Min"], "20");
  assert.equal(h["X-Temp-Max"], "30");
  assert.equal(h["X-Method"], "regression");
  assert.equal(h["X-Stations"], String(stations.length));
  assert.equal(h["X-Cv-Rmse"], reg.cv.regression!.rmse.toFixed(3));
  assert.equal(h["X-Cv-Idw-Rmse"], reg.cv.idw!.rmse.toFixed(3));
  assert.equal(h["X-Water-Masked-Cells"], String(reg.waterMaskedCells));
  assert.ok(Number(h["X-Water-Masked-Cells"]) > 0);
  assert.match(h["X-Extrapolated-Share"]!, /^\d\.\d{3}$/);
  assert.deepEqual(h["X-Bbox"]!.split(",").map(Number), [...BBOX]);
  // every X-* header is listed so browsers let fetch() read them
  const exposed = h["Access-Control-Expose-Headers"]!.split(", ");
  for (const k of Object.keys(h).filter((k) => k.startsWith("X-"))) assert.ok(exposed.includes(k), k);

  const idw = await runInterpolation({ pool: fakePool(stations), store }, params({ size: "24", method: "idw" }));
  const hi = pngHeaders(idw, [20, 30]);
  assert.equal(hi["X-Method"], "idw");
  assert.equal(hi["X-Cv-Rmse"], idw.cv.idw!.rmse.toFixed(3)); // IDW's own error is "the method used"
  assert.equal(hi["X-Extrapolated-Share"], undefined);
  const two = await runInterpolation({ pool: fakePool(stations.slice(0, 2)), store }, params({ size: "16", method: "idw" }));
  assert.equal(pngHeaders(two, [20, 30])["X-Cv-Rmse"], ""); // no CV with < 3 stations
});

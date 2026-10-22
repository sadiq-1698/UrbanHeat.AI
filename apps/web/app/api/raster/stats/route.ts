import { getPool } from "@/lib/db";
import { handle, json, parseBody, parseQuery } from "@/lib/http";
import { getRasterStore } from "@/lib/rasters";
import { areaFromGetQuery, computeRasterStats, fetchCatalog, statsGetQuery, statsPostBody } from "@/lib/raster-stats";
import type { Area } from "@urbanheat/geo-core";

/**
 * GET /api/raster/stats?region=&point=lon,lat&radius_m=800[&layers=lst,canopy]
 * GET /api/raster/stats?region=&bbox=w,s,e,n[&layers=...]
 * Coverage-weighted mean/min/max/std of each raster layer inside a circle or bbox.
 */
export const GET = handle(async (request) => {
  const q = parseQuery(request, statsGetQuery);
  const catalog = await fetchCatalog(getPool(), q.region, q.layers);
  return json(await computeRasterStats({ catalog, store: getRasterStore() }, q.region, areaFromGetQuery(q), q.layers, q.supersample));
});

/**
 * POST /api/raster/stats  { region, layers?, geometry: Polygon | MultiPolygon, supersample? }
 * Same statistics for an arbitrary polygon (e.g. one the user drew).
 */
export const POST = handle(async (request) => {
  const body = await parseBody(request, statsPostBody);
  const catalog = await fetchCatalog(getPool(), body.region, body.layers);
  return json(await computeRasterStats({ catalog, store: getRasterStore() }, body.region, body.geometry as Area, body.layers, body.supersample));
});

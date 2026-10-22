import { getPool } from "@/lib/db";
import { handle, json, parseQuery } from "@/lib/http";
import { fetchLandCover, landCoverQuery } from "@/lib/queries/landcover";

/**
 * GET /api/landcover?bbox=w,s,e,n[&region=][&class=forest,water][&simplify=0.0005][&limit=1000]
 * Land cover polygons intersecting the bbox, as a GeoJSON FeatureCollection
 * (`truncated: true` when more than `limit` matched).
 */
export const GET = handle(async (request) => {
  const params = parseQuery(request, landCoverQuery);
  return json(await fetchLandCover(getPool(), params));
});

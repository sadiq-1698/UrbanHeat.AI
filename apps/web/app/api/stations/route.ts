import { getPool } from "@/lib/db";
import { handle, json, parseQuery } from "@/lib/http";
import { fetchStations, stationsQuery } from "@/lib/queries/stations";

/**
 * GET /api/stations[?bbox=w,s,e,n][&region=][&at=ISO | &date=YYYY-MM-DD&agg=max|mean|min][&observed_only=true][&limit=]
 * Weather stations as GeoJSON points with a temperature reading: the one at `at`, the
 * max/mean/min over the UTC `date`, or each station's latest reading by default.
 */
export const GET = handle(async (request) => {
  const params = parseQuery(request, stationsQuery);
  return json(await fetchStations(getPool(), params));
});

import { getPool } from "@/lib/db";
import { handle, json, parseQuery } from "@/lib/http";
import { fetchStationsRange, stationsRangeQuery } from "@/lib/queries/stations-range";

/**
 * GET /api/stations/range?region=
 * What observations exist for a region: station/reading counts, first/last timestamp, and the
 * UTC days with data. The UI uses it to offer only days that actually have readings.
 */
export const GET = handle(async (request) => {
  return json(await fetchStationsRange(getPool(), parseQuery(request, stationsRangeQuery)));
});

import { getPool } from "@/lib/db";
import { handle, json, parseQuery } from "@/lib/http";
import { findLayer, legendQuery } from "@/lib/raster-tiles";
import { getTileService } from "@/lib/rasters";
import type { RampKind } from "@urbanheat/geo-core";

/**
 * GET /api/raster/legend?region=&kind=
 * The color ramp the tile endpoint uses for a layer: unit, value domain, and color/alpha stops,
 * so the UI legend always matches what is drawn.
 */
export const GET = handle(async (request) => {
  const q = parseQuery(request, legendQuery);
  const row = await findLayer(getPool(), q.region, q.kind as RampKind);
  return json(await getTileService().legend(row));
});

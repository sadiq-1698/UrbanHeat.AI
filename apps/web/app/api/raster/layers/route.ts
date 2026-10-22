import { z } from "zod";
import { getPool } from "@/lib/db";
import { handle, json, parseQuery } from "@/lib/http";
import { regionParam } from "@/lib/schemas";

const query = z.object({ region: regionParam.optional() });

/**
 * GET /api/raster/layers[?region=]
 * The raster catalog: which GeoTIFF layers exist per region, with units and extent.
 */
export const GET = handle(async (request) => {
  const { region } = parseQuery(request, query);
  const { rows } = await getPool().query(
    `SELECT id, name, region, kind, unit, width_px, height_px, nodata, description,
            ARRAY[ST_XMin(bbox), ST_YMin(bbox), ST_XMax(bbox), ST_YMax(bbox)] AS bbox
     FROM raster_layers ${region ? "WHERE region = $1" : ""} ORDER BY region, kind`,
    region ? [region] : [],
  );
  return json({ layers: rows });
});

import { getPool } from "@/lib/db";
import { handle, json, parseQuery } from "@/lib/http";
import { interpolateQuery, pngHeaders, runInterpolation, toGeoJson, toJson, toPng } from "@/lib/interpolation";
import { getRasterStore } from "@/lib/rasters";

const CACHE = { "Cache-Control": "private, max-age=60" };

/**
 * GET /api/interpolate?region=&[at=ISO | date=YYYY-MM-DD&agg=max|mean|min]&method=auto|idw|regression
 *     &format=json|geojson|png&size=128&power=2&neighbors=12[&bbox=][&max_distance_m=][&values=true][&vmin=&vmax=]
 *
 * A continuous temperature surface from the stations' readings. `idw` is inverse-distance weighting;
 * `regression` fits temperature to impervious/canopy/elevation at the stations and IDW-interpolates the residuals
 * (it follows land cover between stations). `auto` uses regression when the region has those rasters.
 * json -> metadata, stats, and leave-one-out error per method; geojson -> cell-centre points with `temp_c`;
 * png -> the surface as an image over `bbox`; `X-*` headers carry the color domain, method, station count and
 * leave-one-out RMSE (of the method used and of plain IDW) so a client can label the image.
 */
export const GET = handle(async (request) => {
  const p = parseQuery(request, interpolateQuery);
  const result = await runInterpolation({ pool: getPool(), store: getRasterStore() }, p);
  if (p.format === "geojson") return json(toGeoJson(result), { headers: CACHE });
  if (p.format === "png") {
    const { png, domain } = toPng(result, p.vmin, p.vmax);
    return new Response(new Uint8Array(png), {
      headers: { ...CACHE, "Content-Type": "image/png", ...pngHeaders(result, domain) },
    });
  }
  return json(toJson(result, p.values), { headers: CACHE });
});

import { getPool } from "@/lib/db";
import { ApiError, handle } from "@/lib/http";
import { findLayer, tileParams } from "@/lib/raster-tiles";
import { getTileService } from "@/lib/rasters";

type Ctx = { params: Promise<Record<string, string>> };

/**
 * GET /api/raster/tile/{region}/{kind}/{z}/{x}/{y}.png
 * 256x256 PNG tile (Web Mercator, XYZ) of a raster layer (canopy, impervious, lst, elevation), rendered on the
 * fly from the GeoTIFF with the layer's color ramp. Tiles outside the raster are fully transparent. Cacheable,
 * with ETag/304 support.
 */
export async function GET(request: Request, { params }: Ctx): Promise<Response> {
  return handle(async (req) => {
    const parsed = tileParams.safeParse(await params);
    if (!parsed.success) throw new ApiError(400, "Invalid tile request", parsed.error.issues.map((i) => i.message));
    const { region, kind, z, x, y } = parsed.data;
    const row = await findLayer(getPool(), region, kind);
    const r = await getTileService().tile(row, z, x, y, req.headers.get("if-none-match"));
    return new Response(r.body ? new Uint8Array(r.body) : null, { status: r.status, headers: r.headers });
  })(request);
}

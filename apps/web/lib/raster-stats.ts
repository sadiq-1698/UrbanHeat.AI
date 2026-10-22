import { type Area, boundsOf, circlePolygon, type RasterStore, zonalStats, type ZonalStats } from "@urbanheat/geo-core";
import type { Pool } from "pg";
import { z } from "zod";
import { ApiError } from "./http";
import { bboxParam, pointParam, RASTER_KINDS, type RasterKind, regionParam } from "./schemas";

export const MAX_RADIUS_M = 20_000;
export const MAX_VERTICES = 10_000;

const lon = z.number().min(-180).max(180);
const lat = z.number().min(-90).max(90);
const position = z.tuple([lon, lat]).rest(z.number());
const ring = z.array(position).min(4);

/** Polygon / MultiPolygon geometry, validated for range, ring size, and total vertex count. */
export const areaSchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("Polygon"), coordinates: z.array(ring).min(1) }),
    z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(z.array(ring).min(1)).min(1) }),
  ])
  .refine((g) => countVertices(g) <= MAX_VERTICES, `geometry has more than ${MAX_VERTICES} vertices`);

function countVertices(g: { type: "Polygon"; coordinates: unknown[][] } | { type: "MultiPolygon"; coordinates: unknown[][][] }): number {
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  return polys.reduce((n, rings) => n + rings.reduce((m, r) => m + r.length, 0), 0);
}

const kindList = z
  .string()
  .transform((s) => s.split(",").map((k) => k.trim()).filter(Boolean))
  .pipe(z.array(z.enum(RASTER_KINDS)).min(1));

const supersample = z.coerce.number().int().min(1).max(8).default(4);

/** GET: a point + radius, or a bbox. */
export const statsGetQuery = z
  .object({
    region: regionParam,
    layers: kindList.optional(),
    point: pointParam.optional(),
    radius_m: z.coerce.number().positive().max(MAX_RADIUS_M).optional(),
    bbox: bboxParam.optional(),
    supersample,
  })
  .refine((q) => (q.point ? q.radius_m !== undefined && !q.bbox : q.bbox !== undefined && q.radius_m === undefined), {
    message: "give either point + radius_m, or bbox",
  });

/** POST: any polygon. */
export const statsPostBody = z.object({
  region: regionParam,
  layers: z.array(z.enum(RASTER_KINDS)).min(1).optional(),
  geometry: areaSchema,
  supersample: z.number().int().min(1).max(8).default(4),
});

export interface CatalogRow {
  name: string;
  region: string;
  kind: RasterKind;
  path: string;
  unit: string;
}

export interface LayerStats extends Omit<ZonalStats, "mean" | "min" | "max" | "std"> {
  name: string;
  unit: string;
  mean: number | null;
  min: number | null;
  max: number | null;
  std: number | null;
}

export interface RasterStatsResult {
  region: string;
  areaM2: number;
  layers: Partial<Record<RasterKind, LayerStats>>;
}

export async function fetchCatalog(pool: Pool, region: string, kinds?: readonly RasterKind[]): Promise<CatalogRow[]> {
  const { rows } = await pool.query<CatalogRow>(
    `SELECT name, region, kind, path, unit FROM raster_layers
     WHERE region = $1 ${kinds ? "AND kind = ANY($2::text[])" : ""} ORDER BY kind`,
    kinds ? [region, [...kinds]] : [region],
  );
  return rows;
}

const finite = (v: number) => (Number.isFinite(v) ? v : null);

/** Zonal statistics of each requested layer inside `area`. */
export async function computeRasterStats(
  deps: { catalog: CatalogRow[]; store: RasterStore },
  region: string,
  area: Area,
  kinds: readonly RasterKind[] | undefined,
  supersample: number,
): Promise<RasterStatsResult> {
  const wanted = kinds ?? deps.catalog.map((c) => c.kind);
  const missing = wanted.filter((k) => !deps.catalog.some((c) => c.kind === k));
  if (deps.catalog.length === 0 || missing.length) {
    const have = deps.catalog.map((c) => c.kind);
    throw new ApiError(404, deps.catalog.length === 0 ? `No raster layers for region "${region}"` : `Region "${region}" has no ${missing.join(", ")} layer`, { available: have });
  }

  const layers: RasterStatsResult["layers"] = {};
  let areaM2 = 0;
  let any = false;
  for (const kind of new Set(wanted)) {
    const row = deps.catalog.find((c) => c.kind === kind)!;
    let grid;
    try {
      const raster = await deps.store.get(row.path);
      grid = await raster.read(boundsOf(area));
    } catch (err) {
      if (err instanceof RangeError) throw new ApiError(422, "Geometry covers too large an area of the raster; use a smaller area");
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        console.error(`raster file missing for layer ${row.name}: ${row.path}`);
        throw new ApiError(503, `Raster data for "${kind}" is unavailable`);
      }
      throw err;
    }
    const stats = grid ? zonalStats(grid, area, { supersample }) : null;
    if (!stats) continue;
    any = true;
    areaM2 = stats.areaM2;
    layers[kind] = { ...stats, name: row.name, unit: row.unit, mean: finite(stats.mean), min: finite(stats.min), max: finite(stats.max), std: finite(stats.std) };
  }
  if (!any) throw new ApiError(404, "Geometry does not overlap this region's rasters");
  return { region, areaM2, layers };
}

/** Resolve a GET query to the polygon it describes. */
export function areaFromGetQuery(q: z.output<typeof statsGetQuery>): Area {
  if (q.point) return circlePolygon(q.point[0], q.point[1], q.radius_m!);
  const [w, s, e, n] = q.bbox!;
  return { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] };
}

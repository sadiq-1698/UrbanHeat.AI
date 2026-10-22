import type { Feature, FeatureCollection, MultiPolygon } from "geojson";
import type { Pool } from "pg";
import { z } from "zod";
import { bboxParam, regionParam } from "../schemas";

export const LAND_COVER_CLASSES = [
  "developed_high", "developed_medium", "developed_low", "developed_open", "forest",
  "shrub_grass", "cropland", "wetland", "water", "barren",
] as const;

export const landCoverQuery = z.object({
  bbox: bboxParam,
  region: regionParam.optional(),
  /** Comma-separated subset of LAND_COVER_CLASSES. */
  class: z
    .string()
    .transform((s) => s.split(",").map((c) => c.trim()).filter(Boolean))
    .pipe(z.array(z.enum(LAND_COVER_CLASSES)).min(1))
    .optional(),
  /** Douglas-Peucker tolerance in degrees; use for zoomed-out views. 0 = exact geometry. */
  simplify: z.coerce.number().min(0).max(0.1).default(0),
  limit: z.coerce.number().int().min(1).max(5000).default(1000),
});
export type LandCoverParams = z.output<typeof landCoverQuery>;

/** Parameterized SQL; fetches limit+1 rows so the caller can tell if the result was truncated. */
export function buildLandCoverSql(p: LandCoverParams): { text: string; values: unknown[] } {
  const values: unknown[] = [...p.bbox];
  const where = ["ST_Intersects(geom, ST_MakeEnvelope($1, $2, $3, $4, 4326))"];
  if (p.region) where.push(`region = $${values.push(p.region)}`);
  if (p.class) where.push(`class = ANY($${values.push(p.class)}::text[])`);
  let geom = "geom";
  if (p.simplify > 0) geom = `ST_SimplifyPreserveTopology(geom, $${values.push(p.simplify)})`;
  const limit = `$${values.push(p.limit + 1)}`;
  return {
    text: `SELECT id, region, class, canopy_pct::float8 AS canopy_pct, impervious_pct::float8 AS impervious_pct,
                  area_m2, ST_AsGeoJSON(${geom}, 6)::json AS geometry
           FROM land_cover
           WHERE ${where.join(" AND ")}
           ORDER BY id
           LIMIT ${limit}`,
    values,
  };
}

interface Row {
  id: string | number;
  region: string;
  class: string;
  canopy_pct: number;
  impervious_pct: number;
  area_m2: number | null;
  geometry: MultiPolygon | null;
}

export interface LandCoverCollection extends FeatureCollection<MultiPolygon> {
  truncated: boolean;
}

export function rowsToLandCover(rows: Row[], limit: number): LandCoverCollection {
  const features: Feature<MultiPolygon>[] = rows
    .slice(0, limit)
    // A simplified geometry can collapse to nothing; drop it rather than emit null geometry.
    .filter((r) => r.geometry)
    .map((r) => ({
      type: "Feature",
      id: Number(r.id),
      geometry: r.geometry!,
      properties: {
        id: Number(r.id),
        region: r.region,
        class: r.class,
        canopy_pct: r.canopy_pct,
        impervious_pct: r.impervious_pct,
        area_m2: r.area_m2,
      },
    }));
  return { type: "FeatureCollection", features, truncated: rows.length > limit };
}

export async function fetchLandCover(pool: Pool, p: LandCoverParams): Promise<LandCoverCollection> {
  const { text, values } = buildLandCoverSql(p);
  const { rows } = await pool.query<Row>(text, values);
  return rowsToLandCover(rows, p.limit);
}

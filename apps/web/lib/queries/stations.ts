import type { Feature, FeatureCollection, Point } from "geojson";
import type { Pool } from "pg";
import { z } from "zod";
import { bboxParam, regionParam } from "../schemas";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

export const stationsQuery = z
  .object({
    bbox: bboxParam.optional(),
    region: regionParam.optional(),
    /** One exact observation timestamp (ISO 8601). */
    at: z.iso.datetime({ offset: true }).optional(),
    /** A UTC day (YYYY-MM-DD) to aggregate over, with `agg`. */
    date: z.iso.date().optional(),
    agg: z.enum(["max", "mean", "min"]).default("max"),
    /** Drop stations that have no observation for the chosen time/day. */
    observed_only: bool.default(false),
    limit: z.coerce.number().int().min(1).max(5000).default(1000),
  })
  .refine((q) => !(q.at && q.date), { message: "use either `at` or `date`, not both" });
export type StationsParams = z.output<typeof stationsQuery>;

const AGG_SQL = { max: "max", mean: "avg", min: "min" } as const;

/**
 * Observation modes:
 *  - `at`:   the reading at exactly that timestamp
 *  - `date`: max/mean/min of the readings in that UTC day
 *  - neither: each station's most recent reading
 */
export function buildStationsSql(p: StationsParams): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const where: string[] = [];
  if (p.bbox) {
    const i = values.length;
    values.push(...p.bbox);
    where.push(`s.geom && ST_MakeEnvelope($${i + 1}, $${i + 2}, $${i + 3}, $${i + 4}, 4326)`);
  }
  if (p.region) where.push(`s.region = $${values.push(p.region)}`);

  let obs: string;
  if (p.at) {
    obs = `SELECT station_id, observed_at, round(temp_c::numeric, 2)::float8 AS temp_c, round(humidity_pct::numeric, 1)::float8 AS humidity_pct,
                  round(wind_ms::numeric, 1)::float8 AS wind_ms, 1 AS n_obs
           FROM station_observations WHERE observed_at = $${values.push(p.at)}`;
  } else if (p.date) {
    const d = `$${values.push(p.date)}::date`;
    const fn = AGG_SQL[p.agg];
    obs = `SELECT station_id, NULL::timestamptz AS observed_at, round(${fn}(temp_c)::numeric, 2)::float8 AS temp_c,
                  round(avg(humidity_pct)::numeric, 1)::float8 AS humidity_pct, round(avg(wind_ms)::numeric, 1)::float8 AS wind_ms, count(*)::int AS n_obs
           FROM station_observations
           WHERE observed_at >= ${d}::timestamp AT TIME ZONE 'UTC'
             AND observed_at < (${d} + 1)::timestamp AT TIME ZONE 'UTC'
           GROUP BY station_id`;
  } else {
    obs = `SELECT DISTINCT ON (station_id) station_id, observed_at, round(temp_c::numeric, 2)::float8 AS temp_c,
                  round(humidity_pct::numeric, 1)::float8 AS humidity_pct, round(wind_ms::numeric, 1)::float8 AS wind_ms, 1 AS n_obs
           FROM station_observations ORDER BY station_id, observed_at DESC`;
  }
  if (p.observed_only) where.push("o.station_id IS NOT NULL");
  const limit = `$${values.push(p.limit + 1)}`;
  return {
    text: `SELECT s.station_id, s.name, s.region, round(s.elevation_m::numeric, 1)::float8 AS elevation_m, s.source,
                  ST_X(s.geom) AS lon, ST_Y(s.geom) AS lat,
                  o.observed_at, o.temp_c, o.humidity_pct, o.wind_ms, o.n_obs
           FROM weather_stations s
           LEFT JOIN (${obs}) o ON o.station_id = s.station_id
           ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
           ORDER BY s.station_id
           LIMIT ${limit}`,
    values,
  };
}

interface Row {
  station_id: string;
  name: string;
  region: string;
  elevation_m: number | null;
  source: string;
  lon: number;
  lat: number;
  observed_at: Date | null;
  temp_c: number | null;
  humidity_pct: number | null;
  wind_ms: number | null;
  n_obs: number | null;
}

export interface StationCollection extends FeatureCollection<Point> {
  truncated: boolean;
}

export function rowsToStations(rows: Row[], limit: number): StationCollection {
  const features: Feature<Point>[] = rows.slice(0, limit).map((r) => ({
    type: "Feature",
    id: r.station_id,
    geometry: { type: "Point", coordinates: [r.lon, r.lat] },
    properties: {
      station_id: r.station_id,
      name: r.name,
      region: r.region,
      elevation_m: r.elevation_m,
      source: r.source,
      temp_c: r.temp_c,
      humidity_pct: r.humidity_pct,
      wind_ms: r.wind_ms,
      observed_at: r.observed_at ? r.observed_at.toISOString() : null,
      n_obs: r.n_obs ?? 0,
    },
  }));
  return { type: "FeatureCollection", features, truncated: rows.length > limit };
}

export async function fetchStations(pool: Pool, p: StationsParams): Promise<StationCollection> {
  const { text, values } = buildStationsSql(p);
  const { rows } = await pool.query<Row>(text, values);
  return rowsToStations(rows, p.limit);
}

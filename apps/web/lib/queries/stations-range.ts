import type { Pool } from "pg";
import { z } from "zod";
import { regionParam } from "../schemas";

export const stationsRangeQuery = z.object({ region: regionParam });
export type StationsRangeParams = z.output<typeof stationsRangeQuery>;

export interface StationsRange {
  region: string;
  stations: number;
  observations: number;
  /** ISO timestamps of the earliest / latest reading; null when the region has none. */
  first: string | null;
  last: string | null;
  /** UTC days (YYYY-MM-DD) that have at least one reading, ascending. */
  days: string[];
}

export const buildStationsRangeSql = (): string => `
  SELECT count(DISTINCT s.station_id)::int AS stations,
         count(o.station_id)::int AS observations,
         min(o.observed_at) AS first,
         max(o.observed_at) AS last,
         coalesce(array_agg(DISTINCT to_char(o.observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'))
                  FILTER (WHERE o.observed_at IS NOT NULL), '{}') AS days
  FROM weather_stations s
  LEFT JOIN station_observations o ON o.station_id = s.station_id
  WHERE s.region = $1`;

interface Row {
  stations: number;
  observations: number;
  first: Date | null;
  last: Date | null;
  days: string[];
}

export function rowToRange(region: string, r: Row): StationsRange {
  return {
    region,
    stations: r.stations,
    observations: r.observations,
    first: r.first ? r.first.toISOString() : null,
    last: r.last ? r.last.toISOString() : null,
    days: [...r.days].sort(),
  };
}

export async function fetchStationsRange(pool: Pool, p: StationsRangeParams): Promise<StationsRange> {
  const { rows } = await pool.query<Row>(buildStationsRangeSql(), [p.region]);
  return rowToRange(p.region, rows[0]!);
}

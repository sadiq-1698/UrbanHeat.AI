import turfArea from "@turf/area";
import { type Area, circlePolygon, toArea } from "./geometry.js";
import type { RasterGrid } from "./raster-grid.js";
import { coverageMask, statsFromMask, type ZonalOptions, type ZonalStats } from "./zonal.js";
import type { Polygon } from "geojson";

/** A set of named rasters (canopy, impervious, lst, ...) that share one grid. */
export type LayerSet = Record<string, RasterGrid>;

const SAME_EPS = 1e-9;

/** Throws unless every layer has the same size and extent (cell-for-cell alignment). */
export function assertSameGrid(layers: LayerSet): void {
  const entries = Object.entries(layers);
  if (entries.length === 0) throw new RangeError("no layers given");
  const [firstName, first] = entries[0]!;
  for (const [name, g] of entries.slice(1)) {
    const same =
      g.width === first.width &&
      g.height === first.height &&
      g.bbox.every((v, i) => Math.abs(v - first.bbox[i]!) < SAME_EPS);
    if (!same) throw new RangeError(`layer "${name}" is not aligned with "${firstName}"`);
  }
}

/**
 * Statistics of every layer inside one polygon, computing the coverage mask once.
 * Null if the polygon misses the grid.
 */
export function zonalStatsLayers(layers: LayerSet, input: Area, opts: ZonalOptions = {}): Record<string, ZonalStats> | null {
  assertSameGrid(layers);
  const area = toArea(input);
  const entries = Object.entries(layers);
  const mask = coverageMask(entries[0]![1], area, opts);
  if (!mask) return null;
  const areaM2 = turfArea({ type: "Feature", properties: {}, geometry: area });
  return Object.fromEntries(entries.map(([name, g]) => [name, statsFromMask(g, mask, areaM2)]));
}

/** Same as zonalStatsLayers for many polygons (e.g. land cover features); misses give null entries. */
export function zonalStatsMany(layers: LayerSet, areas: Area[], opts: ZonalOptions = {}): (Record<string, ZonalStats> | null)[] {
  assertSameGrid(layers);
  return areas.map((a) => zonalStatsLayers(layers, a, opts));
}

export interface BufferStats {
  /** The circle that was summarized. */
  buffer: Polygon;
  stats: Record<string, ZonalStats>;
}

/** Statistics of every layer within `radiusM` metres of a point; null if the circle misses the grid. */
export function bufferStats(layers: LayerSet, lon: number, lat: number, radiusM: number, opts: ZonalOptions = {}): BufferStats | null {
  const buffer = circlePolygon(lon, lat, radiusM);
  const stats = zonalStatsLayers(layers, buffer, opts);
  return stats ? { buffer, stats } : null;
}

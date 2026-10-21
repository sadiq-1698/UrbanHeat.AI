import turfArea from "@turf/area";
import turfIntersect from "@turf/intersect";
import { featureCollection } from "@turf/helpers";
import type { Feature } from "geojson";
import { type Area, boundsOf, toArea } from "./geometry.js";

/** A land cover polygon as stored in PostGIS (`land_cover` table). */
export interface LandCoverFeature {
  geometry: Area;
  properties: { class: string; canopy_pct: number | string; impervious_pct: number | string };
}

export interface LandCoverSummary {
  /** Area of the query polygon, m². */
  queryAreaM2: number;
  /** Part of the query polygon covered by any land cover polygon, m². */
  coveredAreaM2: number;
  /** coveredAreaM2 / queryAreaM2 (0..1). */
  coveredShare: number;
  /** Area-weighted mean canopy over the covered part, %. */
  canopyPct: number;
  /** Area-weighted mean impervious cover over the covered part, %. */
  imperviousPct: number;
  /** Share (0..1) of the covered area per land cover class. */
  classShares: Record<string, number>;
  /** Land cover polygons that overlapped the query. */
  polygons: number;
  /** Overlapping polygons dropped because the geometry operation failed (invalid geometry). */
  skipped: number;
}

const asFeature = (geometry: Area): Feature<Area> => ({ type: "Feature", properties: {}, geometry });

function bboxesOverlap(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}

/**
 * Area-weighted canopy / impervious cover and class mix of land cover inside a
 * query polygon, computed in JS with turf (the on-the-fly counterpart of an
 * ST_Intersection query). Each polygon's attributes are weighted by the
 * geodesic area of its intersection with the query, so a polygon that only
 * clips a corner counts proportionally. Null if nothing overlaps.
 */
export function summarizeLandCover(queryInput: Area, features: Iterable<LandCoverFeature>): LandCoverSummary | null {
  const query = toArea(queryInput);
  const qBounds = boundsOf(query);
  const queryFeature = asFeature(query);
  const queryAreaM2 = turfArea(queryFeature);

  let covered = 0;
  let canopy = 0;
  let imperv = 0;
  let polygons = 0;
  let skipped = 0;
  const byClass = new Map<string, number>();

  for (const f of features) {
    const geom = toArea(f.geometry);
    if (!bboxesOverlap(boundsOf(geom), qBounds)) continue;
    let part: Feature<Area> | null;
    try {
      part = turfIntersect(featureCollection([queryFeature, asFeature(geom)]));
    } catch {
      skipped++;
      continue;
    }
    if (!part) continue;
    const a = turfArea(part);
    if (!(a > 0)) continue;
    polygons++;
    covered += a;
    canopy += a * Number(f.properties.canopy_pct);
    imperv += a * Number(f.properties.impervious_pct);
    byClass.set(f.properties.class, (byClass.get(f.properties.class) ?? 0) + a);
  }

  if (covered === 0) return skipped > 0 ? emptySummary(queryAreaM2, skipped) : null;
  return {
    queryAreaM2,
    coveredAreaM2: covered,
    coveredShare: Math.min(covered / queryAreaM2, 1),
    canopyPct: canopy / covered,
    imperviousPct: imperv / covered,
    classShares: Object.fromEntries([...byClass].map(([k, v]) => [k, v / covered])),
    polygons,
    skipped,
  };
}

function emptySummary(queryAreaM2: number, skipped: number): LandCoverSummary {
  return { queryAreaM2, coveredAreaM2: 0, coveredShare: 0, canopyPct: NaN, imperviousPct: NaN, classShares: {}, polygons: 0, skipped };
}

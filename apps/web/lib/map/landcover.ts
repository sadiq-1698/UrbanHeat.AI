import { type BBox, bboxToParam } from "./geo";

export interface ClassStyle {
  label: string;
  color: string;
}

// Colors follow the NLCD legend so the map reads like land cover maps people already know.
// Order here is the legend order (densest development first).
export const LAND_COVER_STYLES = {
  developed_high: { label: "Developed, high intensity", color: "#ab0000" },
  developed_medium: { label: "Developed, medium intensity", color: "#eb0000" },
  developed_low: { label: "Developed, low intensity", color: "#d99282" },
  developed_open: { label: "Developed, open space", color: "#dec5c5" },
  forest: { label: "Forest", color: "#68ab5f" },
  shrub_grass: { label: "Shrub / grassland", color: "#ccb879" },
  cropland: { label: "Cropland", color: "#ab6c28" },
  wetland: { label: "Wetland", color: "#b8d9eb" },
  water: { label: "Open water", color: "#476ba0" },
  barren: { label: "Barren", color: "#b3ac9f" },
} as const satisfies Record<string, ClassStyle>;

export type LandCoverClass = keyof typeof LAND_COVER_STYLES;
export const FALLBACK_COLOR = "#999999";

export const LAND_COVER_ORDER = Object.keys(LAND_COVER_STYLES) as LandCoverClass[];

/** MapLibre `match` expression coloring features by their `class` property. */
export function colorExpression(): unknown[] {
  return ["match", ["get", "class"], ...LAND_COVER_ORDER.flatMap((c) => [c, LAND_COVER_STYLES[c].color]), FALLBACK_COLOR];
}

export function classLabel(cls: string): string {
  return (LAND_COVER_STYLES as Record<string, ClassStyle>)[cls]?.label ?? cls;
}

/**
 * Douglas-Peucker tolerance (degrees) for a zoom level: about half a screen pixel, so simplification
 * is invisible. Returns 0 (exact geometry) once that gets finer than ~2 m, and never exceeds the API's 0.1 cap.
 */
export function simplifyTolerance(zoom: number): number {
  const pixelDeg = 360 / (512 * 2 ** Math.max(zoom, 0));
  const tol = pixelDeg / 2;
  return tol < 2e-5 ? 0 : Math.min(tol, 0.1);
}

/** Zoom bucket used to decide whether a cached response is still adequate (changes with tolerance steps). */
export function zoomBucket(zoom: number): number {
  return Math.floor(Math.max(zoom, 0));
}

export interface LandCoverRequest {
  bbox: BBox;
  region: string;
  zoom: number;
  limit?: number;
}

export function landCoverUrl({ bbox, region, zoom, limit = 2000 }: LandCoverRequest): string {
  const params = new URLSearchParams({ bbox: bboxToParam(bbox), region, limit: String(limit) });
  const tol = simplifyTolerance(zoom);
  // Round to 6 dp: keeps URLs stable and short, and avoids exponent notation (1e-5) the API wouldn't parse as intended.
  if (tol > 0) params.set("simplify", tol.toFixed(6));
  return `/api/landcover?${params}`;
}

/** Human-readable area, e.g. "3.2 km²" / "4.5 ha" / "820 m²". */
export function formatArea(m2: number | null | undefined): string {
  if (m2 == null || !Number.isFinite(m2)) return "—";
  if (m2 >= 1e6) return `${(m2 / 1e6).toFixed(m2 >= 1e7 ? 0 : 1)} km²`;
  if (m2 >= 1e4) return `${(m2 / 1e4).toFixed(m2 >= 1e5 ? 0 : 1)} ha`;
  return `${Math.round(m2)} m²`;
}

export interface PopupRow {
  label: string;
  value: string;
}

/** Rows for a feature popup (rendered via textContent, never as HTML). */
export function popupRows(p: Record<string, unknown>): { title: string; rows: PopupRow[] } {
  const pct = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(1)}%` : "—");
  return {
    title: classLabel(String(p.class ?? "unknown")),
    rows: [
      { label: "Tree canopy", value: pct(p.canopy_pct) },
      { label: "Impervious", value: pct(p.impervious_pct) },
      { label: "Area", value: formatArea(typeof p.area_m2 === "number" ? p.area_m2 : null) },
    ],
  };
}

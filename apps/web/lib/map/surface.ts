import type { BBox } from "./geo";
import { type ReadingMode, readingParams } from "./stations";

export type SurfaceMethod = "auto" | "idw" | "regression";

export const METHOD_LABELS: Record<SurfaceMethod, string> = {
  auto: "Automatic",
  idw: "Distance-weighted (IDW)",
  regression: "Land-cover regression",
};

/** Long side of the requested surface image, in cells. The image covers the whole region and is stretched by the map. */
export const SURFACE_SIZE = 256;

export function surfaceUrl(region: string, mode: ReadingMode, method: SurfaceMethod, size = SURFACE_SIZE): string {
  const p = new URLSearchParams({ region, format: "png", size: String(size), method });
  for (const [k, v] of readingParams(mode)) p.set(k, v);
  return `/api/interpolate?${p}`;
}

/** Corner coordinates for a MapLibre image source: top-left, top-right, bottom-right, bottom-left (lon, lat). */
export function imageCoordinates(b: BBox): [[number, number], [number, number], [number, number], [number, number]] {
  const [w, s, e, n] = b;
  return [[w, n], [e, n], [e, s], [w, s]];
}

export interface SurfaceMeta {
  domain: [number, number];
  bbox: BBox;
  method: "idw" | "regression";
  stations: number;
  /** Leave-one-out RMSE (°C) of the method used / of plain IDW; null when it couldn't be computed. */
  cvRmse: number | null;
  idwRmse: number | null;
  waterMaskedCells: number;
  /** Regression only. */
  extrapolatedShare: number | null;
}

const num = (v: string | null): number | null => {
  if (v === null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Read the interpolation metadata the API puts in the PNG response headers; null if it's malformed. */
export function parseSurfaceHeaders(h: { get(name: string): string | null }): SurfaceMeta | null {
  const lo = num(h.get("X-Temp-Min"));
  const hi = num(h.get("X-Temp-Max"));
  const bbox = (h.get("X-Bbox") ?? "").split(",").map(Number);
  const method = h.get("X-Method");
  if (lo === null || hi === null || !(lo < hi) || bbox.length !== 4 || bbox.some((v) => !Number.isFinite(v)) || (method !== "idw" && method !== "regression")) return null;
  return {
    domain: [lo, hi],
    bbox: bbox as BBox,
    method,
    stations: num(h.get("X-Stations")) ?? 0,
    cvRmse: num(h.get("X-Cv-Rmse")),
    idwRmse: num(h.get("X-Cv-Idw-Rmse")),
    waterMaskedCells: num(h.get("X-Water-Masked-Cells")) ?? 0,
    extrapolatedShare: num(h.get("X-Extrapolated-Share")),
  };
}

/** One honest sentence about how good the surface is (leave-one-out: each station predicted from the others). */
export function accuracyNote(m: SurfaceMeta): string {
  const used = m.method === "regression" ? "land-cover regression" : "IDW";
  if (m.cvRmse === null) return `${used} from ${m.stations} station${m.stations === 1 ? "" : "s"}; too few stations to estimate accuracy.`;
  const base = `Held-out error (each station predicted from the others): ${m.cvRmse.toFixed(2)} °C`;
  if (m.method === "regression" && m.idwRmse !== null) return `${base} with regression vs ${m.idwRmse.toFixed(2)} °C for plain IDW.`;
  return `${base}.`;
}

export function methodSummary(m: SurfaceMeta): string {
  const extra = m.extrapolatedShare !== null && m.extrapolatedShare > 0 ? ` · ${(m.extrapolatedShare * 100).toFixed(0)}% extrapolated` : "";
  return `${m.method === "regression" ? "Regression" : "IDW"} · ${m.stations} stations${extra}`;
}

import {
  type Area, type BBox, type CvResult, type GeoTiffRaster, type LinearModel, type RasterGrid, type RasterStore, type SamplePoint,
  colormapForKind, coverageMask, encodePng, idwGrid, idwLeaveOneOut, metersPerDegree, regressionIdwGrid, regressionLeaveOneOut, robustDomain,
} from "@urbanheat/geo-core";
import type { Feature, FeatureCollection, Point } from "geojson";
import type { Pool } from "pg";
import { z } from "zod";
import { ApiError } from "./http";
import { type CatalogRow, fetchCatalog } from "./raster-stats";
import { fetchStations, type StationsParams } from "./queries/stations";
import { bboxParam, regionParam } from "./schemas";

export const COVARIATES = ["impervious", "canopy", "elevation"] as const;
export const MAX_GEOJSON_SIDE = 100;
export const MAX_STATIONS = 2000;
/** Leave-one-out refits the model per station; skip it beyond this many stations. */
export const MAX_CV_STATIONS = 300;
const MAX_BBOX_DEG = 2;

const optionalNumber = (min: number, max: number) => z.coerce.number().min(min).max(max).optional();

export const interpolateQuery = z
  .object({
    region: regionParam,
    /** Reading to interpolate: one timestamp, a UTC day aggregate, or (default) each station's latest. */
    at: z.iso.datetime({ offset: true }).optional(),
    date: z.iso.date().optional(),
    agg: z.enum(["max", "mean", "min"]).default("max"),
    /** `auto` = regression on land cover when the region has the covariate rasters, else idw. */
    method: z.enum(["auto", "idw", "regression"]).default("auto"),
    power: z.coerce.number().min(0.5).max(6).default(2),
    neighbors: z.coerce.number().int().min(1).max(50).default(12),
    max_distance_m: optionalNumber(1, 200_000),
    /** Output extent; defaults to the region's raster extent. */
    bbox: bboxParam.optional(),
    /** Length of the longer side of the output grid, in cells. */
    size: z.coerce.number().int().min(8).max(512).default(128),
    format: z.enum(["json", "geojson", "png"]).default("json"),
    /** Regression only: clamp covariates to the range seen at the stations (default) instead of extrapolating linearly. */
    clamp: z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1").default(true),
    /** Leave cells inside open-water polygons (land_cover class `water`) empty: a land-station surface says nothing about water. */
    mask_water: z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1").default(true),
    /** json only: include the grid values (row-major, north row first). */
    values: z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1").default(false),
    /** png only: override the color domain. */
    vmin: optionalNumber(-100, 100),
    vmax: optionalNumber(-100, 100),
  })
  .refine((q) => !(q.at && q.date), { message: "use either `at` or `date`, not both" })
  .refine((q) => q.format !== "geojson" || q.size <= MAX_GEOJSON_SIDE, { message: `geojson output is limited to size <= ${MAX_GEOJSON_SIDE}`, path: ["size"] })
  .refine((q) => (q.vmin === undefined) === (q.vmax === undefined) && (q.vmin === undefined || q.vmin < q.vmax!), { message: "give both vmin and vmax, with vmin < vmax" });
export type InterpolateParams = z.output<typeof interpolateQuery>;

export interface Metrics {
  n: number;
  rmse: number;
  mae: number;
  bias: number;
}

export interface InterpolationResult {
  region: string;
  method: "idw" | "regression";
  /** Why `auto` chose what it did, or null if the method was requested explicitly. */
  methodNote: string | null;
  grid: RasterGrid;
  bbox: BBox;
  stationsUsed: number;
  /** Leave-one-out error per method (null when it could not be computed, with the reason). */
  cv: { idw: Metrics | null; regression: Metrics | null; skipped?: string };
  model?: { r2: number; rmse: number; coefficients: Record<string, number> };
  /** Regression only: share of estimated cells where a covariate was clamped to the stations' range (extrapolation). */
  extrapolatedShare?: number;
  /** Cells emptied because they fall in open water (0 when masking is off or the region has no water polygons). */
  waterMaskedCells: number;
}

const finiteOrNull = (m: CvResult): Metrics | null => (m.n > 0 ? { n: m.n, rmse: m.rmse, mae: m.mae, bias: m.bias } : null);

/** Grid size for a bbox with roughly square cells on the ground, the longer side being `size` cells. */
export function gridSize(bbox: BBox, size: number): { width: number; height: number } {
  const midLat = (bbox[1] + bbox[3]) / 2;
  const wMeters = (bbox[2] - bbox[0]) * metersPerDegree(midLat).x;
  const hMeters = (bbox[3] - bbox[1]) * metersPerDegree(midLat).y;
  const scale = size / Math.max(wMeters, hMeters);
  return { width: Math.max(1, Math.round(wMeters * scale)), height: Math.max(1, Math.round(hMeters * scale)) };
}

async function regionBBox(pool: Pool, region: string): Promise<BBox | null> {
  const { rows } = await pool.query<{ bbox: BBox }>(
    "SELECT ARRAY[ST_XMin(e), ST_YMin(e), ST_XMax(e), ST_YMax(e)] AS bbox FROM (SELECT ST_Extent(bbox) AS e FROM raster_layers WHERE region = $1) t",
    [region],
  );
  return rows[0]?.bbox?.every((v) => v !== null) ? rows[0].bbox : null;
}

/** Water polygons of a region that intersect the bbox. */
async function fetchWaterPolygons(pool: Pool, region: string, bbox: BBox): Promise<Area[]> {
  const { rows } = await pool.query<{ geometry: Area }>(
    "SELECT ST_AsGeoJSON(geom, 6)::json AS geometry FROM land_cover WHERE region = $1 AND class = 'water' AND ST_Intersects(geom, ST_MakeEnvelope($2, $3, $4, $5, 4326))",
    [region, ...bbox],
  );
  return rows.map((r) => r.geometry);
}

/** Set cells that are at least half covered by a water polygon to NaN; returns how many were emptied. */
export function maskWater(grid: RasterGrid, polygons: readonly Area[]): number {
  let masked = 0;
  for (const poly of polygons) {
    const m = coverageMask(grid, poly, { supersample: 2 });
    if (!m) continue;
    for (let r = 0; r < m.height; r++) {
      for (let c = 0; c < m.width; c++) {
        if (m.weights[r * m.width + c]! < 0.5) continue;
        const i = (m.row0 + r) * grid.width + (m.col0 + c);
        if (!Number.isNaN(grid.data[i]!)) masked++;
        grid.data[i] = NaN;
      }
    }
  }
  return masked;
}

export interface Deps {
  pool: Pool;
  store: RasterStore;
}

interface Covariates {
  names: string[];
  /** Covariate values at each station (NaN where unavailable). */
  atPoints: number[][];
  grids: RasterGrid[];
}

async function loadCovariates(store: RasterStore, rows: CatalogRow[], points: readonly SamplePoint[], bbox: BBox, width: number, height: number): Promise<Covariates> {
  const names = [...COVARIATES];
  const rasters: GeoTiffRaster[] = await Promise.all(names.map((k) => store.get(rows.find((r) => r.kind === k)!.path)));
  const lonlat = points.map((p) => [p.lon, p.lat] as [number, number]);
  const [atCols, grids] = await Promise.all([
    Promise.all(rasters.map((r) => r.sampleMany(lonlat, { method: "bilinear" }))),
    Promise.all(
      rasters.map(async (r) => {
        const g = await r.readResampled(bbox, width, height, "average");
        if (!g) throw new ApiError(422, "The requested bbox does not overlap the covariate rasters");
        return g;
      }),
    ),
  ]);
  return { names, atPoints: points.map((_, i) => atCols.map((c) => c[i] ?? NaN)), grids };
}

export async function runInterpolation({ pool, store }: Deps, p: InterpolateParams): Promise<InterpolationResult> {
  const stationParams: StationsParams = { region: p.region, at: p.at, date: p.date, agg: p.agg, observed_only: true, limit: MAX_STATIONS };
  const fc = await fetchStations(pool, stationParams);
  const points: SamplePoint[] = fc.features.flatMap((f) => {
    const t = (f.properties as { temp_c: number | null } | null)?.temp_c;
    return typeof t === "number" ? [{ lon: f.geometry.coordinates[0]!, lat: f.geometry.coordinates[1]!, value: t }] : [];
  });
  if (points.length === 0) throw new ApiError(404, `No stations with a reading for region "${p.region}" at that time`);
  if (fc.truncated) throw new ApiError(422, `More than ${MAX_STATIONS} stations; narrow the request (not supported yet)`);

  const bbox = p.bbox ?? (await regionBBox(pool, p.region));
  if (!bbox) throw new ApiError(404, `Region "${p.region}" has no raster extent; pass bbox`);
  if (bbox[2] - bbox[0] > MAX_BBOX_DEG || bbox[3] - bbox[1] > MAX_BBOX_DEG) throw new ApiError(422, `bbox may span at most ${MAX_BBOX_DEG}° in each direction`);
  const { width, height } = gridSize(bbox, p.size);

  const catalog = p.method === "idw" ? [] : await fetchCatalog(pool, p.region, COVARIATES);
  const haveCovariates = COVARIATES.every((k) => catalog.some((r) => r.kind === k));
  let method: "idw" | "regression";
  let methodNote: string | null = null;
  if (p.method === "idw") method = "idw";
  else if (haveCovariates) method = "regression";
  else if (p.method === "regression") throw new ApiError(422, `Region "${p.region}" lacks the covariate rasters (${COVARIATES.join(", ")}) needed for method=regression`, { available: catalog.map((r) => r.kind) });
  else {
    method = "idw";
    methodNote = `auto fell back to idw: region lacks covariate rasters (${COVARIATES.filter((k) => !catalog.some((r) => r.kind === k)).join(", ")})`;
  }
  if (method === "regression" && p.method === "auto") methodNote = "auto chose regression: the region has impervious, canopy and elevation rasters";

  const idwOpts = { power: p.power, neighbors: p.neighbors, maxDistanceM: p.max_distance_m };
  const doCv = points.length >= 3 && points.length <= MAX_CV_STATIONS;
  const cv: InterpolationResult["cv"] = { idw: null, regression: null };
  if (!doCv) cv.skipped = points.length < 3 ? "needs at least 3 stations" : `skipped above ${MAX_CV_STATIONS} stations`;
  else cv.idw = finiteOrNull(idwLeaveOneOut(points, idwOpts));

  let grid: RasterGrid;
  let model: InterpolationResult["model"];
  let extrapolatedShare: number | undefined;
  if (method === "regression") {
    let cov: Covariates;
    try {
      cov = await loadCovariates(store, catalog, points, bbox, width, height);
    } catch (err) {
      if (err instanceof RangeError) throw new ApiError(422, "bbox covers too large an area of the covariate rasters");
      throw err;
    }
    const reg = regressionIdwGrid(points, cov.atPoints, cov.grids, { ...idwOpts, clamp: p.clamp });
    grid = reg.grid;
    extrapolatedShare = reg.clampedShare;
    const m: LinearModel = reg.model;
    model = { r2: m.r2, rmse: m.rmse, coefficients: Object.fromEntries(["intercept", ...cov.names].map((n, i) => [n, m.coefficients[i]!])) };
    if (doCv) cv.regression = finiteOrNull(regressionLeaveOneOut(points, cov.atPoints, { ...idwOpts, clamp: p.clamp }));
  } else {
    grid = idwGrid(points, bbox, width, height, idwOpts);
  }
  const waterMaskedCells = p.mask_water ? maskWater(grid, await fetchWaterPolygons(pool, p.region, bbox)) : 0;
  return { region: p.region, method, methodNote, grid, bbox, stationsUsed: points.length, cv, model, extrapolatedShare, waterMaskedCells };
}

const round = (v: number, d: number) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);

export function toJson(r: InterpolationResult, includeValues: boolean) {
  const s = r.grid.stats();
  const body: Record<string, unknown> = {
    region: r.region,
    method: r.method,
    methodNote: r.methodNote,
    stationsUsed: r.stationsUsed,
    bbox: r.bbox,
    width: r.grid.width,
    height: r.grid.height,
    stats: { min: round(s.min, 2), max: round(s.max, 2), mean: round(s.mean, 2), nodataCells: s.nodata },
    cv: r.cv,
    model: r.model,
    extrapolatedShare: r.extrapolatedShare === undefined ? undefined : round(r.extrapolatedShare, 3),
    waterMaskedCells: r.waterMaskedCells,
  };
  if (includeValues) body.values = Array.from(r.grid.data, (v) => round(v, 2));
  return body;
}

/** Cell centres as GeoJSON points carrying `temp_c`; no-data cells are omitted. */
export function toGeoJson(r: InterpolationResult): FeatureCollection<Point> {
  const g = r.grid;
  const features: Feature<Point>[] = [];
  for (let row = 0; row < g.height; row++) {
    for (let col = 0; col < g.width; col++) {
      const v = g.at(row, col);
      if (Number.isNaN(v)) continue;
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [Number((r.bbox[0] + (col + 0.5) * g.resX).toFixed(6)), Number((r.bbox[3] - (row + 0.5) * g.resY).toFixed(6))] },
        properties: { temp_c: round(v, 2) },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

/** The surface as a PNG in the "lst" ramp. Returns the image and the color domain used. */
export function toPng(r: InterpolationResult, vmin?: number, vmax?: number): { png: Buffer; domain: [number, number] } {
  const domain: [number, number] = vmin !== undefined && vmax !== undefined ? [vmin, vmax] : robustDomain(r.grid, 0, 100);
  const cm = colormapForKind("lst", domain);
  const g = r.grid;
  const rgba = new Uint8Array(g.width * g.height * 4);
  for (let i = 0; i < g.data.length; i++) {
    const v = g.data[i]!;
    if (Number.isNaN(v)) continue;
    const t = Math.min(Math.max((v - domain[0]) / (domain[1] - domain[0]), 0), 1) * (cm.stops.length - 1);
    const k = Math.min(Math.floor(t), cm.stops.length - 2);
    const f = t - k;
    const a = cm.stops[k]!.color;
    const b = cm.stops[k + 1]!.color;
    for (let c = 0; c < 4; c++) rgba[i * 4 + c] = Math.round(a[c]! + (b[c]! - a[c]!) * f);
  }
  return { png: encodePng(rgba, g.width, g.height), domain };
}

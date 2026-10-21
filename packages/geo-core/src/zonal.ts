import turfArea from "@turf/area";
import { type Area, boundsOf, pointInPolygons, polygonsOf, toArea } from "./geometry.js";
import type { RasterGrid } from "./raster-grid.js";
import { type GridExtent, windowForBBox } from "./resample.js";

export interface ZonalOptions {
  /**
   * Sub-samples per cell side used to estimate how much of each cell the polygon
   * covers (n x n points per cell). 1 = cell-centre test only; 4 (default) gives
   * ~1/16 coverage resolution at modest cost.
   */
  supersample?: number;
}

/** Per-cell polygon coverage (0..1) over the window of the grid the polygon touches. */
export interface CoverageMask {
  col0: number;
  row0: number;
  width: number;
  height: number;
  /** Row-major coverage fractions, length width*height. */
  weights: Float32Array;
  /** Sum of weights: polygon area expressed in cells. */
  totalWeight: number;
}

export interface ZonalStats {
  /** Sum of coverage weights over valid cells (the effective number of cells averaged). */
  weight: number;
  /** Valid cells with any coverage. */
  cells: number;
  /** Share (0..1) of the polygon's covered weight that fell on no-data cells. */
  nodataShare: number;
  mean: number;
  min: number;
  max: number;
  /** Coverage-weighted population standard deviation. */
  std: number;
  /** Polygon ground area in m² (geodesic). */
  areaM2: number;
}

/**
 * Coverage of each grid cell by `area`. If the polygon is too small to hit any
 * sub-sample (e.g. a 30 m buffer on 90 m cells), the cell containing its bbox
 * centre gets weight 1 so small zones still return a value. Null if the polygon
 * doesn't overlap the grid.
 */
export function coverageMask(grid: GridExtent, input: Area, { supersample = 4 }: ZonalOptions = {}): CoverageMask | null {
  if (!Number.isInteger(supersample) || supersample < 1) throw new RangeError("supersample must be a positive integer");
  const area = toArea(input);
  const bounds = boundsOf(area);
  const win = windowForBBox(grid, bounds);
  if (!win) return null;
  const [col0, row0, col1, row1] = win;
  const width = col1 - col0;
  const height = row1 - row0;
  const polys = polygonsOf(area);
  const weights = new Float32Array(width * height);
  const n = supersample;
  const west = grid.bbox[0];
  const north = grid.bbox[3];
  let total = 0;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      let hits = 0;
      for (let j = 0; j < n; j++) {
        const y = north - (row0 + r + (j + 0.5) / n) * grid.resY;
        for (let i = 0; i < n; i++) {
          if (pointInPolygons(west + (col0 + c + (i + 0.5) / n) * grid.resX, y, polys)) hits++;
        }
      }
      const w = hits / (n * n);
      weights[r * width + c] = w;
      total += w;
    }
  }
  if (total === 0) {
    const cx = Math.min(Math.max((((bounds[0] + bounds[2]) / 2) - west) / grid.resX, col0), col1 - 1e-9);
    const cy = Math.min(Math.max((north - (bounds[1] + bounds[3]) / 2) / grid.resY, row0), row1 - 1e-9);
    weights[(Math.floor(cy) - row0) * width + (Math.floor(cx) - col0)] = 1;
    total = 1;
  }
  return { col0, row0, width, height, weights, totalWeight: total };
}

/** Statistics of one layer under a precomputed mask (the mask must come from the same grid geometry). */
export function statsFromMask(grid: RasterGrid, mask: CoverageMask, areaM2: number): ZonalStats {
  let weight = 0;
  let nodataWeight = 0;
  let sum = 0;
  let cells = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let r = 0; r < mask.height; r++) {
    for (let c = 0; c < mask.width; c++) {
      const w = mask.weights[r * mask.width + c]!;
      if (w === 0) continue;
      const v = grid.at(mask.row0 + r, mask.col0 + c);
      if (Number.isNaN(v)) {
        nodataWeight += w;
        continue;
      }
      weight += w;
      sum += v * w;
      cells++;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  const mean = weight > 0 ? sum / weight : NaN;
  let sq = 0;
  if (weight > 0) {
    for (let r = 0; r < mask.height; r++) {
      for (let c = 0; c < mask.width; c++) {
        const w = mask.weights[r * mask.width + c]!;
        const v = w > 0 ? grid.at(mask.row0 + r, mask.col0 + c) : NaN;
        if (!Number.isNaN(v)) sq += w * (v - mean) ** 2;
      }
    }
  }
  return {
    weight,
    cells,
    nodataShare: mask.totalWeight > 0 ? nodataWeight / mask.totalWeight : 0,
    mean,
    min: cells ? min : NaN,
    max: cells ? max : NaN,
    std: weight > 0 ? Math.sqrt(sq / weight) : NaN,
    areaM2,
  };
}

const polygonAreaM2 = (area: Area) => turfArea({ type: "Feature", properties: {}, geometry: area });

/** Coverage-weighted statistics of `grid` inside a polygon; null if the polygon misses the grid. */
export function zonalStats(grid: RasterGrid, input: Area, opts: ZonalOptions = {}): ZonalStats | null {
  const area = toArea(input);
  const mask = coverageMask(grid, area, opts);
  return mask ? statsFromMask(grid, mask, polygonAreaM2(area)) : null;
}

/** Weighted share (0..1) of valid cells in the polygon for which `pred(value)` holds; null if none valid. */
export function zonalShare(grid: RasterGrid, input: Area, pred: (v: number) => boolean, opts: ZonalOptions = {}): number | null {
  const mask = coverageMask(grid, toArea(input), opts);
  if (!mask) return null;
  let hit = 0;
  let all = 0;
  for (let r = 0; r < mask.height; r++) {
    for (let c = 0; c < mask.width; c++) {
      const w = mask.weights[r * mask.width + c]!;
      const v = w > 0 ? grid.at(mask.row0 + r, mask.col0 + c) : NaN;
      if (Number.isNaN(v)) continue;
      all += w;
      if (pred(v)) hit += w;
    }
  }
  return all > 0 ? hit / all : null;
}


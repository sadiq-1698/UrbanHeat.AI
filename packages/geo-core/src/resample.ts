import { type BBox, RasterGrid } from "./raster-grid.js";

export type ResampleMethod = "nearest" | "bilinear" | "average";

const EPS = 1e-9; // absorbs float noise so a bbox on a cell edge doesn't gain a cell

/** Cell-index window [col0, row0, col1, row1) covering `bbox`, clamped to the grid; null if disjoint. */
export function windowForBBox(grid: RasterGrid, bbox: BBox): [number, number, number, number] | null {
  const [w, s, e, n] = grid.bbox;
  const west = Math.max(bbox[0], w);
  const south = Math.max(bbox[1], s);
  const east = Math.min(bbox[2], e);
  const north = Math.min(bbox[3], n);
  if (!(west < east && south < north)) return null;
  const col0 = Math.max(Math.floor((west - w) / grid.resX + EPS), 0);
  const col1 = Math.min(Math.ceil((east - w) / grid.resX - EPS), grid.width);
  const row0 = Math.max(Math.floor((n - north) / grid.resY + EPS), 0);
  const row1 = Math.min(Math.ceil((n - south) / grid.resY - EPS), grid.height);
  return col1 > col0 && row1 > row0 ? [col0, row0, col1, row1] : null;
}

/**
 * Sub-grid covering `bbox`, snapped outward to whole cells (so it can be slightly
 * larger than requested). Null when the bbox does not overlap the grid.
 */
export function cropGrid(grid: RasterGrid, bbox: BBox): RasterGrid | null {
  const win = windowForBBox(grid, bbox);
  if (!win) return null;
  const [col0, row0, col1, row1] = win;
  const width = col1 - col0;
  const height = row1 - row0;
  const data = new Float32Array(width * height);
  for (let r = 0; r < height; r++) {
    const start = (row0 + r) * grid.width + col0;
    data.set(grid.data.subarray(start, start + width), r * width);
  }
  return new RasterGrid(data, width, height, [
    grid.bbox[0] + col0 * grid.resX,
    grid.bbox[3] - row1 * grid.resY,
    grid.bbox[0] + col1 * grid.resX,
    grid.bbox[3] - row0 * grid.resY,
  ]);
}

/** Overlap weights of destination cell `i` (of `n`) over `srcN` source cells along one axis. */
function axisWeights(i: number, n: number, srcN: number): { start: number; weights: number[] } {
  const a = (i * srcN) / n;
  const b = ((i + 1) * srcN) / n;
  const start = Math.floor(a + EPS);
  const end = Math.min(Math.ceil(b - EPS), srcN);
  const weights: number[] = [];
  for (let k = start; k < end; k++) weights.push(Math.min(b, k + 1) - Math.max(a, k));
  return { start, weights };
}

/**
 * Resample to `width` x `height` over the same extent. No-data (NaN) never
 * contaminates results: `average` ignores NaN cells and renormalizes weights,
 * `bilinear` does the same via RasterGrid.bilinearAt, and `nearest` copies NaN.
 * Use `average` when shrinking (it integrates every source cell), `bilinear`
 * for smooth enlargement, and `nearest` for categorical data.
 */
export function resampleGrid(
  grid: RasterGrid,
  width: number,
  height: number,
  method: ResampleMethod = "bilinear",
): RasterGrid {
  const out = new Float32Array(width * height);
  const [west, south, east, north] = grid.bbox;
  const dx = (east - west) / width;
  const dy = (north - south) / height;

  if (method === "average") {
    const cols = Array.from({ length: width }, (_, i) => axisWeights(i, width, grid.width));
    for (let r = 0; r < height; r++) {
      const rw = axisWeights(r, height, grid.height);
      for (let c = 0; c < width; c++) {
        const cw = cols[c]!;
        let sum = 0;
        let weight = 0;
        for (let j = 0; j < rw.weights.length; j++) {
          for (let i = 0; i < cw.weights.length; i++) {
            const v = grid.at(rw.start + j, cw.start + i);
            if (Number.isNaN(v)) continue;
            const w = rw.weights[j]! * cw.weights[i]!;
            sum += v * w;
            weight += w;
          }
        }
        out[r * width + c] = weight > 0 ? sum / weight : NaN;
      }
    }
  } else {
    for (let r = 0; r < height; r++) {
      const lat = north - (r + 0.5) * dy;
      for (let c = 0; c < width; c++) {
        const lon = west + (c + 0.5) * dx;
        const v = method === "nearest" ? grid.valueAt(lon, lat) : grid.bilinearAt(lon, lat);
        out[r * width + c] = v ?? NaN;
      }
    }
  }
  return new RasterGrid(out, width, height, grid.bbox);
}

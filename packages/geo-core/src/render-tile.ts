import { type Colormap, colorAtValue } from "./colormap.js";
import type { GeoTiffRaster } from "./geotiff-raster.js";
import { encodePng } from "./png.js";
import { type RasterGrid } from "./raster-grid.js";
import { resampleGrid } from "./resample.js";
import { isValidTile, pixelLat, pixelLon, tileBBox } from "./tile.js";

export interface RenderTileOptions {
  /** Output tile width/height in pixels. Default 256. */
  size?: number;
  /** `bilinear` (default) for continuous data, `nearest` for categorical. */
  method?: "bilinear" | "nearest";
  /** Passed to the raster read; guards against decoding an enormous window at low zoom. */
  maxPixels?: number;
}

/** Render z/x/y from an in-memory grid that covers (at least part of) the tile: RGBA, transparent where there is no data. */
export function renderTileRgba(grid: RasterGrid, z: number, x: number, y: number, colormap: Colormap, { size = 256, method = "bilinear" }: RenderTileOptions = {}): Uint8ClampedArray {
  if (!isValidTile(z, x, y)) throw new RangeError(`invalid tile ${z}/${x}/${y}`);
  const [w, , e] = tileBBox(z, x, y);
  // When many raster cells fall inside one output pixel, point sampling would alias (speckle). Average down first.
  const pixelDeg = (e - w) / size;
  let src = grid;
  if (grid.resX < pixelDeg / 2) {
    // Mercator pixels are square on the ground, so their height in degrees of latitude is pixelDeg * cos(lat).
    const midLat = (grid.bbox[1] + grid.bbox[3]) / 2;
    const pixelDegY = pixelDeg * Math.cos((midLat * Math.PI) / 180);
    const width = Math.max(1, Math.ceil((grid.bbox[2] - grid.bbox[0]) / pixelDeg));
    const height = Math.max(1, Math.ceil((grid.bbox[3] - grid.bbox[1]) / pixelDegY));
    src = resampleGrid(grid, Math.min(width, grid.width), Math.min(height, grid.height), "average");
  }
  const lons = Float64Array.from({ length: size }, (_, c) => pixelLon(z, x, c, size));
  const out = new Uint8ClampedArray(size * size * 4);
  for (let r = 0; r < size; r++) {
    const lat = pixelLat(z, y, r, size);
    for (let c = 0; c < size; c++) {
      const v = method === "nearest" ? src.valueAt(lons[c]!, lat) : src.bilinearAt(lons[c]!, lat);
      if (v === null) continue; // stays 0,0,0,0 = transparent
      out.set(colorAtValue(colormap, v), (r * size + c) * 4);
    }
  }
  return out;
}

/**
 * Render tile z/x/y of a GeoTIFF as a PNG, or null if the tile doesn't touch the raster (callers
 * usually answer those with a shared empty tile).
 */
export async function renderTilePng(raster: GeoTiffRaster, z: number, x: number, y: number, colormap: Colormap, opts: RenderTileOptions = {}): Promise<Buffer | null> {
  if (!isValidTile(z, x, y)) throw new RangeError(`invalid tile ${z}/${x}/${y}`);
  const grid = await raster.read(tileBBox(z, x, y), { maxPixels: opts.maxPixels });
  if (!grid) return null;
  const size = opts.size ?? 256;
  return encodePng(renderTileRgba(grid, z, x, y, colormap, opts), size, size);
}

/** A fully transparent PNG, encoded once at the best compression level. */
export const emptyTilePng = (size = 256): Buffer => encodePng(new Uint8Array(size * size * 4), size, size, 9);

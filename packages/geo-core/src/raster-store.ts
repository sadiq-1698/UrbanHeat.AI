import { resolve, sep } from "node:path";
import { GeoTiffRaster } from "./geotiff-raster.js";

/**
 * Opens GeoTIFFs under one root directory (RASTER_DIR) and caches the open
 * handles, so API routes don't re-parse headers on every request. Paths come
 * from the `raster_layers.path` column but are still validated: they must stay
 * inside the root and be .tif/.tiff files.
 */
export class RasterStore {
  private readonly root: string;
  private readonly open = new Map<string, Promise<GeoTiffRaster>>();

  constructor(rootDir: string) {
    this.root = resolve(rootDir);
  }

  resolvePath(relPath: string): string {
    const full = resolve(this.root, relPath);
    if (!full.startsWith(this.root + sep) || !/\.tiff?$/i.test(full)) {
      throw new Error(`raster path not allowed: ${relPath}`);
    }
    return full;
  }

  get(relPath: string): Promise<GeoTiffRaster> {
    const full = this.resolvePath(relPath);
    let raster = this.open.get(full);
    if (!raster) {
      raster = GeoTiffRaster.open(full);
      // A failed open (missing file, wrong CRS) must not stay cached forever.
      raster.catch(() => this.open.delete(full));
      this.open.set(full, raster);
    }
    return raster;
  }

  async closeAll(): Promise<void> {
    const all = await Promise.allSettled([...this.open.values()]);
    for (const r of all) if (r.status === "fulfilled") r.value.close();
    this.open.clear();
  }
}

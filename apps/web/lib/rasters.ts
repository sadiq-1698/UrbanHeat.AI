import { RasterStore } from "@urbanheat/geo-core";
import { getEnv } from "./env";

const globalForRaster = globalThis as unknown as { __urbanheatRasters?: RasterStore };

/** Process-wide handle cache rooted at RASTER_DIR. */
export function getRasterStore(): RasterStore {
  return (globalForRaster.__urbanheatRasters ??= new RasterStore(getEnv().rasterDir));
}

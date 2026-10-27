import { RasterStore } from "@urbanheat/geo-core";
import { getEnv } from "./env";
import { createTileService } from "./raster-tiles";

const g = globalThis as unknown as { __urbanheatRasters?: RasterStore; __urbanheatTiles?: ReturnType<typeof createTileService> };

/** Process-wide handle cache rooted at RASTER_DIR. */
export function getRasterStore(): RasterStore {
  return (g.__urbanheatRasters ??= new RasterStore(getEnv().rasterDir));
}

/** Process-wide tile renderer (holds the tile LRU and per-layer color domains). */
export function getTileService() {
  return (g.__urbanheatTiles ??= createTileService(getRasterStore()));
}

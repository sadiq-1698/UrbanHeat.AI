import { stat } from "node:fs/promises";
import {
  FIXED_DOMAINS, RAMPS, colormapForKind, emptyTilePng, isRampKind, isValidTile, renderTilePng, robustDomain,
  type Domain, type RampKind, type RasterStore,
} from "@urbanheat/geo-core";
import type { Pool } from "pg";
import { z } from "zod";
import { LruCache } from "./lru";
import { ApiError } from "./http";
import { regionParam } from "./schemas";

export const TILE_SIZE = 256;
/** Overview size used to pick a layer's color domain (long side). */
const DOMAIN_SAMPLE_PX = 512;
const CATALOG_TTL_MS = 30_000;
const CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=3600";

const intSegment = (max?: number) => z.string().regex(/^\d{1,9}$/).transform(Number).pipe(max === undefined ? z.number() : z.number().max(max));

/** URL segments of /api/raster/tile/{region}/{kind}/{z}/{x}/{y}[.png], validated as a real tile. */
export const tileParams = z
  .object({
    region: regionParam,
    kind: z.string().refine(isRampKind, "unknown raster kind"),
    z: intSegment(22),
    x: intSegment(),
    y: z.string().regex(/^\d{1,9}(\.png)?$/).transform((s) => Number(s.replace(/\.png$/, ""))),
  })
  .refine((p) => isValidTile(p.z, p.x, p.y), "tile coordinates out of range for this zoom")
  .transform((p) => ({ ...p, kind: p.kind as RampKind }));

export const legendQuery = z.object({ region: regionParam, kind: z.string().refine(isRampKind, "unknown raster kind") });

export interface LayerRow {
  name: string;
  path: string;
  unit: string;
  kind: RampKind;
}

export interface LegendStop {
  value: number;
  /** #rrggbb */
  color: string;
  /** 0..1 */
  alpha: number;
}

export interface Legend {
  kind: RampKind;
  unit: string;
  domain: Domain;
  stops: LegendStop[];
}

export interface TileResult {
  status: 200 | 304;
  headers: Record<string, string>;
  body: Buffer | null;
}

const toHex = (c: readonly number[]) => `#${c.slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/**
 * Renders and caches raster tiles. Cache keys include the file's mtime, so re-ingesting a region
 * (new GeoTIFF) invalidates its tiles and color domains automatically.
 */
export function createTileService(store: RasterStore, opts: { maxTiles?: number } = {}) {
  const tiles = new LruCache<Buffer>(opts.maxTiles ?? 400);
  const domains = new Map<string, Promise<Domain>>();
  const empty = emptyTilePng(TILE_SIZE);

  async function version(row: LayerRow) {
    const s = await stat(store.resolvePath(row.path));
    return { mtime: s.mtimeMs, size: s.size, key: `${row.path}:${s.mtimeMs}:${s.size}` };
  }

  async function domainFor(row: LayerRow, key: string): Promise<Domain> {
    const fixed = FIXED_DOMAINS[row.kind];
    if (fixed) return fixed;
    let d = domains.get(key);
    if (!d) {
      d = (async () => {
        const raster = await store.get(row.path);
        const scale = DOMAIN_SAMPLE_PX / Math.max(raster.width, raster.height);
        const w = Math.max(1, Math.min(raster.width, Math.round(raster.width * scale)));
        const h = Math.max(1, Math.min(raster.height, Math.round(raster.height * scale)));
        const grid = await raster.readResampled(raster.bbox, w, h, "average");
        if (!grid) throw new Error("empty raster");
        return robustDomain(grid);
      })();
      d.catch(() => domains.delete(key)); // don't cache failures
      domains.set(key, d);
    }
    return d;
  }

  async function rasterOrThrow(row: LayerRow) {
    try {
      return await version(row);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        console.error(`raster file missing for layer ${row.name}: ${row.path}`);
        throw new ApiError(503, `Raster data for "${row.kind}" is unavailable`);
      }
      throw err;
    }
  }

  return {
    async tile(row: LayerRow, zoom: number, x: number, y: number, ifNoneMatch?: string | null): Promise<TileResult> {
      const v = await rasterOrThrow(row);
      const etag = `W/"${v.mtime.toString(36)}-${v.size.toString(36)}-${zoom}-${x}-${y}"`;
      const headers = { "Content-Type": "image/png", "Cache-Control": CACHE_CONTROL, ETag: etag };
      if (ifNoneMatch && ifNoneMatch.split(",").some((t) => t.trim() === etag)) return { status: 304, headers, body: null };

      const key = `${v.key}:${zoom}/${x}/${y}`;
      let png = tiles.get(key);
      if (!png) {
        const domain = await domainFor(row, v.key);
        let rendered: Buffer | null;
        try {
          rendered = await renderTilePng(await store.get(row.path), zoom, x, y, colormapForKind(row.kind, domain), { size: TILE_SIZE });
        } catch (err) {
          if (err instanceof RangeError) throw new ApiError(422, "Tile covers too much of the raster to render on the fly (needs overviews)");
          throw err;
        }
        png = rendered ?? empty;
        tiles.set(key, png);
      }
      return { status: 200, headers, body: png };
    },

    async legend(row: LayerRow): Promise<Legend> {
      const v = await rasterOrThrow(row);
      const domain = await domainFor(row, v.key);
      const ramp = RAMPS[row.kind];
      const cm = colormapForKind(row.kind, domain);
      return {
        kind: row.kind,
        unit: row.unit,
        domain,
        stops: cm.stops.map((s, i) => ({ value: s.value, color: toHex(s.color), alpha: Number((ramp.alphas[i]! / 255).toFixed(3)) })),
      };
    },
  };
}

/** Catalog lookups are per tile request and tiles arrive in bursts, so remember (region, kind) -> row briefly. */
const catalogCache = new Map<string, { at: number; row: LayerRow | null }>();

export async function findLayer(pool: Pool, region: string, kind: RampKind, now = Date.now()): Promise<LayerRow> {
  const key = `${region}/${kind}`;
  let hit = catalogCache.get(key);
  if (!hit || now - hit.at > CATALOG_TTL_MS) {
    const { rows } = await pool.query<LayerRow>("SELECT name, path, unit, kind FROM raster_layers WHERE region = $1 AND kind = $2", [region, kind]);
    hit = { at: now, row: rows[0] ?? null };
    catalogCache.set(key, hit);
  }
  if (!hit.row) throw new ApiError(404, `Region "${region}" has no ${kind} layer`);
  return hit.row;
}

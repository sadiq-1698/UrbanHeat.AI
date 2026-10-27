import type { BBox } from "./raster-grid.js";

/** Slippy-map (XYZ) tile math for Web Mercator, as used by MapLibre raster sources. */

export const MAX_ZOOM = 22;

/** True for integer z in 0..MAX_ZOOM and x, y in 0..2^z-1. */
export function isValidTile(z: number, x: number, y: number): boolean {
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > MAX_ZOOM) return false;
  const n = 2 ** z;
  return x >= 0 && x < n && y >= 0 && y < n;
}

/** Longitude (degrees) at a fractional tile x coordinate. */
export const tileXToLon = (tx: number, z: number): number => (tx / 2 ** z) * 360 - 180;

/** Latitude (degrees) at a fractional tile y coordinate. */
export function tileYToLat(ty: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * ty) / 2 ** z;
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}

/** [west, south, east, north] of tile z/x/y. */
export function tileBBox(z: number, x: number, y: number): BBox {
  return [tileXToLon(x, z), tileYToLat(y + 1, z), tileXToLon(x + 1, z), tileYToLat(y, z)];
}

/** Longitude of the centre of pixel column `col` in a `size`-pixel-wide tile. */
export const pixelLon = (z: number, x: number, col: number, size: number): number => tileXToLon(x + (col + 0.5) / size, z);

/** Latitude of the centre of pixel row `row` (0 = north). Rows are evenly spaced in Mercator y, not in latitude. */
export const pixelLat = (z: number, y: number, row: number, size: number): number => tileYToLat(y + (row + 0.5) / size, z);

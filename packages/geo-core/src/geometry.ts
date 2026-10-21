import turfBuffer from "@turf/buffer";
import { point } from "@turf/helpers";
import type { Feature, MultiPolygon, Polygon, Position } from "geojson";
import type { BBox } from "./raster-grid.js";

export type Area = Polygon | MultiPolygon;
/** One polygon as GeoJSON rings: [outer, ...holes]. */
export type Rings = Position[][];

const EARTH_RADIUS_M = 6_371_008.8; // same mean radius turf uses
const RAD = Math.PI / 180;

/** Accepts a Polygon/MultiPolygon geometry or a Feature wrapping one. */
export function toArea(input: Area | Feature<Area>): Area {
  const g = input.type === "Feature" ? input.geometry : input;
  if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) {
    throw new TypeError("expected a Polygon or MultiPolygon");
  }
  for (const rings of polygonsOf(g)) {
    if (rings.length === 0 || rings.some((r) => r.length < 4)) {
      throw new RangeError("polygon rings need at least 4 positions (closed)");
    }
  }
  return g;
}

export function polygonsOf(area: Area): Rings[] {
  return area.type === "Polygon" ? [area.coordinates] : area.coordinates;
}

export function boundsOf(area: Area): BBox {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const rings of polygonsOf(area)) {
    for (const [x, y] of rings[0]!) {
      if (x! < west) west = x!;
      if (x! > east) east = x!;
      if (y! < south) south = y!;
      if (y! > north) north = y!;
    }
  }
  return [west, south, east, north];
}

function inRing(x: number, y: number, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi! > y !== yj! > y && x < ((xj! - xi!) * (y - yi!)) / (yj! - yi!) + xi!) inside = !inside;
  }
  return inside;
}

/** Even-odd containment: inside the outer ring and outside every hole, for any member polygon. */
export function pointInPolygons(x: number, y: number, polys: Rings[]): boolean {
  for (const [outer, ...holes] of polys) {
    if (inRing(x, y, outer!) && !holes.some((h) => inRing(x, y, h))) return true;
  }
  return false;
}

/** Metres spanned by one degree of longitude / latitude at `lat` (spherical Earth). */
export function metersPerDegree(lat: number): { x: number; y: number } {
  const y = EARTH_RADIUS_M * RAD;
  return { x: y * Math.cos(lat * RAD), y };
}

/** Approximate ground area of one raster cell centred at `lat`, in m². */
export function cellAreaM2(lat: number, resX: number, resY: number): number {
  const m = metersPerDegree(lat);
  return resX * m.x * resY * m.y;
}

/** Great-circle distance in metres. */
export function haversineM(a: readonly [number, number], b: readonly [number, number]): number {
  const dLat = (b[1] - a[1]) * RAD;
  const dLon = (b[0] - a[0]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Geodesic-ish circle polygon (turf buffer) of `radiusM` metres around a point. */
export function circlePolygon(lon: number, lat: number, radiusM: number, steps = 32): Polygon {
  if (!(radiusM > 0)) throw new RangeError("radiusM must be > 0");
  const b = turfBuffer(point([lon, lat]), radiusM, { units: "meters", steps });
  if (!b) throw new Error("buffer failed");
  return b.geometry as Polygon;
}

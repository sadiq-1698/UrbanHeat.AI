/** [west, south, east, north] in degrees. */
export type BBox = [number, number, number, number];

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Smallest bbox containing all of `boxes`; null for an empty list. */
export function unionBBox(boxes: readonly BBox[]): BBox | null {
  if (boxes.length === 0) return null;
  return boxes.reduce<BBox>(
    (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])],
    [...boxes[0]!],
  );
}

/**
 * Viewport -> a bbox the API accepts. At low zooms or after wrapping across the antimeridian a map
 * can report longitudes beyond ±180 (or a latitude past the Mercator limit); clamp so the request is valid.
 */
export function viewportToBBox(b: { getWest(): number; getSouth(): number; getEast(): number; getNorth(): number }): BBox {
  const west = clamp(b.getWest(), -180, 180);
  const east = clamp(b.getEast(), -180, 180);
  const south = clamp(b.getSouth(), -90, 90);
  const north = clamp(b.getNorth(), -90, 90);
  return [west, south, east, north];
}

/** Does `inner` lie entirely within `outer`? */
export function bboxContains(outer: BBox, inner: BBox): boolean {
  return inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];
}

/** Pad a bbox by `fraction` of its width/height on each side (clamped to valid coordinates). */
export function padBBox(b: BBox, fraction: number): BBox {
  const dx = (b[2] - b[0]) * fraction;
  const dy = (b[3] - b[1]) * fraction;
  return [clamp(b[0] - dx, -180, 180), clamp(b[1] - dy, -90, 90), clamp(b[2] + dx, -180, 180), clamp(b[3] + dy, -90, 90)];
}

/** "w,s,e,n" with 5 decimals (~1 m), the format the API's `bbox` param expects. */
export function bboxToParam(b: BBox): string {
  return b.map((v) => Number(v.toFixed(5))).join(",");
}

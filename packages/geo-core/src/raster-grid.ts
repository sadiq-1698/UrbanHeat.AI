/** In-memory raster: float32 values on a regular EPSG:4326 grid, NaN = no data. */

/** [west, south, east, north] in degrees. */
export type BBox = [number, number, number, number];

export interface GridStats {
  /** Cells with a valid value. */
  count: number;
  /** Cells that are NaN. */
  nodata: number;
  min: number;
  max: number;
  mean: number;
  /** Population standard deviation. */
  std: number;
}

export class RasterGrid {
  /** Cell size in degrees (east-west / north-south). */
  readonly resX: number;
  readonly resY: number;

  constructor(
    readonly data: Float32Array,
    readonly width: number,
    readonly height: number,
    readonly bbox: BBox,
  ) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new RangeError(`invalid raster size ${width}x${height}`);
    }
    if (data.length !== width * height) {
      throw new RangeError(`data length ${data.length} does not match ${width}x${height}`);
    }
    const [west, south, east, north] = bbox;
    if (!(west < east && south < north)) throw new RangeError(`invalid bbox [${bbox}]`);
    this.resX = (east - west) / width;
    this.resY = (north - south) / height;
  }

  /** Raw cell value by (row, col); row 0 is the northern edge. */
  at(row: number, col: number): number {
    return this.data[row * this.width + col]!;
  }

  /** Fractional pixel coordinates (col, row) of a point; may lie outside the grid. */
  private toPixel(lon: number, lat: number): [number, number] {
    return [(lon - this.bbox[0]) / this.resX, (this.bbox[3] - lat) / this.resY];
  }

  contains(lon: number, lat: number): boolean {
    const [w, s, e, n] = this.bbox;
    return lon >= w && lon <= e && lat >= s && lat <= n;
  }

  /** Nearest-cell value, or null outside the grid or where the cell is no-data. */
  valueAt(lon: number, lat: number): number | null {
    if (!this.contains(lon, lat)) return null;
    const [x, y] = this.toPixel(lon, lat);
    // A point exactly on the east/south edge belongs to the last cell.
    const col = Math.min(Math.floor(x), this.width - 1);
    const row = Math.min(Math.floor(y), this.height - 1);
    const v = this.at(row, col);
    return Number.isNaN(v) ? null : v;
  }

  /**
   * Bilinear interpolation between the four cell centres around the point.
   * No-data neighbours are dropped and the remaining weights renormalized, so a
   * coastline doesn't poison the result; null if all four are no-data. Within
   * half a cell of the border the edge cell value is used.
   */
  bilinearAt(lon: number, lat: number): number | null {
    if (!this.contains(lon, lat)) return null;
    const [x, y] = this.toPixel(lon, lat);
    const fx = x - 0.5; // cell centres sit at +0.5
    const fy = y - 0.5;
    const c0 = Math.floor(fx);
    const r0 = Math.floor(fy);
    const tx = fx - c0;
    const ty = fy - r0;
    const clampC = (c: number) => Math.min(Math.max(c, 0), this.width - 1);
    const clampR = (r: number) => Math.min(Math.max(r, 0), this.height - 1);
    let sum = 0;
    let weight = 0;
    for (const [dr, dc, w] of [
      [0, 0, (1 - tx) * (1 - ty)],
      [0, 1, tx * (1 - ty)],
      [1, 0, (1 - tx) * ty],
      [1, 1, tx * ty],
    ] as const) {
      const v = this.at(clampR(r0 + dr), clampC(c0 + dc));
      if (w > 0 && !Number.isNaN(v)) {
        sum += v * w;
        weight += w;
      }
    }
    return weight > 0 ? sum / weight : null;
  }

  stats(): GridStats {
    let count = 0;
    let sum = 0;
    let sumSq = 0;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < this.data.length; i++) {
      const v = this.data[i]!;
      if (Number.isNaN(v)) continue;
      count++;
      sum += v;
      sumSq += v * v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const mean = count ? sum / count : NaN;
    const variance = count ? Math.max(sumSq / count - mean * mean, 0) : NaN;
    return {
      count,
      nodata: this.data.length - count,
      min: count ? min : NaN,
      max: count ? max : NaN,
      mean,
      std: Math.sqrt(variance),
    };
  }
}

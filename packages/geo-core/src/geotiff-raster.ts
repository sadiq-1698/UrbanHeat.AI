import { fromArrayBuffer, fromFile, type GeoTIFF, type GeoTIFFImage } from "geotiff";
import { type BBox, RasterGrid } from "./raster-grid.js";
import { resampleGrid, type ResampleMethod, windowForBBox } from "./resample.js";

/** Refuse to materialize more cells than this in one read (4 bytes each). */
const DEFAULT_MAX_PIXELS = 16_000_000;

export interface ReadOptions {
  /** 1-based band. Default 1. */
  band?: number;
  maxPixels?: number;
}

export interface SampleOptions {
  /** `nearest` (default) returns the containing cell; `bilinear` interpolates cell centres. */
  method?: "nearest" | "bilinear";
  band?: number;
}

/**
 * A GeoTIFF on disk (or in a buffer), read lazily through geotiff.js. Only the
 * requested window is decoded, so large files are fine; the file must be in
 * EPSG:4326 with a north-up grid. No-data cells come back as NaN.
 */
export class GeoTiffRaster {
  readonly width: number;
  readonly height: number;
  readonly bbox: BBox;
  readonly resX: number;
  readonly resY: number;
  /** The file's declared no-data value, if any. */
  readonly nodata: number | null;

  private constructor(
    private readonly tiff: GeoTIFF,
    private readonly image: GeoTIFFImage,
    readonly source: string,
  ) {
    this.width = image.getWidth();
    this.height = image.getHeight();
    const [west, south, east, north] = image.getBoundingBox() as [number, number, number, number];
    this.bbox = [west, south, east, north];
    this.resX = (east - west) / this.width;
    this.resY = (north - south) / this.height;
    this.nodata = image.getGDALNoData();
  }

  static async open(path: string): Promise<GeoTiffRaster> {
    return GeoTiffRaster.wrap(await fromFile(path), path);
  }

  static async fromBuffer(buffer: ArrayBuffer, label = "<buffer>"): Promise<GeoTiffRaster> {
    return GeoTiffRaster.wrap(await fromArrayBuffer(buffer), label);
  }

  private static async wrap(tiff: GeoTIFF, source: string): Promise<GeoTiffRaster> {
    const image = await tiff.getImage();
    const keys = (image.getGeoKeys() ?? {}) as Record<string, number>;
    if (keys.GeographicTypeGeoKey !== 4326 || keys.ProjectedCSTypeGeoKey) {
      throw new Error(
        `${source}: only EPSG:4326 GeoTIFFs are supported (found geographic=${keys.GeographicTypeGeoKey ?? "none"}, ` +
          `projected=${keys.ProjectedCSTypeGeoKey ?? "none"}); reproject with gdalwarp -t_srs EPSG:4326`,
      );
    }
    if (image.getOrigin().length < 2 || image.getResolution()[1]! >= 0) {
      throw new Error(`${source}: expected a north-up raster (negative y resolution)`);
    }
    return new GeoTiffRaster(tiff, image, source);
  }

  close(): void {
    this.tiff.close?.();
  }

  /** Cell window [col0,row0,col1,row1) -> grid. */
  private async readWindow(
    win: [number, number, number, number],
    { band = 1, maxPixels = DEFAULT_MAX_PIXELS }: ReadOptions = {},
  ): Promise<RasterGrid> {
    const [col0, row0, col1, row1] = win;
    const width = col1 - col0;
    const height = row1 - row0;
    if (width * height > maxPixels) {
      throw new RangeError(`${this.source}: window of ${width}x${height} cells exceeds maxPixels=${maxPixels}`);
    }
    const samples = this.image.getSamplesPerPixel();
    if (band < 1 || band > samples) throw new RangeError(`${this.source}: band ${band} not in 1..${samples}`);
    const bands = (await this.tiff.readRasters({ window: win, samples: [band - 1], interleave: false })) as unknown as ArrayLike<number>[];
    const raw = bands[0]!;
    const data = new Float32Array(width * height);
    const nodata = this.nodata;
    for (let i = 0; i < data.length; i++) {
      const v = raw[i]!;
      data[i] = Number.isFinite(v) && v !== nodata ? v : NaN;
    }
    return new RasterGrid(data, width, height, [
      this.bbox[0] + col0 * this.resX,
      this.bbox[3] - row1 * this.resY,
      this.bbox[0] + col1 * this.resX,
      this.bbox[3] - row0 * this.resY,
    ]);
  }

  /**
   * Native-resolution read of `bbox` (default: whole raster), snapped outward to
   * whole cells. Null if the bbox misses the raster.
   */
  async read(bbox: BBox = this.bbox, opts: ReadOptions = {}): Promise<RasterGrid | null> {
    const win = windowForBBox(this, bbox);
    return win ? this.readWindow(win, opts) : null;
  }

  /** Read `bbox` and resample to width x height (see resampleGrid for method guidance). */
  async readResampled(
    bbox: BBox,
    width: number,
    height: number,
    method: ResampleMethod = "bilinear",
    opts: ReadOptions = {},
  ): Promise<RasterGrid | null> {
    const grid = await this.read(bbox, opts);
    return grid ? resampleGrid(grid, width, height, method) : null;
  }

  /** Value at a point, or null outside the raster / on a no-data cell. */
  async sample(lon: number, lat: number, opts: SampleOptions = {}): Promise<number | null> {
    return (await this.sampleMany([[lon, lat]], opts))[0]!;
  }

  /**
   * Values at many points, in order. Points are read through one window spanning
   * all of them when it fits `maxPixels`, otherwise one tiny window per point.
   */
  async sampleMany(
    points: ReadonlyArray<readonly [number, number]>,
    { method = "nearest", band = 1 }: SampleOptions = {},
  ): Promise<(number | null)[]> {
    const [w, s, e, n] = this.bbox;
    const inside = points.map(([lon, lat]) => lon >= w && lon <= e && lat >= s && lat <= n);
    const results: (number | null)[] = points.map(() => null);
    const idx = points.flatMap((_, i) => (inside[i] ? [i] : []));
    if (idx.length === 0) return results;

    const cellOf = ([lon, lat]: readonly [number, number]): [number, number] => [
      Math.min(Math.floor((lon - w) / this.resX), this.width - 1),
      Math.min(Math.floor((n - lat) / this.resY), this.height - 1),
    ];
    const pad = method === "bilinear" ? 1 : 0;
    const clampWin = (c: number, r: number): [number, number, number, number] => [
      Math.max(c - pad, 0), Math.max(r - pad, 0),
      Math.min(c + pad + 1, this.width), Math.min(r + pad + 1, this.height),
    ];

    const cells = idx.map((i) => cellOf(points[i]!));
    const cols = cells.map((c) => c[0]);
    const rows = cells.map((c) => c[1]);
    const span = clampWin(Math.min(...cols), Math.min(...rows));
    const spanMax = clampWin(Math.max(...cols), Math.max(...rows));
    const union: [number, number, number, number] = [span[0], span[1], spanMax[2], spanMax[3]];
    const single = (union[2] - union[0]) * (union[3] - union[1]) <= DEFAULT_MAX_PIXELS;

    const lookup = (g: RasterGrid, [lon, lat]: readonly [number, number]) =>
      method === "bilinear" ? g.bilinearAt(lon, lat) : g.valueAt(lon, lat);

    if (single) {
      const grid = await this.readWindow(union, { band });
      idx.forEach((i) => (results[i] = lookup(grid, points[i]!)));
    } else {
      for (let k = 0; k < idx.length; k++) {
        const grid = await this.readWindow(clampWin(cells[k]![0], cells[k]![1]), { band });
        results[idx[k]!] = lookup(grid, points[idx[k]!]!);
      }
    }
    return results;
  }
}

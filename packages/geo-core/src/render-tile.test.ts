import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { colorAtValue, colormapFromHex } from "./colormap.js";
import { GeoTiffRaster } from "./geotiff-raster.js";
import { emptyTilePng, renderTilePng, renderTileRgba } from "./render-tile.js";
import { RasterGrid } from "./raster-grid.js";
import { lonLatToTile, pixelLat, pixelLon, tileBBox } from "./tile.js";

const fixture = (n: string) => fileURLToPath(new URL(`../test-fixtures/${n}`, import.meta.url));
const cm = colormapFromHex([1, 16], ["#0000ff", "#ff0000"], [255, 255]);

/** Decode a tile PNG written by encodePng back to RGBA bytes. */
function pngPixels(png: Buffer, size: number): Uint8Array {
  let off = 8;
  let idat = Buffer.alloc(0);
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    if (png.toString("ascii", off + 4, off + 8) === "IDAT") idat = Buffer.concat([idat, png.subarray(off + 8, off + 8 + len)]);
    off += 12 + len;
  }
  const raw = inflateSync(idat);
  const out = new Uint8Array(size * size * 4);
  for (let r = 0; r < size; r++) out.set(raw.subarray(r * (size * 4 + 1) + 1, (r + 1) * (size * 4 + 1)), r * size * 4);
  return out;
}

test("pixels match a direct lookup of the same location, and are transparent outside the raster", async () => {
  const r = await GeoTiffRaster.open(fixture("grid4.tif")); // lon 10..14, lat 50..54, values 1..16
  const z = 6;
  const { x, y } = lonLatToTile(14, 54, z); // the tile holding the raster's NE corner: only partly covered
  const bbox = tileBBox(z, x, y);
  const grid = (await r.read(bbox))!;
  assert.ok(grid, "tile should overlap the raster");
  const size = 64;
  const rgba = renderTileRgba(grid, z, x, y, cm, { size });
  let inside = 0;
  let outside = 0;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const lon = pixelLon(z, x, col, size);
      const lat = pixelLat(z, y, row, size);
      const expected = grid.bilinearAt(lon, lat);
      const px = [...rgba.subarray((row * size + col) * 4, (row * size + col) * 4 + 4)];
      if (expected === null) {
        outside++;
        assert.deepEqual(px, [0, 0, 0, 0], `row ${row} col ${col}`);
      } else {
        inside++;
        assert.deepEqual(px, colorAtValue(cm, expected));
      }
    }
  }
  assert.ok(inside > 0 && outside > 0, `inside=${inside} outside=${outside}`); // a partial tile: both kinds present
});

test("no-data cells render transparent and neighbours are not poisoned", async () => {
  const r = await GeoTiffRaster.open(fixture("grid4-nodata.tif")); // cell value 6 is nodata
  const z = 8;
  const { x, y } = lonLatToTile(11.5, 52.5, z); // z8 tile around the no-data cell (lon 11..12, lat 52..53)
  const grid = (await r.read(tileBBox(z, x, y)))!;
  const rgba = renderTileRgba(grid, z, x, y, cm, { size: 64, method: "nearest" });
  // The 6-cell is lon 11..12, lat 52..53; sample exactly inside it through pixel centres.
  let sawHole = false;
  for (let row = 0; row < 64; row++) {
    for (let col = 0; col < 64; col++) {
      const lon = pixelLon(z, x, col, 64);
      const lat = pixelLat(z, y, row, 64);
      if (lon > 11 && lon < 12 && lat > 52 && lat < 53) {
        sawHole = true;
        assert.equal(rgba[(row * 64 + col) * 4 + 3], 0);
      }
    }
  }
  assert.ok(sawHole, "test tile should contain the no-data cell");
});

test("renderTilePng returns a PNG for overlapping tiles and null for disjoint ones", async () => {
  const r = await GeoTiffRaster.open(fixture("grid4.tif"));
  const t = lonLatToTile(12, 52, 8);
  const png = (await renderTilePng(r, 8, t.x, t.y, cm, { size: 32 }))!;
  assert.deepEqual([...png.subarray(1, 4)], [0x50, 0x4e, 0x47]);
  assert.equal(pngPixels(png, 32).length, 32 * 32 * 4);
  const far = lonLatToTile(-100, 40, 8);
  assert.equal(await renderTilePng(r, 8, far.x, far.y, cm, { size: 32 }), null);
  await assert.rejects(renderTilePng(r, 3, 9, 0, cm), RangeError);
});

test("zoomed-out tiles average instead of point-sampling (no speckle from fine data)", async () => {
  // Checkerboard of 0/100 at 0.001° cells; a z8 pixel (~0.0055°) spans several cells, so output should be ~mid-grey, not 0/100.
  const n = 200;
  const data = Float32Array.from({ length: n * n }, (_, i) => ((i % n) + Math.floor(i / n)) % 2 === 0 ? 0 : 100);
  const [z, tx, ty] = [8, lonLatToTile(11.5, 52.5, 8).x, lonLatToTile(11.5, 52.5, 8).y];
  const [tw, , , tn] = tileBBox(z, tx, ty);
  const west = tw + 0.3; // a 0.2° x 0.2° patch well inside the tile
  const north = tn - 0.3;
  const grid = new RasterGrid(data, n, n, [west, north - n * 0.001, west + n * 0.001, north]);
  const gray = colormapFromHex([0, 100], ["#000000", "#ffffff"]);
  const rgba = renderTileRgba(grid, z, tx, ty, gray, { size: 128 });
  const reds: number[] = [];
  for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3] === 255) reds.push(rgba[i]!);
  assert.ok(reds.length > 20, `only ${reds.length} covered pixels`);
  const mean = reds.reduce((a, b) => a + b, 0) / reds.length;
  const spread = Math.max(...reds) - Math.min(...reds);
  assert.ok(mean > 100 && mean < 155, `mean ${mean}`);
  assert.ok(spread < 120, `spread ${spread}: expected averaged values, not 0/255 speckle`);
});

test("emptyTilePng is a tiny transparent PNG", () => {
  const png = emptyTilePng(256);
  assert.ok(png.length < 400);
  assert.ok(pngPixels(png, 256).every((b) => b === 0));
});

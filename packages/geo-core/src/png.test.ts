import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32, inflateSync } from "node:zlib";
import { encodePng } from "./png.js";

/** Minimal PNG reader for the subset we write (8-bit RGBA, filter 0), validating chunk CRCs as it goes. */
function decode(png: Buffer) {
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let off = 8;
  const chunks: Record<string, Buffer> = {};
  const order: string[] = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString("ascii", off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    const crc = png.readUInt32BE(off + 8 + len);
    assert.equal(crc, crc32(png.subarray(off + 4, off + 8 + len)) >>> 0, `bad CRC in ${type}`);
    chunks[type] = data;
    order.push(type);
    off += 12 + len;
  }
  const width = chunks.IHDR!.readUInt32BE(0);
  const height = chunks.IHDR!.readUInt32BE(4);
  const raw = inflateSync(chunks.IDAT!);
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  for (let r = 0; r < height; r++) {
    assert.equal(raw[r * (stride + 1)], 0, "filter byte");
    raw.copy(pixels, r * stride, r * (stride + 1) + 1, (r + 1) * (stride + 1));
  }
  return { width, height, depth: chunks.IHDR![8], colour: chunks.IHDR![9], pixels, order };
}

test("round-trips pixels exactly", () => {
  const w = 3;
  const h = 2;
  const rgba = Uint8Array.from({ length: w * h * 4 }, (_, i) => (i * 37) % 256);
  const d = decode(encodePng(rgba, w, h));
  assert.deepEqual([d.width, d.height, d.depth, d.colour], [3, 2, 8, 6]);
  assert.deepEqual([...d.pixels], [...rgba]);
  assert.deepEqual(d.order, ["IHDR", "IDAT", "IEND"]);
});

test("encodes a full tile and compresses flat regions", () => {
  const rgba = new Uint8Array(256 * 256 * 4); // fully transparent
  const png = encodePng(rgba, 256, 256); // default level 3: fast, still ~200x smaller than raw
  assert.ok(png.length < 2000, `transparent tile is ${png.length} bytes`);
  assert.ok(encodePng(rgba, 256, 256, 9).length < 400); // best level, for constants encoded once
  const d = decode(png);
  assert.equal(d.pixels.length, 256 * 256 * 4);
  assert.ok(d.pixels.every((b) => b === 0));
});

test("accepts Uint8ClampedArray and rejects mismatched input", () => {
  const png = encodePng(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1);
  assert.deepEqual([...decode(png).pixels], [255, 0, 0, 255]);
  assert.throws(() => encodePng(new Uint8Array(3), 1, 1), RangeError);
  assert.throws(() => encodePng(new Uint8Array(0), 0, 0), RangeError);
  assert.throws(() => encodePng(new Uint8Array(16), 2.5, 2), RangeError);
});

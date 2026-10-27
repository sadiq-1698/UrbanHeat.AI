import { crc32, deflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeAndData.copy(out, 4);
  out.writeUInt32BE(crc32(typeAndData) >>> 0, 8 + data.length);
  return out;
}

/**
 * Encode 8-bit RGBA pixels (row-major, `width * height * 4` bytes) as a PNG. Uses filter type 0 on every
 * row and a fast deflate level: tiles are rendered per request, so encode speed matters more than size.
 */
export function encodePng(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, level = 3): Buffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`invalid PNG size ${width}x${height}`);
  }
  if (rgba.length !== width * height * 4) throw new RangeError(`expected ${width * height * 4} bytes, got ${rgba.length}`);
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height); // each row: filter byte (0) + pixels
  for (let r = 0; r < height; r++) {
    raw.set(rgba.subarray(r * stride, (r + 1) * stride), r * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level })), chunk("IEND", Buffer.alloc(0))]);
}

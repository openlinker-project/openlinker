/**
 * Programmatic PNG image generator (offline, zero-dependency)
 *
 * The golden-path fresh product (E3) must carry at least one photo or Allegro's
 * offer validator rejects the created offer with "Wymagane jest co najmniej 1
 * zdjęcie" ("at least 1 photo required"). We can't fetch images from the network
 * (offline / CSP), so we synthesize valid RGB PNGs on the fly and upload them to
 * the PrestaShop product via the webservice image endpoint.
 *
 * Images are generated large enough (default 800x800) to clear Allegro's minimum
 * resolution requirement, and each carries a distinct base colour + simple stripe
 * pattern so a run visibly attaches several DIFFERENT photos, not one repeated.
 *
 * Only Node built-ins are used: `zlib` for DEFLATE + CRC32, `Buffer` for bytes.
 *
 * @module api
 */

import { deflateSync } from 'node:zlib';

export interface GeneratedImage {
  bytes: Buffer;
  filename: string;
  contentType: string;
}

/** An RGB colour, each channel 0-255. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** CRC32 over a buffer using the standard IEEE polynomial (0xEDB88320). */
function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Wrap chunk data in a PNG chunk (length + type + data + CRC). */
function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBytes, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

/**
 * Build a valid RGB PNG of `size`x`size` filled with `base`, overlaid with a few
 * lighter diagonal stripes so the image isn't a flat single colour.
 */
export function generatePng(base: Rgb, size = 800): Buffer {
  const bytesPerPixel = 3;
  const stride = 1 + size * bytesPerPixel; // 1 filter byte per scanline
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter type 0 (None)
    for (let x = 0; x < size; x += 1) {
      // Diagonal stripe every 80px lightens the pixel to add visible structure.
      const stripe = ((x + y) % 160) < 80;
      const px = rowStart + 1 + x * bytesPerPixel;
      const lighten = stripe ? 60 : 0;
      raw[px] = Math.min(255, base.r + lighten);
      raw[px + 1] = Math.min(255, base.g + lighten);
      raw[px + 2] = Math.min(255, base.b + lighten);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = truecolour RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Three DISTINCT product photos (red, green, blue base colours) for the fresh
 * product. Distinct enough that a run visibly attaches multiple different images.
 */
export function buildFreshProductImages(size = 800): GeneratedImage[] {
  const palette: Array<{ name: string; color: Rgb }> = [
    { name: 'photo-red', color: { r: 200, g: 60, b: 60 } },
    { name: 'photo-green', color: { r: 60, g: 170, b: 90 } },
    { name: 'photo-blue', color: { r: 60, g: 90, b: 200 } },
  ];
  return palette.map(({ name, color }) => ({
    bytes: generatePng(color, size),
    filename: `${name}.png`,
    contentType: 'image/png',
  }));
}

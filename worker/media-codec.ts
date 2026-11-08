import decodeJpeg, { init as initJpeg } from '@jsquash/jpeg/decode.js';
import decodePng, { init as initPng } from '@jsquash/png/decode.js';
import jpegModule from '@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm';
import pngModule from '@jsquash/png/codec/pkg/squoosh_png_bg.wasm';
import {
  MEDIA_MAX_BYTES,
  MEDIA_MAX_EDGE,
  MEDIA_MAX_PIXELS,
  JPEG_MAX_PIXELS,
  PNG_HIGH_RES_BYTES,
} from '../src/shared/media';
export interface NormalizedMedia {
  bytes: Uint8Array<ArrayBuffer>;
  mime: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
}

// Pure codec setup runs at Worker startup; no request, identity, binding or external fetch is held.
const ready = Promise.all([
  initJpeg({
    instantiateWasm(
      imports: WebAssembly.Imports,
      receive: (instance: WebAssembly.Instance) => void,
    ) {
      const instance = new WebAssembly.Instance(jpegModule, imports);
      receive(instance);
      return instance.exports;
    },
    print: () => {},
    printErr: () => {},
  }),
  initPng(pngModule),
]).then(
  () => true,
  () => false,
);
export async function warmMediaCodec() {
  return ready;
}
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
function dimensions(width: number, height: number, pixels: number) {
  return (
    width >= 1 &&
    height >= 1 &&
    width <= MEDIA_MAX_EDGE &&
    height <= MEDIA_MAX_EDGE &&
    width * height <= pixels
  );
}
function concat(chunks: Uint8Array[]) {
  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc(bytes: Uint8Array) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
async function png(bytes: Uint8Array): Promise<NormalizedMedia | null> {
  if (!pngSignature.every((value, index) => bytes[index] === value)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length),
    chunks = [bytes.subarray(0, 8)],
    compressed: Uint8Array[] = [];
  let offset = 8,
    width = 0,
    height = 0,
    channels = 0,
    count = 0,
    ended = false,
    imageEnded = false;
  while (offset < bytes.length && !ended) {
    if (++count > 1024 || offset + 12 > bytes.length) return null;
    const length = view.getUint32(offset),
      end = offset + 12 + length;
    if (length > MEDIA_MAX_BYTES || end > bytes.length) return null;
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (
      !/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type) ||
      crc(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4)
    )
      return null;
    if (count === 1 && type !== 'IHDR') return null;
    if (type === 'IHDR') {
      if (count !== 1 || length !== 13) return null;
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      const color = bytes[offset + 17];
      channels = color === 2 ? 3 : color === 6 ? 4 : 0;
      if (
        !dimensions(width, height, MEDIA_MAX_PIXELS) ||
        (width * height > JPEG_MAX_PIXELS && bytes.length > PNG_HIGH_RES_BYTES) ||
        bytes[offset + 16] !== 8 ||
        !channels ||
        bytes[offset + 18] !== 0 ||
        bytes[offset + 19] !== 0 ||
        bytes[offset + 20] !== 0
      )
        return null;
    } else if (type === 'IDAT') {
      if (imageEnded) return null;
      compressed.push(bytes.subarray(offset + 8, end - 4));
    } else if (type === 'IEND') {
      if (length || !compressed.length) return null;
      ended = true;
    } else {
      if (compressed.length) imageEnded = true;
      // Reject animations, colour-key transparency and unsupported critical chunks.
      // Browser preparation emits ordinary RGB/RGBA pixels, not these containers.
      if (['acTL', 'fcTL', 'fdAT', 'tRNS'].includes(type) || type[0] === type[0].toUpperCase())
        return null;
    }
    if (['IHDR', 'IDAT', 'IEND'].includes(type)) chunks.push(bytes.subarray(offset, end));
    offset = end;
  }
  if (!ended || offset !== bytes.length) return null;
  const clean = concat(chunks);
  // Bound the *decoded* zlib stream before a library can allocate from its length.
  const expected = height * (width * channels + 1),
    input = concat(compressed);
  const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream('deflate'));
  const reader = stream.getReader();
  let inflated = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      inflated += next.value.length;
      if (inflated > expected) return null;
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (inflated !== expected) return null;
  const decoded = await decodePng(clean.slice().buffer);
  return decoded.width === width &&
    decoded.height === height &&
    decoded.data.length === width * height * 4
    ? { bytes: clean, mime: 'image/png', width, height }
    : null;
}
function jpegContainer(bytes: Uint8Array) {
  if (bytes[0] !== 255 || bytes[1] !== 216) return null;
  const parts = [bytes.subarray(0, 2)],
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  let offset = 2,
    width = 0,
    height = 0,
    count = 0,
    scan = false,
    ended = false;
  while (offset < bytes.length) {
    if (++count > 256 || bytes[offset] !== 255 || offset + 1 >= bytes.length) return null;
    const marker = bytes[offset + 1];
    if (marker === 217) {
      parts.push(bytes.subarray(offset, offset + 2));
      offset += 2;
      ended = true;
      break;
    }
    if (scan || offset + 4 > bytes.length || marker === 216 || marker === 0) return null;
    const length = view.getUint16(offset + 2),
      end = offset + 2 + length;
    if (length < 2 || end > bytes.length) return null;
    if (marker === 192) {
      if (width || length !== 17 || bytes[offset + 4] !== 8 || bytes[offset + 9] !== 3) return null;
      height = view.getUint16(offset + 5);
      width = view.getUint16(offset + 7);
      if (!dimensions(width, height, JPEG_MAX_PIXELS)) return null;
      for (let c = 0; c < 3; c++) {
        const start = offset + 10 + c * 3,
          sampling = bytes[start + 1];
        if (
          bytes[start] !== c + 1 ||
          !(sampling >> 4) ||
          !(sampling & 15) ||
          sampling >> 4 > 2 ||
          (sampling & 15) > 2 ||
          bytes[start + 2] > 3
        )
          return null;
      }
    } else if (marker >= 193 && marker <= 207 && ![196, 204].includes(marker)) return null;
    if ((marker >= 224 && marker <= 239) || marker === 254) {
      // All APP/COM segments, including EXIF/GPS, ICC, thumbnails and comments, are removed.
      // Reject orientation-changing EXIF: removing it must not silently rotate a raw camera image.
      if (marker === 225 && !normalOrientation(bytes.subarray(offset + 4, end))) return null;
      if (marker === 238) return null; // Adobe CMYK / non-default colour transforms are not normalized RGB.
    } else {
      if (![192, 196, 219, 221, 218].includes(marker)) return null;
      parts.push(bytes.subarray(offset, end));
    }
    offset = end;
    if (marker === 218) {
      if (
        !width ||
        length !== 12 ||
        bytes[end - 3] !== 0 ||
        bytes[end - 2] !== 63 ||
        bytes[end - 1] !== 0
      )
        return null;
      scan = true;
      const start = offset;
      while (offset < bytes.length) {
        if (bytes[offset] !== 255) {
          offset++;
          continue;
        }
        const code = bytes[offset + 1];
        if (code === 0 || (code >= 208 && code <= 215)) {
          offset += 2;
          continue;
        }
        if (code === 217) {
          parts.push(bytes.subarray(start, offset));
          break;
        }
        return null;
      }
    }
  }
  return ended && scan && offset === bytes.length ? { bytes: concat(parts), width, height } : null;
}
function normalOrientation(app: Uint8Array) {
  if (String.fromCharCode(...app.subarray(0, 6)) !== 'Exif\0\0') return true;
  if (app.length < 14) return false;
  const little = app[6] === 73 && app[7] === 73;
  if (!little && !(app[6] === 77 && app[7] === 77)) return false;
  const v = new DataView(app.buffer, app.byteOffset + 6, app.length - 6);
  if (v.getUint16(2, little) !== 42) return false;
  const offset = v.getUint32(4, little);
  if (offset < 8 || offset + 2 > v.byteLength) return false;
  const count = v.getUint16(offset, little);
  if (count > 128 || offset + 2 + count * 12 + 4 > v.byteLength) return false;
  for (let i = 0; i < count; i++) {
    const pos = offset + 2 + i * 12;
    if (
      v.getUint16(pos, little) === 274 &&
      (v.getUint16(pos + 2, little) !== 3 ||
        v.getUint32(pos + 4, little) !== 1 ||
        v.getUint16(pos + 8, little) !== 1)
    )
      return false;
  }
  return true;
}

/** Full server decode is independent of the browser resize. Never trusts MIME or image headers alone. */
export async function normalizeMedia(
  bytes: Uint8Array,
  mime: string,
): Promise<NormalizedMedia | null> {
  if (!bytes.length || bytes.length > MEDIA_MAX_BYTES || !(await ready)) return null;
  try {
    if (mime === 'image/png') return await png(bytes);
    if (mime !== 'image/jpeg') return null;
    const clean = jpegContainer(bytes);
    if (!clean) return null;
    const decoded = await decodeJpeg(clean.bytes.slice().buffer);
    return decoded.width === clean.width &&
      decoded.height === clean.height &&
      decoded.data.length === clean.width * clean.height * 4
      ? { ...clean, mime: 'image/jpeg' }
      : null;
  } catch {
    return null;
  }
}

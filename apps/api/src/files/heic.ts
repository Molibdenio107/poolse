import decode = require('heic-decode');
import { encode } from 'jpeg-js';

/**
 * iPhone photographs — POOLSE-179 (Rui, 05-11-2026: convert them). The bucket
 * and `stored_file` take PDF, JPEG, PNG and WebP; Chrome and Edge cannot show a
 * HEIC, so the office could not read one. A HEIC is turned into a JPEG before it
 * is judged like any other upload, and never stored as itself.
 *
 * - **Recognised by its bytes**, never by its name: an ISO-BMFF `ftyp` box with
 *   a HEIF brand, the test `heic-decode` applies itself.
 * - **Measured before it is decoded.** The width and height come from the
 *   container; a picture over `MAX_HEIC_PIXELS` is refused before a pixel is
 *   expanded, so a small file cannot ask for gigabytes (a decompression bomb).
 * - **Re-encoded, not re-wrapped**, so EXIF does not survive — including the
 *   GPS position a phone writes into every photo.
 */
const BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1']);

/** 50 MP: a 48 MP iPhone photo fits; anything bigger is not a photo of a document. */
export const MAX_HEIC_PIXELS = 50_000_000;

export function looksLikeHeic(bytes: Buffer): boolean {
  return (
    bytes.length >= 12 &&
    bytes.toString('latin1', 4, 8) === 'ftyp' &&
    BRANDS.has(bytes.toString('latin1', 8, 12).replace('\0', ' ').trim())
  );
}

/**
 * One decode at a time, across the whole process. A 50 MP picture is about 200 MB
 * of pixels; the hourly limit bounds one person, not many at once (review,
 * 05-11-2026). A family waits a second longer; the API never holds two.
 */
let queue: Promise<unknown> = Promise.resolve();

export function heicToJpeg(bytes: Buffer): Promise<Buffer | 'too_large' | 'unreadable'> {
  const turn = queue.then(() => convert(bytes));
  queue = turn.catch(() => undefined);
  return turn;
}

async function convert(bytes: Buffer): Promise<Buffer | 'too_large' | 'unreadable'> {
  let images: Awaited<ReturnType<typeof decode.all>>;
  try {
    images = await decode.all({ buffer: bytes });
  } catch {
    return 'unreadable';
  }
  try {
    const first = images[0];
    if (first === undefined) return 'unreadable';
    if (first.width * first.height > MAX_HEIC_PIXELS) return 'too_large';
    const image = await first.decode();
    const jpeg = encode(
      { width: image.width, height: image.height, data: Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength) },
      85,
    );
    return Buffer.from(jpeg.data);
  } catch {
    return 'unreadable';
  } finally {
    images.dispose();
  }
}

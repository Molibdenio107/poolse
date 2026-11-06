/**
 * A JPEG's metadata, removed — POOLSE-179 security review (05-11-2026).
 *
 * A phone writes EXIF into every photograph: the camera, the time and, unless
 * the owner turned it off, **where it was taken** — usually the family's home.
 * Nobody at the club needs that, and a photo of a child's identity card is the
 * last place it should travel. So every JPEG is stripped on upload, whatever
 * its purpose.
 *
 * **Lossless.** The image data is not decoded or re-encoded: the metadata
 * segments are cut out of the byte stream (APP1 — EXIF and XMP — and APP13 —
 * Photoshop/IPTC) and every other segment is copied as it was.
 *
 * **Orientation survives.** A phone stores a portrait photo sideways and says so
 * in EXIF tag 0x0112; dropping it would show every ID card on its side. When
 * the original had an orientation other than 1, a minimal EXIF segment holding
 * only that tag is written back. Nothing else is.
 *
 * Anything that does not parse as a JPEG segment stream is returned unchanged:
 * the upload check has already decided it is a JPEG by its magic bytes, and a
 * file we cannot walk is better stored as sent than refused here.
 */

const SOI = 0xd8;
const SOS = 0xda;
const EOI = 0xd9;
const APP1 = 0xe1;
const APP13 = 0xed;

/** EXIF orientation (1–8) from an APP1 payload, or null. */
function orientationOf(payload: Buffer): number | null {
  if (payload.length < 14 || payload.toString('latin1', 0, 6) !== 'Exif\0\0') return null;
  const tiff = payload.subarray(6);
  const order = tiff.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') return null;
  const little = order === 'II';
  const u16 = (at: number): number => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const u32 = (at: number): number => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  try {
    const ifd = u32(4);
    const count = u16(ifd);
    for (let i = 0; i < count; i += 1) {
      const entry = ifd + 2 + i * 12;
      if (u16(entry) === 0x0112) {
        const value = u16(entry + 8);
        return value >= 1 && value <= 8 ? value : null;
      }
    }
  } catch {
    return null; // a truncated IFD: no orientation, not an error
  }
  return null;
}

/** A complete APP1 segment carrying only the orientation tag (big-endian TIFF). */
function orientationSegment(orientation: number): Buffer {
  const tiff = Buffer.alloc(26);
  tiff.write('MM', 0, 'latin1');
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4); // first IFD right after the header
  tiff.writeUInt16BE(1, 8); // one entry
  tiff.writeUInt16BE(0x0112, 10); // Orientation
  tiff.writeUInt16BE(3, 12); // SHORT
  tiff.writeUInt32BE(1, 14); // count
  tiff.writeUInt16BE(orientation, 18); // value, left-justified
  tiff.writeUInt32BE(0, 22); // no next IFD
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const header = Buffer.alloc(4);
  header[0] = 0xff;
  header[1] = APP1;
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

export function stripJpegMetadata(bytes: Buffer): Buffer {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== SOI) return bytes;
  const kept: Buffer[] = [bytes.subarray(0, 2)];
  let orientation: number | null = null;
  let at = 2;
  let stripped = false;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return bytes; // not a segment boundary: leave it alone
    const marker = bytes[at + 1]!;
    if (marker === 0xff) {
      at += 1; // fill byte
      continue;
    }
    if (marker === SOS || marker === EOI) {
      // The rest is image data (or the end): copied whole.
      if (orientation !== null && orientation !== 1) kept.splice(1, 0, orientationSegment(orientation));
      kept.push(bytes.subarray(at));
      return stripped ? Buffer.concat(kept) : bytes;
    }
    // Markers with no length (RSTn, TEM) do not occur before SOS; anything else has one.
    const length = bytes.readUInt16BE(at + 2);
    if (length < 2 || at + 2 + length > bytes.length) return bytes;
    const segment = bytes.subarray(at, at + 2 + length);
    if (marker === APP1 || marker === APP13) {
      if (marker === APP1 && orientation === null) orientation = orientationOf(segment.subarray(4));
      stripped = true;
    } else {
      kept.push(segment);
    }
    at += 2 + length;
  }
  return bytes;
}

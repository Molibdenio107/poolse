import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decode, encode } from 'jpeg-js';
import { stripJpegMetadata } from './jpeg-metadata.js';

/** An APP1 EXIF segment with an orientation and a GPS IFD pointer (little-endian). */
function exifSegment(orientation: number): Buffer {
  const tiff = Buffer.alloc(8 + 2 + 2 * 12 + 4);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(2, 8);
  // Orientation
  tiff.writeUInt16LE(0x0112, 10);
  tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(orientation, 18);
  // GPSInfo pointer — what must not survive
  tiff.writeUInt16LE(0x8825, 22);
  tiff.writeUInt16LE(4, 24);
  tiff.writeUInt32LE(1, 26);
  tiff.writeUInt32LE(4242, 30);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff, Buffer.from('41.1579N,8.6291W', 'latin1')]);
  const header = Buffer.from([0xff, 0xe1, 0, 0]);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

const plain = (): Buffer => Buffer.from(encode({ width: 4, height: 2, data: Buffer.alloc(4 * 2 * 4, 120) }, 90).data);
const withExif = (orientation: number): Buffer => {
  const jpeg = plain();
  return Buffer.concat([jpeg.subarray(0, 2), exifSegment(orientation), jpeg.subarray(2)]);
};

test('the GPS position and the camera’s notes are gone; the picture is byte-for-byte the same', () => {
  const sent = withExif(1);
  const kept = stripJpegMetadata(sent);
  assert.equal(kept.includes(Buffer.from('41.1579N')), false);
  assert.equal(kept.includes(Buffer.from('Exif')), false, 'orientation 1 needs no EXIF at all');
  assert.deepEqual(kept, plain(), 'nothing but the metadata changed');
  assert.equal(decode(kept).width, 4);
});

test('a sideways phone photo keeps its orientation, and only that', () => {
  const kept = stripJpegMetadata(withExif(6));
  assert.equal(kept.includes(Buffer.from('41.1579N')), false);
  const at = kept.indexOf(Buffer.from('Exif\0\0', 'latin1'));
  assert.ok(at > 0, 'a minimal EXIF is written back');
  const tiff = kept.subarray(at + 6);
  assert.equal(tiff.toString('latin1', 0, 2), 'MM');
  assert.equal(tiff.readUInt16BE(8), 1, 'one entry');
  assert.equal(tiff.readUInt16BE(10), 0x0112);
  assert.equal(tiff.readUInt16BE(18), 6);
  assert.equal(decode(kept).height, 2, 'still a valid JPEG');
});

test('a JPEG with nothing to strip, or one that will not parse, is returned as sent', () => {
  const clean = plain();
  assert.equal(stripJpegMetadata(clean), clean);
  const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]), Buffer.alloc(10)]);
  assert.equal(stripJpegMetadata(broken), broken);
  const notJpeg = Buffer.from('%PDF-1.4');
  assert.equal(stripJpegMetadata(notJpeg), notJpeg);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { pngSize } from '../../src/platform/darwin/png.js';

/** Build a 24-byte PNG buffer that carries only signature + IHDR. */
export function fakePng(width, height) {
  const buf = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

test('reads width/height from an IHDR chunk', () => {
  assert.deepEqual(pngSize(fakePng(2880, 1800)), { width: 2880, height: 1800 });
});

test('accepts a real 1x1 PNG', () => {
  const real = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  assert.deepEqual(pngSize(real), { width: 1, height: 1 });
});

test('rejects a short buffer', () => {
  assert.throws(() => pngSize(Buffer.alloc(8)), /过短/);
});

test('rejects a non-PNG buffer', () => {
  assert.throws(() => pngSize(Buffer.alloc(24)), /不是 PNG/);
});

test('rejects a PNG without an IHDR chunk', () => {
  const buf = fakePng(10, 10);
  buf.write('IDAT', 12, 'ascii');
  assert.throws(() => pngSize(buf), /IHDR/);
});

test('rejects a zero-sized IHDR', () => {
  assert.throws(() => pngSize(fakePng(0, 10)), /尺寸非法/);
});

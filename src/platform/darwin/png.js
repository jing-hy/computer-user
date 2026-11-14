/**
 * Minimal PNG header reader: the macOS backend needs the real pixel size of a
 * `screencapture` output to derive the display scale factor, and pulling in an
 * image library for four integers would be silly.
 *
 * @module platform/darwin/png
 */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Read { width, height } from a PNG buffer (IHDR chunk).
 * @param {Buffer} buf
 * @returns {{width: number, height: number}}
 */
export function pngSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) {
    throw new Error('computer-use(mac): PNG 数据过短，读不到尺寸');
  }
  if (!buf.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('computer-use(mac): 不是 PNG（签名不符），无法读取尺寸');
  }
  const chunkLength = buf.readUInt32BE(8);
  const chunkType = buf.toString('ascii', 12, 16);
  if (chunkType !== 'IHDR' || chunkLength < 8) {
    throw new Error('computer-use(mac): PNG 缺少 IHDR 头');
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('computer-use(mac): PNG 尺寸非法（' + width + 'x' + height + '）');
  }
  return { width, height };
}

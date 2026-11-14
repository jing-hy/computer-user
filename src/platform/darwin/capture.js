/**
 * Screenshot capture for macOS.
 *
 * `screencapture` writes real (physical) pixels; everything else in the plugin
 * speaks logical points (that is what CGEvent / cliclick consume). The job of
 * this module is to bridge those two coordinate systems so "read the image,
 * click at the pixel you see" cannot drift by the Retina factor.
 *
 * v1 captures the main display only: multi-display layouts (negative origins)
 * are deliberately left for real-hardware calibration.
 *
 * @module platform/darwin/capture
 */

import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawnExec } from './exec.js';
import { pngSize } from './png.js';

/** JXA one-liner: the main screen's backing scale factor (1 or 2). */
export const SCALE_FACTOR_JXA = "ObjC.import('AppKit'); console.log(String($.NSScreen.mainScreen.backingScaleFactor));";

/**
 * @param {{
 *   exec?: import('./exec.js').Exec,
 *   probe?: { has: (name: string) => Promise<boolean> },
 *   readFile?: typeof readFileSync,
 *   mkdir?: typeof mkdirSync,
 * }} [deps]
 */
export function createCapture({ exec = spawnExec, probe, readFile = readFileSync, mkdir = mkdirSync } = {}) {
  const requireScreencapture = async () => {
    if (probe && !(await probe.has('screencapture'))) {
      throw new Error('computer-use(mac): 找不到 screencapture（macOS 系统自带，请检查 PATH）');
    }
  };

  /** Run one in-place sips edit; throws with the args so failures are debuggable. */
  const sips = async (args, { signal } = {}) => {
    const res = await exec('sips', args, { timeoutMs: 30000, signal });
    if (res.code !== 0) {
      throw new Error('computer-use(mac): sips 失败（' + args.join(' ') + '）：' + String(res.stderr || '').slice(0, 200));
    }
    return res;
  };

  /** Backing scale factor, defaulting to 1 when the probe fails. */
  const scaleFactor = async ({ signal } = {}) => {
    try {
      const res = await exec('osascript', ['-l', 'JavaScript', '-e', SCALE_FACTOR_JXA], { timeoutMs: 8000, signal });
      const value = Number(String(res.stdout || '').trim());
      return Number.isFinite(value) && value > 0 ? value : 1;
    } catch {
      return 1;
    }
  };

  /**
   * @param {{outPath?: string, region?: number[], scale?: number}} payload
   * @param {{signal?: AbortSignal}} [opts]
   * @returns {Promise<{ok: true, path: string, width: number, height: number, virtual_offset: number[], scale: number, display: string, backing_scale?: number}>}
   */
  return async function capture(payload = {}, { signal } = {}) {
    await requireScreencapture();
    const outPath = String(payload.outPath || '').trim();
    if (!outPath) throw new Error('computer-use(mac): capture 需要 outPath');
    try { mkdir(dirname(outPath), { recursive: true }); } catch { /* screencapture will report it */ }

    const shot = await exec('screencapture', ['-x', '-t', 'png', outPath], { timeoutMs: 20000, signal });
    if (shot.code !== 0) {
      throw new Error('computer-use(mac): screencapture 失败（exit ' + shot.code + '）' + (shot.stderr ? '：' + String(shot.stderr).slice(0, 200) : ''));
    }

    const full = pngSize(readFile(outPath));
    const dpr = await scaleFactor({ signal });

    let offsetX = 0;
    let offsetY = 0;
    let boxW = full.width;
    let boxH = full.height;

    if (Array.isArray(payload.region) && payload.region.length === 4) {
      const [rx0, ry0, rx1, ry1] = payload.region.map(Number);
      if (![rx0, ry0, rx1, ry1].every((v) => Number.isFinite(v))) {
        throw new Error('computer-use(mac): region 必须是 4 个 0..1 之间的分数');
      }
      const px0 = Math.floor(rx0 * full.width);
      const py0 = Math.floor(ry0 * full.height);
      const px1 = Math.ceil(rx1 * full.width);
      const py1 = Math.ceil(ry1 * full.height);
      if (px1 <= px0 || py1 <= py0 || px0 < 0 || py0 < 0) {
        throw new Error('computer-use(mac): region 裁剪框为空（' + [px0, py0, px1 - px0, py1 - py0].join(',') + '）');
      }
      boxW = px1 - px0;
      boxH = py1 - py0;
      offsetX = Math.round(px0 / dpr);
      offsetY = Math.round(py0 / dpr);
      await sips(['-c', String(boxH), String(boxW), '--cropOffset', String(py0), String(px0), outPath], { signal });
    }

    // Normalize physical pixels back to logical points: image pixels == click points.
    let outW = Math.max(1, Math.round(boxW / dpr));
    if (dpr !== 1) await sips(['--resampleWidth', String(outW), outPath], { signal });

    const askedScale = Number(payload.scale);
    const scale = Number.isFinite(askedScale) && askedScale > 0 && askedScale < 1 ? askedScale : 1;
    if (scale !== 1) {
      outW = Math.max(1, Math.round(outW * scale));
      await sips(['--resampleWidth', String(outW), outPath], { signal });
    }

    const finalSize = pngSize(readFile(outPath));
    /** @type {Record<string, unknown>} */
    const result = {
      ok: true,
      path: outPath,
      width: finalSize.width,
      height: finalSize.height,
      virtual_offset: [offsetX, offsetY],
      scale,
      display: 'main',
    };
    if (dpr !== 1) result.backing_scale = dpr;
    return result;
  };
}

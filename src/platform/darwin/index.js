/**
 * The macOS backend: one object with the same shape the Windows backend exposes,
 * so `src/backend.js` can pick one with a plain `if` and nothing above it knows
 * which platform it is on.
 *
 * Capability map (see docs/mac-backend.md for the full matrix):
 *   capture.ps1 → screencapture + sips + PNG header (logical-point normalization)
 *   input.ps1   → cliclick (pointer) / AppleScript (keys, text) / JXA (scroll)
 *   observe.ps1 → CGWindowList via JXA (windows, foreground, wait), probe
 *   guard.ps1   → JXA AppKit pill (ensureGuard), shared stop latch
 *
 * @module platform/darwin
 */

import { spawnExec } from './exec.js';
import { createToolProbe } from './paths.js';
import { createCapture } from './capture.js';
import { createInput } from './input.js';
import { createObserve } from './observe.js';
import { createGuard } from './guard.js';
import { unsupported } from './unsupported.js';
import { clearStop, guardState, isStopped, requestStop, stopReason } from '../../stop-flag.js';

export { clearStop, guardState, isStopped, requestStop, stopReason } from '../../stop-flag.js';
export { unsupported } from './unsupported.js';
export { CLICLICK_HINT } from './paths.js';

/** What this backend implements, for docs and the doctor line. */
export const CAPABILITIES = Object.freeze({
  screenshot: 'main display, region + scale, logical-point normalized',
  pointer: 'cliclick (move/click/drag); getpos',
  keyboard: 'AppleScript keystroke + key code (Unicode ok)',
  scroll: 'JXA CGEventCreateScrollWheelEvent',
  windows: 'CGWindowList (list / foreground / activate)',
  wait: 'window handle or title substring',
  pill: 'JXA AppKit NSPanel + click-to-stop + timeout',
  'control-tree': 'not implemented (needs AX API + TCC)',
  'window-move-close': 'not implemented (needs AX API)',
  'global-stop-key': 'not implemented (CGEventTap needs a C callback)',
});

/**
 * @param {{
 *   exec?: import('./exec.js').Exec,
 *   spawnDetached?: (cmd: string, args: string[]) => {pid?: number},
 *   sleep?: (ms: number) => Promise<void>,
 * }} [deps]
 */
export function createDarwinBackend({ exec = spawnExec, spawnDetached, sleep } = {}) {
  const probe = createToolProbe(exec);
  const capture = createCapture({ exec, probe });
  const input = createInput({ exec, probe });
  const observe = createObserve({ exec, probe, sleep });
  const guard = createGuard({ spawnDetached });

  /**
   * Same signature as the Windows `runPs`: the script *name* stays the
   * capability key, so `src/tools.js` needs no platform branch at all.
   *
   * @param {string} scriptName
   * @param {Record<string, any>} payload
   * @param {{signal?: AbortSignal, timeoutMs?: number}} [opts]
   */
  const runPs = async (scriptName, payload = {}, opts = {}) => {
    switch (String(scriptName)) {
      case 'capture.ps1':
        return capture(payload, opts);
      case 'input.ps1':
        return input(payload, opts);
      case 'observe.ps1':
        return observe(payload, opts);
      case 'guard.ps1':
        throw unsupported('guard.ps1（接管提示条脚本）', 'macOS 的提示条由 ensureGuard 直接拉起 JXA 进程，不经过 runPs。');
      default:
        throw unsupported('未知后端脚本 ' + scriptName);
    }
  };

  return {
    id: 'darwin',
    platform: 'darwin',
    scripts: { capture: null, input: null, observe: null, guard: null },
    capabilities: CAPABILITIES,
    probe,
    runPs,
    ensureGuard: guard.ensureGuard,
    stopGuard: guard.stopGuard,
    // The stop latch is shared with the Windows backend (src/stop-flag.js);
    // re-exposing it here keeps the two backend objects interchangeable.
    guardState: guard.guardState,
    isStopped,
    requestStop,
    stopReason,
    clearStop,
  };
}

/** Default instance used by `src/backend.js` (no process is spawned at import time). */
export const darwinBackend = createDarwinBackend();

export const runPs = (scriptName, payload, opts) => darwinBackend.runPs(scriptName, payload, opts);
export const ensureGuard = (payload) => darwinBackend.ensureGuard(payload);
export const stopGuard = (opts) => darwinBackend.stopGuard(opts);

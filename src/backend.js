/**
 * The one place where the plugin decides which platform backend to use.
 *
 * Everything above this file (`src/tools.js`, the settings, the /computer
 * command) is platform-neutral; everything below it is a single backend:
 *
 *   win32  → src/ps.js (PowerShell scripts, unchanged since 0.5.10)
 *   darwin → src/platform/darwin/ (experimental, see docs/mac-backend.md)
 *
 * Both are imported statically on purpose: they are plain ESM with no side
 * effects at import time, so importing the macOS backend on Windows cannot run a
 * macOS command. Keeping the choice in a plain `if` also makes the Windows path
 * provably identical to what shipped before.
 *
 * @module backend
 */

import * as windows from './ps.js';


/**
 * Pick a backend for a platform string.
 *
 * @param {string} [platform]  defaults to the running process' platform
 * @returns {typeof windows & {id: string, platform: string}}
 * @throws {Error} on platforms this plugin does not support
 */
export function selectBackend(platform = process.platform) {
  if (platform === 'win32') {
    return {
      ...windows,
      id: 'windows',
      platform: 'win32',
      scripts: { capture: 'capture.ps1', input: 'input.ps1', observe: 'observe.ps1', guard: 'guard.ps1' },
    };
  }
  throw new Error(
    'computer-user 仅支持 Windows 与 macOS（当前平台 ' + platform + '）。' +
      'Linux 等平台还没有后端，详见 docs/mac-backend.md。'
  );
}

/** The backend for this process. */
export const backend = selectBackend();

export const runPs = backend.runPs;
export const ensureGuard = backend.ensureGuard;
export const stopGuard = backend.stopGuard;
export const guardState = backend.guardState;
export const isStopped = backend.isStopped;
export const requestStop = backend.requestStop;
export const stopReason = backend.stopReason;
export const clearStop = backend.clearStop;

export default backend;

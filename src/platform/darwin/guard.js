/**
 * Takeover guard for macOS: pill process + shared stop latch.
 *
 * Same contract as the Windows `ensureGuard`/`stopGuard`: a detached process
 * renders the pill, `guard.pid` lets us kill it, and `stop.flag` is what every
 * tool call checks. The pill body is generated JXA (see ./jxa/pill.js).
 *
 * @module platform/darwin/guard
 */

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GUARD_DIR,
  GUARD_PID_FILE,
  GUARD_STOP_FLAG,
  clearStop,
  guardState,
  requestStop,
  takeGuardLock,
} from '../../stop-flag.js';
import { pillJXA } from './jxa/pill.js';

/** Where the generated pill script is written (one file, rewritten every time). */
export const PILL_SCRIPT = join(GUARD_DIR, 'guard-mac.js');
/** Spawn diagnostics, same file name the Windows backend writes. */
export const SPAWN_DIAG = join(GUARD_DIR, 'guard.spawn.json');

/** Launch a detached long-running process (the pill). Injected in tests. */
function defaultSpawnDetached(cmd, args) {
  const child = spawn(cmd, args, { stdio: 'ignore', detached: false, windowsHide: true });
  child.unref();
  return child;
}

/**
 * @param {{spawnDetached?: (cmd: string, args: string[]) => {pid?: number}}} [deps]
 */
export function createGuard({ spawnDetached = defaultSpawnDetached } = {}) {
  const diagnose = (data) => {
    try {
      mkdirSync(GUARD_DIR, { recursive: true });
      writeFileSync(SPAWN_DIAG, JSON.stringify({ at: new Date().toISOString(), ...data }), 'utf8');
    } catch { /* diagnostics are best effort */ }
  };

  /**
   * Start the pill when one is not already up.
   * @param {{message?: string, hint?: string, timeoutMs?: number, hotkey?: string}} [payload]
   * @returns {boolean} whether a pill is (now) running
   */
  const ensureGuard = (payload = {}) => {
    const state = guardState();
    if (state.stopped) return false;
    if (state.running) return true;
    if (!takeGuardLock()) return true;
    clearStop();

    const hint = payload.hint && String(payload.hint).includes('{key}')
      ? '点击此提示条任意位置即停止 · 或输入 /computer'
      : (payload.hint || '点击此提示条任意位置即停止 · 或输入 /computer');
    let scriptPath;
    try {
      mkdirSync(GUARD_DIR, { recursive: true });
      scriptPath = PILL_SCRIPT;
      writeFileSync(scriptPath, pillJXA({
        message: payload.message || 'DSH 正在操控你的电脑',
        hint,
        timeoutMs: payload.timeoutMs,
        stopFlagPath: GUARD_STOP_FLAG,
      }), 'utf8');
    } catch (error) {
      diagnose({ ok: false, stage: 'write-script', error: String(error?.message || error), scriptPath });
      return false;
    }

    try {
      const child = spawnDetached('osascript', ['-l', 'JavaScript', scriptPath]);
      const pid = Number(child && child.pid);
      if (Number.isFinite(pid) && pid > 0) {
        try { writeFileSync(GUARD_PID_FILE, String(pid), 'utf8'); } catch { /* best effort */ }
      }
      diagnose({ ok: true, stage: 'spawn', pid: Number.isFinite(pid) ? pid : null, scriptPath, backend: 'darwin' });
      return true;
    } catch (error) {
      diagnose({ ok: false, stage: 'spawn', error: String(error?.message || error), scriptPath, backend: 'darwin' });
      return false;
    }
  };

  /**
   * Close the pill without revoking approval; `hard` latches the stop flag.
   * @param {{hard?: boolean}} [options]
   * @returns {{killed: boolean, hard: boolean}}
   */
  const stopGuard = ({ hard = false } = {}) => {
    let killed = false;
    try {
      const raw = readFileSync(GUARD_PID_FILE, 'utf8').trim();
      const pid = Number(raw);
      if (Number.isFinite(pid) && pid > 0) {
        try { process.kill(pid); killed = true; } catch { /* already gone */ }
      }
    } catch { /* no pid file */ }
    try { rmSync(GUARD_PID_FILE, { force: true }); } catch { /* best effort */ }
    try { rmSync(SPAWN_DIAG, { force: true }); } catch { /* best effort */ }
    if (hard) requestStop('tool');
    else clearStop();
    return { killed, hard };
  };

  return { ensureGuard, stopGuard, guardState };
}

/**
 * Cross-platform stop latch for the takeover guard.
 *
 * Both backends share this file: a stop flag under the OS temp directory is
 * what makes "the user pressed stop and it actually stops" true, and it is also
 * what `/computer` clears when a session is resumed after a timeout.
 *
 * The on-disk format (`reason=<token> at=<ISO>`) is written by other processes
 * too — `guard.ps1` on Windows and the JXA pill on macOS — so keep it stable.
 *
 * @module stop-flag
 */

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Directory shared by the pill process, the stop flag and the spawn locks.
 * `COMPUTER_USER_STATE_DIR` only exists so the test suite can sandbox the latch;
 * the shipped default is the OS temp directory.
 */
export const GUARD_DIR = process.env.COMPUTER_USER_STATE_DIR
  ? resolve(process.env.COMPUTER_USER_STATE_DIR)
  : join(tmpdir(), 'computer-user');
/** Latch honoured by every computer_* call while present. */
export const GUARD_STOP_FLAG = join(GUARD_DIR, 'stop.flag');
/** Pid of the detached pill process (Windows: powershell.exe, macOS: osascript). */
export const GUARD_PID_FILE = join(GUARD_DIR, 'guard.pid');
/** Short-lived lock that keeps two rapid tool calls from spawning two pills. */
export const GUARD_LOCK = join(GUARD_DIR, 'guard.lock');
/** How long a spawn attempt blocks a second one while the pill is still loading. */
export const GUARD_LOCK_MS = 5000;

/** True once the user pressed the stop key (or asked to stop). */
export function isStopped() {
  return existsSync(GUARD_STOP_FLAG);
}

/** Write the stop flag so subsequent calls refuse to act. */
export function requestStop(reason = 'agent') {
  try {
    mkdirSync(GUARD_DIR, { recursive: true });
    writeFileSync(GUARD_STOP_FLAG, 'reason=' + reason + ' at=' + new Date().toISOString(), 'utf8');
  } catch { /* best effort */ }
}

/**
 * Read the stop flag's reason ('hotkey' | 'button' | 'timeout' | ...), or null
 * when nothing is latched. Used so a timeout is not reported as a key press.
 */
export function stopReason() {
  try {
    const raw = readFileSync(GUARD_STOP_FLAG, 'utf8');
    const m = /reason=([^\s]+)/.exec(raw);
    return m ? m[1] : 'unknown';
  } catch { return null; }
}

/** Clear the stop flag (a new approval starts a fresh takeover). */
export function clearStop() {
  try { rmSync(GUARD_STOP_FLAG, { force: true }); } catch { /* best effort */ }
}

/** Read whether a pill process is alive and whether a stop is pending. */
export function guardState() {
  let running = false;
  let pid;
  try {
    const raw = readFileSync(GUARD_PID_FILE, 'utf8').trim();
    pid = Number(raw);
    if (Number.isFinite(pid) && pid > 0) {
      try { process.kill(pid, 0); running = true; } catch { running = false; }
    }
  } catch { /* no pid file */ }
  return { running, pid, stopped: isStopped(), stateDir: GUARD_DIR };
}

/** Drop the shared pid/lock files (used when a pill is being torn down). */
export function clearGuardFiles() {
  try { rmSync(GUARD_PID_FILE, { force: true }); } catch { /* best effort */ }
  try { rmSync(GUARD_LOCK, { force: true }); } catch { /* best effort */ }
}

/**
 * Take the spawn lock so two rapid calls do not start two pills.
 * @returns {boolean} true when the caller may spawn now.
 */
export function takeGuardLock() {
  try {
    const startedAt = existsSync(GUARD_LOCK) ? statSync(GUARD_LOCK).mtimeMs : 0;
    if (Date.now() - startedAt < GUARD_LOCK_MS) return false;
    mkdirSync(GUARD_DIR, { recursive: true });
    writeFileSync(GUARD_LOCK, String(Date.now()), 'utf8');
    return true;
  } catch { return false; }
}

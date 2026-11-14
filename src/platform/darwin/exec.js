/**
 * Process helper for the macOS backend.
 *
 * Every command the backend runs goes through one injectable function, so the
 * whole backend is testable on Windows/Linux (tests pass a fake `exec`).
 *
 * @module platform/darwin/exec
 */

import { spawn } from 'node:child_process';

/**
 * @typedef {(cmd: string, args?: string[], opts?: object) => Promise<{code: number, stdout: string, stderr: string}>} Exec
 */

/**
 * Run one command and capture its output.
 *
 * @param {string} cmd
 * @param {string[]} [args]
 * @param {{timeoutMs?: number, signal?: AbortSignal, input?: string}} [opts]
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
export function spawnExec(cmd, args = [], { timeoutMs = 25000, signal, input } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      reject(new Error('computer-use(mac): 无法启动 ' + cmd + '：' + error.message));
      return;
    }
    let out = '';
    let err = '';
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already gone */ }
      finish(reject, new Error('computer-use(mac): ' + cmd + ' 执行超时（' + timeoutMs + 'ms）'));
    }, timeoutMs);
    if (signal && typeof signal.addEventListener === 'function') {
      signal.addEventListener('abort', () => {
        try { child.kill(); } catch { /* already gone */ }
        finish(reject, new Error('computer-use: 已取消'));
      }, { once: true });
    }
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => finish(reject, new Error('computer-use(mac): 无法启动 ' + cmd + '：' + e.message)));
    child.on('close', (code) => finish(resolve, { code, stdout: out, stderr: err }));
    child.stdin.end(input == null ? undefined : input);
  });
}

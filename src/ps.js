import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to one of the bundled PowerShell scripts inside this package. */
export function powerShellScript(name) {
  return join(__dirname, name);
}

/**
 * Run a bundled PowerShell script with a JSON payload (passed as base64 to avoid
 * shell-quoting/encoding issues). The script prints one JSON object to stdout;
 * it MUST carry a boolean `ok` field. `ok:true` resolves, otherwise we reject
 * with `.error`. Stdout lines before the JSON are tolerated.
 *
 * @param {string} scriptName  'capture.ps1' | 'input.ps1'
 * @param {object} payload     JSON payload object
 * @param {{timeoutMs?:number, signal?:AbortSignal}} opts
 * @returns {Promise<object>}  the parsed result object
 */
export function runPs(scriptName, payload, { timeoutMs = 25000, signal } = {}) {
  return new Promise((resolve, reject) => {
    const b64 = Buffer.from(JSON.stringify(payload ?? {}), 'utf8').toString('base64');
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', powerShellScript(scriptName), '-Json', b64],
      { windowsHide: true }
    );
    let out = '';
    let err = '';
    let settled = false;

    const finish = (fn, v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(v);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(reject, new Error(`computer-use: PowerShell ${scriptName} 执行超时（${timeoutMs}ms）`));
    }, timeoutMs);

    if (signal && typeof signal.addEventListener === 'function') {
      signal.addEventListener('abort', () => {
        child.kill();
        finish(reject, new Error('computer-use: 已取消'));
      }, { once: true });
    }

    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });

    child.on('error', (e) => {
      finish(reject, new Error(`computer-use: 无法启动 PowerShell：${e.message}`));
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const lines = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        let parsed;
        try { parsed = JSON.parse(lines[i]); } catch { continue; }
        if (parsed && typeof parsed.ok === 'boolean') {
          if (parsed.ok) return resolve(parsed);
          return reject(new Error(`computer-use: ${parsed.error || 'PowerShell 执行失败'}`));
        }
      }
      const detail = err.trim();
      reject(new Error(
        `computer-use: ${scriptName} 失败（exit ${code}）` +
        (detail ? `：${detail.slice(0, 300)}` : '（无输出）')
      ));
    });

    child.stdin.end();
  });
}

// ── takeover guard: pill window + global stop key ─────────────────────────
// The pill runs as its own process so the stop key still lands while the input
// backend is busy. It writes a stop flag that every computer_* call checks
// before acting, which is what makes "press the key and it actually stops" true.

const GUARD_DIR = join(tmpdir(), 'computer-user');
const GUARD_STOP_FLAG = join(GUARD_DIR, 'stop.flag');
const GUARD_PID_FILE = join(GUARD_DIR, 'guard.pid');
const GUARD_LOCK = join(GUARD_DIR, 'guard.lock');
/** How long a spawn attempt blocks a second one while the pill is still loading. */
const GUARD_LOCK_MS = 5000;

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

/** Clear the stop flag (a new approval starts a fresh takeover). */
export function clearStop() {
  try { rmSync(GUARD_STOP_FLAG, { force: true }); } catch { /* best effort */ }
}

/**
 * Close the takeover pill now, without revoking the session approval.
 * Closing the window is a safety action, so callers may invoke it without a
 * separate approval; `hard` additionally writes the stop flag (a real stop).
 * @param {{hard?:boolean}} [options]
 * @returns {{killed:boolean, hard:boolean}}
 */
export function stopGuard({ hard = false } = {}) {
  let killed = false;
  try {
    const raw = readFileSync(GUARD_PID_FILE, 'utf8').trim();
    const pid = Number(raw);
    if (Number.isFinite(pid) && pid > 0) {
      try { process.kill(pid); killed = true; } catch { /* already gone */ }
    }
  } catch { /* no pid file */ }
  try { rmSync(GUARD_PID_FILE, { force: true }); } catch { /* best effort */ }
  try { rmSync(join(GUARD_DIR, 'guard.json'), { force: true }); } catch { /* best effort */ }
  try { rmSync(GUARD_LOCK, { force: true }); } catch { /* best effort */ }
  if (hard) requestStop('tool');
  else clearStop();
  return { killed, hard };
}

/** Read whether the pill process is alive and whether a stop is pending. */
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

/**
 * Start the takeover pill if it is not already up. Never restarts after a stop:
 * the user asked for it to end, so the next takeover needs a fresh approval.
 * @returns {boolean} whether a pill is (now) running.
 */
export function ensureGuard(payload = {}) {
  const state = guardState();
  if (state.stopped) return false;
  if (state.running) return true;
  // WPF takes a moment to load, so two rapid tool calls would otherwise each
  // spawn their own pill. A short-lived lock covers that window.
  try {
    const startedAt = existsSync(GUARD_LOCK) ? statSync(GUARD_LOCK).mtimeMs : 0;
    if (Date.now() - startedAt < GUARD_LOCK_MS) return true;
    mkdirSync(GUARD_DIR, { recursive: true });
    writeFileSync(GUARD_LOCK, String(Date.now()), 'utf8');
  } catch { /* best effort */ }
  clearStop();
  const b64 = Buffer.from(JSON.stringify(payload ?? {}), 'utf8').toString('base64');
  const scriptPath = powerShellScript('guard.ps1');
  try {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Json', b64],
      { windowsHide: true, detached: true, stdio: 'ignore' }
    );
    child.on('error', (error) => {
      try {
        writeFileSync(join(GUARD_DIR, 'guard.spawn.json'), JSON.stringify({ at: new Date().toISOString(), ok: false, error: String(error?.message || error), scriptPath }), 'utf8');
      } catch { /* best effort */ }
    });
    child.unref();
    try {
      writeFileSync(join(GUARD_DIR, 'guard.spawn.json'), JSON.stringify({ at: new Date().toISOString(), ok: true, pid: child.pid ?? null, scriptPath }), 'utf8');
    } catch { /* best effort */ }
  } catch (error) {
    try {
      writeFileSync(join(GUARD_DIR, 'guard.spawn.json'), JSON.stringify({ at: new Date().toISOString(), ok: false, error: String(error?.message || error), scriptPath }), 'utf8');
    } catch { /* best effort */ }
    return false;
  }
  return true;
}

export default runPs;

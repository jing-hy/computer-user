import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Sandbox the shared latch before anything imports stop-flag.js.
const STATE_DIR = mkdtempSync(join(tmpdir(), 'cu-guard-'));
process.env.COMPUTER_USER_STATE_DIR = STATE_DIR;

const { createGuard, PILL_SCRIPT, SPAWN_DIAG } = await import('../../src/platform/darwin/guard.js');
const stopFlag = await import('../../src/stop-flag.js');
const { pillJXA } = await import('../../src/platform/darwin/jxa/pill.js');

test.after(() => {
  delete process.env.COMPUTER_USER_STATE_DIR;
  rmSync(STATE_DIR, { recursive: true, force: true });
});

test('pillJXA renders a non-activating, all-Spaces panel with both stop reasons', () => {
  const source = pillJXA({ message: '自定义文案', hint: '点我停止', timeoutMs: 90000, stopFlagPath: '/tmp/x/stop.flag' });
  assert.match(source, /NSWindowStyleMaskNonactivatingPanel/);
  assert.match(source, /NSWindowCollectionBehaviorCanJoinAllSpaces/);
  assert.match(source, /NSFloatingWindowLevel/);
  assert.match(source, /const TIMEOUT_MS = 90000;/);
  assert.match(source, /\/tmp\/x\/stop\.flag/);
  assert.match(source, /writeStop\("button"\)/);
  assert.match(source, /writeStop\("timeout"\)/);
  assert.match(source, /自定义文案/);
  assert.match(source, /pressedMouseButtons/);
  assert.match(source, /NSRunLoop\.currentRunLoop\.runUntilDate/);
});

test('pillJXA requires the stop flag path and floors the timeout at one minute', () => {
  assert.throws(() => pillJXA({}), /stopFlagPath/);
  const source = pillJXA({ timeoutMs: 5, stopFlagPath: '/tmp/x' });
  assert.match(source, /const TIMEOUT_MS = 60000;/);
});

test('ensureGuard spawns the JXA pill once and records pid + diagnostics', () => {
  const spawned = [];
  const guard = createGuard({ spawnDetached: (cmd, args) => { spawned.push({ cmd, args }); return { pid: 987654 }; } });
  stopFlag.clearStop();
  rmSync(stopFlag.GUARD_PID_FILE, { force: true });
  rmSync(stopFlag.GUARD_LOCK, { force: true });

  const ok = guard.ensureGuard({ message: 'DSH 正在操控你的电脑', timeoutMs: 60000 });
  assert.equal(ok, true);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].cmd, 'osascript');
  assert.deepEqual(spawned[0].args.slice(0, 2), ['-l', 'JavaScript']);
  assert.equal(spawned[0].args[2], PILL_SCRIPT);
  assert.equal(readFileSync(stopFlag.GUARD_PID_FILE, 'utf8'), '987654');
  assert.ok(existsSync(PILL_SCRIPT), 'pill script must be written');
  const diag = JSON.parse(readFileSync(SPAWN_DIAG, 'utf8'));
  assert.equal(diag.ok, true);
  assert.equal(diag.backend, 'darwin');
  assert.equal(diag.pid, 987654);
});

test('ensureGuard does not spawn while a stop is latched', () => {
  const spawned = [];
  const guard = createGuard({ spawnDetached: (cmd, args) => { spawned.push(cmd); return { pid: 1 }; } });
  stopFlag.requestStop('timeout');
  assert.equal(guard.ensureGuard({}), false);
  assert.equal(spawned.length, 0);
  stopFlag.clearStop();
});

test('ensureGuard reuses a live pid instead of spawning a second pill', () => {
  const spawned = [];
  const guard = createGuard({ spawnDetached: (cmd, args) => { spawned.push(cmd); return { pid: 1 }; } });
  stopFlag.clearStop();
  // our own pid is definitely alive
  writeFileSync(stopFlag.GUARD_PID_FILE, String(process.pid), 'utf8');
  assert.equal(guard.ensureGuard({}), true);
  assert.equal(spawned.length, 0);
  rmSync(stopFlag.GUARD_PID_FILE, { force: true });
});

test('stopGuard hard stops through the shared flag, soft close clears it', () => {
  const guard = createGuard({ spawnDetached: () => ({ pid: 1 }) });
  stopFlag.clearStop();
  const hard = guard.stopGuard({ hard: true });
  assert.equal(hard.hard, true);
  assert.equal(stopFlag.isStopped(), true);
  assert.equal(stopFlag.stopReason(), 'tool');

  const soft = guard.stopGuard({});
  assert.equal(soft.hard, false);
  assert.equal(stopFlag.isStopped(), false);
});

test('a spawn failure degrades to "no pill" and writes diagnostics', () => {
  const guard = createGuard({ spawnDetached: () => { throw new Error('osascript missing'); } });
  stopFlag.clearStop();
  rmSync(stopFlag.GUARD_LOCK, { force: true });
  const ok = guard.ensureGuard({});
  assert.equal(ok, false);
  const diag = JSON.parse(readFileSync(SPAWN_DIAG, 'utf8'));
  assert.equal(diag.ok, false);
  assert.match(diag.error, /osascript missing/);
});

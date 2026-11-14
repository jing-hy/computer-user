import test from 'node:test';
import assert from 'node:assert/strict';
import backendDefault, { selectBackend } from '../../src/backend.js';
import * as ps from '../../src/ps.js';
import * as darwin from '../../src/platform/darwin/index.js';

test('win32 selects the frozen PowerShell backend', () => {
  const b = selectBackend('win32');
  assert.equal(b.id, 'windows');
  assert.equal(b.platform, 'win32');
  assert.equal(b.runPs, ps.runPs, 'Windows must keep using ps.js runPs (byte-identical behaviour)');
  assert.equal(b.ensureGuard, ps.ensureGuard);
  assert.equal(b.stopGuard, ps.stopGuard);
  assert.equal(b.isStopped, ps.isStopped);
  assert.equal(typeof b.powerShellScript, 'function');
});

test('darwin selects the macOS backend and exposes no PowerShell entry point', () => {
  const b = selectBackend('darwin');
  assert.equal(b.id, 'darwin');
  assert.equal(b.platform, 'darwin');
  assert.equal(typeof b.runPs, 'function');
  assert.equal(typeof darwin.runPs, 'function');
  assert.equal(b.powerShellScript, undefined);
  assert.equal(b.scripts.capture, null, 'macOS has no .ps1 scripts');
  assert.equal(typeof b.ensureGuard, 'function');
  assert.equal(typeof b.stopGuard, 'function');
});

test('unsupported platforms fail at selection, not at first tool call', () => {
  for (const platform of ['linux', 'freebsd', 'aix']) {
    assert.throws(() => selectBackend(platform), /仅支持 Windows 与 macOS/);
  }
});

test('the default backend follows the running process', () => {
  assert.equal(backendDefault.platform, process.platform);
  assert.equal(backendDefault.id, process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'other');
});

test('importing the macOS backend never spawns anything', async () => {
  const calls = [];
  const fakeExec = async (cmd, args = []) => { calls.push(cmd); return { code: 0, stdout: '', stderr: '' }; };
  const backend = darwin.createDarwinBackend({ exec: fakeExec, spawnDetached: () => ({ pid: 1 }) });
  assert.equal(calls.length, 0, 'constructing the backend must not run commands');
  assert.equal(backend.id, 'darwin');
  assert.deepEqual(Object.keys(backend).sort(), [
    'capabilities', 'clearStop', 'ensureGuard', 'guardState', 'id', 'isStopped', 'platform', 'probe',
    'requestStop', 'runPs', 'scripts', 'stopGuard', 'stopReason',
  ]);
});

test('both backends expose the same surface tools.js injects', () => {
  for (const platform of ['win32', 'darwin']) {
    const b = selectBackend(platform);
    for (const key of ['runPs', 'ensureGuard', 'stopGuard', 'guardState', 'isStopped', 'stopReason', 'clearStop']) {
      assert.equal(typeof b[key], 'function', platform + ' missing ' + key);
    }
  }
});

test('guard.ps1 is not reachable through the macOS runPs path', async () => {
  const backend = selectBackend('darwin');
  await assert.rejects(() => backend.runPs('guard.ps1', {}), /提示条/);
  await assert.rejects(() => backend.runPs('nope.ps1', {}), /暂不支持/);
});

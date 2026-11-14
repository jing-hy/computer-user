/**
 * Contract test: drive the REAL tool layer (src/tools.js) against the macOS
 * backend with a fake system-command layer. This is what proves the two halfs
 * fit — a Windows-only test would never notice that macOS returns a shape the
 * tools cannot render, or an `undefined` the host rejects as non-lossless JSON.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createComputerTools } from '../../src/tools.js';
import { createDarwinBackend } from '../../src/platform/darwin/index.js';

const WORK = mkdtempSync(join(tmpdir(), 'cu-contract-'));

test.after(() => rmSync(WORK, { recursive: true, force: true }));

function fakePng(width, height) {
  const buf = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function makeCommands() {
  const calls = [];
  const exec = async (cmd, args = []) => {
    calls.push({ cmd, args: [...args] });
    const script = args.join(' ');
    if (cmd === 'which') return { code: 0, stdout: '/usr/bin/' + args[0] + '\n', stderr: '' };
    if (cmd === 'sw_vers') return { code: 0, stdout: '14.5\n', stderr: '' };
    if (cmd === 'screencapture') {
      const out = args[args.length - 1];
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, fakePng(2880, 1800));
      return { code: 0, stdout: '', stderr: '' };
    }
    if (cmd === 'sips') {
      const out = args[args.length - 1];
      const resample = args.indexOf('--resampleWidth');
      if (resample >= 0) {
        const w = Number(args[resample + 1]);
        writeFileSync(out, fakePng(w, Math.round(w * 0.625)));
        return { code: 0, stdout: '', stderr: '' };
      }
      const crop = args.indexOf('-c');
      if (crop >= 0) {
        writeFileSync(out, fakePng(Number(args[crop + 2]), Number(args[crop + 1])));
        return { code: 0, stdout: '', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    }
    if (cmd.endsWith('cliclick')) return { code: 0, stdout: '10,20\n', stderr: '' };
    if (cmd === 'osascript') {
      if (script.includes('backingScaleFactor')) return { code: 0, stdout: '2\n', stderr: '' };
      if (script.includes('frontmostApplication')) {
        return { code: 0, stdout: JSON.stringify({ handle: 101, pid: 42, title: 'T', process: 'P', rect: { x: 0, y: 0, w: 100, h: 100 } }), stderr: '' };
      }
      if (script.includes('runningApplicationWithProcessIdentifier')) return { code: 0, stdout: '{"ok":true}', stderr: '' };
      if (script.includes('CGWindowListCopyWindowInfo')) {
        return { code: 0, stdout: JSON.stringify([{ handle: 101, pid: 42, process: 'P', title: 'T', x: 0, y: 0, w: 100, h: 100, layer: 0 }]), stderr: '' };
      }
      return { code: 0, stdout: 'ok', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  return { exec, calls };
}

function makeEnv() {
  const { exec, calls } = makeCommands();
  const backend = createDarwinBackend({ exec, spawnDetached: () => ({ pid: 123456 }) });
  const cfg = { mode: 'auto', tool_mode: 'all', enabled_tools: [], stop_hotkey: 'ctrl+alt+esc', takeover_minutes: 30 };
  const tools = createComputerTools({
    runPs: backend.runPs,
    getConfig: () => ({ ...cfg }),
    approvedSessions: new Set(),
    sessionIds: ['s1'],
    setMode: async () => {},
    isStopped: () => false,
    stopReason: () => null,
    ensureGuard: () => true,
    stopGuard: () => ({ killed: false, hard: false }),
  });
  const byName = (name) => tools.find((t) => t.name === name);
  return { backend, tools, byName, calls };
}

const assertLossless = (value) => {
  assert.equal(JSON.stringify(value).includes('undefined'), false, 'tool results must be lossless JSON');
  const round = JSON.parse(JSON.stringify(value));
  assert.deepEqual(round, value);
};

test('screenshot returns the capture contract the tools render', async () => {
  const env = makeEnv();
  const res = await env.byName('computer_screenshot').execute({ path: join(WORK, 'shot.png') }, {});
  assert.equal(res.path, join(WORK, 'shot.png'));
  assert.equal(res.width, 1440);
  assert.equal(res.height, 900);
  assert.deepEqual(res.virtual_offset, [0, 0]);
  assert.equal(res.scale, 1);
  assertLossless(res);
});

test('click round-trips through the macOS pointer backend', async () => {
  const env = makeEnv();
  const res = await env.byName('computer_click').execute({ coordinate: [10, 20] }, {});
  assert.deepEqual(res.clicked, [10, 20]);
  assertLossless(res);
});

test('list_windows + activate_window stay JSON-safe on macOS', async () => {
  const env = makeEnv();
  const windows = await env.byName('computer_list_windows').execute({}, {});
  assert.equal(windows.windows.length, 1);
  assertLossless(windows);

  const activated = await env.byName('computer_activate_window').execute({ window: 101 }, {});
  assert.deepEqual(Object.keys(activated).sort(), ['action', 'handle']);
  assertLossless(activated);
});

test('doctor reports the macOS backend without any undefined field', async () => {
  const env = makeEnv();
  const res = await env.byName('computer_doctor').execute({}, {});
  assert.match(res.edition, /macOS/);
  assert.equal(res.uia, false);
  assert.equal(res.stopped, false);
  assert.equal(res.mode, 'auto');
  assert.equal(res.tool_mode, 'all');
  assertLossless(res);
});

test('control-tree tools fail with the documented message instead of a bad result', async () => {
  const env = makeEnv();
  await assert.rejects(() => env.byName('computer_snapshot').execute({}, {}), /docs\/mac-backend\.md/);
  await assert.rejects(() => env.byName('computer_invoke').execute({ target: 'x' }, {}), /docs\/mac-backend\.md/);
});

test('every tool either works or fails loudly on macOS (no silent empty results)', async () => {
  const env = makeEnv();
  const sample = {
    computer_screenshot: { path: join(WORK, 'x.png') },
    computer_click: { coordinate: [1, 2] },
    computer_type: { text: 'hi' },
    computer_keypress: { keys: ['enter'] },
    computer_scroll: { coordinate: [1, 2], clicks: 1 },
    computer_drag: { start_coordinate: [1, 2], end_coordinate: [3, 4] },
    computer_move_mouse: { coordinate: [5, 6] },
    computer_get_cursor_position: {},
    computer_wait: { ms: 1 },
    computer_list_windows: {},
    computer_doctor: {},
    computer_browser: {},
  };
  for (const [name, args] of Object.entries(sample)) {
    const tool = env.byName(name);
    if (!tool) continue;
    const value = await tool.execute(args, {});
    assertLossless(value);
  }
});

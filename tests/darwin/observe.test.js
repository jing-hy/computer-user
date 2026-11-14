import test from 'node:test';
import assert from 'node:assert/strict';
import { activateJXA, createObserve, DPR_JXA, FOREGROUND_JXA, WINDOWS_JXA } from '../../src/platform/darwin/observe.js';

const WINDOW_ROWS = [
  { handle: 101, pid: 42, process: 'Code', title: 'main.js', x: 0, y: 0, w: 1200, h: 800, layer: 0 },
  { handle: 102, pid: 42, process: 'Code', title: 'offscreen', x: 0, y: 0, w: 0, h: 0, layer: 0 },
  { handle: 103, pid: 7, process: 'WindowServer', title: 'menu', x: 0, y: 0, w: 10, h: 10, layer: 25 },
];

function makeEnv({ windows = WINDOW_ROWS, foreground, nowSeq } = {}) {
  const calls = [];
  let tick = 0;
  const exec = async (cmd, args = []) => {
    calls.push({ cmd, args: [...args] });
    const script = args.join(' ');
    if (cmd === 'sw_vers') return { code: 0, stdout: '14.5\n', stderr: '' };
    if (cmd === 'osascript') {
      if (script.includes('backingScaleFactor')) return { code: 0, stdout: '2\n', stderr: '' };
      if (script.includes('frontmostApplication')) {
        return { code: 0, stdout: JSON.stringify(foreground || {
          handle: 101, pid: 42, title: 'main.js', process: 'Code', rect: { x: 0, y: 0, w: 1200, h: 800 },
        }), stderr: '' };
      }
      if (script.includes('runningApplicationWithProcessIdentifier')) return { code: 0, stdout: '{"ok":true}', stderr: '' };
      if (script.includes('CGWindowListCopyWindowInfo')) return { code: 0, stdout: JSON.stringify(windows), stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  const now = nowSeq ? () => nowSeq[Math.min(tick++, nowSeq.length - 1)] : Date.now;
  const observe = createObserve({
    exec,
    probe: { has: async () => true, snapshot: async () => ({ screencapture: '/usr/sbin/screencapture', osascript: '/usr/bin/osascript' }) },
    now,
    sleep: async () => {},
  });
  return { observe, calls };
}

test('windows keeps only real on-screen app windows and maps rect', async () => {
  const env = makeEnv();
  const res = await env.observe({ action: 'windows' });
  assert.equal(res.ok, true);
  assert.equal(res.windows.length, 1);
  assert.deepEqual(res.windows[0], {
    handle: 101, title: 'main.js', pid: 42, process: 'Code',
    rect: { x: 0, y: 0, w: 1200, h: 800 }, focused: false,
  });
});

test('foreground reports the frontmost app window', async () => {
  const env = makeEnv();
  const res = await env.observe({ action: 'foreground' });
  assert.equal(res.ok, true);
  assert.equal(res.foreground.handle, 101);
  assert.equal(res.foreground.process, 'Code');
  assert.deepEqual(res.foreground.rect, { x: 0, y: 0, w: 1200, h: 800 });
});

test('activate looks the window up and activates its process', async () => {
  const env = makeEnv();
  const res = await env.observe({ action: 'window', kind: 'activate', handle: 101 });
  assert.equal(res.action, 'activate');
  assert.equal(res.handle, 101);
  const activateCall = env.calls.find((c) => c.args.join(' ').includes('runningApplicationWithProcessIdentifier(42)'));
  assert.ok(activateCall, 'activate JXA must target the owner pid');
});

test('activate fails clearly for an unknown window', async () => {
  const env = makeEnv();
  await assert.rejects(() => env.observe({ action: 'window', kind: 'activate', handle: 999 }), /window not found/);
});

test('wait returns as soon as the handle is on screen', async () => {
  const env = makeEnv();
  const res = await env.observe({ action: 'wait', handle: 101, timeoutMs: 1000 });
  assert.equal(res.found, true);
  assert.ok(res.waited_ms >= 0);
});

test('wait matches a title substring', async () => {
  const env = makeEnv();
  const res = await env.observe({ action: 'wait', titleContains: 'main', timeoutMs: 1000 });
  assert.equal(res.found, true);
});

test('wait gives up after the deadline', async () => {
  // now() jumps past the deadline on the second poll
  const env = makeEnv({ nowSeq: [0, 0, 5000, 5000] });
  const res = await env.observe({ action: 'wait', handle: 424242, timeoutMs: 1000 });
  assert.equal(res.found, false);
  assert.equal(res.waited_ms, 1000);
});

test('wait for a control-tree locator is explicitly unsupported', async () => {
  const env = makeEnv();
  await assert.rejects(() => env.observe({ action: 'wait', locator: 'w42/Button[0]', timeoutMs: 500 }), /暂不支持/);
});

test('control-tree and window geometry actions reject with the doc pointer', async () => {
  const env = makeEnv();
  for (const payload of [
    { action: 'snapshot', handle: 101 },
    { action: 'act', kind: 'invoke' },
    { action: 'window', kind: 'move', handle: 101, rect: { x: 0, y: 0, w: 10, h: 10 } },
    { action: 'window', kind: 'close', handle: 101 },
    { action: 'nope' },
  ]) {
    await assert.rejects(() => env.observe(payload), /docs\/mac-backend\.md/, JSON.stringify(payload));
  }
});

test('probe returns doctor-safe fields (no undefined values)', async () => {
  const env = makeEnv();
  const res = await env.observe({ action: 'probe' });
  assert.equal(res.ok, true);
  assert.equal(res.backend, 'darwin');
  assert.equal(typeof res.powershell, 'string');
  assert.equal(res.uia, false);
  assert.match(res.edition, /macOS 14\.5/);
  assert.equal(res.macos, '14.5');
  assert.equal(res.dpr_unverified, false);
  assert.equal(JSON.stringify(res).includes('undefined'), false);
});

test('JXA sources carry the Quartz calls they claim to', () => {
  assert.match(WINDOWS_JXA, /CGWindowListCopyWindowInfo/);
  assert.match(WINDOWS_JXA, /kCGWindowListOptionOnScreenOnly/);
  assert.match(FOREGROUND_JXA, /frontmostApplication/);
  assert.match(activateJXA(77), /runningApplicationWithProcessIdentifier\(77\)/);
  assert.match(DPR_JXA, /backingScaleFactor/);
});

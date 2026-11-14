import test from 'node:test';
import assert from 'node:assert/strict';
import { createComputerTools } from '../src/tools.js';
import { planCommandAction } from '../src/index.js';

function makeEnv(opts = {}) {
  const calls = [];
  const state = {
    mode: 'auto',
    tool_mode: 'all',
    enabled_tools: [],
    stop_hotkey: 'ctrl+alt+esc',
    takeover_minutes: 30,
    ...opts.cfg,
  };
  const runPs = opts.runPs ?? (async (script, payload) => {
    calls.push({ script, payload });
    return { ok: true };
  });
  const tools = createComputerTools({
    runPs,
    getConfig: () => ({ ...state }),
    approvedSessions: new Set(opts.approved ?? []),
    sessionIds: ['s1'],
    setMode: async () => {},
    isStopped: opts.isStopped ?? (() => false),
    stopReason: opts.stopReason,
    ensureGuard: () => true,
  });
  const byName = (n) => tools.find((x) => x.name === n);
  return { tools, byName, calls };
}

// ── issue #6: computer_activate_window → "value is not lossless JSON" ───────

test('issue #6: activate/close results carry no undefined fields', async () => {
  for (const [tool, kind] of [['computer_activate_window', 'activate'], ['computer_close_window', 'close']]) {
    const env = makeEnv({ runPs: async () => ({ ok: true, action: kind, handle: 4242 }) });
    const out = await env.byName(tool).execute({ window: 4242 });
    assert.deepEqual(Object.keys(out).sort(), ['action', 'handle'], `${tool} keys`);
    assert.equal('rect' in out, false, `${tool} must not expose a missing rect`);
    assert.equal(JSON.stringify(out).includes('undefined'), false);
    assert.equal(JSON.stringify(out), JSON.stringify({ action: kind, handle: 4242 }));
  }
});

test('issue #6: move still returns the rect the backend reported', async () => {
  const rect = { x: 1, y: 2, w: 300, h: 200 };
  const env = makeEnv({ runPs: async () => ({ ok: true, action: 'move', handle: 7, rect }) });
  const out = await env.byName('computer_move_window').execute({ window: 7, rect });
  assert.deepEqual(out, { action: 'move', handle: 7, rect });
});

test('issue #6: a failed window call throws a readable error instead of an empty result', async () => {
  const env = makeEnv({ runPs: async () => ({ ok: false, error: 'window not found: hwnd=1' }) });
  await assert.rejects(
    () => env.byName('computer_activate_window').execute({ window: 1 }),
    /window not found/
  );
});

test('issue #6: a non-numeric hwnd is rejected before the backend runs', async () => {
  const env = makeEnv();
  await assert.rejects(() => env.byName('computer_activate_window').execute({ window: 'abc' }), /hwnd/);
  assert.equal(env.calls.length, 0);
});

// ── issue #7: timeout stop blocks everything and /computer cannot clear it ──

test('issue #7: a timeout stop reports the timeout, not the stop hotkey', async () => {
  const env = makeEnv({ isStopped: () => true, stopReason: () => 'timeout' });
  await assert.rejects(
    () => env.byName('computer_click').execute({ coordinate: [1, 2] }),
    (err) => {
      assert.equal(err.stopped, true);
      assert.equal(err.stopReason, 'timeout');
      assert.match(err.message, /超时/);
      assert.match(err.message, /\/computer/);
      assert.doesNotMatch(err.message, /按下了停止热键/);
      return true;
    }
  );
});

test('issue #7: a real hotkey stop still says so', async () => {
  const env = makeEnv({ isStopped: () => true, stopReason: () => 'hotkey' });
  await assert.rejects(
    () => env.byName('computer_click').execute({ coordinate: [1, 2] }),
    /按下了停止热键/
  );
});

test('issue #7: computer_doctor still answers while a stop is latched', async () => {
  const env = makeEnv({
    isStopped: () => true,
    stopReason: () => 'timeout',
    runPs: async (script, payload) => {
      if (payload.action === 'probe') {
        return { ok: true, powershell: '5.1', edition: 'Desktop', uia: true, tempWritable: true, tempDir: 'C:\\Temp' };
      }
      return { ok: true, foreground: { handle: 1, title: 'W' } };
    },
  });
  const out = await env.byName('computer_doctor').execute({});
  assert.equal(out.stopped, true);
  assert.equal(out.powershell, '5.1');
  assert.equal(JSON.stringify(out).includes('undefined'), false);
});

test('issue #7: tools recover as soon as the stop flag is gone', async () => {
  let stopped = true;
  const env = makeEnv({
    isStopped: () => stopped,
    stopReason: () => (stopped ? 'timeout' : null),
    runPs: async () => ({ ok: true, cursor: [1, 2] }),
  });
  await assert.rejects(() => env.byName('computer_click').execute({ coordinate: [1, 2] }), /超时/);
  stopped = false;
  const res = await env.byName('computer_click').execute({ coordinate: [1, 2] });
  assert.deepEqual(res, { clicked: [1, 2] });
});

test('issue #7: /computer resumes instead of revoking when a stop is latched', () => {
  // 停止标记 + 已批准 = 恢复（否则用户要按两次 /computer）
  assert.equal(planCommandAction({ stopped: true, approved: true }), 'resume');
  // 其它组合保持开关语义
  assert.equal(planCommandAction({ stopped: false, approved: true }), 'toggle');
  assert.equal(planCommandAction({ stopped: true, approved: false }), 'toggle');
  assert.equal(planCommandAction({ stopped: false, approved: false }), 'toggle');
});

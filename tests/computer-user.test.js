import test from 'node:test';
import assert from 'node:assert/strict';
import { createComputerTools } from '../src/tools.js';
import { sessionTargetsFromInvocation, toggleApproval } from '../src/index.js';

function makeEnv(overrides = {}) {
  const calls = [];
  const approvedSessions = new Set();
  const state = {
    mode: 'auto',
    screenshot_dir: '',
    default_scale: 1,
    typing_interval_ms: 0,
    scroll_units: 1,
    debug: false,
    ...overrides,
  };
  const getConfig = () => ({ ...state });
  const runPs = async (script, payload, _opts) => {
    calls.push({ script, payload });
    if (script === 'capture.ps1') {
      return { ok: true, path: payload.outPath, width: 1920, height: 1080, virtual_offset: [0, 0], scale: 1 };
    }
    if (payload.action === 'getpos') return { ok: true, cursor: [10, 20] };
    if (payload.action === 'move') return { ok: true, cursor: payload.coordinate };
    if (payload.action === 'click') return { ok: true, cursor: payload.coordinate };
    if (payload.action === 'type') return { ok: true, chars: payload.text.length };
    if (payload.action === 'keypress') return { ok: true, keys: payload.keys.join('+') };
    if (payload.action === 'drag') return { ok: true, from: payload.from, to: payload.to };
    if (payload.action === 'scroll') return { ok: true, cursor: payload.coordinate };
    return { ok: true, cursor: [0, 0] };
  };
  const sessionId = 'test-session-1';
  const setMode = async (mode) => { state.mode = mode; };
  const tools = createComputerTools({ runPs, getConfig, approvedSessions, sessionId, setMode });
  const byName = (n) => tools.find((t) => t.name === n);
  const exec = { signal: undefined, agent: { session: { header: { cwd: process.cwd(), sessionId } } } };
  return { tools, byName, calls, runPs, getConfig, state, exec, approvedSessions, sessionId, setMode };
}

test('registers exactly the 10 computer_* tools, all non-concurrency-safe', () => {
  const { tools } = makeEnv();
  assert.equal(tools.length, 10);
  for (const t of tools) {
    assert.match(t.name, /^computer_/);
    assert.equal(typeof t.execute, 'function');
    assert.equal(t.isConcurrencySafe(), false, t.name);
    assert.ok(t.parameters?.properties, `${t.name} needs parameters.properties`);
    assert.ok(t.output?.schema, `${t.name} needs output.schema`);
    assert.ok(t.output?.render, `${t.name} needs output.render`);
  }
  const names = new Set(tools.map((t) => t.name));
  assert.deepEqual([...names].sort(), [
    'computer_click',
    'computer_drag',
    'computer_get_cursor_position',
    'computer_keypress',
    'computer_move_mouse',
    'computer_screenshot',
    'computer_scroll',
    'computer_set_mode',
    'computer_type',
    'computer_wait',
  ]);
});

// ── computer_set_mode ──

test('computer_set_mode refuses when ai_can_change_mode is off (default)', async () => {
  const env = makeEnv({ mode: 'auto', ai_can_change_mode: false });
  await assert.rejects(
    env.byName('computer_set_mode').execute({ mode: 'readonly' }, env.exec),
    /未允许 AI 修改运行模式/
  );
  assert.equal(env.state.mode, 'auto');
});

test('computer_set_mode works when ai_can_change_mode is on', async () => {
  const env = makeEnv({ mode: 'auto', ai_can_change_mode: true });
  const res = await env.byName('computer_set_mode').execute({ mode: 'readonly' }, env.exec);
  assert.equal(res.mode, 'readonly');
  assert.equal(env.state.mode, 'readonly');
});

test('computer_set_mode validates unknown mode', async () => {
  const env = makeEnv({ mode: 'auto', ai_can_change_mode: true });
  await assert.rejects(
    env.byName('computer_set_mode').execute({ mode: 'banana' }, env.exec),
    /mode 必须是/
  );
});

test('computer_set_mode refuses while mode is disabled', async () => {
  const env = makeEnv({ mode: 'disabled', ai_can_change_mode: true });
  await assert.rejects(
    env.byName('computer_set_mode').execute({ mode: 'auto' }, env.exec),
    /已禁用/
  );
});

// ── /computer approval toggle (sessionTargetsFromInvocation / toggleApproval) ──

test('sessionTargetsFromInvocation uses agent.id + session.header.sessionId', () => {
  const inv = { agent: { id: 'sess-1', session: { header: { sessionId: 'sess-1' } } } };
  const t = sessionTargetsFromInvocation(inv);
  assert.ok(t.has('sess-1'));
});

test('sessionTargetsFromInvocation falls back to __global__', () => {
  const t = sessionTargetsFromInvocation({});
  assert.ok(t.has('__global__'));
});

test('toggleApproval: approve then revoke', () => {
  const set = new Set();
  const targets = new Set(['sess-1']);
  const r1 = toggleApproval(set, targets);
  assert.equal(r1.approved, true);
  assert.ok(set.has('sess-1'));
  const r2 = toggleApproval(set, targets);
  assert.equal(r2.approved, false);
  assert.ok(!set.has('sess-1'));
});

test('toggleApproval: mixed targets — approves when none approved, revokes all when any approved', () => {
  const set = new Set(['other']);
  const targets = new Set(['sess-1', 'other']);
  const r = toggleApproval(set, targets);
  assert.equal(r.approved, false);
  assert.ok(!set.has('sess-1'));
  assert.ok(!set.has('other'));
});

// ── mode: disabled ──

test('mode=disabled → screenshot refuses', async () => {
  const env = makeEnv({ mode: 'disabled' });
  await assert.rejects(
    env.byName('computer_screenshot').execute({}, env.exec),
    /已禁用/
  );
  assert.equal(env.calls.length, 0);
});

test('mode=disabled → click refuses', async () => {
  const env = makeEnv({ mode: 'disabled' });
  await assert.rejects(
    env.byName('computer_click').execute({ coordinate: [10, 20] }, env.exec),
    /已禁用/
  );
});

// ── mode: readonly ──

test('mode=readonly → screenshot allowed (read-only)', async () => {
  const env = makeEnv({ mode: 'readonly' });
  const res = await env.byName('computer_screenshot').execute({}, env.exec);
  assert.equal(res.ok, true);
});

test('mode=readonly → get_cursor_position allowed', async () => {
  const env = makeEnv({ mode: 'readonly' });
  const res = await env.byName('computer_get_cursor_position').execute({}, env.exec);
  assert.deepEqual([res.x, res.y], [10, 20]);
});

test('mode=readonly → wait allowed', async () => {
  const env = makeEnv({ mode: 'readonly' });
  const res = await env.byName('computer_wait').execute({ ms: 5 }, env.exec);
  assert.equal(res.waited, 5);
});

test('mode=readonly → click refuses (side-effect)', async () => {
  const env = makeEnv({ mode: 'readonly' });
  await assert.rejects(
    env.byName('computer_click').execute({ coordinate: [1, 2] }, env.exec),
    /只读模式/
  );
});

test('mode=readonly → type refuses', async () => {
  const env = makeEnv({ mode: 'readonly' });
  await assert.rejects(
    env.byName('computer_type').execute({ text: 'hi' }, env.exec),
    /只读模式/
  );
});

// ── mode: manual (unapproved) ──

test('mode=manual (unapproved) → screenshot allowed (read-only)', async () => {
  const env = makeEnv({ mode: 'manual' });
  const res = await env.byName('computer_screenshot').execute({}, env.exec);
  assert.equal(res.ok, true);
});

test('mode=manual (unapproved) → click refuses with awaitingApproval', async () => {
  const env = makeEnv({ mode: 'manual' });
  const err = await env.byName('computer_click').execute({ coordinate: [10, 20] }, env.exec).then(
    () => null,
    (e) => e
  );
  assert.ok(err);
  assert.equal(err.awaitingApproval, true);
  assert.match(err.message, /\/computer/);
  assert.equal(env.calls.length, 0);
});

// ── mode: manual (approved) ──

test('mode=manual + approved session → click runs', async () => {
  const env = makeEnv({ mode: 'manual' });
  env.approvedSessions.add(env.sessionId);
  const res = await env.byName('computer_click').execute({ coordinate: [10, 20] }, env.exec);
  assert.deepEqual(res.clicked, [10, 20]);
  assert.equal(env.calls[0].script, 'input.ps1');
});

test('mode=manual + approved → type runs', async () => {
  const env = makeEnv({ mode: 'manual' });
  env.approvedSessions.add(env.sessionId);
  const res = await env.byName('computer_type').execute({ text: 'hi' }, env.exec);
  assert.equal(res.chars, 2);
});

// ── mode: auto ──

test('mode=auto → click runs without approval', async () => {
  const env = makeEnv({ mode: 'auto' });
  const res = await env.byName('computer_click').execute({ coordinate: [5, 6] }, env.exec);
  assert.deepEqual(res.clicked, [5, 6]);
});

test('mode=auto → type runs', async () => {
  const env = makeEnv({ mode: 'auto' });
  const res = await env.byName('computer_type').execute({ text: '中文 test' }, env.exec);
  assert.equal(res.chars, 7);
});

test('mode=auto (default) → keypress runs', async () => {
  const env = makeEnv();
  const res = await env.byName('computer_keypress').execute({ keys: ['ctrl', 'a'] }, env.exec);
  assert.equal(res.keys, 'ctrl+a');
});

// ── functional tests (mode=auto) ──

test('screenshot writes into configured screenshot_dir', async () => {
  const env = makeEnv({ screenshot_dir: 'shots' });
  const res = await env.byName('computer_screenshot').execute({}, env.exec);
  assert.match(res.path, /[/\\]shots[/\\]/);
});

test('screenshot honors explicit path', async () => {
  const env = makeEnv();
  const res = await env.byName('computer_screenshot').execute({ path: 'foo.png' }, env.exec);
  assert.ok(res.path.endsWith('foo.png'));
});

test('type passes text and typing interval', async () => {
  const env = makeEnv({ typing_interval_ms: 5 });
  const res = await env.byName('computer_type').execute({ text: 'hello 中文' }, env.exec);
  assert.equal(res.chars, 8);
  assert.equal(env.calls[0].payload.typingIntervalMs, 5);
});

test('drag passes from/to and hold keys', async () => {
  const env = makeEnv();
  const res = await env.byName('computer_drag').execute({
    start_coordinate: [0, 0], end_coordinate: [50, 50], hold_keys: ['shift'],
  }, env.exec);
  assert.deepEqual(res.to, [50, 50]);
  assert.equal(env.calls[0].payload.holdKeys[0], 'shift');
});

test('scroll uses config scroll_units when clicks omitted', async () => {
  const env = makeEnv({ scroll_units: 3 });
  await env.byName('computer_scroll').execute({ coordinate: [5, 5] }, env.exec);
  assert.equal(env.calls[0].payload.clicks, 3);
  assert.equal(env.calls[0].payload.direction, 'down');
});

test('move_mouse returns the moved coordinate', async () => {
  const env = makeEnv();
  const res = await env.byName('computer_move_mouse').execute({ coordinate: [300, 400] }, env.exec);
  assert.deepEqual(res.moved_to, [300, 400]);
});

test('get_cursor_position reads position', async () => {
  const env = makeEnv();
  const res = await env.byName('computer_get_cursor_position').execute({}, env.exec);
  assert.deepEqual([res.x, res.y], [10, 20]);
});

test('wait resolves with ms', async () => {
  const env = makeEnv();
  const t0 = Date.now();
  const res = await env.byName('computer_wait').execute({ ms: 15 }, env.exec);
  assert.ok(Date.now() - t0 >= 14);
  assert.equal(res.waited, 15);
});

test('output.render returns a text block', () => {
  const env = makeEnv();
  const t = env.byName('computer_click');
  const out = t.output.render({}, { clicked: [1, 2] });
  assert.ok(Array.isArray(out));
  assert.equal(out[0].type, 'text');
  assert.match(out[0].text, /1/);
});

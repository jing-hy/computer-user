import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createComputerTools } from '../src/tools.js';

function makeEnv(overrides = {}) {
  const calls = [];
  const state = {
    enabled: true,
    require_confirmation: true,
    screenshot_dir: '',
    default_scale: 1,
    typing_interval_ms: 0,
    scroll_units: 1,
    debug: false,
    ...overrides,
  };
  const getConfig = () => ({ ...state });
  const runPs = async (script, payload, opts) => {
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
  const tools = createComputerTools({ runPs, getConfig });
  const byName = (n) => tools.find((t) => t.name === n);
  const noSignal = { signal: undefined, agent: { session: { header: { cwd: process.cwd() } } } };
  const exec = { signal: undefined, agent: { session: { header: { cwd: process.cwd() } } } };
  return { tools, byName, calls, runPs, getConfig, state, exec };
}

test('registers exactly the 9 computer_* tools, all non-concurrency-safe', () => {
  const { tools } = makeEnv();
  assert.equal(tools.length, 9);
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
    'computer_type',
    'computer_wait',
  ]);
});

test('enabled=false → computer_screenshot refuses without calling runPs', async () => {
  const env = makeEnv({ enabled: false });
  await assert.rejects(
    env.byName('computer_screenshot').execute({}, env.exec),
    /computer-use 已关闭/
  );
  assert.equal(env.calls.length, 0);
});

test('require_confirmation=true → side-effecting click refuses without confirm:true', async () => {
  const env = makeEnv({ require_confirmation: true });
  const err = await env.byName('computer_click').execute({ coordinate: [10, 20] }, env.exec).then(
    () => null,
    (e) => e
  );
  assert.ok(err);
  assert.equal(err.awaitingConfirmation, true);
  assert.match(err.message, /请示/);
  assert.equal(env.calls.length, 0);
});

test('require_confirmation=true + confirm:true → click runs', async () => {
  const env = makeEnv({ require_confirmation: true });
  const res = await env.byName('computer_click').execute({ coordinate: [10, 20], confirm: true }, env.exec);
  assert.deepEqual(res.clicked, [10, 20]);
  assert.equal(env.calls[0].script, 'input.ps1');
  assert.equal(env.calls[0].payload.action, 'click');
  assert.deepEqual(env.calls[0].payload.coordinate, [10, 20]);
});

test('require_confirmation=false → click runs without confirm', async () => {
  const env = makeEnv({ require_confirmation: false });
  const res = await env.byName('computer_click').execute({ coordinate: [1, 2] }, env.exec);
  assert.deepEqual(res.clicked, [1, 2]);
  assert.equal(env.calls.length, 1);
});

test('screenshot is NOT gated by require_confirmation (read-only) — only enabled', async () => {
  const env = makeEnv({ require_confirmation: true });
  const res = await env.byName('computer_screenshot').execute({}, env.exec);
  assert.equal(res.ok, true);
  assert.equal(env.calls[0].script, 'capture.ps1');
});

test('screenshot writes into configured screenshot_dir (trailing path join works)', async () => {
  const env = makeEnv({ screenshot_dir: 'shots' });
  const res = await env.byName('computer_screenshot').execute({}, env.exec);
  assert.match(res.path, /[/\\]shots[/\\]/);
});

test('screenshot honors explicit path (cwd-resolved)', async () => {
  const env = makeEnv();
  const res = await env.byName('computer_screenshot').execute({ path: 'foo.png' }, env.exec);
  assert.ok(res.path.endsWith('foo.png'));
});

test('type passes text and typing interval', async () => {
  const env = makeEnv({ typing_interval_ms: 5 });
  const res = await env.byName('computer_type').execute({ text: 'hello 中文', confirm: true }, env.exec);
  assert.equal(res.chars, 8);
  assert.equal(env.calls[0].payload.action, 'type');
  assert.equal(env.calls[0].payload.text, 'hello 中文');
  assert.equal(env.calls[0].payload.typingIntervalMs, 5);
});

test('keypress passes keys array', async () => {
  const env = makeEnv();
  const res = await env.byName('computer_keypress').execute({ keys: ['ctrl', 'c'], confirm: true }, env.exec);
  assert.equal(res.keys, 'ctrl+c');
});

test('drag passes from/to and hold keys', async () => {
  const env = makeEnv();
  const res = await env.byName('computer_drag').execute({
    start_coordinate: [0, 0], end_coordinate: [50, 50], hold_keys: ['shift'], confirm: true,
  }, env.exec);
  assert.deepEqual(res.to, [50, 50]);
  assert.equal(env.calls[0].payload.holdKeys[0], 'shift');
});

test('scroll uses config scroll_units when clicks omitted', async () => {
  const env = makeEnv({ scroll_units: 3 });
  await env.byName('computer_scroll').execute({ coordinate: [5, 5], confirm: true }, env.exec);
  assert.equal(env.calls[0].payload.clicks, 3);
  assert.equal(env.calls[0].payload.direction, 'down');
});

test('move_mouse returns the moved coordinate', async () => {
  const env = makeEnv();
  const res = await env.byName('computer_move_mouse').execute({ coordinate: [300, 400], confirm: true }, env.exec);
  assert.deepEqual(res.moved_to, [300, 400]);
});

test('get_cursor_position reads position (only enabled gate)', async () => {
  const env = makeEnv();
  const res = await env.byName('computer_get_cursor_position').execute({}, env.exec);
  assert.deepEqual([res.x, res.y], [10, 20]);
  assert.equal(env.calls[0].payload.action, 'getpos');
});

test('wait resolves with ms (small real delay)', async () => {
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

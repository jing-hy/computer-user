import test from 'node:test';
import assert from 'node:assert/strict';
import { createInput, scrollJXA } from '../../src/platform/darwin/input.js';

function makeEnv({ cliclick = true } = {}) {
  const calls = [];
  const exec = async (cmd, args = []) => {
    calls.push({ cmd, args: [...args] });
    if (cmd.endsWith('cliclick') && args[0] === 'p:.') {
      return { code: 0, stdout: '12,34\n', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  const probe = {
    path: async (name) => (name === 'cliclick' ? (cliclick ? '/opt/homebrew/bin/cliclick' : null) : '/usr/bin/' + name),
  };
  return { handle: createInput({ exec, probe }), calls };
}

const last = (calls) => calls[calls.length - 1];

test('click maps the three click kinds onto cliclick verbs', async () => {
  for (const [kind, verb] of [['click', 'c'], ['right_click', 'rc'], ['double_click', 'dc']]) {
    const env = makeEnv();
    const res = await env.handle({ action: 'click', coordinate: [10, 20], action2: kind });
    assert.deepEqual(last(env.calls).args, [verb + ':10,20']);
    assert.deepEqual(res.cursor, [10, 20]);
    assert.equal(res.action, kind);
  }
});

test('move and getpos round-trip through cliclick', async () => {
  const env = makeEnv();
  const moved = await env.handle({ action: 'move', coordinate: [5, 6] });
  assert.deepEqual(last(env.calls).args, ['m:5,6']);
  assert.deepEqual(moved.cursor, [5, 6]);

  const pos = await env.handle({ action: 'getpos' });
  assert.deepEqual(pos.cursor, [12, 34]);
});

test('drag holds and releases modifiers around the drop', async () => {
  const env = makeEnv();
  const res = await env.handle({ action: 'drag', from: [1, 2], to: [3, 4], holdKeys: ['cmd'] });
  assert.deepEqual(last(env.calls).args, ['kd:cmd', 'dd:1,2', 'dm:3,4', 'du:3,4', 'ku:cmd']);
  assert.deepEqual(res.from, [1, 2]);
  assert.deepEqual(res.to, [3, 4]);
});

test('drag rejects non-modifier hold keys', async () => {
  const env = makeEnv();
  await assert.rejects(() => env.handle({ action: 'drag', from: [1, 1], to: [2, 2], holdKeys: ['a'] }), /只接受修饰键/);
});

test('scroll posts a wheel event through JXA (works without cliclick)', async () => {
  const env = makeEnv({ cliclick: false });
  const res = await env.handle({ action: 'scroll', coordinate: [7, 8], direction: 'down', clicks: 2 });
  const call = last(env.calls);
  assert.deepEqual(call.args.slice(0, 3), ['-l', 'JavaScript', '-e']);
  assert.match(call.args[3], /CGEventCreateScrollWheelEvent\(null, 1, 2, -6, 0\)/);
  assert.equal(res.direction, 'down');
  assert.equal(res.clicks, 2);
});

test('horizontal scroll sends a second wheel axis', async () => {
  assert.match(scrollJXA(0, 3), /CGEventCreateScrollWheelEvent\(null, 1, 2, 0, 3\)/);
});

test('type sends Unicode text through System Events (cliclick t: cannot)', async () => {
  const env = makeEnv();
  const res = await env.handle({ action: 'type', text: '你好 world' });
  const script = env.calls.find((c) => c.cmd === 'osascript');
  assert.deepEqual(script.args, ['-e', 'tell application "System Events" to keystroke "你好 world"']);
  assert.equal(res.chars, 8);
  assert.deepEqual(res.cursor, [12, 34]);
});

test('type with send_enter presses Return afterwards', async () => {
  const env = makeEnv();
  await env.handle({ action: 'type', text: 'hi', sendEnter: true });
  const scripts = env.calls.filter((c) => c.cmd === 'osascript').map((c) => c.args[1]);
  assert.equal(scripts.length, 2);
  assert.match(scripts[1], /key code 36/);
});

test('keypress builds a chord for characters', async () => {
  const env = makeEnv();
  const res = await env.handle({ action: 'keypress', keys: ['ctrl', 'a'] });
  assert.deepEqual(last(env.calls).args, ['-e', 'tell application "System Events" to keystroke "a" using {control down}']);
  assert.deepEqual(res.keys, ['ctrl', 'a']);
});

test('keypress uses a key code for special keys', async () => {
  const env = makeEnv();
  await env.handle({ action: 'keypress', keys: ['enter'] });
  assert.deepEqual(last(env.calls).args, ['-e', 'tell application "System Events" to key code 36']);
  await env.handle({ action: 'keypress', keys: ['ctrl', 'shift', 'esc'] });
  assert.deepEqual(last(env.calls).args, ['-e', 'tell application "System Events" to key code 53 using {control down, shift down}']);
});

test('keypress needs exactly one non-modifier key', async () => {
  const env = makeEnv();
  await assert.rejects(() => env.handle({ action: 'keypress', keys: ['ctrl', 'a', 'b'] }), /恰好一个非修饰键/);
  await assert.rejects(() => env.handle({ action: 'keypress', keys: ['ctrl'] }), /恰好一个非修饰键/);
  await assert.rejects(() => env.handle({ action: 'keypress', keys: [] }), /不能为空/);
});

test('pointer actions refuse to guess when cliclick is missing', async () => {
  const env = makeEnv({ cliclick: false });
  await assert.rejects(() => env.handle({ action: 'click', coordinate: [1, 2] }), /cliclick/);
  await assert.rejects(() => env.handle({ action: 'move', coordinate: [1, 2] }), /brew install cliclick/);
  await assert.rejects(() => env.handle({ action: 'getpos' }), /cliclick/);
});

test('bad coordinates and unknown actions fail loudly', async () => {
  const env = makeEnv();
  await assert.rejects(() => env.handle({ action: 'click', coordinate: [1] }), /需要 \[x, y\]/);
  await assert.rejects(() => env.handle({ action: 'click', coordinate: [NaN, 2] }), /不是有效坐标/);
  await assert.rejects(() => env.handle({ action: 'hover' }), /暂不支持/);
  await assert.rejects(() => env.handle({}), /需要 action/);
});

test('an osascript failure explains the Accessibility permission', async () => {
  const exec = async (cmd, args = []) => {
    if (cmd === 'osascript') return { code: 1, stdout: '', stderr: 'not authorized to send Apple events' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const handle = createInput({ exec, probe: { path: async () => '/usr/bin/cliclick' } });
  await assert.rejects(() => handle({ action: 'type', text: 'x' }), /辅助功能/);
});

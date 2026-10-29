import test from 'node:test';
import assert from 'node:assert/strict';
import { createComputerTools } from '../src/tools.js';

function makeEnv(opts = {}) {
  const calls = [];
  const guards = [];
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
    return { ok: true, elements: [], windows: [], found: true, foreground: { handle: 1, title: 'W' } };
  });
  const tools = createComputerTools({
    runPs,
    getConfig: () => ({ ...state }),
    approvedSessions: new Set(),
    sessionIds: ['s1'],
    setMode: async () => {},
    isStopped: opts.isStopped ?? (() => false),
    ensureGuard: opts.ensureGuard ?? ((payload) => { guards.push(payload); return true; }),
    fetchJson: opts.fetchJson,
  });
  const byName = (n) => tools.find((x) => x.name === n);
  return { tools, byName, calls, guards, state };
}

test('tool_mode=lite keeps the nine everyday tools', () => {
  const env = makeEnv({ cfg: { tool_mode: 'lite' } });
  assert.equal(env.tools.length, 9);
  const names = env.tools.map((t) => t.name);
  assert.ok(names.includes('computer_snapshot'));
  assert.ok(!names.includes('computer_invoke'));
});

test('tool_mode=custom honours enabled_tools', () => {
  const env = makeEnv({ cfg: { tool_mode: 'custom', enabled_tools: ['computer_screenshot', 'computer_snapshot'] } });
  assert.deepEqual(env.tools.map((t) => t.name).sort(), ['computer_screenshot', 'computer_snapshot']);
});

test('snapshot shortens locators but keeps them replayable', async () => {
  const env = makeEnv({
    runPs: async (script, payload) => {
      if (script === 'observe.ps1' && payload.action === 'snapshot') {
        return {
          ok: true,
          observation: { window: { handle: 42, title: 'T' }, capturedAt: 'now', truncated: false },
          elements: [{ id: 'hwnd=42|role=Button|name=OK|nth=1', role: 'Button', name: 'OK', rect: { x: 1, y: 2, w: 3, h: 4 }, enabled: true, focusable: true, value: null }],
        };
      }
      return { ok: true };
    },
  });
  const res = await env.byName('computer_snapshot').execute({ max_nodes: 10 }, {});
  assert.equal(res.elements.length, 1);
  assert.equal(res.elements[0].id, 'h=42|r=Button|n=OK|i=1');
});

test('invoke forwards the locator and fences on the foreground window', async () => {
  const env = makeEnv();
  await env.byName('computer_invoke').execute({ target: 'h=42|r=Button|n=OK|i=1' }, {});
  const call = env.calls.find((c) => c.script === 'observe.ps1' && c.payload.action === 'act');
  assert.equal(call.payload.kind, 'invoke');
  assert.equal(call.payload.locator, 'h=42|r=Button|n=OK|i=1');
  assert.equal(call.payload.requireForeground, true);
});

test('set_value carries the new value', async () => {
  const env = makeEnv();
  await env.byName('computer_set_value').execute({ target: 'h=1|r=Edit|n=|i=0', value: 'hello' }, {});
  const call = env.calls.find((c) => c.script === 'observe.ps1' && c.payload.action === 'act');
  assert.equal(call.payload.kind, 'set_value');
  assert.equal(call.payload.value, 'hello');
});

test('a pending stop refuses every tool before touching the desktop', async () => {
  const env = makeEnv({ isStopped: () => true });
  await assert.rejects(env.byName('computer_click').execute({ coordinate: [1, 2] }, {}), /已急停/);
  assert.equal(env.calls.length, 0);
  assert.equal(env.guards.length, 0);
});

test('side-effecting tools start the takeover pill with the configured hotkey', async () => {
  const env = makeEnv({ cfg: { stop_hotkey: 'ctrl+alt+f8' } });
  await env.byName('computer_click').execute({ coordinate: [1, 2] }, {});
  assert.equal(env.guards.length, 1);
  assert.equal(env.guards[0].hotkey, 'ctrl+alt+f8');
});

test('read-only tools do not start the pill', async () => {
  const env = makeEnv();
  await env.byName('computer_screenshot').execute({}, {});
  assert.equal(env.guards.length, 0);
});

test('screenshot refuses when the foreground window changed', async () => {
  const env = makeEnv({
    runPs: async (script, payload) => {
      if (script === 'observe.ps1' && payload.action === 'foreground') return { ok: true, foreground: { handle: 99, title: 'Other' } };
      if (script === 'capture.ps1') return { ok: true, path: 'p.png', width: 1, height: 1, virtual_offset: [0, 0], scale: 1 };
      return { ok: true };
    },
  });
  await assert.rejects(
    env.byName('computer_screenshot').execute({ expected_window: 7 }, {}),
    /前台窗口已变化/
  );
});

test('screenshot reports the foreground window and the look hint', async () => {
  const env = makeEnv({
    runPs: async (script, payload) => {
      if (script === 'observe.ps1' && payload.action === 'foreground') return { ok: true, foreground: { handle: 5, title: 'Editor' } };
      if (script === 'capture.ps1') return { ok: true, path: 'p.png', width: 2, height: 2, virtual_offset: [0, 0], scale: 1 };
      return { ok: true };
    },
  });
  const res = await env.byName('computer_screenshot').execute({}, {});
  assert.equal(res.window.handle, 5);
  assert.match(res.look, /read_image/);
});

test('wait with a condition polls observe.ps1 and fails loudly on timeout', async () => {
  const env = makeEnv({
    runPs: async (script, payload) => {
      if (script === 'observe.ps1' && payload.action === 'wait') return { ok: true, found: false };
      return { ok: true };
    },
  });
  await assert.rejects(
    env.byName('computer_wait').execute({ title_contains: 'Save', timeout_ms: 600 }, {}),
    /条件等待超时/
  );
});

test('doctor reports the runtime facts', async () => {
  const env = makeEnv({
    runPs: async (script, payload) => {
      if (payload.action === 'probe') return { ok: true, powershell: '5.1', edition: 'Desktop', uia: true, tempWritable: true, tempDir: 'T' };
      if (payload.action === 'foreground') return { ok: true, foreground: { handle: 3, title: 'A' } };
      return { ok: true };
    },
  });
  const res = await env.byName('computer_doctor').execute({}, {});
  assert.equal(res.powershell, '5.1');
  assert.equal(res.uia, true);
  assert.equal(res.mode, 'auto');
  assert.equal(res.stop_hotkey, 'ctrl+alt+esc');
});

test('window tools forward the handle and kind', async () => {
  const env = makeEnv();
  await env.byName('computer_move_window').execute({ window: 123, rect: { x: 0, y: 0, w: 800, h: 600 } }, {});
  const call = env.calls.find((c) => c.payload.action === 'window');
  assert.equal(call.payload.kind, 'move');
  assert.equal(call.payload.handle, 123);
  assert.deepEqual(call.payload.rect, { x: 0, y: 0, w: 800, h: 600 });
});

test('browser lane reports how to enable CDP when the port is unset', async () => {
  const env = makeEnv();
  const res = await env.byName('computer_browser').execute({}, {});
  assert.deepEqual(res.pages, []);
  assert.match(res.note, /cdp_port/);
});

test('browser lane maps CDP targets when the endpoint answers', async () => {
  const env = makeEnv({
    fetchJson: async (url) => {
      assert.match(url, /\/json\/list$/);
      return [{ id: 'A', type: 'page', title: 'Example', url: 'https://example.com', webSocketDebuggerUrl: 'ws://x' }];
    },
  });
  const res = await env.byName('computer_browser').execute({ port: 9222 }, {});
  assert.equal(res.port, 9222);
  assert.equal(res.pages[0].title, 'Example');
  assert.equal(res.pages[0].websocket, 'ws://x');
});

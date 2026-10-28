/**
 * 回归测试：DSH 0.2.x 内核的形状。
 *
 * 0.2 的 `@deepseek-ai/dsh-settings` 不再提供带命名空间的 settings scope，
 * 取而代之的是按 profile 条目 id 的 `SettingsForms`：
 *   describe() -> SettingsDescriptor[]  ({ ns, value, revision, ... })
 *   update(ns, patch) / replace(...) / mutate(...) / configure({ auto })
 * `@deepseek-ai/dsh-llm` 同时移除了可变的 provider 注册对象，输出过滤器要挂到
 * `llm/stream` waterfall 上。
 *
 * 这些测试锁定插件在 0.2 形状下：读当前 Config、写回 mode、关掉自动生成页、
 * 以及 `llm/stream` 上的伪工具调用过滤。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { apply as applyPlugin, guardStream } from '../src/index.js';

function makeCtx({ settings, commands } = {}) {
  const tools = [];
  const logs = [];
  const injects = [];
  const listeners = new Map();
  const ctx = {
    logger: {
      info: (m) => logs.push(['info', m]),
      warn: (m) => logs.push(['warn', m]),
    },
    effect: (fn) => fn(),
    tools: { register: (t) => { tools.push(t); return () => {}; } },
    on: (event, listener) => {
      listeners.set(event, listener);
      return () => listeners.delete(event);
    },
    inject: (deps, cb) => {
      injects.push(deps.join('+'));
      if (deps.includes('settings') && settings) cb({ settings });
      if (deps.includes('commands') && commands) cb({ commands });
      return () => {};
    },
  };
  return { ctx, tools, logs, injects, listeners };
}

/** Collect an async iterable into an array. */
async function collect(iterable) {
  const out = [];
  for await (const chunk of iterable) out.push(chunk);
  return out;
}

async function* fromArray(items) {
  for (const item of items) yield item;
}

// ── SettingsForms（0.2 形状）────────────────────────────────────────────────

test('apply(): SettingsForms — reads live Config from describe() and writes mode through update()', async () => {
  const state = { mode: 'auto', ai_can_change_mode: true, output_guard: true, debug: false };
  const updates = [];
  const settings = {
    describe: () => [{ ns: 'computer-user', value: { ...state }, revision: 3, writable: true }],
    update: async (ns, patch) => {
      updates.push([ns, patch]);
      Object.assign(state, patch);
    },
    configure: () => () => {},
  };
  const { ctx, tools } = makeCtx({ settings });

  applyPlugin(ctx, { mode: 'manual' });

  const setMode = tools.find((t) => t.name === 'computer_set_mode');
  assert.ok(setMode, 'computer_set_mode must be registered');
  const result = await setMode.execute({ mode: 'readonly' }, {});
  assert.deepEqual(updates, [['computer-user', { mode: 'readonly' }]], 'mode must be written through SettingsForms.update(ns, patch)');
  assert.equal(result.mode, 'readonly');
  assert.equal(state.mode, 'readonly');
});

test('apply(): SettingsForms — declares auto:false for the bundled settings card', () => {
  const configureCalls = [];
  const settings = {
    describe: () => [],
    update: async () => {},
    configure: (presentation, owner) => {
      configureCalls.push({ presentation, owner });
      return () => {};
    },
  };
  const { ctx } = makeCtx({ settings });
  const pluginFiber = { id: 'fiber-computer-user' };
  ctx.fiber = pluginFiber;

  applyPlugin(ctx, { mode: 'manual' });

  assert.equal(configureCalls.length, 1, 'configure() must be called once');
  assert.deepEqual(configureCalls[0].presentation, { auto: false }, 'the bundled card replaces the generated page');
  assert.equal(configureCalls[0].owner, pluginFiber, 'the policy belongs to the plugin fiber');
});

test('apply(): SettingsForms — the mode gate follows describe(), not the boot snapshot', async () => {
  const state = { mode: 'readonly', ai_can_change_mode: false, output_guard: true, debug: false };
  const settings = {
    describe: () => [{ ns: 'computer-user', value: { ...state } }],
    update: async () => {},
    configure: () => () => {},
  };
  const { ctx, tools } = makeCtx({ settings });
  // The boot snapshot says auto, the live Config says readonly: the gate must
  // deny before any PowerShell side effect runs.
  applyPlugin(ctx, { mode: 'auto' });

  const click = tools.find((t) => t.name === 'computer_click');
  await assert.rejects(() => click.execute({ coordinate: [1, 2] }, {}), /只读模式/, 'readonly must be enforced from the live value');
});

// ── llm/stream waterfall ───────────────────────────────────────────────────

test('guardStream: first fake tool-call text is replaced by the coaching note, the second passes', async () => {
  const fake = 'computer_click({ coordinate: [10, 20] })';
  const chunks = [
    { type: 'text-delta', index: 0, text: fake },
    { type: 'text-delta', index: 0, text: 'normal tail' },
    { type: 'text-delta', index: 0, text: fake },
  ];
  const out = await collect(guardStream(fromArray(chunks), () => ({ output_guard: true })));

  assert.equal(out.length, 3, 'the rejected delta is dropped and the note takes its place');
  assert.match(out[0].text, /输出已过滤/, 'the note explains the filter');
  assert.equal(out[1].text, 'normal tail');
  assert.equal(out[2].text, fake, 'the same text passes on the second output');
});

test('guardStream: output_guard=false forwards every chunk untouched', async () => {
  const fake = 'computer_click({ coordinate: [10, 20] })';
  const chunks = [{ type: 'text-delta', index: 0, text: fake }];
  const out = await collect(guardStream(fromArray(chunks), () => ({ output_guard: false })));
  assert.deepEqual(out, chunks);
});

test('apply(): registers the output guard on the llm/stream waterfall', () => {
  const settings = {
    describe: () => [{ ns: 'computer-user', value: { mode: 'auto', output_guard: true } }],
    update: async () => {},
    configure: () => () => {},
  };
  const { ctx, listeners } = makeCtx({ settings });
  applyPlugin(ctx, { mode: 'auto' });

  const handler = listeners.get('llm/stream');
  assert.equal(typeof handler, 'function', 'the guard must listen on llm/stream');
  const out = handler({}, () => fromArray([{ type: 'text-delta', index: 0, text: 'computer_wait({ ms: 5 })' }]));
  return collect(out).then((chunks) => {
    assert.equal(chunks.length, 1);
    assert.match(chunks[0].text, /输出已过滤/);
  });
});

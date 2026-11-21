/**
 * 回归测试：流式热路径的代价。
 *
 * issue #8：启用本插件后流式输出从约 200 tok/s 掉到 16–18 tok/s，禁用即恢复，
 * 且与是否真的调用工具无关。原因是 output guard 的 \`llm/stream\` 钩子对**每个
 * chunk** 读一次 Config，而 0.2.x 的实时读法是 \`SettingsForms.describe()\`：
 * 每次调用重建全部活跃 profile 条目的表单、schema JSON 与 revision 串
 * （本机 238 条目实测约 50 ms、约 1 MB 垃圾），于是每条流都被它钉在
 * 约 20 chunk/s。
 *
 * 这些测试锁定修复后的形状：
 *   1. 一条流只解析一次 output_guard 偏好（不是每个 chunk 一次）；
 *   2. 宿主暴露 fiber 的解析后 Config 时，完全不碰 settings.describe()；
 *   3. 只能走 settings 时，describe() 的结果在短窗口内复用；
 *   4. 0.2.x 的 llm/stream 生效后，0.1.x 的 provider 代理自动卸载，
 *      同一个 chunk 不会被两层 guard 分别判定。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { apply as applyPlugin, guardStream, plainConfigOf } from '../../src/index.js';

function makeCtx({ settings, commands, llm } = {}) {
  const tools = [];
  const logs = [];
  const listeners = new Map();
  const ctx = {
    logger: { info: (m) => logs.push(['info', m]), warn: (m) => logs.push(['warn', m]) },
    effect: (fn) => fn(),
    tools: { register: (t) => { tools.push(t); return () => {}; } },
    on: (event, listener) => { listeners.set(event, listener); return () => listeners.delete(event); },
    inject: (deps, cb) => {
      if (deps.includes('settings') && settings) cb({ settings });
      if (deps.includes('commands') && commands) cb({ commands });
      if (deps.includes('llm') && llm) cb({ llm });
      return () => {};
    },
  };
  return { ctx, tools, logs, listeners };
}

async function collect(iterable) {
  const out = [];
  for await (const chunk of iterable) out.push(chunk);
  return out;
}

async function* fromArray(items) {
  for (const item of items) yield item;
}

const tokens = (n) => Array.from({ length: n }, (_, i) => ({ type: 'text-delta', index: 0, text: 'tok' + i }));

// ── guardStream：每条流只读一次偏好 ─────────────────────────────────────────

test('guardStream: reads the preference once per stream, not once per chunk', async () => {
  let reads = 0;
  const out = await collect(guardStream(fromArray(tokens(1000)), () => {
    reads++;
    return { output_guard: true };
  }));
  assert.equal(out.length, 1000, 'every clean chunk must still be forwarded');
  assert.equal(reads, 1, 'the live Config read must not run per chunk (issue #8)');
});

test('guardStream: accepts an already-resolved Config', async () => {
  const chunks = [{ type: 'text-delta', index: 0, text: 'hello' }];
  assert.deepEqual(await collect(guardStream(fromArray(chunks), { output_guard: true })), chunks);
  assert.deepEqual(await collect(guardStream(fromArray(chunks), { output_guard: false })), chunks);
});

test('guardStream: output_guard=false forwards every chunk without reading again', async () => {
  const chunks = [{ type: 'text-delta', index: 0, text: 'computer_click({ coordinate: [1, 2] })' }];
  let reads = 0;
  const out = await collect(guardStream(fromArray(chunks), () => { reads++; return { output_guard: false }; }));
  assert.deepEqual(out, chunks);
  assert.equal(reads, 1);
});

// ── apply：实时 Config 走 fiber，而不是 describe() ──────────────────────────

test('apply(): a fiber-exposed Config never rebuilds the settings forms', async () => {
  let describeCalls = 0;
  const settings = {
    describe: () => { describeCalls++; return [{ ns: 'computer-user', value: { output_guard: true } }]; },
    update: async () => {},
    configure: () => () => {},
  };
  const { ctx, listeners } = makeCtx({ settings });
  // cordis keeps the resolved config on the fiber; a .volatile() write updates
  // it in place, so it is both live and free.
  ctx.fiber = { effectiveConfig: { mode: 'auto', ai_can_change_mode: true, output_guard: true } };
  applyPlugin(ctx, { mode: 'manual' });

  const handler = listeners.get('llm/stream');
  assert.equal(typeof handler, 'function');
  const out = await collect(handler({}, () => fromArray(tokens(500))));

  assert.equal(out.length, 500);
  assert.equal(describeCalls, 0, 'the hot path must not call SettingsForms.describe() at all');
});

test('apply(): the settings fallback is cached, so a long stream rebuilds the forms at most once', async () => {
  let describeCalls = 0;
  const settings = {
    describe: () => { describeCalls++; return [{ ns: 'computer-user', value: { mode: 'auto', output_guard: true } }]; },
    update: async () => {},
    configure: () => () => {},
  };
  const { ctx, listeners } = makeCtx({ settings });
  applyPlugin(ctx, { mode: 'manual' });

  const handler = listeners.get('llm/stream');
  await collect(handler({}, () => fromArray(tokens(400))));
  await collect(handler({}, () => fromArray(tokens(400))));

  assert.ok(describeCalls <= 1, 'describe() must be cached, not called per stream/chunk (got ' + describeCalls + ')');
});

test('apply(): the volatile reference a fiber exposes is flattened like the host does', () => {
  const write = Symbol.for('cosmokit.volatile.write');
  const ref = Object.freeze({ get: () => ({ mode: 'readonly', output_guard: false }), [write]: () => {} });
  assert.deepEqual(plainConfigOf(ref), { mode: 'readonly', output_guard: false });
  assert.deepEqual(plainConfigOf({ a: [ref] }), { a: [{ mode: 'readonly', output_guard: false }] });
});

// ── 0.2.x waterfall 生效后，0.1.x 代理必须卸载 ──────────────────────────────

test('apply(): the 0.1.x provider proxy retires once llm/stream runs, so a chunk is guarded once', async () => {
  const fake = 'computer_wait({ ms: 5 })';
  const original = { stream: () => fromArray([{ type: 'text-delta', index: 0, text: fake }]) };
  const registration = { provider: 'deepseek', adapter: original };
  const llm = {
    listProviders: () => ['deepseek'],
    registration: () => registration,
    on: () => () => {},
  };
  const settings = { describe: () => [], update: async () => {}, configure: () => () => {} };
  const { ctx, listeners } = makeCtx({ settings, llm });
  ctx.fiber = { effectiveConfig: { mode: 'auto', output_guard: true } };
  applyPlugin(ctx, { mode: 'manual' });

  assert.notEqual(registration.adapter, original, 'without a waterfall the provider proxy is the fallback');

  const handler = listeners.get('llm/stream');
  const out = await collect(handler({}, () => registration.adapter.stream({})));

  assert.equal(registration.adapter, original, 'the fallback must uninstall itself when the waterfall runs');
  assert.equal(out.length, 1);
  assert.match(out[0].text, /输出已过滤/, 'the single remaining layer still filters the fake call');
});

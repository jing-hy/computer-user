/**
 * 回归测试：DSH 内核 0.1.3 起 @deepseek-ai/dsh-settings 只导出
 * { SettingsConflictError, SettingsProvider, redactSecrets } ——
 * settingsNamespace / installSettingsSection 已被移除（GitHub issue #1：
 * 「更新后无法启动」）。插件入口若继续 import 这两个符号，模块图直接
 * 抛 "does not provide an export named 'settingsNamespace'"，整个插件
 * 无法加载。
 *
 * 同时锁定 0.1.3 的 owner-scope API 形状：只有 get / watch / update / replace，
 * 没有 set —— 写配置必须走 update。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { settingsNamespace } from '../src/settings-compat.js';
import { apply as applyPlugin } from '../src/index.js';

const srcDir = fileURLToPath(new URL('../src/', import.meta.url));

function makeCtx({ settings, commands } = {}) {
  const tools = [];
  const logs = [];
  const commandDefs = [];
  const injects = [];
  const ctx = {
    logger: {
      info: (m) => logs.push(['info', m]),
      warn: (m) => logs.push(['warn', m]),
    },
    effect: (fn) => fn(),
    tools: { register: (t) => tools.push(t) },
    inject: (deps, cb) => {
      injects.push(deps.join('+'));
      if (deps.includes('settings') && settings) cb({ settings });
      if (deps.includes('commands') && commands) cb({ commands });
      // 'llm' 刻意不提供：输出过滤器那条支路不在本测试范围内
      return () => {};
    },
  };
  return { ctx, tools, logs, commandDefs, injects };
}

// ── 垫片本身 ───────────────────────────────────────────────────────────────

test('settingsNamespace accepts kebab-case names and rejects everything else', () => {
  assert.equal(settingsNamespace('computer-user'), 'computer-user');
  assert.equal(settingsNamespace('a'), 'a');
  assert.equal(settingsNamespace('a1-b2'), 'a1-b2');
  for (const bad of ['ComputerUser', 'computer_user', '1computer', '', 'computer user', '-leading', null, 42]) {
    assert.throws(() => settingsNamespace(bad), TypeError, `expected TypeError for ${JSON.stringify(bad)}`);
  }
});

// ── issue #1 回归：不再依赖被移除的导出 ────────────────────────────────────

test('issue #1 regression: no src file imports anything from @deepseek-ai/dsh-settings', () => {
  const offenders = [];
  for (const file of readdirSync(srcDir)) {
    if (!file.endsWith('.js')) continue;
    const text = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (/^\s*(import|export)[^\n]*from\s+['"]@deepseek-ai\/dsh-settings['"]/.test(line)) {
        offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(offenders, [], `plugin must not import removed exports:\n${offenders.join('\n')}`);
});

test('issue #1 regression: the shim lives in-tree and is part of the published files', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(pkg.files.includes('src'), 'package.json "files" must ship src/ (where settings-compat.js lives)');
  assert.equal(typeof settingsNamespace, 'function');
});

// ── 0.1.3 owner scope：只有 update，没有 set ───────────────────────────────

test('apply(): 0.1.3 scope (get/watch/update, no set) — computer_set_mode persists through scope.update', async () => {
  const state = { mode: 'auto', ai_can_change_mode: true, output_guard: true, debug: false };
  const updates = [];
  const registerCalls = [];
  const scope = {
    get: () => ({ ...state }),
    watch: () => () => {},
    update: (patch) => {
      updates.push(patch);
      Object.assign(state, patch);
    },
    // 故意不提供 set：0.1.3 的 scope 没有它
  };
  const settings = {
    register(ns, schema, options) {
      registerCalls.push({ ns, schema, hasBase: Object.prototype.hasOwnProperty.call(options ?? {}, 'base') });
      return scope;
    },
  };
  const { ctx, tools, commandDefs } = makeCtx({ settings, commands: { register: (d) => commandDefs.push(d) } });

  applyPlugin(ctx, { mode: 'auto', ai_can_change_mode: true });

  assert.equal(registerCalls.length, 1, 'settings namespace must register exactly once');
  assert.equal(registerCalls[0].ns, 'computer-user');
  assert.ok(registerCalls[0].hasBase, 'composition base (the entry config) must be passed through');

  const setModeTool = tools.find((t) => t.name === 'computer_set_mode');
  assert.ok(setModeTool, 'computer_set_mode must be registered');
  const result = await setModeTool.execute({ mode: 'readonly' }, {});
  assert.deepEqual(updates, [{ mode: 'readonly' }], 'mode must be written via scope.update({...})');
  assert.equal(result.mode, 'readonly');
  assert.equal(state.mode, 'readonly');
});

test('apply(): settings service without register() (post-0.1.3 kernels) degrades instead of aborting apply', () => {
  const settings = { describe() {}, schema() {} }; // 新内核形状：没有 register
  const { ctx, tools, logs, commandDefs } = makeCtx({
    settings,
    commands: { register: (d) => commandDefs.push(d) },
  });

  assert.doesNotThrow(() => applyPlugin(ctx, { mode: 'manual' }));

  // 关键：settings 失败后，同一 apply 里后面的 /computer 命令接线必须照常完成
  assert.ok(commandDefs.some((d) => d.name === 'computer'), '/computer command must still be registered');
  assert.ok(tools.length > 0, 'tools must still be registered');
  assert.ok(
    logs.some(([level, msg]) => level === 'warn' && /settings disabled/.test(msg)),
    'the degradation must be logged as a warning',
  );
});

test('apply(): settings.register throwing does not swallow the tools registered before it', () => {
  const settings = {
    register() {
      throw new TypeError('settings.register is not a function');
    },
  };
  const { ctx, tools, logs } = makeCtx({ settings });

  assert.doesNotThrow(() => applyPlugin(ctx, { mode: 'auto' }));
  assert.equal(tools.length, 21, 'all 21 computer_* tools must still register');
  assert.ok(logs.some(([, msg]) => /settings\.register is not a function/.test(msg)));
});

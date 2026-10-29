/**
 * Regression: the entry's default export must carry the Config schema.
 *
 * cordis's loader normalizes a plugin module with
 *   exports = exports.default ?? exports
 * and settings derives a form from entry.fiber.runtime.Config, where the
 * runtime is that normalized object. An entry that only named-exports Config
 * (and separately default-exports { apply }) loses its schema, so the Host
 * never serves the namespace: the settings card then reports "not served by
 * the host" and the plugin does not appear in the plugin list.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import entry, { Config } from '../src/index.js';

test('default export carries Config for the cordis loader', () => {
  assert.equal(entry.Config, Config, 'entry.fiber.runtime.Config must resolve');
  assert.equal(entry.name, 'computer-user');
  assert.equal(typeof entry.apply, 'function');
});

test('Config is a standard schema covering every settings field', () => {
  assert.equal(typeof (Config['~standard'] && Config['~standard'].validate), 'function', 'cordis resolveConfig needs ~standard.validate');
  const result = Config['~standard'].validate({});
  assert.equal(result.issues, undefined);
  const value = result.value;
  for (const key of [
    'mode',
    'ai_can_change_mode',
    'screenshot_dir',
    'default_scale',
    'typing_interval_ms',
    'scroll_units',
    'output_guard',
    'debug',
  ]) {
    assert.ok(key in value, key + ' missing from the schema');
  }
});

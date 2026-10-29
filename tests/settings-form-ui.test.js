/**
 * Regression: the Web settings card uses the official settings-form language.
 *
 * DSH's built-in plugin pages render through
 * @deepseek-ai/dsh-client-ui-primitives' SettingsForm / SettingsValueField:
 * a flat field list with hairline separators, 34px inputs on layer-3, 13px/500
 * labels, 12px tertiary hints, a per-field "overridden" badge with a text reset,
 * and one filled save button. This test pins that vocabulary so a future edit
 * cannot silently drift back to the old bordered-card / capsule-button look.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

test('settings card uses the official settings-form tokens', () => {
  assert.ok(client.includes('var(--dsw-radius-md)'), 'inputs and button use --dsw-radius-md');
  assert.ok(client.includes('height:34px'), 'inputs are 34px tall like fields.module.css');
  assert.ok(client.includes('background:var(--dsw-alias-bg-layer-3)'), 'inputs sit on layer-3');
  assert.ok(client.includes('border-top:.5px solid var(--dsw-alias-border-l2)'), 'fields are separated by a hairline');
  assert.ok(client.includes('font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)'), 'labels are 13px/500 primary');
  assert.ok(client.includes('.__cu_save:disabled{opacity:.4'), 'save button dims when disabled');
});

test('the old bordered-card / capsule / disclosure look is gone', () => {
  assert.ok(!client.includes('__cu_card'), 'no bordered card group');
  assert.ok(!client.includes('__cu_btn'), 'no capsule button class');
  assert.ok(!client.includes('__cu_advanced'), 'no advanced disclosure block');
  assert.ok(!client.includes('border-radius:18px'), 'no capsule radius');
  assert.ok(!client.includes('details.__cu_advanced'), 'no details disclosure');
});

test('edits are staged and written atomically through the shared form', () => {
  assert.ok(client.includes('scope.mutate(ops, snapshot.revision)'), '0.2.x path mutates with the read revision');
  assert.ok(client.includes('scope.set(op.path[0], op.value)'), '0.1.x fallback still writes per field');
  assert.ok(client.includes('scope.unset(op.path[0])'), 'clearing a field stages an unset');
  assert.ok(client.includes('setFailed(true)'), 'a refused save keeps the drafts and reports failure');
});

test('per-field overridden badge and reset are wired', () => {
  assert.ok(client.includes('t("overridden")'), 'overridden badge label');
  assert.ok(client.includes('t("reset")'), 'reset control label');
  assert.ok(client.includes('hasOwn(user, f.key)'), 'overridden is decided by the user layer presence');
});

test('every Config field is reachable from the card', () => {
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
    assert.ok(client.includes('key: "' + key + '"'), 'field ' + key + ' is rendered');
  }
});

test('the card registers into settings.section and keeps the 0.1.x transport', () => {
  assert.ok(client.includes('name: "settings.section"'), 'registers a settings section');
  assert.ok(client.includes('ctx.inject(["configForms"]'), '0.2.x transport');
  assert.ok(client.includes('ctx.inject(["settingsScope"]'), '0.1.x fallback transport');
});

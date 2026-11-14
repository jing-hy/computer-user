import test from 'node:test';
import assert from 'node:assert/strict';
import { appleScriptString, resolveKey, usingClause } from '../../src/platform/darwin/keys.js';

test('modifier aliases cover the Windows spellings', () => {
  for (const name of ['ctrl', 'control']) {
    assert.deepEqual(resolveKey(name), { kind: 'modifier', osascript: 'control down', cliclick: 'ctrl' });
  }
  assert.equal(resolveKey('alt').osascript, 'option down');
  assert.equal(resolveKey('option').cliclick, 'alt');
  for (const name of ['super', 'win', 'cmd', 'command', 'meta']) {
    assert.equal(resolveKey(name).osascript, 'command down', name);
  }
  assert.equal(resolveKey('shift').cliclick, 'shift');
});

test('special keys carry an AppleScript key code and a cliclick name', () => {
  assert.deepEqual(resolveKey('enter'), { kind: 'code', code: 36, cliclick: 'enter' });
  assert.equal(resolveKey('return').code, 36);
  assert.equal(resolveKey('tab').code, 48);
  assert.equal(resolveKey('esc').code, 53);
  assert.equal(resolveKey('space').code, 49);
  assert.equal(resolveKey('backspace').code, 51);
  assert.equal(resolveKey('delete').code, 51);
  assert.equal(resolveKey('up').code, 126);
  assert.equal(resolveKey('pageup').code, 116);
  assert.equal(resolveKey('f1').code, 122);
  assert.equal(resolveKey('f12').code, 111);
  assert.equal(resolveKey('f20').code, 90);
  assert.equal(resolveKey('f17').cliclick, null);
});

test('single characters resolve to keystroke payloads (not key codes)', () => {
  assert.deepEqual(resolveKey('a'), { kind: 'char', value: 'a' });
  assert.deepEqual(resolveKey('7'), { kind: 'char', value: '7' });
  assert.deepEqual(resolveKey('-'), { kind: 'char', value: '-' });
  // case is normalized: ctrl+A and ctrl+a are the same chord
  assert.deepEqual(resolveKey('A'), { kind: 'char', value: 'a' });
});

test('Windows-only keys are rejected instead of silently remapped', () => {
  for (const name of ['insert', 'prtsc', 'printscreen', 'pause', 'scrolllock', 'numlock', 'clear']) {
    assert.throws(() => resolveKey(name), /没有|未知/, name);
  }
});

test('unknown multi-character names are rejected with the supported set', () => {
  assert.throws(() => resolveKey('hyper'), /未知键名/);
  assert.throws(() => resolveKey(''), /键名为空/);
});

test('appleScriptString escapes quotes, backslashes and control characters', () => {
  assert.equal(appleScriptString('你好'), '"你好"');
  assert.equal(appleScriptString('a"b'), '"a\\"b"');
  assert.equal(appleScriptString('a\\b'), '"a\\\\b"');
  assert.equal(appleScriptString('a\nb'), '"a\\nb"');
});

test('usingClause builds the AppleScript modifier list', () => {
  assert.equal(usingClause([]), '');
  assert.equal(usingClause(undefined), '');
  assert.equal(usingClause(['control']), ' using {control down}');
  assert.equal(usingClause(['control', 'shift']), ' using {control down, shift down}');
});

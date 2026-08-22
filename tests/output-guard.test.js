import test from 'node:test';
import assert from 'node:assert/strict';
import { detectFakeToolText, createOutputGuard } from '../src/output-guard.js';

test('detectFakeToolText: pseudo invoke XML is detected', () => {
  assert.ok(detectFakeToolText('<invoke name="computer_click">'));
  assert.ok(detectFakeToolText('请调用 <使用工具：computer_type>'));
});

test('detectFakeToolText: bare tool-call-as-text JSON is detected', () => {
  assert.ok(detectFakeToolText('computer_click({ coordinate: [1, 2] })'));
  assert.ok(detectFakeToolText('await computer_keypress(["ctrl","c"])'));
});

test('detectFakeToolText: normal text passes', () => {
  assert.equal(detectFakeToolText('让我先截图看一下屏幕。'), null);
  assert.equal(detectFakeToolText('这个插件叫 computer-user，功能是读屏和操作鼠标键盘。'), null);
});

test('createOutputGuard: first fake-call occurrence rejected, second same passes', () => {
  const guard = createOutputGuard({ allowAfter: 2 });
  const d1 = guard.sniff('computer_click({ coordinate: [10, 20] })');
  assert.equal(d1.kind, 'reject');
  assert.match(d1.note, /第二次/);
  const d2 = guard.sniff('computer_click({ coordinate: [10, 20] })');
  assert.equal(d2.kind, 'pass-second');
  const d3 = guard.sniff('computer_click({ coordinate: [10, 20] })');
  assert.equal(d3.kind, 'pass-second'); // allowed from now on
});

test('createOutputGuard: different fingerprints count separately', () => {
  const guard = createOutputGuard({ allowAfter: 2 });
  assert.equal(guard.sniff('computer_click({ coordinate: [1, 1] })').kind, 'reject');
  assert.equal(guard.sniff('computer_type({ text: "a" })').kind, 'reject');
  assert.equal(guard.sniff('computer_click({ coordinate: [1, 1] })').kind, 'pass-second');
  assert.equal(guard.sniff('computer_type({ text: "a" })').kind, 'pass-second');
});

test('createOutputGuard: normal deltas pass and do not leak counts', () => {
  const guard = createOutputGuard();
  assert.equal(guard.sniff('好的，我先截图。').kind, 'pass');
  assert.equal(guard.sniff('computer-user 插件已经发布了。').kind, 'pass');
  assert.equal(guard.counts.size, 0);
});

test('createOutputGuard: reject then pass-second even when interleaved with normal text', () => {
  const guard = createOutputGuard({ allowAfter: 2 });
  assert.equal(guard.sniff('好的').kind, 'pass');
  const r = guard.sniff('<invoke name="computer_screenshot">');
  assert.equal(r.kind, 'reject');
  assert.match(r.note, /输出已过滤/);
  const r2 = guard.sniff('<invoke name="computer_screenshot">');
  assert.equal(r2.kind, 'pass-second');
});
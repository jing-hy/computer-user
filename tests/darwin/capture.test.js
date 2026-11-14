import test from 'node:test';
import assert from 'node:assert/strict';
import { createCapture } from '../../src/platform/darwin/capture.js';

/** 24-byte PNG header only — enough for the size reader. */
function fakePng(width, height) {
  const buf = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

/**
 * Fake macOS command layer: screencapture writes a PNG header, sips rewrites the
 * header to emulate crop/resample, osascript reports the backing scale factor.
 */
function makeEnv({ screen = { width: 2880, height: 1800 }, dpr, hasScreencapture = true } = {}) {
  const calls = [];
  const files = new Map();
  const exec = async (cmd, args = []) => {
    calls.push({ cmd, args: [...args] });
    if (cmd === 'screencapture') {
      const out = args[args.length - 1];
      files.set(out, fakePng(screen.width, screen.height));
      return { code: 0, stdout: '', stderr: '' };
    }
    if (cmd === 'sips') {
      const out = args[args.length - 1];
      const cur = files.get(out) || fakePng(1, 1);
      const resample = args.indexOf('--resampleWidth');
      if (resample >= 0) {
        const w = Number(args[resample + 1]);
        const ratio = w / cur.readUInt32BE(16);
        files.set(out, fakePng(w, Math.max(1, Math.round(cur.readUInt32BE(20) * ratio))));
        return { code: 0, stdout: '', stderr: '' };
      }
      const crop = args.indexOf('-c');
      if (crop >= 0) {
        files.set(out, fakePng(Number(args[crop + 2]), Number(args[crop + 1])));
        return { code: 0, stdout: '', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    }
    if (cmd === 'osascript') {
      if (dpr === undefined) return { code: 1, stdout: '', stderr: 'boom' };
      return { code: 0, stdout: String(dpr) + '\n', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  const probe = { has: async (name) => (name === 'screencapture' ? hasScreencapture : true) };
  const capture = createCapture({ exec, probe, readFile: (p) => {
    if (!files.has(p)) throw new Error('missing file ' + p);
    return files.get(p);
  }, mkdir: () => {} });
  return { capture, calls, files };
}

test('full-screen capture normalizes Retina pixels to logical points', async () => {
  const env = makeEnv({ dpr: 2 });
  const res = await env.capture({ outPath: '/tmp/shot.png' });
  assert.equal(res.ok, true);
  assert.equal(res.width, 1440);
  assert.equal(res.height, 900);
  assert.deepEqual(res.virtual_offset, [0, 0]);
  assert.equal(res.scale, 1);
  assert.equal(res.backing_scale, 2);
  assert.equal(res.display, 'main');
  const sips = env.calls.find((c) => c.cmd === 'sips');
  assert.deepEqual(sips.args, ['--resampleWidth', '1440', '/tmp/shot.png']);
});

test('scale factor 1 keeps the physical pixels untouched', async () => {
  const env = makeEnv({ dpr: 1 });
  const res = await env.capture({ outPath: '/tmp/shot.png' });
  assert.equal(res.width, 2880);
  assert.equal(res.backing_scale, undefined);
  assert.equal(env.calls.filter((c) => c.cmd === 'sips').length, 0);
});

test('region crops in physical pixels and reports a point-space offset', async () => {
  const env = makeEnv({ dpr: 2 });
  const res = await env.capture({ outPath: '/tmp/shot.png', region: [0.5, 0.5, 1, 1] });
  const crop = env.calls.find((c) => c.cmd === 'sips');
  assert.deepEqual(crop.args, ['-c', '900', '1440', '--cropOffset', '900', '1440', '/tmp/shot.png']);
  assert.deepEqual(res.virtual_offset, [720, 450]);
  assert.equal(res.width, 720);
  assert.equal(res.height, 450);
});

test('explicit scale shrinks the normalized image', async () => {
  const env = makeEnv({ dpr: 2 });
  const res = await env.capture({ outPath: '/tmp/shot.png', scale: 0.5 });
  assert.equal(res.scale, 0.5);
  assert.equal(res.width, 720);
  assert.equal(env.calls.filter((c) => c.cmd === 'sips').length, 2);
});

test('an unreadable scale factor falls back to 1 instead of failing the shot', async () => {
  const env = makeEnv({ dpr: undefined });
  const res = await env.capture({ outPath: '/tmp/shot.png' });
  assert.equal(res.width, 2880);
  assert.equal(res.backing_scale, undefined);
});

test('missing outPath is a clear error', async () => {
  const env = makeEnv({ dpr: 2 });
  await assert.rejects(() => env.capture({}), /需要 outPath/);
});

test('a missing screencapture binary is reported, not guessed', async () => {
  const env = makeEnv({ dpr: 2, hasScreencapture: false });
  await assert.rejects(() => env.capture({ outPath: '/tmp/shot.png' }), /screencapture/);
});

test('a degenerate region is rejected', async () => {
  const env = makeEnv({ dpr: 2 });
  await assert.rejects(() => env.capture({ outPath: '/tmp/shot.png', region: [0.5, 0.5, 0.5, 0.5] }), /裁剪框为空/);
});

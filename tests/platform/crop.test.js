import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyCrop, stripPlatformBranch, stripPlatformImport } from '../../scripts/crop-platform.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const WORK = mkdtempSync(join(tmpdir(), 'cu-crop-'));

test.after(() => rmSync(WORK, { recursive: true, force: true }));

test('stripPlatformBranch removes a single-line branch', () => {
  const src = [
    "  if (platform === 'win32') {",
    '    return { id: "windows" };',
    '  }',
    "  if (platform === 'darwin') return { id: 'darwin' };",
    '  throw new Error("no");',
  ].join('\n');
  const out = stripPlatformBranch(src, 'darwin');
  assert.doesNotMatch(out, /darwin/);
  assert.match(out, /win32/);
  assert.match(out, /throw new Error/);
});

test('stripPlatformBranch removes a braced branch without touching the rest', () => {
  const src = [
    "  if (platform === 'win32') {",
    '    return {',
    '      ...windows,',
    "      id: 'windows',",
    '    };',
    '  }',
    "  if (platform === 'darwin') return { id: 'darwin' };",
    '  throw new Error("no");',
  ].join('\n');
  const out = stripPlatformBranch(src, 'win32');
  assert.doesNotMatch(out, /windows/);
  assert.match(out, /darwin/);
});

test('stripPlatformImport drops only the matching import line', () => {
  const src = [
    "import * as windows from './ps.js';",
    "import { darwinBackend } from './platform/darwin/index.js';",
    'export const x = 1;',
  ].join('\n');
  const win = stripPlatformImport(src, 'darwin');
  assert.doesNotMatch(win, /darwinBackend/);
  assert.match(win, /ps\.js/);
  const mac = stripPlatformImport(src, 'win32');
  assert.doesNotMatch(mac, /ps\.js/);
  assert.match(mac, /darwinBackend/);
});

test('win32 snapshot keeps only the PowerShell backend', async () => {
  const outDir = join(WORK, 'win32');
  const result = applyCrop({ root: ROOT, outDir, platform: 'win32' });
  assert.ok(existsSync(join(outDir, 'src/ps.js')));
  assert.ok(existsSync(join(outDir, 'src/capture.ps1')));
  assert.ok(!existsSync(join(outDir, 'src/platform/darwin')), 'macOS backend must be gone');
  assert.ok(!existsSync(join(outDir, 'tests/darwin')), 'macOS tests must be gone');

  const pkg = JSON.parse(readFileSync(join(outDir, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.os, ['win32']);
  assert.match(pkg.description, /Windows/);

  const backend = readFileSync(join(outDir, 'src/backend.js'), 'utf8');
  assert.doesNotMatch(backend, /darwinBackend/);
  assert.match(backend, /ps\.js/);

  const cropped = await import(pathToFileURL(join(outDir, 'src/backend.js')).href);
  assert.equal(cropped.selectBackend('win32').id, 'windows');
  assert.throws(() => cropped.selectBackend('darwin'), /仅支持 Windows 与 macOS/);

  const meta = JSON.parse(readFileSync(join(outDir, '.platform-crop.json'), 'utf8'));
  assert.equal(meta.platform, 'win32');
  assert.ok(meta.removed.some((p) => p.startsWith('src/platform/darwin')));
  assert.equal(result.packageJson.os[0], 'win32');
});

test('darwin snapshot keeps only the macOS backend', async () => {
  const outDir = join(WORK, 'darwin');
  applyCrop({ root: ROOT, outDir, platform: 'darwin' });
  assert.ok(existsSync(join(outDir, 'src/platform/darwin/index.js')));
  assert.ok(existsSync(join(outDir, 'src/stop-flag.js')));
  for (const gone of ['src/ps.js', 'src/capture.ps1', 'src/input.ps1', 'src/observe.ps1', 'src/guard.ps1', 'tests/windows']) {
    assert.ok(!existsSync(join(outDir, gone)), gone + ' must be gone');
  }

  const pkg = JSON.parse(readFileSync(join(outDir, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.os, ['darwin']);

  const backend = readFileSync(join(outDir, 'src/backend.js'), 'utf8');
  assert.doesNotMatch(backend, /as windows from/);
  assert.doesNotMatch(backend, /if \(platform === 'win32'\)/);
  assert.match(backend, /darwinBackend/);
  // NOTE: this snapshot cannot be imported on Windows — its module-level
  // `selectBackend()` correctly rejects the host platform. The branch-removal
  // logic itself is covered by the stripPlatformBranch tests above; the win32
  // snapshot is imported for real because it runs on this host.
  assert.match(backend, /仅支持 Windows 与 macOS/);
});

test('snapshots carry a README banner naming the source commit', () => {
  const outDir = join(WORK, 'banner');
  const result = applyCrop({ root: ROOT, outDir, platform: 'win32' });
  const readme = readFileSync(join(outDir, 'README.md'), 'utf8');
  assert.match(readme, /Windows 专用构建/);
  assert.ok(readme.includes(result.commit.slice(0, 8)) || result.commit === 'unknown');
});

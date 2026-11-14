#!/usr/bin/env node
/**
 * Build a single-platform snapshot of this repository.
 *
 * main is the dual-platform line. The windows-only and mac-only branches are
 * derived from it by this script, so they can be regenerated after every
 * release instead of drifting through cherry-picks:
 *
 *     node scripts/crop-platform.mjs --platform=win32  --out .crop/win32
 *     node scripts/crop-platform.mjs --platform=darwin --out .crop/darwin
 *
 * It never touches the source tree: it reads the repo, writes a pruned copy to
 * --out, and prints the git commands that turn that copy into a branch.
 *
 * @module scripts/crop-platform
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Never copied into a snapshot. */
const ALWAYS_IGNORED = new Set(['.git', 'node_modules', '.crop', '.DS_Store']);

/** What each single-platform build keeps and drops. */
export const PLATFORM_SPEC = {
  win32: {
    os: ['win32'],
    label: 'Windows 专用构建 / Windows-only build',
    branch: 'windows-only',
    dropPaths: [
      'src/platform/darwin',
      'tests/darwin',
      // These exercise BOTH backends, so they only make sense on main.
      'tests/platform',
      'tests/shared/backend-select.test.js',
      'tests/shared/contract.test.js',
    ],
    stripBackend: 'darwin',
    tools: 'PowerShell + UIA',
  },
  darwin: {
    os: ['darwin'],
    label: 'macOS 专用构建 / macOS-only build',
    branch: 'mac-only',
    dropPaths: [
      'src/capture.ps1',
      'src/input.ps1',
      'src/observe.ps1',
      'src/guard.ps1',
      'src/ps.js',
      'tests/windows',
      // Both-backend tests stay on main only.
      'tests/platform',
      'tests/shared/backend-select.test.js',
      'tests/shared/contract.test.js',
      'scripts/smoke-cmd-wheel.ps1',
      'scripts/smoke-cmd.ps1',
      'scripts/smoke-exec.ps1',
      'scripts/smoke-exec2.ps1',
      'scripts/smoke-keypress.ps1',
      'scripts/smoke-pointer.ps1',
      'scripts/smoke-winforms.ps1',
    ],
    stripBackend: 'win32',
    tools: 'screencapture + osascript',
  },
};

/**
 * Remove one `if (platform === '…') { … }` branch (single-line or braced) from
 * the backend selector.
 *
 * @param {string} source
 * @param {string} platform
 * @returns {string}
 */
export function stripPlatformBranch(source, platform) {
  const marker = "if (platform === '" + platform + "')";
  const lines = source.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].includes(marker)) {
      out.push(lines[i]);
      continue;
    }
    if (lines[i].trimEnd().endsWith(';')) continue;
    let depth = 0;
    let sawBrace = false;
    let j = i;
    for (; j < lines.length; j += 1) {
      for (const ch of lines[j]) {
        if (ch === '{') { depth += 1; sawBrace = true; }
        else if (ch === '}') depth -= 1;
      }
      if (sawBrace && depth === 0) break;
    }
    i = j;
  }
  return out.join('\n');
}

/**
 * Drop the import that only the removed platform needs.
 *
 * @param {string} source
 * @param {string} platform
 */
export function stripPlatformImport(source, platform) {
  if (platform === 'darwin') {
    return source.replace(/^import \{ darwinBackend \} from '\.\/platform\/darwin\/index\.js';$/m, '');
  }
  return source.replace(/^import \* as windows from '\.\/ps\.js';$/m, '');
}

/**
 * Compute what a snapshot would contain, without writing anything.
 *
 * @param {{root: string, platform: 'win32'|'darwin'}} opts
 */
export function planCrop({ root, platform }) {
  const spec = PLATFORM_SPEC[platform];
  if (!spec) throw new Error('unknown platform: ' + platform);
  return {
    platform,
    spec,
    root,
    files: listFiles(root),
    dropPaths: spec.dropPaths,
    commit: gitCommit(root),
  };
}

/**
 * Write a pruned copy of the repository into `outDir`.
 *
 * @param {{root: string, outDir: string, platform: 'win32'|'darwin'}} opts
 * @returns {{outDir: string, removed: string[], packageJson: object, commit: string}}
 */
export function applyCrop({ root, outDir, platform }) {
  const plan = planCrop({ root, platform });
  const spec = plan.spec;
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const removed = [];
  for (const file of plan.files) {
    const top = file.split('/')[0];
    if (ALWAYS_IGNORED.has(top)) continue;
    if (spec.dropPaths.some((p) => file === p || file.startsWith(p + '/'))) {
      removed.push(file);
      continue;
    }
    const dst = join(outDir, file);
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(join(root, file), dst);
  }

  const backendPath = join(outDir, 'src/backend.js');
  if (existsSync(backendPath)) {
    let source = readFileSync(backendPath, 'utf8');
    source = stripPlatformBranch(source, spec.stripBackend);
    source = stripPlatformImport(source, spec.stripBackend);
    writeFileSync(backendPath, source, 'utf8');
  }

  const pkgPath = join(outDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.os = spec.os.slice();
  pkg.description = pkg.description + ' — ' + spec.label;
  pkg.platformBuild = { platform, generatedFrom: plan.commit, generatedAt: new Date().toISOString() };
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + String.fromCharCode(10), 'utf8');

  const banner = '> **' + spec.label + '** — 这个分支由 scripts/crop-platform.mjs 从 main 生成，' +
    '只包含一个平台的后端；主开发线 main 是双平台。' +
    String.fromCharCode(10) + '> Source commit: ' + plan.commit + String.fromCharCode(10) +
    String.fromCharCode(10);
  for (const readme of ['README.md', 'README.zh.md']) {
    const target = join(outDir, readme);
    if (!existsSync(target)) continue;
    writeFileSync(target, banner + readFileSync(target, 'utf8'), 'utf8');
  }

  writeFileSync(join(outDir, '.platform-crop.json'), JSON.stringify({
    platform,
    sourceCommit: plan.commit,
    createdAt: new Date().toISOString(),
    removed,
    packageOs: spec.os,
  }, null, 2) + String.fromCharCode(10), 'utf8');

  return { outDir, removed, packageJson: pkg, commit: plan.commit };
}

/** Files a snapshot would copy: git-tracked + untracked (never ignored ones). */
function listFiles(root) {
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files', '-co', '--exclude-standard'], { encoding: 'utf8' });
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    const files = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir)) {
        if (ALWAYS_IGNORED.has(entry)) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else files.push(relative(root, full).split('\\').join('/'));
      }
    };
    walk(root);
    return files;
  }
}

function gitCommit(root) {
  try {
    return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

/** CLI entry point. */
function main(argv) {
  const args = new Map();
  for (const raw of argv) {
    const matched = /^--([^=]+)=(.*)$/.exec(raw);
    if (matched) args.set(matched[1], matched[2]);
  }
  const platform = args.get('platform');
  const out = args.get('out');
  const root = resolve(args.get('root') || process.cwd());
  if (!platform || !PLATFORM_SPEC[platform]) {
    console.error('usage: node scripts/crop-platform.mjs --platform=win32|darwin --out <dir> [--root <repo>]');
    process.exit(2);
  }
  if (!out) {
    console.error('missing --out <dir>');
    process.exit(2);
  }
  const result = applyCrop({ root, outDir: resolve(out), platform });
  const spec = PLATFORM_SPEC[platform];
  const log = [
    'platform : ' + platform,
    'root     : ' + root,
    'out      : ' + result.outDir,
    'commit   : ' + result.commit,
    'removed  : ' + result.removed.length + ' path(s)',
    ...result.removed.map((p) => '  - ' + p),
    'package  : os=' + JSON.stringify(result.packageJson.os),
    '',
    'next steps (on the branch you want to overwrite):',
    '  git checkout -B ' + spec.branch + ' main',
    '  git rm -r --cached . >/dev/null',
    '  git clean -fdx -e node_modules >/dev/null',
    '  cp -R "' + result.outDir + '/." .',
    '  git add -A && git commit -m "chore(platform): ' + platform + ' snapshot from ' + result.commit.slice(0, 8) + '"',
    '  git push -u origin ' + spec.branch,
  ];
  console.log(log.join(String.fromCharCode(10)));
}

const invokedDirectly = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(String(error && error.message ? error.message : error));
    process.exit(1);
  }
}

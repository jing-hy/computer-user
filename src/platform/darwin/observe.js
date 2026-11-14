/**
 * Desktop observation for the macOS backend.
 *
 * Windows uses UIA (a rich control tree). macOS equivalent is the Accessibility
 * API, which needs real hardware + TCC authorisation to calibrate — so this v1
 * keeps to the parts that Quartz already exposes: the on-screen window list, the
 * frontmost app, and waiting for a window to appear.
 *
 * Every control-tree capability (`snapshot`, `act`, window move/close) rejects
 * with an explicit `unsupported()` error naming the gap.
 *
 * @module platform/darwin/observe
 */

import { spawnExec } from './exec.js';
import { unsupported } from './unsupported.js';

const CG_LIST_FLAGS = '$.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements';

/** JXA source returning the on-screen window list as JSON. */
export const WINDOWS_JXA = [
  "ObjC.import('CoreGraphics');",
  'const list = ObjC.deepUnwrap($.CGWindowListCopyWindowInfo(' + CG_LIST_FLAGS + ', $.kCGNullWindowID)) || [];',
  'const out = list.map(function (w) {',
  "  const b = w.kCGWindowBounds || {};",
  '  return { handle: Number(w.kCGWindowNumber), pid: Number(w.kCGWindowOwnerPID),',
  "    process: String(w.kCGWindowOwnerName || ''), title: String(w.kCGWindowName || ''),",
  '    x: Number(b.X || 0), y: Number(b.Y || 0), w: Number(b.Width || 0), h: Number(b.Height || 0),',
  '    layer: Number(w.kCGWindowLayer || 0) };',
  '});',
  'console.log(JSON.stringify(out));',
].join(' ');

/** JXA source returning the frontmost application plus its front window. */
export const FOREGROUND_JXA = [
  "ObjC.import('AppKit'); ObjC.import('CoreGraphics');",
  'const front = $.NSWorkspace.sharedWorkspace.frontmostApplication;',
  'const pid = Number(front.processIdentifier);',
  "const name = String(ObjC.unwrap(front.localizedName) || '');",
  'const list = ObjC.deepUnwrap($.CGWindowListCopyWindowInfo(' + CG_LIST_FLAGS + ', $.kCGNullWindowID)) || [];',
  'let best = null;',
  'for (const w of list) {',
  '  if (Number(w.kCGWindowOwnerPID) !== pid) continue;',
  '  const b = w.kCGWindowBounds || {};',
  '  if (Number(w.kCGWindowLayer) === 0 && Number(b.Width || 0) > 0) { best = w; break; }',
  '}',
  'const b = best ? (best.kCGWindowBounds || {}) : {};',
  'console.log(JSON.stringify({ handle: best ? Number(best.kCGWindowNumber) : 0, pid: pid,',
  "  title: best ? String(best.kCGWindowName || '') : '', process: name,",
  '  rect: { x: Number(b.X || 0), y: Number(b.Y || 0), w: Number(b.Width || 0), h: Number(b.Height || 0) } }));',
].join(' ');

/** JXA source that brings one process to the front. */
export function activateJXA(pid) {
  return [
    "ObjC.import('AppKit');",
    'const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(' + Math.trunc(pid) + ');',
    'const ok = app ? app.activateWithOptions(1) : false;',
    'console.log(JSON.stringify({ ok: !!ok }));',
  ].join(' ');
}

/** JXA source returning the main screen backing scale factor. */
export const DPR_JXA = "ObjC.import('AppKit'); console.log(String($.NSScreen.mainScreen.backingScaleFactor));";

/**
 * @param {{
 *   exec?: import('./exec.js').Exec,
 *   probe?: { has:(n:string)=>Promise<boolean>, snapshot: () => Promise<Record<string, string|null>> },
 *   now?: () => number,
 *   sleep?: (ms: number) => Promise<void>,
 * }} [deps]
 */
export function createObserve({ exec = spawnExec, probe, now = Date.now, sleep } = {}) {
  const pause = sleep ?? ((ms) => new Promise((resolve) => { const t = setTimeout(resolve, ms); if (t.unref) t.unref(); }));

  const runJXA = async (source, { timeoutMs = 20000, signal } = {}) => {
    const res = await exec('osascript', ['-l', 'JavaScript', '-e', source], { timeoutMs, signal });
    if (res.code !== 0) {
      throw new Error('computer-use(mac): JXA 失败（exit ' + res.code + '）：' + String(res.stderr || '').slice(0, 300));
    }
    return String(res.stdout || '').trim();
  };

  const listWindows = async ({ signal } = {}) => {
    const raw = await runJXA(WINDOWS_JXA, { signal });
    let parsed;
    try { parsed = JSON.parse(raw || '[]'); } catch {
      throw new Error('computer-use(mac): 窗口列表输出无法解析：' + raw.slice(0, 200));
    }
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((w) => w && w.layer === 0 && Number(w.w) > 0)
      .map((w) => ({
        handle: Number(w.handle),
        title: String(w.title || ''),
        pid: Number(w.pid),
        process: String(w.process || ''),
        rect: { x: Number(w.x), y: Number(w.y), w: Number(w.w), h: Number(w.h) },
        focused: false,
      }));
  };

  const foreground = async ({ signal } = {}) => {
    const raw = await runJXA(FOREGROUND_JXA, { signal });
    let parsed;
    try { parsed = JSON.parse(raw || '{}'); } catch {
      throw new Error('computer-use(mac): 前台窗口输出无法解析：' + raw.slice(0, 200));
    }
    return {
      handle: Number(parsed.handle || 0),
      title: String(parsed.title || ''),
      pid: Number(parsed.pid || 0),
      process: String(parsed.process || ''),
      rect: parsed.rect || { x: 0, y: 0, w: 0, h: 0 },
    };
  };

  const probeSelf = async ({ signal } = {}) => {
    const tools = probe ? await probe.snapshot() : {};
    let macos = '';
    try {
      const res = await exec('sw_vers', ['-productVersion'], { timeoutMs: 8000, signal });
      macos = String(res.stdout || '').trim();
    } catch { /* keep it empty */ }
    let tempWritable = false;
    const tempDir = process.env.TMPDIR || '/tmp';
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const f = path.join(tempDir, 'computer-user-probe.tmp');
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(f, 'ok', 'utf8');
      tempWritable = fs.existsSync(f);
      fs.rmSync(f, { force: true });
    } catch { /* stays false */ }
    let dprUnverified = true;
    try {
      const raw = await runJXA(DPR_JXA, { timeoutMs: 8000, signal });
      dprUnverified = !Number.isFinite(Number(raw));
    } catch { dprUnverified = true; }
    return {
      ok: true,
      backend: 'darwin',
      platform: 'darwin',
      powershell: 'n/a（macOS 无 PowerShell 后端）',
      edition: 'macOS ' + (macos || '?') + '（darwin backend）',
      uia: false,
      uiaError: 'macOS 没有 UI Automation；控件树需要 AX API（本版未实现）',
      macos,
      tempDir,
      tempWritable,
      dpr_unverified: dprUnverified,
      // No CGEventTap in this backend yet — the doctor surfaces this so a user
      // who presses the stop hotkey knows why nothing happens.
      global_hotkey: false,
      tools,
    };
  };

  const waitFor = async (payload, { signal } = {}) => {
    const timeoutMs = Math.min(60000, Math.max(500, Number(payload.timeoutMs ?? 15000)));
    const handle = payload.handle == null ? null : Number(payload.handle);
    const titleContains = payload.titleContains == null ? null : String(payload.titleContains);
    if (payload.locator) {
      throw unsupported('computer_wait(target=控件 id)', '控件树在 macOS 上未实现，无法按元素等待。');
    }
    const deadline = now() + timeoutMs;
    while (now() < deadline) {
      if (signal?.aborted) throw new Error('computer-use: 已取消');
      const windows = await listWindows({ signal });
      if (handle !== null && windows.some((w) => w.handle === handle)) {
        return { ok: true, found: true, waited_ms: timeoutMs - Math.max(0, deadline - now()) };
      }
      if (titleContains && windows.some((w) => String(w.title || '').includes(titleContains))) {
        return { ok: true, found: true, waited_ms: timeoutMs - Math.max(0, deadline - now()) };
      }
      await pause(250);
    }
    return { ok: true, found: false, waited_ms: timeoutMs };
  };

  /**
   * @param {Record<string, any>} payload
   * @param {{signal?: AbortSignal}} [opts]
   */
  return async function handleObserve(payload = {}, { signal } = {}) {
    const action = String(payload.action || '');
    switch (action) {
      case 'probe':
        return probeSelf({ signal });
      case 'windows':
        return { ok: true, windows: await listWindows({ signal }) };
      case 'foreground':
        return { ok: true, foreground: await foreground({ signal }) };
      case 'wait':
        return waitFor(payload, { signal });
      case 'snapshot':
        throw unsupported('computer_snapshot（UIA/AX 控件树）', 'AX API 需要真机与辅助功能授权，本版未实现。');
      case 'act':
        throw unsupported('computer_invoke / focus / set_value / select（控件级操作）', '同上：控件树未实现，请改用截图 + 坐标点击。');
      case 'window': {
        const kind = String(payload.kind || '');
        if (kind === 'activate') {
          const handle = Number(payload.handle);
          if (!Number.isFinite(handle)) throw new Error('computer-use(mac): window 需要 handle');
          const windows = await listWindows({ signal });
          const target = windows.find((w) => w.handle === handle);
          if (!target) throw new Error('computer-use(mac): window not found: id=' + handle);
          const raw = await runJXA(activateJXA(target.pid), { signal });
          let parsed = {};
          try { parsed = JSON.parse(raw || '{}'); } catch { parsed = {}; }
          if (!parsed.ok) throw new Error('computer-use(mac): 激活窗口失败（pid=' + target.pid + '）');
          return { ok: true, action: 'activate', handle };
        }
        if (kind === 'move' || kind === 'close') {
          throw unsupported('computer_' + kind + '_window', '窗口移动/关闭需要 AX API，本版未实现。');
        }
        throw new Error('computer-use(mac): 未知 window kind: ' + kind);
      }
      default:
        throw unsupported('observe action "' + action + '"');
    }
  };
}

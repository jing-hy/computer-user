/**
 * Mouse / keyboard input for the macOS backend.
 *
 * Transport split (deliberate):
 *  - pointer: `cliclick` (brew). There is no zero-dependency way to generate
 *    Quartz mouse events from a script — CGEventCreateMouseEvent needs a CGPoint
 *    struct the ObjC bridge cannot express. Missing cliclick → clear error.
 *  - text / key chords: AppleScript `keystroke` + `key code` (System Events).
 *    Unicode (Chinese) works here, which cliclick's `t:` does not.
 *  - scroll wheel: JXA + CGEventCreateScrollWheelEvent (integer args only, so the
 *    bridge copes) — works without cliclick.
 *
 * @module platform/darwin/input
 */

import { spawnExec } from './exec.js';
import { appleScriptString, resolveKey, usingClause } from './keys.js';
import { CLICLICK_HINT } from './paths.js';
import { unsupported } from './unsupported.js';

/**
 * JXA source that posts a scroll-wheel event.
 * @param {number} vertical
 * @param {number} horizontal
 */
export function scrollJXA(vertical, horizontal) {
  return [
    "ObjC.import('CoreGraphics');",
    'const ev = $.CGEventCreateScrollWheelEvent(null, 1, 2, ' + Math.trunc(vertical) + ', ' + Math.trunc(horizontal) + ');',
    '$.CGEventPost($.kCGHIDEventTap, ev);',
    "console.log('ok');",
  ].join(' ');
}

/**
 * @param {{exec?: import('./exec.js').Exec, probe?: {path:(n:string)=>Promise<string|null>}}} [deps]
 */
export function createInput({ exec = spawnExec, probe } = {}) {
  const need = async (name, hint) => {
    if (!probe) return name;
    const found = await probe.path(name);
    if (!found) throw new Error('computer-use(mac): 找不到 ' + name + '。' + (hint || ''));
    return found;
  };

  const runCliclick = async (bin, argv, { timeoutMs = 15000, signal } = {}) => {
    const res = await exec(bin, argv, { timeoutMs, signal });
    if (res.code !== 0) {
      throw new Error('computer-use(mac): cliclick 失败（' + argv.join(' ') + '）：' + String(res.stderr || '').slice(0, 200));
    }
    return String(res.stdout || '').trim();
  };

  const runAppleScript = async (source, { timeoutMs = 15000, signal } = {}) => {
    const res = await exec('osascript', ['-e', source], { timeoutMs, signal });
    if (res.code !== 0) {
      const detail = String(res.stderr || '').trim();
      throw new Error(
        'computer-use(mac): AppleScript 失败（System Events）' +
          (detail ? '：' + detail.slice(0, 300) : '') +
          '。请在「系统设置 → 隐私与安全性 → 辅助功能」里勾选宿主应用（DSH）。'
      );
    }
    return String(res.stdout || '').trim();
  };

  const runJXA = async (source, { timeoutMs = 15000, signal } = {}) => {
    const res = await exec('osascript', ['-l', 'JavaScript', '-e', source], { timeoutMs, signal });
    if (res.code !== 0) {
      const detail = String(res.stderr || '').trim();
      throw new Error(
        'computer-use(mac): JXA 失败' + (detail ? '：' + detail.slice(0, 300) : '') +
          '。请在「系统设置 → 隐私与安全性 → 辅助功能」里勾选宿主应用（DSH）。'
      );
    }
    return String(res.stdout || '').trim();
  };

  const cursorPos = async ({ signal } = {}) => {
    try {
      const bin = await need('cliclick');
      const out = await runCliclick(bin, ['p:.'], { signal });
      const m = /(-?\d+)\s*,\s*(-?\d+)/.exec(out);
      return m ? [Number(m[1]), Number(m[2])] : null;
    } catch {
      return null;
    }
  };

  const coord = (value, label) => {
    if (!Array.isArray(value) || value.length < 2) {
      throw new Error('computer-use(mac): ' + label + ' 需要 [x, y]');
    }
    const x = Math.round(Number(value[0]));
    const y = Math.round(Number(value[1]));
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error('computer-use(mac): ' + label + ' 不是有效坐标 ' + JSON.stringify(value));
    }
    return [x, y];
  };

  /**
   * @param {Record<string, any>} payload  same shape as input.ps1 expects
   * @param {{signal?: AbortSignal}} [opts]
   */
  return async function handleInput(payload = {}, { signal } = {}) {
    const action = String(payload.action || '');
    if (!action) throw new Error('computer-use(mac): input 需要 action');

    switch (action) {
      case 'getpos': {
        const pos = await cursorPos({ signal });
        if (!pos) throw new Error('computer-use(mac): 读不到光标位置（需要 cliclick）。' + CLICLICK_HINT);
        return { ok: true, cursor: pos };
      }
      case 'move': {
        const [x, y] = coord(payload.coordinate, 'coordinate');
        const bin = await need('cliclick', CLICLICK_HINT);
        await runCliclick(bin, ['m:' + x + ',' + y], { signal });
        return { ok: true, cursor: [x, y] };
      }
      case 'click': {
        const [x, y] = coord(payload.coordinate, 'coordinate');
        const kind = String(payload.action2 || 'click');
        const verb = kind === 'right_click' ? 'rc' : kind === 'double_click' ? 'dc' : 'c';
        const bin = await need('cliclick', CLICLICK_HINT);
        await runCliclick(bin, [verb + ':' + x + ',' + y], { signal });
        return { ok: true, cursor: [x, y], action: kind };
      }
      case 'drag': {
        const [sx, sy] = coord(payload.from, 'from');
        const [tx, ty] = coord(payload.to, 'to');
        const bin = await need('cliclick', CLICLICK_HINT);
        const argv = [];
        const holds = Array.isArray(payload.holdKeys) ? payload.holdKeys : [];
        for (const key of holds) {
          const resolved = resolveKey(key);
          if (resolved.kind !== 'modifier' || !resolved.cliclick) {
            throw new Error('computer-use(mac): drag 的 hold_keys 只接受修饰键，收到 ' + JSON.stringify(key));
          }
          argv.push('kd:' + resolved.cliclick);
        }
        argv.push('dd:' + sx + ',' + sy, 'dm:' + tx + ',' + ty, 'du:' + tx + ',' + ty);
        for (const key of [...holds].reverse()) {
          const resolved = resolveKey(key);
          if (resolved.kind === 'modifier' && resolved.cliclick) argv.push('ku:' + resolved.cliclick);
        }
        await runCliclick(bin, argv, { signal, timeoutMs: 30000 });
        return { ok: true, from: [sx, sy], to: [tx, ty], cursor: [tx, ty] };
      }
      case 'scroll': {
        const [x, y] = coord(payload.coordinate, 'coordinate');
        const direction = String(payload.direction || 'down');
        const clicks = Math.max(1, Math.trunc(Number(payload.clicks) || 1));
        const lines = 3 * clicks;
        const vertical = direction === 'up' ? lines : direction === 'down' ? -lines : 0;
        const horizontal = direction === 'right' ? lines : direction === 'left' ? -lines : 0;
        if (vertical === 0 && horizontal === 0) {
          throw new Error('computer-use(mac): direction 必须是 up/down/left/right，收到 ' + JSON.stringify(direction));
        }
        // The wheel follows the pointer, so park it first when cliclick exists.
        try {
          const bin = await need('cliclick');
          await runCliclick(bin, ['m:' + x + ',' + y], { signal });
        } catch { /* scrolling still works at the current pointer position */ }
        await runJXA(scrollJXA(vertical, horizontal), { signal });
        return { ok: true, cursor: [x, y], direction, clicks };
      }
      case 'type': {
        const text = String(payload.text ?? '');
        const interval = Math.max(0, Number(payload.typingIntervalMs) || 0);
        if (interval > 0) {
          for (const ch of text) {
            await runAppleScript('tell application "System Events" to keystroke ' + appleScriptString(ch), { signal, timeoutMs: 20000 });
            await new Promise((resolve) => setTimeout(resolve, interval));
          }
        } else {
          await runAppleScript('tell application "System Events" to keystroke ' + appleScriptString(text), { signal, timeoutMs: 20000 });
        }
        if (payload.sendEnter) {
          await runAppleScript('tell application "System Events" to key code 36', { signal });
        }
        const result = { ok: true, chars: text.length, sendEnter: !!payload.sendEnter };
        const pos = await cursorPos({ signal });
        if (pos) result.cursor = pos;
        return result;
      }
      case 'keypress': {
        const raw = Array.isArray(payload.keys) ? payload.keys : [];
        if (raw.length === 0) throw new Error('computer-use(mac): keys 不能为空');
        const parts = raw.map((k) => resolveKey(k));
        const modifiers = [];
        const mains = [];
        for (const part of parts) {
          if (part.kind === 'modifier') modifiers.push(part.osascript.replace(/ down$/, ''));
          else mains.push(part);
        }
        if (mains.length !== 1) {
          throw new Error('computer-use(mac): keys 需要恰好一个非修饰键（收到 ' + raw.length + ' 个键名）');
        }
        const main = mains[0];
        const clause = usingClause(modifiers);
        const source = main.kind === 'char'
          ? 'tell application "System Events" to keystroke ' + appleScriptString(main.value) + clause
          : 'tell application "System Events" to key code ' + main.code + clause;
        await runAppleScript(source, { signal });
        return { ok: true, keys: raw };
      }
      default:
        throw unsupported('input action "' + action + '"');
    }
  };
}

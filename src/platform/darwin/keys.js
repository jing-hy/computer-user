/**
 * Key name resolution for the macOS backend.
 *
 * Mirrors the coverage of `input.ps1`'s `Resolve-Key` so a model that learned
 * the Windows key names can reuse them verbatim on macOS:
 *
 *  - modifiers:  ctrl / control / shift / alt / option / super / win / cmd / command / meta
 *  - navigation: enter / return / tab / esc / escape / space / backspace / delete / home /
 *                end / pageup / pagedown / up / down / left / right
 *  - function:   f1..f20
 *  - characters: a-z, 0-9, any single punctuation character
 *
 * Keys that physically do not exist on Apple keyboards (insert / prtsc / pause /
 * scrolllock / numlock) are rejected with an explicit error instead of silently
 * doing something else.
 *
 * @module platform/darwin/keys
 */

/** Modifier aliases → the name AppleScript/cliclick use. */
export const MODIFIER_ALIASES = {
  ctrl: 'control',
  control: 'control',
  shift: 'shift',
  alt: 'option',
  option: 'option',
  opt: 'option',
  super: 'command',
  win: 'command',
  windows: 'command',
  cmd: 'command',
  command: 'command',
  meta: 'command',
};

/** How a resolved modifier is spelled for each transport. */
const MODIFIER_NAMES = {
  control: { osascript: 'control down', cliclick: 'ctrl' },
  shift: { osascript: 'shift down', cliclick: 'shift' },
  option: { osascript: 'option down', cliclick: 'alt' },
  command: { osascript: 'command down', cliclick: 'cmd' },
};

/** Special (non-character) keys: AppleScript key code + cliclick `kp:` name. */
export const SPECIAL_KEYS = {
  return: { code: 36, cliclick: 'enter' },
  enter: { code: 36, cliclick: 'enter' },
  tab: { code: 48, cliclick: 'tab' },
  space: { code: 49, cliclick: 'space' },
  backspace: { code: 51, cliclick: 'delete' },
  delete: { code: 51, cliclick: 'delete' },
  del: { code: 51, cliclick: 'delete' },
  forwarddelete: { code: 117, cliclick: 'forward-delete' },
  escape: { code: 53, cliclick: 'esc' },
  esc: { code: 53, cliclick: 'esc' },
  capslock: { code: 57, cliclick: null },
  home: { code: 115, cliclick: 'home' },
  end: { code: 119, cliclick: 'end' },
  pageup: { code: 116, cliclick: 'page-up' },
  pagedown: { code: 121, cliclick: 'page-down' },
  up: { code: 126, cliclick: 'arrow-up' },
  down: { code: 125, cliclick: 'arrow-down' },
  left: { code: 123, cliclick: 'arrow-left' },
  right: { code: 124, cliclick: 'arrow-right' },
  f1: { code: 122, cliclick: 'f1' },
  f2: { code: 120, cliclick: 'f2' },
  f3: { code: 99, cliclick: 'f3' },
  f4: { code: 118, cliclick: 'f4' },
  f5: { code: 96, cliclick: 'f5' },
  f6: { code: 97, cliclick: 'f6' },
  f7: { code: 98, cliclick: 'f7' },
  f8: { code: 100, cliclick: 'f8' },
  f9: { code: 101, cliclick: 'f9' },
  f10: { code: 109, cliclick: 'f10' },
  f11: { code: 103, cliclick: 'f11' },
  f12: { code: 111, cliclick: 'f12' },
  f13: { code: 105, cliclick: 'f13' },
  f14: { code: 107, cliclick: 'f14' },
  f15: { code: 113, cliclick: 'f15' },
  f16: { code: 106, cliclick: 'f16' },
  f17: { code: 64, cliclick: null },
  f18: { code: 79, cliclick: null },
  f19: { code: 80, cliclick: null },
  f20: { code: 90, cliclick: null },
};

/** Keys a Windows keyboard has and an Apple keyboard does not. */
export const UNSUPPORTED_KEYS = new Set([
  'insert',
  'prtsc',
  'printscreen',
  'pause',
  'scrolllock',
  'numlock',
  'clear',
]);

/**
 * Resolve one key name.
 *
 * @param {string} name
 * @returns {{kind:'modifier', osascript:string, cliclick:string}
 *          | {kind:'code', code:number, cliclick:string|null}
 *          | {kind:'char', value:string}}
 * @throws {Error} for keys macOS cannot synthesize
 */
export function resolveKey(name) {
  const key = String(name ?? '').trim().toLowerCase();
  if (!key) throw new Error('computer-use(mac): 键名为空');
  if (MODIFIER_ALIASES[key]) {
    const canonical = MODIFIER_ALIASES[key];
    return { kind: 'modifier', osascript: MODIFIER_NAMES[canonical].osascript, cliclick: MODIFIER_NAMES[canonical].cliclick };
  }
  if (SPECIAL_KEYS[key]) {
    const special = SPECIAL_KEYS[key];
    return { kind: 'code', code: special.code, cliclick: special.cliclick };
  }
  if (UNSUPPORTED_KEYS.has(key)) {
    throw new Error('computer-use(mac): macOS 键盘没有 ' + name + ' 键（Windows 专属键），请改用其它键');
  }
  if (key.length === 1) {
    return { kind: 'char', value: key };
  }
  throw new Error('computer-use(mac): 未知键名 ' + JSON.stringify(name) + '（支持 ctrl/shift/alt/cmd、enter/tab/esc/space/backspace/delete/home/end/pageup/pagedown/up/down/left/right、f1..f20、单个字符）');
}

/**
 * AppleScript string literal for a text value (keystroke payload).
 * @param {string} text
 */
export function appleScriptString(text) {
  const escaped = String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
  return '"' + escaped + '"';
}

/**
 * Build the `using {…}` clause for AppleScript, or an empty string.
 * @param {string[]} modifiers  canonical names: control | shift | option | command
 */
export function usingClause(modifiers) {
  if (!modifiers || modifiers.length === 0) return '';
  const names = modifiers.map((m) => (MODIFIER_NAMES[m] ? MODIFIER_NAMES[m].osascript : m + ' down'));
  return ' using {' + names.join(', ') + '}';
}

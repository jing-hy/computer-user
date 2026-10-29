import { join, resolve as pathResolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

/**
 * Build the computer_* tools. Coordinate system: pixels relative to the
 * multi-monitor VIRTUAL SCREEN ORIGIN (returned by computer_screenshot as
 * `virtual_offset`). All screen-reading/automation is delegated to bundled
 * PowerShell scripts (capture.ps1 / input.ps1) with zero native dependencies.
 *
 * @param {{runPs:(script:string,payload:object,opts?:object)=>Promise<object>, getConfig:()=>object, approvedSessions?:Set<string>, sessionId?:string, sessionIds?:string[], setMode?:(mode:string)=>Promise<void>}} deps
 * @returns {Array<object>} tool definitions ready for ctx.tools.register
 */

const COORD = {
  type: 'array',
  minItems: 2,
  maxItems: 2,
  items: { type: 'number' },
  description: '相对多屏虚拟屏原点的像素坐标 [x, y]（原点是 computer_screenshot 返回的 virtual_offset）',
};

const HEAD =
  '先看屏幕：computer_screenshot 返回 PNG 路径，有视觉的模型直接 read_image(path) 看图（不依赖任何插件）；需要精确文字时再交给 picturereader 的 image_scan / image_ocr（可选，不装也能用）。要稳定的控件级操作，先 computer_snapshot 读 UIA 控件树，再用 computer_invoke / computer_set_value / computer_focus 按元素 id 操作（不移动鼠标、不抢前台）。';

/** Tools that are always safe (no side effects on the user's desktop). */
const READONLY_TOOLS = new Set([
  'computer_screenshot',
  'computer_get_cursor_position',
  'computer_wait',
  'computer_snapshot',
  'computer_list_windows',
  'computer_doctor',
  'computer_browser',
]);

/** Tools kept when tool_mode=lite (the ones a normal task needs). */
const LITE_TOOLS = new Set([
  'computer_screenshot',
  'computer_snapshot',
  'computer_click',
  'computer_type',
  'computer_keypress',
  'computer_scroll',
  'computer_wait',
  'computer_get_cursor_position',
  'computer_set_mode',
]);

const MODES = ['disabled', 'readonly', 'manual', 'auto'];

/**
 * Mode gate: decide whether a tool call is allowed based on the current mode
 * and the session's approval state.
 *
 * Returns void if allowed, or throws with `awaitingApproval=true` if
 * the user needs to approve via /computer first.
 */
function modeGate(cfg, toolName, approvedSessions, sessionIds) {
  const mode = cfg.mode ?? 'manual';
  if (mode === 'disabled') {
    throw new Error('computer-user 已禁用：请在「设置 → 电脑操作」切换模式后再使用');
  }
  if (mode === 'readonly' && !READONLY_TOOLS.has(toolName)) {
    throw new Error(`computer-user 只读模式：${toolName} 不允许执行，仅截图/读光标/等待可用`);
  }
  if (mode === 'manual' && !READONLY_TOOLS.has(toolName)) {
    const ids = Array.isArray(sessionIds) ? sessionIds : sessionIds ? [sessionIds] : [];
    const approved = approvedSessions && ids.some((id) => id && approvedSessions.has(id));
    if (!approved) {
      const e = new Error(
        '需要批准：当前为手动批准模式。请在对话框输入 /computer 批准后重试（批准后本轮及后续轮次均可使用）。'
      );
      e.awaitingApproval = true;
      throw e;
    }
  }
  // mode === 'auto' or readonly tool or approved manual → allow
}

/**
 * Validate a mode value against the allowed enum.
 * @returns the validated mode string.
 */
function validateMode(value) {
  if (typeof value !== 'string' || !MODES.includes(value)) {
    throw new Error(`computer_set_mode: mode 必须是 ${MODES.join('/')} 之一`);
  }
  return value;
}

function textOut(schema, prefixLines) {
  const props = schema.properties ?? {};
  const required = (schema.required ?? []).filter((k) => k in props);
  return {
    schema: { type: 'object', additionalProperties: true, properties: props, required },
    render: (_args, value) => {
      const head = prefixLines === undefined ? [] : (typeof prefixLines === 'function' ? prefixLines(value) : prefixLines);
      const lines = [...head];
      if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
          if (k === 'ok') continue;
          if (v === undefined || v === null) continue;
          lines.push(`${k}: ${JSON.stringify(v)}`);
        }
      }
      return [{ type: 'text', text: lines.join('\n') }];
    },
  };
}

export function createComputerTools({ runPs, getConfig, approvedSessions, sessionId, sessionIds, setMode, isStopped, ensureGuard, requestStop, fetchJson }) {
  if (typeof runPs !== 'function') throw new Error('computer-user: runPs is required');
  if (typeof getConfig !== 'function') throw new Error('computer-user: getConfig is required');

  const approvalIds = Array.isArray(sessionIds)
    ? sessionIds
    : sessionId
      ? [sessionId]
      : [];
  const stoppedError = () => {
    const e = new Error('computer-user 已急停：用户按下了停止热键（或点了停止按钮）。请让用户确认后重新 /computer 批准，或重启会话。');
    e.stopped = true;
    return e;
  };
  // Every tool call passes this gate: mode → stop flag → takeover pill.
  const gate = (toolName) => {
    modeGate(getConfig(), toolName, approvedSessions, approvalIds);
    if (typeof isStopped === 'function' && isStopped()) throw stoppedError();
    if (!READONLY_TOOLS.has(toolName) && typeof ensureGuard === 'function') {
      const cfg = getConfig();
      try {
        ensureGuard({
          hotkey: cfg.stop_hotkey || 'ctrl+alt+esc',
          message: cfg.takeover_message || undefined,
          timeoutMs: Math.max(60000, Number(cfg.takeover_minutes ?? 30) * 60000),
        });
      } catch { /* the pill is a nicety; never block an action on it */ }
    }
  };

  // -- computer_screenshot ---------------------------------------------------
  const computerScreenshot = {
    name: 'computer_screenshot',
    description: [
      'Capture the whole virtual screen (all monitors) to a PNG file and return its path plus the foreground window.',
      'Models with native vision read it with read_image(path) — no extra plugin required. Use picturereader image_scan / image_ocr only when exact characters are needed.',
      `${HEAD}`,
      'Parameters: path (optional — where to save; when empty a unique file is written under the configured screenshot_dir, defaulting to the OS temp dir), region (optional [x0,y0,x1,y1] fractions in 0..1 to capture a sub-area), scale (optional 0.1..1 to downscale the saved image).',
      'Returns { path, width, height, virtual_offset:[x,y], scale }. virtual_offset is the virtual-screen origin you must add to a monitor\'s local pixel when targeting that monitor.',
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: true,
      properties: {
        path: { type: 'string', description: 'Optional absolute or cwd-relative output path for the PNG. When empty a unique file is created under the configured screenshot_dir (default: OS temp).' },
        region: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'number' }, description: 'Optional [x0, y0, x1, y1] fractions (0..1) to capture only a sub-area of the virtual screen.' },
        scale: { type: 'number', description: 'Optional 0.1..1 downscale for the saved image (default: the configured default_scale, 1 = full resolution).' },
        expected_window: { type: 'number', description: 'Optional hwnd from the previous screenshot; refuses when the foreground window changed since then (stale-observation fence).' },
      },
      required: [],
    },
    output: textOut({
      required: ['path', 'width', 'height', 'virtual_offset', 'scale'],
    }, ['screenshot saved — vision models: read_image(path); exact text: image_ocr(path); controls: computer_snapshot()']),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      gate('computer_screenshot');
      if (exec?.signal?.aborted) throw new Error('computer_screenshot: cancelled');
      const cfg = getConfig();
      const cwd = exec?.agent?.session?.header?.cwd ?? process.cwd();
      const dir = cfg.screenshot_dir?.trim() ? pathResolve(cwd, cfg.screenshot_dir) : join(tmpdir(), 'computer-user');
      const outPath = args && args.path
        ? pathResolve(cwd, String(args.path))
        : join(dir, `shot-${Date.now()}-${randomBytes(4).toString('hex')}.png`);
      const payload = {
        outPath,
        region: Array.isArray(args?.region) && args.region.length === 4 ? args.region : undefined,
        scale: typeof args?.scale === 'number' ? args.scale : cfg.default_scale,
      };
      const expected = args?.expected_window;
      if (expected !== undefined && expected !== null && String(expected).length > 0) {
        try {
          const probe = await runPs('observe.ps1', { action: 'foreground' }, { signal: exec?.signal, timeoutMs: 8000 });
          const fgNow = probe.foreground;
          if (String(fgNow?.handle) !== String(expected)) {
            throw new Error('computer_screenshot: 前台窗口已变化（expected hwnd=' + expected + '，现在是 hwnd=' + fgNow?.handle + ' title=' + JSON.stringify(fgNow?.title) + '）。请重新截图确认界面。');
          }
        } catch (e) {
          if (String(e?.message || '').includes('前台窗口已变化')) throw e;
        }
      }
      const shot = await runPs('capture.ps1', payload, { signal: exec?.signal });
      let fg;
      try {
        const probe = await runPs('observe.ps1', { action: 'foreground' }, { signal: exec?.signal, timeoutMs: 8000 });
        fg = probe.foreground;
      } catch { /* observation is best-effort */ }
      return {
        ...shot,
        captured_at: new Date().toISOString(),
        window: fg,
        look: 'vision models: read_image(path); exact text: image_ocr(path); controls: computer_snapshot()',
      };
    },
  };

  // -- side-effecting tools --------------------------------------------------
  const computerClick = {
    name: 'computer_click',
    description: [`Click at a coordinate. ${HEAD}`, 'Parameters: coordinate (required [x,y] pixels, relative to the virtual-screen origin), action (optional: click [default] | right_click | double_click).', 'Returns the clicked coordinate.'],
    parameters: {
      type: 'object', additionalProperties: true,
      properties: {
        coordinate: { ...COORD, description: 'Relative to virtual-screen origin from computer_screenshot.virtual_offset.' },
        action: { type: 'string', enum: ['click', 'right_click', 'double_click'], description: 'Default click.' },
      },
      required: ['coordinate'],
    },
    output: textOut({ required: ['clicked'] }),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      gate('computer_click');
      const res = await runPs('input.ps1', { action: 'click', coordinate: args.coordinate, action2: args.action ?? 'click' }, { signal: exec?.signal });
      return { clicked: res.cursor };
    },
  };

  const computerType = {
    name: 'computer_type',
    description: [`Type arbitrary UTF-16 text (supports Chinese) at the current focus. ${HEAD}`, 'Parameters: text (required string), send_enter (optional bool — press Enter after typing).', 'Input uses SendInput KEYEVENTF_UNICODE, so any character, including CJK, is entered reliably.' ],
    parameters: {
      type: 'object', additionalProperties: true,
      properties: { text: { type: 'string' }, send_enter: { type: 'boolean' } },
      required: ['text'],
    },
    output: textOut({ required: ['chars'] }),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      gate('computer_type');
      const cfg = getConfig();
      const res = await runPs('input.ps1', {
        action: 'type', text: String(args.text), sendEnter: !!args.send_enter,
        typingIntervalMs: cfg.typing_interval_ms || 0,
      }, { signal: exec?.signal });
      return { chars: res.chars };
    },
  };

  const computerKeypress = {
    name: 'computer_keypress',
    description: [`Send a key chord (e.g. ["ctrl","c"], ["alt","tab"]). ${HEAD}`, 'Parameters: keys (required array of key names: ctrl/control, shift, alt, super/win/cmd, enter, tab, esc, space, backspace, delete, home, end, pageup, pagedown, up/down/left/right, f1..f24, single letters/digits, or single punctuation chars).'],
    parameters: {
      type: 'object', additionalProperties: true,
      properties: { keys: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Key names pressed together (modifiers first).' } },
      required: ['keys'],
    },
    output: textOut({ required: ['keys'] }),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      gate('computer_keypress');
      const res = await runPs('input.ps1', { action: 'keypress', keys: args.keys }, { signal: exec?.signal });
      return { keys: res.keys };
    },
  };

  const computerScroll = {
    name: 'computer_scroll',
    description: [`Scroll at a coordinate. ${HEAD}`, 'Parameters: coordinate (required [x,y]), direction (optional: down [default] | up | left | right), clicks (optional number of wheel notches, default from config scroll_units).'],
    parameters: {
      type: 'object', additionalProperties: true,
      properties: {
        coordinate: COORD,
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
        clicks: { type: 'number' },
      },
      required: ['coordinate'],
    },
    output: textOut({ required: ['scrolled'] }),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      gate('computer_scroll');
      const cfg = getConfig();
      const clicks = typeof args.clicks === 'number' && args.clicks > 0 ? args.clicks : (cfg.scroll_units || 1);
      await runPs('input.ps1', { action: 'scroll', coordinate: args.coordinate, direction: args.direction ?? 'down', clicks }, { signal: exec?.signal });
      return { scrolled: `${args.direction ?? 'down'} ${clicks} tick(s) at [${args.coordinate}]` };
    },
  };

  const computerDrag = {
    name: 'computer_drag',
    description: [`Drag from start to end (press, interpolate, release). ${HEAD}`, 'Parameters: start_coordinate (required [x,y]), end_coordinate (required [x,y]), hold_keys (optional array, e.g. ["shift"] pressed while dragging).'],
    parameters: {
      type: 'object', additionalProperties: true,
      properties: {
        start_coordinate: COORD,
        end_coordinate: COORD,
        hold_keys: { type: 'array', items: { type: 'string' } },
      },
      required: ['start_coordinate', 'end_coordinate'],
    },
    output: textOut({ required: ['from', 'to'] }),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      gate('computer_drag');
      const res = await runPs('input.ps1', { action: 'drag', from: args.start_coordinate, to: args.end_coordinate, holdKeys: args.hold_keys ?? [] }, { signal: exec?.signal });
      return { from: res.from, to: res.to };
    },
  };

  const computerMoveMouse = {
    name: 'computer_move_mouse',
    description: [`Move the mouse cursor to a coordinate (without clicking). ${HEAD}`, 'Parameters: coordinate (required [x,y]).', 'Use computer_get_cursor_position to read the resulting position.'],
    parameters: {
      type: 'object', additionalProperties: true,
      properties: { coordinate: COORD },
      required: ['coordinate'],
    },
    output: textOut({ required: ['moved_to'] }),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      gate('computer_move_mouse');
      const res = await runPs('input.ps1', { action: 'move', coordinate: args.coordinate }, { signal: exec?.signal });
      return { moved_to: res.cursor };
    },
  };

  const computerWait = {
    name: 'computer_wait',
    description: [
      'Wait for a duration, or wait until a condition is true (poll every 250ms). No side effects.',
      'Parameters: ms (optional duration in milliseconds), and optionally one condition: window (hwnd to appear), target (element id from computer_snapshot to appear), title_contains (substring of a window title), timeout_ms (condition deadline, default 15000).',
      'Prefer a condition over a fixed sleep when an app is slow: it returns as soon as the UI settles.',
    ].join(' '),
    parameters: {
      type: 'object', additionalProperties: true,
      properties: {
        ms: { type: 'number', description: 'Sleep duration when no condition is given.' },
        window: { type: 'number', description: 'Wait until this hwnd exists.' },
        target: { type: 'string', description: 'Wait until this element id (locator) resolves.' },
        title_contains: { type: 'string', description: 'Wait until some window title contains this substring.' },
        timeout_ms: { type: 'number', description: 'Condition deadline in ms (default 15000, max 60000).' },
      },
      required: [],
    },
    output: textOut({ required: ['waited'] }),
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      gate('computer_wait');
      const condition = {};
      if (args?.window !== undefined && args?.window !== null) condition.handle = Number(args.window);
      if (args?.target) condition.locator = String(args.target);
      if (args?.title_contains) condition.titleContains = String(args.title_contains);
      if (Object.keys(condition).length > 0) {
        const timeoutMs = Math.min(60000, Math.max(500, Number(args.timeout_ms ?? 15000)));
        const res = await runPs('observe.ps1', { action: 'wait', ...condition, timeoutMs }, { signal: exec?.signal, timeoutMs: timeoutMs + 8000 });
        if (!res.found) {
          throw new Error('computer_wait: 条件等待超时（' + timeoutMs + 'ms）：' + JSON.stringify(condition));
        }
        return { found: true, condition: condition, timeout_ms: timeoutMs };
      }
      const ms = Math.max(0, Number(args?.ms ?? 1000) || 0);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        exec?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('computer_wait: cancelled')); }, { once: true });
      });
      return { waited: ms };
    },
  };

  const computerGetCursorPosition = {
    name: 'computer_get_cursor_position',
    description: ['Read the current mouse cursor position as virtual-screen pixels [x, y].', 'Useful to verify the result of computer_move_mouse / computer_click. No side effects.'],
    parameters: { type: 'object', additionalProperties: true, properties: {}, required: [] },
    output: textOut({ required: ['x', 'y'] }),
    isConcurrencySafe: () => false,
    async execute(_args, exec) {
      gate('computer_get_cursor_position');
      const res = await runPs('input.ps1', { action: 'getpos' }, { signal: exec?.signal });
      return { x: res.cursor[0], y: res.cursor[1] };
    },
  };

  // -- computer_set_mode: AI may change the runtime mode (if enabled) -------
  const computerSetMode = {
    name: 'computer_set_mode',
    description: [
      'Change the runtime mode to one of: disabled / readonly / manual / auto.',
      'Only works when the setting「AI 可自行修改运行模式」(ai_can_change_mode) is on; otherwise this tool refuses.',
      'Settings card dropdown stays in sync: the new mode is written to the computer-user settings namespace (same store the dropdown reads).',
      'Parameters: mode (required, one of disabled/readonly/manual/auto).',
    ].join(' '),
    parameters: {
      type: 'object', additionalProperties: true,
      properties: {
        mode: { type: 'string', enum: MODES, description: '目标运行模式：disabled/readonly/manual/auto' },
      },
      required: ['mode'],
    },
    output: textOut({ required: ['mode', 'changed_by'] }),
    isConcurrencySafe: () => false,
    async execute(args, _exec) {
      if (typeof setMode !== 'function') throw new Error('computer_set_mode: 设置服务不可用');
      const cfg = getConfig();
      if (cfg.mode === 'disabled') {
        throw new Error('computer-user 已禁用：无法在禁用模式下修改运行模式（需用户在设置中先解除禁用）');
      }
      if (cfg.ai_can_change_mode !== true) {
        throw new Error('computer_set_mode: 当前未允许 AI 修改运行模式（设置「AI 可自行修改运行模式」未开启）');
      }
      const mode = validateMode(args.mode);
      await setMode(mode);
      return { mode, changed_by: 'ai' };
    },
  };

  // -- structured observation (UI Automation) --------------------------------
  // Locators are shortened on the model side to keep the list cheap; observe.ps1
  // accepts both spellings.
  const shortId = (id) => String(id || '')
    .replace('hwnd=', 'h=')
    .replace('|role=', '|r=')
    .replace('|name=', '|n=')
    .replace('|nth=', '|i=');

  const computerSnapshot = {
    name: 'computer_snapshot',
    description: [
      'Read the UI Automation tree of one window (default: the foreground window) and return a bounded, indexed element list with a replayable id per element.',
      'Prefer this over pixel guessing when you need to click a named button or fill a field: far fewer tokens than a screenshot, and it never moves the pointer.',
      'Each id is a locator (window handle + role + name + occurrence). Pass it to computer_invoke / computer_set_value / computer_focus. If the UI changed, the locator fails loudly instead of hitting whatever now sits at the old coordinates.',
      'Parameters: window (optional hwnd; default foreground), max_depth (default 6, max 10), max_nodes (default 80, max 400).',
    ].join(' '),
    parameters: {
      type: 'object', additionalProperties: true,
      properties: {
        window: { type: 'number', description: 'Target window handle (hwnd). Empty = the foreground window.' },
        max_depth: { type: 'number', description: 'Tree depth cap (default 6).' },
        max_nodes: { type: 'number', description: 'Node budget (default 80, max 400).' },
      },
      required: [],
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => {
        const obs = value.observation || {};
        const win = obs.window || {};
        const lines = [
          'window: ' + (win.title || '(no title)') + ' (hwnd=' + win.handle + ', ' + (win.process || '?') + ')',
          'captured_at: ' + (obs.capturedAt || '?') + (obs.truncated ? ' (truncated)' : ''),
        ];
        for (const el of value.elements || []) {
          const r = el.rect ? ' @' + el.rect.x + ',' + el.rect.y + ' ' + el.rect.w + 'x' + el.rect.h : '';
          const flags = (el.enabled === false ? ' [disabled]' : '') + (el.value !== null && el.value !== undefined && el.value !== '' ? ' [' + el.value + ']' : '');
          lines.push('[' + el.role + '] ' + (el.name || el.autoId || '(unnamed)') + r + flags + '  id=' + el.id);
        }
        if (!value.elements || value.elements.length === 0) {
          lines.push('(no controls exposed — the app may be custom-drawn; fall back to computer_screenshot + coordinates)');
        }
        return [{ type: 'text', text: lines.join('\n') }];
      },
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      gate('computer_snapshot');
      const payload = {
        action: 'snapshot',
        maxDepth: Math.min(10, Math.max(1, Number(args?.max_depth ?? 6))),
        maxNodes: Math.min(400, Math.max(10, Number(args?.max_nodes ?? 80))),
      };
      if (args?.window !== undefined && args?.window !== null) payload.handle = Number(args.window);
      const res = await runPs('observe.ps1', payload, { signal: exec?.signal, timeoutMs: 30000 });
      const elements = (res.elements || []).map((el) => ({ ...el, id: shortId(el.id) }));
      return { observation: res.observation, elements };
    },
  };

  // -- control actions (no pointer movement) --------------------------------
  const makeActTool = (name, kind, label, hint, extraProps, extraRequired) => ({
    name,
    description: [
      label,
      hint,
      'Parameters: target (required element id from computer_snapshot)' +
        (extraRequired.length ? ', ' + extraRequired.join(', ') : '') +
        ', require_foreground (optional bool, default true — refuses when the target window is not the foreground window).',
    ].join(' '),
    parameters: {
      type: 'object', additionalProperties: true,
      properties: {
        target: { type: 'string', description: 'Element id returned by computer_snapshot.' },
        require_foreground: { type: 'boolean', description: 'Refuse when the target window is not the foreground window (default true).' },
        ...extraProps,
      },
      required: ['target', ...extraRequired],
    },
    output: textOut({ required: ['action'] }),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      gate(name);
      const payload = {
        action: 'act',
        kind,
        locator: String(args.target),
        requireForeground: args.require_foreground !== false,
      };
      if (kind === 'set_value') payload.value = String(args.value ?? '');
      const res = await runPs('observe.ps1', payload, { signal: exec?.signal, timeoutMs: 20000 });
      return { action: res.action, window: res.window };
    },
  });

  const computerInvoke = makeActTool(
    'computer_invoke', 'invoke',
    'Invoke the default action of a control (press a button, follow a link) without moving the pointer.',
    'Prefer this over computer_click whenever computer_snapshot exposes an Invoke pattern.',
    {}, []
  );
  const computerSetValue = makeActTool(
    'computer_set_value', 'set_value',
    'Set a control value directly (text field, combo) without typing and without touching the clipboard.',
    'Works even when the control is scrolled out of view, as long as UI Automation exposes a Value pattern.',
    { value: { type: 'string', description: 'New value.' } }, ['value']
  );
  const computerFocus = makeActTool(
    'computer_focus', 'focus',
    'Move keyboard focus to a control without clicking it.',
    'Follow with computer_type to type into it.',
    {}, []
  );

  // -- windows ---------------------------------------------------------------
  const computerListWindows = {
    name: 'computer_list_windows',
    description: 'List top-level windows (handle, title, process, rectangle, focused). Use the handle in computer_snapshot / computer_activate_window / computer_move_window / computer_close_window.',
    parameters: { type: 'object', additionalProperties: true, properties: {}, required: [] },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => {
        const lines = [];
        for (const w of value.windows || []) {
          const r = w.rect ? ' @' + w.rect.x + ',' + w.rect.y + ' ' + w.rect.w + 'x' + w.rect.h : '';
          lines.push('hwnd=' + w.handle + ' [' + (w.process || '?') + '] ' + (w.title || '(no title)') + r + (w.focused ? ' (focused)' : ''));
        }
        if (lines.length === 0) lines.push('(no visible top-level windows)');
        return [{ type: 'text', text: lines.join('\n') }];
      },
    },
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      gate('computer_list_windows');
      const res = await runPs('observe.ps1', { action: 'windows' }, { signal: exec?.signal, timeoutMs: 20000 });
      return { windows: res.windows || [] };
    },
  };

  const makeWindowTool = (name, kind, label, hint, extraProps, extraRequired) => ({
    name,
    description: [label, hint, 'Parameters: window (required hwnd from computer_list_windows)' + (extraRequired.length ? ', ' + extraRequired.join(', ') : '') + '.'].join(' '),
    parameters: {
      type: 'object', additionalProperties: true,
      properties: { window: { type: 'number', description: 'Window handle (hwnd).' }, ...extraProps },
      required: ['window', ...extraRequired],
    },
    output: textOut({ required: ['action'] }),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      gate(name);
      const payload = { action: 'window', kind, handle: Number(args.window) };
      if (kind === 'move') payload.rect = args.rect;
      const res = await runPs('observe.ps1', payload, { signal: exec?.signal, timeoutMs: 15000 });
      return { action: res.action, handle: res.handle, rect: res.rect };
    },
  });

  const computerActivateWindow = makeWindowTool(
    'computer_activate_window', 'activate',
    'Bring a window to the foreground.',
    'Use after computer_list_windows; returning focus matters for coordinate clicks.',
    {}, []
  );
  const computerMoveWindow = makeWindowTool(
    'computer_move_window', 'move',
    'Move/resize a window to an explicit rectangle.',
    'Handy for putting two windows side by side before a drag or compare.',
    { rect: { type: 'object', description: 'Target rectangle {x,y,w,h} in virtual-screen pixels.', properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } }, required: ['x', 'y', 'w', 'h'] } },
    ['rect']
  );
  const computerCloseWindow = makeWindowTool(
    'computer_close_window', 'close',
    'Ask a window to close (posts WM_CLOSE; the app may prompt to save).',
    'This is a request, not a kill: unsaved-work dialogs still need handling.',
    {}, []
  );

  // -- doctor ---------------------------------------------------------------
  const computerDoctor = {
    name: 'computer_doctor',
    description: 'Self-check the runtime: PowerShell version, UI Automation availability, temp/state directory, pending stop, active mode and tool_mode. Run this first when a computer_* call fails without an obvious cause.',
    parameters: { type: 'object', additionalProperties: true, properties: {}, required: [] },
    output: textOut({ required: ['powershell', 'uia'] }),
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      gate('computer_doctor');
      const probe = await runPs('observe.ps1', { action: 'probe' }, { signal: exec?.signal, timeoutMs: 15000 });
      let foreground;
      try {
        const res = await runPs('observe.ps1', { action: 'foreground' }, { signal: exec?.signal, timeoutMs: 8000 });
        foreground = res.foreground;
      } catch { /* best effort */ }
      const cfg = getConfig();
      return {
        powershell: probe.powershell,
        edition: probe.edition,
        uia: probe.uia,
        uia_error: probe.uiaError || undefined,
        temp_writable: probe.tempWritable,
        state_dir: probe.tempDir,
        stopped: typeof isStopped === 'function' ? isStopped() : false,
        mode: cfg.mode,
        tool_mode: cfg.tool_mode || 'all',
        stop_hotkey: cfg.stop_hotkey || 'ctrl+alt+esc',
        foreground: foreground ? { handle: foreground.handle, title: foreground.title } : undefined,
      };
    },
  };

  // -- optional browser lane -------------------------------------------------
  // Read-only CDP probe: when the user starts Chrome/Edge with
  // --remote-debugging-port and sets cdp_port, the model can see the pages
  // instead of guessing pixels. Driving them is left to the caller (any CDP
  // client) so the plugin keeps no long-lived connection.
  const httpJson = fetchJson ?? (async (url, opts) => {
    const res = await fetch(url, opts);
    return res.json();
  });

  const computerBrowser = {
    name: 'computer_browser',
    description: [
      'List Chromium DevTools targets over the loopback CDP endpoint (set cdp_port in Settings, or pass port).',
      'Read-only: returns each page id/title/url/websocket so a caller can decide to drive the web UI through CDP instead of pixels.',
      'Returns an empty list with a note when no port is configured or the endpoint is closed.',
    ].join(' '),
    parameters: {
      type: 'object', additionalProperties: true,
      properties: { port: { type: 'number', description: 'Override the configured cdp_port for this call.' } },
      required: [],
    },
    output: textOut({ required: ['pages'] }),
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      gate('computer_browser');
      const cfg = getConfig();
      const port = Number(args?.port ?? cfg.cdp_port ?? 0);
      if (!Number.isFinite(port) || port <= 0) {
        return { pages: [], note: 'cdp_port 未配置：在设置里填上 Chrome/Edge 的 --remote-debugging-port 后可用' };
      }
      try {
        const list = await httpJson('http://127.0.0.1:' + Math.trunc(port) + '/json/list', { signal: exec?.signal });
        const pages = Array.isArray(list) ? list : [];
        return {
          port: Math.trunc(port),
          pages: pages.map((p) => ({
            id: p.id,
            type: p.type,
            title: p.title,
            url: p.url,
            websocket: p.webSocketDebuggerUrl,
          })),
        };
      } catch (e) {
        return { port: Math.trunc(port), pages: [], note: 'CDP 端点不可达：' + String(e?.message || e) };
      }
    },
  };

  const tools = [
    computerScreenshot,
    computerSnapshot,
    computerBrowser,
    computerClick,
    computerInvoke,
    computerSetValue,
    computerFocus,
    computerType,
    computerKeypress,
    computerScroll,
    computerDrag,
    computerMoveMouse,
    computerWait,
    computerGetCursorPosition,
    computerListWindows,
    computerActivateWindow,
    computerMoveWindow,
    computerCloseWindow,
    computerDoctor,
    computerSetMode,
  ];

  // tool_mode: all (default) | lite | custom (enabled_tools allow-list).
  const cfgNow = getConfig();
  const mode = String(cfgNow.tool_mode || 'all');
  if (mode === 'lite') return tools.filter((t) => LITE_TOOLS.has(t.name));
  if (mode === 'custom') {
    const allow = Array.isArray(cfgNow.enabled_tools) && cfgNow.enabled_tools.length
      ? new Set(cfgNow.enabled_tools.map(String))
      : null;
    if (allow) return tools.filter((t) => allow.has(t.name));
  }
  return tools;

  for (const tool of tools) {
    if (Array.isArray(tool.description)) tool.description = tool.description.join(' ');
  }

  return tools;
}

export default createComputerTools;

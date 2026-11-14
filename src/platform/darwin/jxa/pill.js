/**
 * The takeover pill for macOS, as generated JXA source.
 *
 * Windows renders the pill with WPF and registers a global stop hotkey. macOS
 * gets an AppKit `NSPanel` instead:
 *
 *  - `nonactivatingPanel` + `canJoinAllSpaces` + floating level: appears above
 *    normal windows, follows every Space, never steals focus.
 *  - clicking anywhere on the pill stops the takeover (writes the shared
 *    `stop.flag` with `reason=button`) — polling `NSEvent.pressedMouseButtons`
 *    is used instead of a target/action pair, because the ObjC bridge cannot
 *    define the ObjC method an NSButton action needs.
 *  - the timeout writes `reason=timeout`, exactly like `guard.ps1`, so the
 *    Windows error text and the `/computer` resume path stay identical.
 *
 * A global keyboard hotkey is deliberately NOT registered: `CGEventTap` needs a
 * C function-pointer callback the bridge cannot express. `docs/mac-backend.md`
 * tracks that as the remaining gap.
 *
 * @module platform/darwin/jxa/pill
 */

/**
 * Build the JXA program that renders the pill.
 *
 * @param {{message?: string, hint?: string, timeoutMs?: number, stopFlagPath: string}} opts
 * @returns {string} JavaScript-for-OSA source
 */
export function pillJXA({ message = 'DSH 正在操控你的电脑', hint = '点击此提示条任意位置即停止 · 或输入 /computer', timeoutMs = 1800000, stopFlagPath }) {
  if (!stopFlagPath) throw new Error('computer-use(mac): pillJXA 需要 stopFlagPath');
  const timeout = Math.max(60000, Math.trunc(Number(timeoutMs) || 1800000));
  return [
    "ObjC.import('Cocoa');",
    "ObjC.import('AppKit');",
    "ObjC.import('QuartzCore');",
    '',
    'const STOP_FLAG = ' + JSON.stringify(stopFlagPath) + ';',
    'const TIMEOUT_MS = ' + timeout + ';',
    'const MESSAGE = ' + JSON.stringify(String(message)) + ';',
    'const HINT = ' + JSON.stringify(String(hint)) + ';',
    '',
    'function writeStop(reason) {',
    '  try {',
    '    const text = "reason=" + reason + " at=" + (new Date()).toISOString();',
    '    const ns = $.NSString.alloc.initWithUTF8String(text);',
    '    ns.writeToFileAtomicallyEncodingError($(STOP_FLAG), true, $.NSUTF8StringEncoding, null);',
    '  } catch (e) { /* the call that follows will fail loudly instead */ }',
    '}',
    '',
    'const app = $.NSApplication.sharedApplication;',
    'app.setActivationPolicy(1);',
    '',
    'const W = 520;',
    'const H = 64;',
    'const frame = $.NSScreen.mainScreen.frame;',
    'const originX = frame.origin.x + (frame.size.width - W) / 2;',
    'const originY = frame.origin.y + frame.size.height - H - 48;',
    '',
    'const panel = $.NSPanel.alloc.initWithContentRectStyleMaskBackingDefer(',
    '  $.NSMakeRect(originX, originY, W, H),',
    '  $.NSWindowStyleMaskBorderless | $.NSWindowStyleMaskNonactivatingPanel,',
    '  $.NSBackingStoreBuffered,',
    '  false',
    ');',
    'panel.setLevel($.NSFloatingWindowLevel);',
    'panel.setCollectionBehavior($.NSWindowCollectionBehaviorCanJoinAllSpaces | $.NSWindowCollectionBehaviorTransient);',
    'panel.setOpaque(false);',
    'panel.setHasShadow(true);',
    'panel.setBackgroundColor($.NSColor.clearColor);',
    '',
    'const bg = $.NSView.alloc.initWithFrame($.NSMakeRect(0, 0, W, H));',
    'bg.setWantsLayer(true);',
    'bg.layer.setBackgroundColor($.NSColor.colorWithCalibratedRedGreenBlueAlpha(0.06, 0.09, 0.16, 0.92).CGColor);',
    'bg.layer.setCornerRadius(16);',
    'panel.contentView.addSubview(bg);',
    '',
    'function label(text, y, size, color) {',
    '  const field = $.NSTextField.alloc.initWithFrame($.NSMakeRect(20, y, W - 40, 20));',
    '  field.setStringValue(text);',
    '  field.setBezeled(false);',
    '  field.setDrawsBackground(false);',
    '  field.setEditable(false);',
    '  field.setSelectable(false);',
    '  field.setTextColor(color);',
    '  field.setFont($.NSFont.systemFontOfSize(size));',
    '  bg.addSubview(field);',
    '}',
    'label(MESSAGE, 34, 13.5, $.NSColor.whiteColor);',
    'label(HINT, 14, 11.5, $.NSColor.colorWithCalibratedRedGreenBlueAlpha(0.72, 0.78, 0.9, 1));',
    '',
    'panel.orderFrontRegardless();',
    '',
    'const started = Date.now();',
    'while (true) {',
    '  const inside = (function () {',
    '    const p = $.NSEvent.mouseLocation;',
    '    return p.x >= originX && p.x <= originX + W && p.y >= originY && p.y <= originY + H;',
    '  })();',
    '  const pressed = Number($.NSEvent.pressedMouseButtons);',
    '  if ((pressed & 1) === 1 && inside) { writeStop("button"); break; }',
    '  if (Date.now() - started >= TIMEOUT_MS) { writeStop("timeout"); break; }',
    '  $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.2));',
    '}',
    'app.terminate(0);',
  ].join('\n');
}

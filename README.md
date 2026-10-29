# computer-user

Codex-style **computer use** for DeepSeek Harness (DSH): read the screen and drive the
mouse & keyboard — screenshot → analyze with [picturereader] → click/type/keypress/scroll/
drag → verify. **Windows only.**

- `computer_screenshot` captures the whole virtual screen (multi-monitor, DPI-aware) to a
  PNG file and returns its path — feed it straight into picturereader's `image_scan` /
  `image_ocr` to "see" the screen with any text-only model.
- 8 more `computer_*` tools operate the mouse & keyboard through bundled PowerShell +
  Win32 `SendInput` (no native modules, no compilation, works in the DSH/EAC host process).
- A settings card (「电脑操作 / Computer Use」) puts a **mode dropdown** up front —
  disabled / read-only / manual approval (`/computer`) / automatic — with the rest
  collapsed under a default-closed **高级设置 / Advanced** section.
- **Fully local — no external API calls**: screenshot (PowerShell), analysis
  (picturereader local scan/OCR), input (Win32 SendInput). Nothing leaves the machine.
  Read the workflow in [skills/computer-use.md](skills/computer-use.md) (locate the
  target window first, then OCR inside the window, then click once and verify).
- Verified on **DeepSeek Harness EAC** desktop (same DSH host kernel as the web app).

> 中文说明见 [README.zh.md](README.zh.md)。

## Vision: native first, picturereader optional

The plugin never requires a vision plugin. `computer_screenshot` hands you a PNG path
plus the foreground window, and every model can act from there:

- **Vision-capable models** (most current ones): screenshot → `read_image(path)` → act.
  No extra plugin, no OCR step.
- **Text-only models**: install [picturereader](https://github.com/jing-hy/picturereader)
  and run `image_scan` / `image_ocr` on the same PNG. That path still works, it is just
  no longer mandatory.
- **No vision at all**: `computer_snapshot` returns the UI Automation tree with a
  replayable id per element, so `computer_invoke` / `computer_set_value` /
  `computer_focus` act on named controls without any pixels and without moving the pointer.

The classic loop is unchanged (look → act → verify); the look step is `read_image` for
vision models and `image_ocr` for text-only ones. See
[skills/computer-use.md](skills/computer-use.md).

## Tools

Nineteen tools. `tool_mode` can trim the set to nine everyday ones (see Settings).

| Group | Tools |
|---|---|
| Look | `computer_screenshot` (PNG path + foreground window), `computer_snapshot` (UIA tree with locator ids), `computer_list_windows`, `computer_get_cursor_position` |
| Pointer & keys | `computer_click`, `computer_type`, `computer_keypress`, `computer_scroll`, `computer_drag`, `computer_move_mouse` |
| Controls, no pointer | `computer_invoke`, `computer_set_value`, `computer_focus` |
| Windows | `computer_activate_window`, `computer_move_window`, `computer_close_window` |
| Timing | `computer_wait` — fixed sleep, or wait-until a window / element / title substring appears |
| Runtime | `computer_doctor` (PowerShell + UIA + stop state), `computer_set_mode` |

Coordinates stay pixels relative to the virtual-screen origin (`virtual_offset`).
UIA locators look like `h=<hwnd>|r=<Role>|n=<Name>|i=<nth>` and are re-resolved on every
action, so a stale locator fails instead of clicking whatever now sits at the old
coordinates. `computer_screenshot` accepts `expected_window` to fence the same way.

### Takeover pill and stop key

Any side-effecting call raises a blue pill at the top center of the screen: DSH is
controlling your computer, press Ctrl+Alt+Esc to stop. The hotkey (configurable) and the
pill Stop button both write a stop flag; every later `computer_*` call refuses to act
until the user approves again. The pill runs in its own process, so the key still lands
while the input backend is busy.

## Install

```bash
npm install computer-user
```

or in the DSH profile:

```bash
dsh plugin --profile web add computer-user
```

Then restart DSH (or use the EAC settings → Plugins → Manage screen). The tools appear for
any session; the settings card appears under Settings → Computer Use.

Compatible with every published DSH 0.2.x pre-release (`0.2.0-rc.1` … `0.2.2-alpha.2`)
and with 0.1.x hosts. The version gate is `@deepseek-ai/dsh-settings >=0.1.0-rc.6 <0.3.0-0`,
so the host plugin-compatibility check accepts all of them; 0.3.0 stays out of range until
this plugin is verified against it. The 0.2 settings form (`configForms` / `SettingsForms`)
and the `llm/stream` waterfall are used when present, and the 0.1.x namespaced settings
scope and provider registration are kept as fallbacks.

### Pair with picturereader (recommended)

```text
computer_screenshot → path
picturereader image_scan / image_ocr <path>   # look
computer_click / type / ...                   # act
computer_screenshot → image_compare           # verify
```

## Settings card

The settings card (「电脑操作 / Computer Use」) uses the same settings form as the built-in
plugin pages: a flat field list separated by hairline rules, 34px inputs on `bg-layer-3`,
13px/500 labels, 12px tertiary hints, a per-field 「已覆盖 / Overridden」 badge with a text
「恢复默认 / Reset to default」, and one filled save button. Edits are staged locally and
written atomically on save (`mutate(ops, revision)`); a save the Host rejects keeps the
drafts. Reading the plugin entry's own Config through `ctx.configForms` (DSH 0.2.x shared
forms) keeps the card in sync with the Host settings document and with `computer_set_mode`.

- **Mode dropdown** at the top of the card:
  - `disabled` — every `computer_*` tool refuses.
  - `readonly` — only screenshot / cursor-read / wait are allowed.
  - `manual` — side-effecting tools need the session approved first via the `/computer`
    slash command (one approval unlocks the session for later turns).
  - `auto` — the LLM freely calls all tools.
- **AI may change mode itself** checkbox (below the dropdown, not in Advanced):
  off by default; when on, the AI can switch modes via `computer_set_mode` — changes are
  written to the same plugin Config entry, so the dropdown stays in sync both ways.
- **截图输出目录 / Screenshot output dir**, **截图默认缩放 / Default scale**,
  **逐字输入间隔 / Typing interval**, **滚动刻度 / Scroll units**,
  **代码输出打回 / Reject code-as-text output (default on)**, **调试日志 / Debug logging**.
- **工具分档 / Tool set**: all (19) / lite (9 everyday tools) / custom (allow-list by name).
- **自定义白名单 / Custom allow-list**: comma-separated tool names used with custom.
- **急停热键 / Stop hotkey** (default `ctrl+alt+esc`), **提示条自动收起（分钟） / Auto-dismiss
  (minutes)**, **提示条文案 / Pill caption** — `{key}` is replaced with the hotkey.

**Output guard** is a host-side filter on the LLM stream: if the model writes a fake
tool-call / XML markup as *conversation text* (e.g. `computer_click({…})` or `<invoke …>`
typed out instead of a real call), that chunk is stripped and replaced with a one-time
coaching note; outputting the exact same text a second time passes through unblocked.
Turn it off in Advanced when you intentionally want code snippets in replies.

## Safety

- **Locate the target window first** (DPI-aware GetWindowRect — see
  [skills/computer-use.md](skills/computer-use.md)); desktop icons/background confuse
  both OCR and clicks. Only work inside the target window.
- Always `computer_screenshot` first and analyze it (picturereader) before acting.
- Click once, screenshot to verify; never blind click repeatedly (many UIs toggle).
- Use `manual` mode with the `/computer` command to keep a human in the loop.
- If injected input is silently dropped, check security software (some AV suites filter
  simulated input).

## Verification & known limits

- `node --test` unit suite: 39/39 green (tool registration, gates, arg validation,
  output guard).
- Real-machine safe-window smoke (throwaway window + cmd.exe, never the user's apps):
  screenshot PNG correct; cursor read/move round-trip exact; typing `hello 中文 123!`
  read back verbatim; keypress Home/End navigation + insert verified (`HEADzzzTAIL`);
  double-click word selection, click-to-clear, drag selection all asserted via control state.
- Headless integration: both `computer_screenshot` and `computer_get_cursor_position`
  called successfully by the model inside a real `dsh --profile headless` session.
- Headless real-scenario: model autonomously executed a 5-step task
  (screenshot → image_scan → type "hello" → screenshot → image_ocr) inside
  `dsh --profile headless`, coordinating picturereader and computer-user tools.
  OCR confirmed the typed text appeared on screen.
- **Wheel verified**: all 9 tools (screenshot / click / type / keypress / scroll / drag /
  move_mouse / wait / get_cursor_position) fully end-to-end verified. Wheel scroll position
  changed and MouseWheel events fired correctly. Note: always-on-top IME toolbars (e.g.
  Sogou Input floating bar) or other overlay windows can absorb wheel events if the cursor
  lands on them — move the cursor to a clear area first (same as any cursor-based input).
- EAC compatibility: loads side-by-side with picturereader in the same host; static scan of
  all built-in plugins shows zero `computer_*` / `computer-user` namespace collisions.

## Development

```text
src/capture.ps1    DPI-aware multi-monitor screenshot (System.Drawing)
src/input.ps1      SendInput mouse/keyboard backend
src/ps.js          PowerShell runner (base64 JSON, timeout, abort)
src/tools.js       the 9 computer_* tool definitions + enabled/confirm gates
src/config.js      settings namespace schema
src/index.js       plugin entry (register tools + settings, hot reload)
client.js          Web settings card (ModuleLoader bundle, zh/en)
scripts/           real-machine smoke scripts (safe-window)
tests/             node:test unit tests
```

## License

MIT

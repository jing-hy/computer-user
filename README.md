# computer-user

Codex-style **computer use** for DeepSeek Harness (DSH): read the screen and drive the
mouse & keyboard — screenshot → analyze with [picturereader] → click/type/keypress/scroll/
drag → verify. **Windows only.**

- `computer_screenshot` captures the whole virtual screen (multi-monitor, DPI-aware) to a
  PNG file and returns its path — feed it straight into picturereader's `image_scan` /
  `image_ocr` to "see" the screen with any text-only model.
- 8 more `computer_*` tools operate the mouse & keyboard through bundled PowerShell +
  Win32 `SendInput` (no native modules, no compilation, works in the DSH/EAC host process).
- A settings card (「电脑操作 / Computer Use」) puts the two important switches up front —
  **是否开启 / Enabled** and **是否要请示 / Ask before acting** — with the rest collapsed
  under a default-closed **高级设置 / Advanced** section.
- Verified on **DeepSeek Harness EAC** desktop (same DSH host kernel as the web app).

> 中文说明见 [README.zh.md](README.zh.md)。

## Tools

| Tool | What it does |
|---|---|
| `computer_screenshot` | Save full virtual-screen PNG (region/scale optional) → `{path,width,height,virtual_offset,scale}` |
| `computer_click` | Click at `[x,y]` (click / right_click / double_click) |
| `computer_type` | Type arbitrary UTF-16 text — CJK included — via `SendInput` Unicode |
| `computer_keypress` | Key chord, e.g. `["ctrl","c"]`, `["alt","tab"]`; letters/digits use virtual keys so shortcuts work |
| `computer_scroll` | Wheel scroll at `[x,y]`: up / down / left / right, `clicks` notches |
| `computer_drag` | Press → interpolate → release, optional `hold_keys` |
| `computer_move_mouse` | Move cursor without clicking |
| `computer_wait` | Sleep `ms` (let UI settle) |
| `computer_get_cursor_position` | Read current cursor `[x,y]` |

Coordinates are **pixels relative to the virtual-screen origin** (all monitors combined;
`computer_screenshot` returns it as `virtual_offset`). `SetProcessDPIAware` keeps
coordinates aligned with physical pixels on scaled displays.

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

### Pair with picturereader (recommended)

```text
computer_screenshot → path
picturereader image_scan / image_ocr <path>   # look
computer_click / type / ...                   # act
computer_screenshot → image_compare           # verify
```

## Settings card

- **是否开启 / Enabled** — master switch; when off every `computer_*` tool refuses.
- **是否要请示 / Ask before acting** — when on, side-effecting operations
  (click/type/keypress/scroll/drag/move) require an explicit `confirm: true` in the call;
  screenshot / cursor-read / wait are not gated.
- **高级设置 / Advanced** (collapsed by default): screenshot output dir, default scale,
  typing interval, scroll units, debug logging.

## Safety

- Always `computer_screenshot` first and analyze it (picturereader) before acting; never
  blind-click/type.
- Only interact with task-relevant windows; never operate the DSH/EAC client itself.
- Use `confirm: true` semantics and the settings card to keep a human in the loop.
- If injected input is silently dropped, check security software (some AV suites filter
  simulated input).

## Verification & known limits

- `node --test` unit suite: 16/16 green (tool registration, gates, arg validation).
- Real-machine safe-window smoke (throwaway window + cmd.exe, never the user's apps):
  screenshot PNG correct; cursor read/move round-trip exact; typing `hello 中文 123!`
  read back verbatim; keypress Home/End navigation + insert verified (`HEADzzzTAIL`);
  double-click word selection, click-to-clear, drag selection all asserted via control state.
- Headless integration: both `computer_screenshot` and `computer_get_cursor_position`
  called successfully by the model inside a real `dsh --profile headless` session.
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

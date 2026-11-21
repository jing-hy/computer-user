<div align="center">

# computer-user

**Codex-style computer use for DeepSeek Harness.**
Full implementation on Windows: the agent sees the screen, clicks, types, and drives named UI Automation controls. macOS is an experimental backend (capture / pointer / keyboard / windows / pill, no control tree yet). No sidecar, no native build.

[![npm](https://img.shields.io/npm/v/computer-user?color=blue)](https://www.npmjs.com/package/computer-user)
[![downloads](https://img.shields.io/npm/dm/computer-user)](https://www.npmjs.com/package/computer-user)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20(experimental)-0078D4)](#platform-support)
[![tests](https://img.shields.io/badge/tests-160%20passing-brightgreen)](#development)

[中文（默认）](README.md) | English

<img src="https://raw.githubusercontent.com/jing-hy/computer-user/main/assets/takeover-pill.png" width="780" alt="Takeover pill: DSH is controlling your computer, press Ctrl+Alt+Esc to stop">

</div>

`computer-user` is a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) bundle that gives an agent
twenty-one `computer_*` tools: screenshot, UI Automation tree, pointer and keyboard input, window control, and a
takeover pill with a global stop key that follows you across virtual desktops.

It ships as a normal DSH plugin — `package.json`, one `cordis.patch.yml`, a settings card, and a backend
chosen by platform (Windows: four PowerShell scripts; macOS: built-in `screencapture` / `osascript` plus optional
`cliclick`). No native addon, no daemon process, no MCP bridge.

## Platform support

| Capability | Windows 10/11 | macOS (experimental) |
|---|---|---|
| Screenshot (full / region / scale) | ✅ multi-monitor virtual desktop | ✅ main display; Retina normalized to points |
| Pointer click / move / drag / scroll / position | ✅ | ✅ (`brew install cliclick` needed for pointer) |
| Keyboard chords / text (incl. CJK) | ✅ | ✅ (AppleScript `keystroke`, unicode ok) |
| Window list / foreground / activate | ✅ | ✅ (`CGWindowList`) |
| Window move / close | ✅ | ❌ explicit error (needs AX API) |
| Control tree `snapshot` / `invoke` / `set_value` / `focus` | ✅ UIA | ❌ explicit error (needs AX API + TCC) |
| Condition wait (`computer_wait`) | ✅ | ✅ |
| Takeover pill + stop button + timeout latch | ✅ WPF | ✅ JXA/AppKit panel (click the pill to stop) |
| Global stop **hotkey** | ✅ | ⚠️ off by default (`CGEventTap`, needs real-hardware check) |

On macOS, grant the DSH app two permissions in “System Settings → Privacy & Security” before the first run:
**Screen Recording** (otherwise `screencapture` sees nothing) and **Accessibility** (otherwise synthetic input is
dropped and window details are missing). **Input Monitoring** is only needed for the optional global stop key.
Restart DSH after granting. `computer_doctor` reports the active backend, the macOS version, whether
`screencapture` / `osascript` / `cliclick` are on PATH, and `dpr_unverified` for the Retina mapping.

See [docs/mac-backend.md](docs/mac-backend.md) for the backend contract and the known gaps.

## Why this one

- **Native DSH bundle, not a bridge.** Tools register through `ctx.tools.register`; settings ride the 0.2.x
  `SettingsForms` entry; the Web card is a first-class settings section, not a separate page.
- **Zero native dependencies.** Input uses `SendInput`, capture uses GDI, observation uses UI Automation —
  all through Windows PowerShell 5.1 that ships with the OS.
- **Vision optional.** `computer_screenshot` returns a PNG path: vision models call `read_image`, text-only
  models use picturereader OCR, and `computer_snapshot` acts on named controls without any pixels.
- **Stops when asked.** A blue pill appears while the agent has control; the stop key (default `Ctrl+Alt+Esc`)
  or its button writes a stop flag that every later call refuses to ignore. When a task is done the agent can
  close the pill itself with `computer_stop` (the approval survives), and the pill follows virtual-desktop switches.
- **Stale-safe.** Element ids are re-resolved on every action, and a screenshot can be fenced on the
  foreground window — a changed UI fails loudly instead of clicking the wrong thing.

## Quick start

npm:

```sh
npm install computer-user
```

DSH profile:

```sh
dsh plugin --profile desktop add computer-user
```

Restart DSH. The tools appear in every session; the card appears under Settings → Computer Use.

From a checkout:

```sh
git clone https://github.com/jing-hy/computer-user.git
cd computer-user
npm install --no-save @deepseek-ai/schemastery@3.18.5   # peer, provided by the host at runtime
node --test
```

## The loop

```text
computer_screenshot            -> PNG path + foreground window
read_image(path)               -> vision models see it   (text-only: image_ocr / image_scan)
computer_snapshot              -> UI Automation tree, one replayable id per element
computer_invoke / set_value    -> act on a named control, pointer untouched
computer_screenshot            -> verify (optionally fenced with expected_window)
```

Coordinate work still works: every input tool takes virtual-screen pixels, and `computer_screenshot`
returns `virtual_offset` so multi-monitor rigs line up.

## Tools

Twenty-one tools. `tool_mode` can trim the set to nine everyday ones.

| Group | Tools |
|---|---|
| Observe | `computer_screenshot`, `computer_snapshot`, `computer_list_windows`, `computer_get_cursor_position` |
| Act with the pointer | `computer_click`, `computer_type`, `computer_keypress`, `computer_scroll`, `computer_drag`, `computer_move_mouse` |
| Act on controls | `computer_invoke`, `computer_set_value`, `computer_focus` |
| Windows | `computer_activate_window`, `computer_move_window`, `computer_close_window` |
| Timing | `computer_wait` — sleep, or wait until a window / element / title substring appears |
| Runtime | `computer_doctor`, `computer_browser` (read-only CDP list), `computer_set_mode` |
| Wrap-up | `computer_stop` — close the pill and end the takeover (approval kept; `hard: true` is a real stop) |

Element ids look like `h=<hwnd>|r=<Role>|n=<Name>|i=<nth>|a=<autoId>`. They are resolved again on every
action, so a locator from a stale snapshot errors instead of hitting whatever moved under it. `a=` is the
control automation id and outranks the occurrence index, which drifts between a shallow snapshot and a deeper walk.

## How it shows up in DSH

- The plugin inventory shows **Computer Use** with a blue cursor icon (`locale/en.json`, `package.json.icon`).
- The slash menu shows `[hollow cursor] 电脑操作 computer · 批准或撤销电脑操作`. The label and glyph are
  decorated client-side: the Host command schema only accepts `name` / `description`, and icons plus localized
  labels live in a private client table, so a plugin cannot declare them.
- The settings card lives at Settings → Computer Use.

## Settings

This card writes the plugin entry Config (all fields hot-reloadable).

| Field | Default | What it does |
|---|---|---|
| `mode` | `manual` | `disabled` refuses everything; `readonly` allows observation only; `manual` needs `/computer`; `auto` lets the model act freely |
| `ai_can_change_mode` | `false` | Whether `computer_set_mode` may switch modes on its own |
| `screenshot_dir` | empty | Output directory for screenshots (empty = OS temp) |
| `default_scale` | `1` | Default screenshot downscale, 0.1–1 |
| `typing_interval_ms` | `0` | Delay between characters while typing |
| `scroll_units` | `1` | Wheel notches per `computer_scroll` (120 WHEEL delta each) |
| `output_guard` | `true` | Strips fake tool-call/XML text written as conversation; same text passes on the second output |
| `debug` | `false` | Logs the PowerShell script paths |
| `tool_mode` | `all` | `all` / `lite` / `custom` |
| `enabled_tools` | `[]` | Allow-list used with `custom` (empty = all) |
| `stop_hotkey` | `ctrl+alt+esc` | Key shown on the pill; the pill button always works |
| `takeover_minutes` | `30` | The pill auto-dismisses (and stops) after this long; `0` never auto-dismisses |
| `takeover_message` | empty | Pill title; `{key}` is replaced with the hotkey |
| `cdp_port` | `0` | Chromium `--remote-debugging-port` for `computer_browser` (`0` = off) |
| `approve_observe` | `false` | When on, screenshots / UIA snapshots / window lists also need `/computer` in `manual` |

### Output guard (`output_guard`)

It catches one specific failure: the model **writing a tool call as conversation text** (e.g. `computer_click({...})`
or `<invoke …>` in prose). The first occurrence is replaced by a coaching note that tells the model to make a real
tool call; the same text passes on its second occurrence, so it can never loop.

- **Scope: every streamed response.** It sits on the host's `llm/stream` waterfall (on hosts without that waterfall
  it falls back to wrapping each provider's `adapter.stream()`). It runs whether or not you called a computer tool
  in that turn.
- **Cost: one Config read per stream, not one per token.** Since 0.6.2 the live value comes straight off the plugin
  fiber's resolved Config (O(1)); only when the host does not expose it does the plugin consult the settings service,
  and then the result is reused for 500 ms. Streaming throughput is unaffected.
- **What you lose by turning it off:** fake tool-call text shows up in the answer verbatim and is never corrected.
  Nothing else changes — tools, permissions and the stop switch are untouched.

> Up to 0.6.1 the guard read the Config **per chunk**. On DSH 0.2.x that read is `SettingsForms.describe()`, which
> rebuilds every active profile entry's form, schema JSON and revision string on each call (measured: ~50 ms and
> ~1 MB of garbage at 238 entries). On the streaming hot path that is tens of milliseconds of synchronous blocking
> per token, which pinned streaming at 16–18 tok/s (issue #8) — worse with more plugins, gone when the plugin is
> disabled. 0.6.2 fixes that path.

## Safety model

- **Modes.** `disabled` / `readonly` / `manual` / `auto`. Observation tools stay available in `readonly`.
- **Session approval.** In `manual`, side-effecting tools refuse until the user types `/computer` in that
  session; typing it again revokes the approval.
- **Takeover pill and stop key.** Any side-effecting call raises the pill. The hotkey, the pill button, or a
  timeout writes a stop flag; every later call except `computer_doctor` then fails with an explicit "stopped"
  error that names the actual cause (timeout vs. hotkey). Typing `/computer` once clears the flag and resumes —
  an already approved session comes straight back, no revoke-then-approve dance. The pill is its own process,
  so the key lands even while the input backend is busy.
- **Observation gating (optional).** `approve_observe` extends the approval requirement to screenshots and
  UI snapshots, for setups where looking at the screen is itself sensitive. Off by default.
- **Stale rejection.** Locator resolution and the optional `expected_window` fence.

## How it works

```mermaid
flowchart LR
  A[Agent] -->|computer_* tools| B[computer-user host bundle]
  B -->|capture.ps1| C[PNG + foreground window]
  B -->|input.ps1| D[SendInput mouse / keyboard]
  B -->|observe.ps1| E[UI Automation tree, locators, windows]
  B -->|guard.ps1| F[Takeover pill + stop key]
  C --> G{see}
  G -->|vision| H[read_image]
  G -->|text-only| I[picturereader OCR]
```

The host half registers tools and reads its own Config entry; the browser half (`client.js`) renders the
settings card through `ctx.configForms` and the official settings-form vocabulary.

## Compatibility

| DSH | Status |
|---|---|
| 0.2.0-rc.1 … 0.2.2-alpha.2 | Supported; the version gate is `@deepseek-ai/dsh-settings >=0.1.0-rc.6 <0.3.0-0` |
| 0.1.0-rc.6 … 0.1.7-rc.2 | Supported through the 0.1.x namespaced settings scope |
| 0.3.0 and later | Out of range until verified against that kernel |

Windows 10/11 x64. The screenshots and UIA paths were verified on Windows PowerShell 5.1.

## Development

```sh
node --test                      # 78 tests: tools, gates, guard, settings card, entry shape
```

Layout: `src/index.js` (entry, commands, output guard), `src/tools.js` (tool surface and gates),
`src/ps.js` (PowerShell runner + guard state), `src/capture.ps1` / `src/input.ps1` / `src/observe.ps1` /
`src/guard.ps1`, `client.js` (settings card), `tests/`.

## License

[MIT](LICENSE)

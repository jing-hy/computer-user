# macOS 后端（实验性）

这个文件是 macOS 后端的契约与边界说明。Windows 后端仍是功能完整的那个；macOS 后端覆盖
「截图 + 鼠标键盘 + 窗口 + 等待 + 接管提示条」，**不覆盖**控件树与窗口几何操作 —— 那些会明确报错。

> 状态：0.6.0 起提供。所有实现都写了，但**没有在 Mac 真机上验证过**（开发机是 Windows）。
> 下面「真机验证清单」是拿到 Mac 后要逐条过的项目。

---

## 1. 后端契约

`src/backend.js` 是唯一的平台分叉点：

```js
selectBackend(platform = process.platform) // 'win32' | 'darwin' | 抛错
```

两个后端暴露**同一个表面**，`src/tools.js` 通过注入使用：

| 导出 | 说明 |
|---|---|
| `runPs(scriptName, payload, opts)` | `scriptName` 是**能力键**，不是文件名：`capture.ps1` / `input.ps1` / `observe.ps1` / `guard.ps1` |
| `ensureGuard(payload)` | 拉起接管提示条，返回布尔（是否已在运行） |
| `stopGuard({hard})` | 关掉提示条；`hard` 同时写停止标记 |
| `guardState() / isStopped() / requestStop() / stopReason() / clearStop()` | 共享的急停状态（`src/stop-flag.js`） |
| `scripts` | Windows 是四个 `.ps1` 文件名；macOS 全是 `null` |
| `capabilities`（仅 mac） | 能力表，供文档与 doctor 阅读 |

> 约定：`runPs` 成功时 resolve 一个对象（宿主校验「无损 JSON」，**不允许出现 `undefined` 字段**），
> 失败时 reject 一个带中文说明的 `Error`。macOS 后端的「不支持」也走 reject（`unsupported()`），
> 因此模型看到的是明确的错误文案，而不是空结果。

### payload → action 对照

| scriptName | action | macOS 实现 |
|---|---|---|
| `capture.ps1` | （整块） | `screencapture -x -t png` + `sips` 裁剪/缩放 + PNG IHDR 读尺寸 |
| `input.ps1` | `getpos` `move` `click` `drag` | `cliclick`（`p:.` / `m:` / `c:` `rc:` `dc:` / `kd: dd: dm: du: ku:`） |
| `input.ps1` | `scroll` | JXA：`CGEventCreateScrollWheelEvent` + `CGEventPost` |
| `input.ps1` | `type` `keypress` | AppleScript：`keystroke` / `key code` + `using {… down}` |
| `observe.ps1` | `probe` | `sw_vers` + 工具探测 + 临时目录可写 + `NSScreen.backingScaleFactor` |
| `observe.ps1` | `windows` `foreground` | JXA：`CGWindowListCopyWindowInfo`（`layer === 0` 且有尺寸的窗口） |
| `observe.ps1` | `window(kind=activate)` | JXA：`NSRunningApplication.activateWithOptions(1)` |
| `observe.ps1` | `wait` | Node 侧轮询（handle / titleContains） |
| `observe.ps1` | `snapshot` `act` `window(move\|close)` | **reject**：控件树/几何操作需 AX API |
| `guard.ps1` | — | 不走 `runPs`；由 `ensureGuard` 直接拉起 JXA 进程 |

### 坐标系（最容易翻车的地方）

- `screencapture` 输出的是**物理像素**，`cliclick` / CGEvent 吃的是**逻辑点**。
- 后端拿到 PNG 后除以 `backingScaleFactor`（1 或 2），再用 `sips --resampleWidth` 把图缩回点尺寸。
  于是「图上量到的像素坐标」就等于「点击用的点坐标」，模型不需要知道 Retina 存在。
- 区域截图返回的 `virtual_offset` 也是**点坐标**（=`像素 / dpr`）。
- v1 只截主屏，`virtual_offset` 恒为 `[0,0]`（多屏、负原点留给真机校准）。

---

## 2. 接管提示条（JXA + AppKit）

Windows 用 WPF + `RegisterHotKey`；macOS 用 `osascript -l JavaScript` 跑一段生成的 JXA：

- `NSPanel` + `NSWindowStyleMaskNonactivatingPanel`：浮窗不抢焦点；
- `NSFloatingWindowLevel` + `NSWindowCollectionBehaviorCanJoinAllSpaces`：置顶并跟随所有 Space/全屏应用；
- 文案两行（主提示 + 副提示），圆角深色背景；
- **点击提示条任意位置 = 停止**：轮询 `NSEvent.pressedMouseButtons` + `NSEvent.mouseLocation`，
  命中即写 `stop.flag reason=button`；
- `takeover_minutes` 到点写 `reason=timeout`（与 `guard.ps1` 完全一致，所以 `/computer` 恢复与错误文案复用）；
- 进程模型与 Windows 一致：独立进程 + `guard.pid` + `guard.lock` + `guard.spawn.json` 诊断；
- 拉起失败**不阻塞工具**（提示条是 nice-to-have），失败写 `%TMPDIR%/computer-user/guard.spawn.json`。

**没有全局键盘热键**：`CGEventTap`/`NSEvent` 的全局监听需要 C 函数指针或 block 回调，ObjC bridge
表达不了。停止方式在 macOS 上是：点提示条 / `/computer` 撤销批准 / `computer_stop {hard:true}`。
如果后续确认 JXA 能注册 block 型 monitor，再开启（`docs` 这里会更新）。

---

## 3. TCC 权限（必须用户手动授权）

| 权限 | 位置 | 缺了会怎样 |
|---|---|---|
| 屏幕录制 Screen Recording | 系统设置 → 隐私与安全性 → 屏幕录制 | `screencapture` 出不了画面（黑图/报错） |
| 辅助功能 Accessibility | … → 辅助功能 | 合成键鼠被丢弃；AppleScript 控制 System Events 被拒 |
| 输入监控 Input Monitoring | … → 输入监控 | 只有全局停止热键需要（当前默认关闭，可不授权） |

授权对象是**宿主应用**（DeepSeek Harness），不是 `osascript`。授权后需要重启 DSH。
`computer_doctor` 会报告 `screencapture` / `osascript` / `cliclick` 是否在 PATH 上，以及 `dpr_unverified`。

---

## 4. 真机验证清单（拿到 Mac 之后）

- [ ] `npm i -g computer-user` 后 `computer_doctor` 报 `backend: darwin`（`edition` 含 macOS 版本）
- [ ] 授权屏幕录制 → `computer_screenshot` 出图，且 `width` 等于屏幕「点」宽（不是像素宽）
- [ ] Retina 屏上按图像坐标点击，落点准确（DPR 折算正确）；`dpr_unverified: false`
- [ ] 没装 cliclick 时，点击类工具报 `brew install cliclick`，键盘/滚动仍可用
- [ ] 装了 cliclick 后：click / right_click / double_click / drag / getpos 全部正确
- [ ] 中文输入（`computer_type`）落到目标输入框
- [ ] `computer_keypress`：`["ctrl","a"]`、`["enter"]`、`["ctrl","shift","esc"]` 行为正确
- [ ] `computer_scroll` 方向与 Windows 语义一致（up/down 不反）
- [ ] `computer_list_windows` 的 handle 能被 `computer_activate_window` 使用
- [ ] 提示条：出现、置顶、不抢焦点、切 Space 后仍在、点一下即停止（`stop.flag reason=button`）
- [ ] 超时（`takeover_minutes` 调小到 1）→ 自动急停，错误文案说「超时」而不是「按了热键」
- [ ] 超时后 `/computer` 一次即恢复（0.5.10 的 `planCommandAction` 在 mac 上同样成立）
- [ ] `computer_snapshot` / `computer_invoke` / 窗口 move/close → 报 `docs/mac-backend.md`，不崩
- [ ] 多屏（负原点）行为确认；若不对，按下面「后续」补 `NSScreen.screens` 布局

---

## 5. 已知缺口与后续方向

| 缺口 | 原因 | 方向 |
|---|---|---|
| 控件树（AX） | `AXUIElement` 需要真机 + 辅助功能授权才能校准 | 用 Swift 小工具或 JXA 桥接 AX，把 `Role/Title/Value/AXPress` 映射到现有 locator |
| 窗口移动/关闭 | 依赖 AX | 同上（`AXPosition` / `AXClose`） |
| 全局停止热键 | `CGEventTap` 需要 C 回调 | 预编译 Swift 二进制，或验证 JXA 的 block 型 monitor |
| 多屏 / 负原点 | 未校准 | 读 `NSScreen.screens`，把每块屏的 `frame.origin` 拼成虚拟桌面，region 与 offset 按屏换算 |
| `cliclick` 依赖 | 指针注入没有零依赖方案（CGEvent 鼠标事件要 CGPoint 结构体） | 同上：Swift 二进制可去掉这个依赖 |

---

## 6. 单平台构建分支

- `main`：双平台主线，所有开发与发布都在这（npm 上仍是同一个包）。
- `windows-only` / `mac-only`：由 `scripts/crop-platform.mjs` 从 main 生成的**快照**：

```sh
node scripts/crop-platform.mjs --platform=win32  --out .crop/win32
node scripts/crop-platform.mjs --platform=darwin --out .crop/darwin
```

脚本只读源码、只写 `--out`，然后打印把这棵目录树变成分支的命令。裁剪内容：删掉另一平台的后端与测试、
`package.json` 的 `os` 收窄为单平台、README 顶部加「单平台构建 + 来源 commit」横幅、
写 `.platform-crop.json` 记录来源。main 每次发版后重跑脚本即可重建分支（不做 cherry-pick）。

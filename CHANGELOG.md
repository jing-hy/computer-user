# Changelog

## 0.5.9 (2026-10-29)

- 斜杠菜单图标改成**空心描边**（`fill:none` + `stroke:currentColor`，1.6 描边、圆角接头），
  与宿主 Regular 系图标一致；上一版是实心填充。
- 去掉图标与文字之间的外边距（`margin-right:6px` 删除），图标 16px，紧贴命令名。

## 0.5.8 (2026-10-29)

- **`/computer` 在斜杠菜单里显示中文名 + 图标**。宿主的命令注册只收 `name` / `description`，
  菜单里的图标与本地化标签来自客户端私有表（`hostFace` + `label.*` / `description.*` 字典），
  插件注入不进去 —— meow-memory 的做法是在客户端直接装饰渲染出来的那一行：`MutationObserver`
  盯 `[data-trigger-menu]`，按 `button[id^="dsh-slash-option-command-"]` 找到 `dream` 行，
  把文字换成中文、前面插一个 SVG。这里照同样思路做 `/computer`：显示名「电脑操作」、
  别名保留 `computer`、描述压成「批准或撤销电脑操作」、前面插光标图标。幂等，菜单每次重渲染
  都会重新装饰；宿主换 class 时最坏情况是回到原样，不会报错。
- 测试 78/78。

## 0.5.7 (2026-10-29)

- **提示条终于能显示**（此前「进程起来了但看不见窗口」，三个叠加的 bug）：
  1. `spawn(..., { detached: true })` 在 Windows 上映射为 `DETACHED_PROCESS`，该模式下的
     PowerShell 立刻退出（实测 3 秒内消失且无任何输出）→ 改为附着启动。
  2. tick 里用 `PeekMessage(PM_REMOVE)` 排空队列，把 WPF dispatcher 自己的消息（含它依赖的
     WM_TIMER）一起吞掉 → dispatcher 饥饿，窗口再也画不出来，timer 只跳一次。改为
     `HwndSource.AddHook` 接 `WM_HOTKEY`，热键照旧生效，队列不被动。
  3. `DispatcherTimer` 只存在局部变量里，ShowDialog 阻塞期间被回收 → 提升到脚本作用域。
  修复后：`MainWindowHandle` 从 0 变成真实值，`guard.desktop.log` 稳定每 1.5 秒一行，切虚拟
  桌面时 `onCurrent=False` → 重建窗口 → 新窗口 `onCurrent=True`（已实测跟随）。
- `computer_doctor` 返回值去掉 `undefined` 字段（宿主校验要求 lossless JSON，之前直接报错）。
- 提示条增加 `guard.debug.log`（start/window-built/timer-started/showdialog-*/tick 1-3），用于
  下次定位；`/computer` 命令描述缩短为「批准或撤销电脑操作」。
- 测试 78/78。

## 0.5.6 (2026-10-29)

- **新增 `computer_stop`**：关闭接管提示条并结束本次接管，**保留**当前批准；`hard: true` 才是
  急停（写停止标记）。关闭窗口属于安全动作，所以该工具不进入批准门禁。技能文档补了「收尾：
  不用了就关掉提示条」一节，明确模型在任务结束时应该主动调用。
- **提示条桌面跟随诊断**：每 1.5 秒把 `IsWindowOnCurrentVirtualDesktop` 的结果追加到
  `%TEMP%\computer-user\guard.desktop.log`，用于确认「切桌面不跟随」是检测失败还是重建失败。
- 测试 78/78。

## 0.5.5 (2026-10-29)

- **locator 更稳**：元素 id 现在同时带 automation id（`|a=<autoId>`），解析时优先按它匹配。
  之前只靠 role/name/nth，浅层快照与深层重新遍历之间 nth 会漂移，导致 `computer_focus` 报
  "target not found"（实测在 Windows 运行框的输入框上复现）。
- **提示条启动诊断**：`ensureGuard` 把 spawn 结果写到 `%TEMP%\computer-user\guard.spawn.json`
  （ok / pid / error），用于定位「宿主里调用了却没出现提示条」这类问题。
- 测试 76/76。

## 0.5.4 (2026-10-29)

- **插件清单展示对齐官方**：新增 `locale/zh.json` / `locale/en.json`（`meta.title` +
  `meta.description`），中文界面显示「电脑操作」与一句短描述，英文界面显示 Computer Use；
  `package.json` 增加 `icon: assets/icon.png`（蓝色圆角 + 光标，1.9 KB）并在 `exports` 导出
  `./locale/*`，宿主 `readPluginMeta` 才能读到。package description 也从长句改为一行。
- **提示条启动锁**：WPF 加载需要 1–3 秒，连续两次副作用调用会各起一个提示条（能看到旧文案的
  残影）。`ensureGuard` 现在写 `guard.lock`，5 秒内的第二次调用直接复用，guard 退出时清掉锁。
- 测试 76/76。

## 0.5.3 (2026-10-29)

- **修复：切换虚拟桌面后提示条消失**。普通窗口只属于创建它的那个桌面，现在每 1.5 秒用公开接口
  `IVirtualDesktopManager::IsWindowOnCurrentVirtualDesktop` 检查一次；不在当前桌面就把提示条重建到
  当前桌面（热键随之重新注册），所以切桌面后仍然看得见。
- **提示条周期性重申 topmost**（`SetWindowPos` + `HWND_TOPMOST`），避免被另一个同级置顶窗口盖住。
- 明确：**只有副作用调用才拉起提示条**；`computer_screenshot` / `computer_snapshot` /
  `computer_list_windows` / `computer_get_cursor_position` / `computer_wait` / `computer_doctor` /
  `computer_browser` 这些只读工具不会弹窗（已有测试覆盖）。

## 0.5.2 (2026-10-29)

- **提示条改用 WPF**：ClearType 矢量文字（不再有 WinForms 位图模糊）、真正的圆角与投影、
  标题 + 副标题两行；提示文案改为「DSH 正在操控你的电脑 / 请勿操作鼠标 · 按 Ctrl+Alt+Esc 停止」。
- **新增 `approve_observe`**：默认关闭；开启后手动批准模式下连 `computer_screenshot` /
  `computer_snapshot` / 窗口列表也要先 `/computer`（适合「看一眼屏幕本身也敏感」的场景）。
- **README 中英双语重写**：徽章、提示条截图、工具/设置表、安全模型、mermaid 架构图、兼容矩阵；
  `assets/takeover-pill.png` 随包发布，图片用 raw URL 以同时适配 GitHub 与 npm。
- 测试 76/76。

## 0.5.1 (2026-10-29)

- **浏览器只读通道**：新增 `computer_browser` —— 配置 `cdp_port` 后通过 loopback 的
  `/json/list` 列出 Chromium 页面（id / title / url / websocket），用于决定走 CDP 还是像素；
  端口未配置或不可达时返回空列表与说明。只读，不建立长连接。
- 设置页新增「浏览器调试端口（CDP）」。
- 测试 74/74。

## 0.5.0 (2026-10-29)

- **有视觉就能用**：`computer_screenshot` 返回 PNG 路径 + 前台窗口；模型直接
  `read_image(path)` 看图，picturereader 从「必需」降为「可选」（仅文本模型要精确文字时才用）。
- **UIA 结构化观测**：新增 `computer_snapshot`（控件树 + 可重放 locator）与
  `computer_invoke` / `computer_set_value` / `computer_focus` —— 不移动鼠标、不抢前台，
  元素 id 形如 `h=<hwnd>|r=<Role>|n=<Name>|i=<nth>`，每次动作重新解析。
- **窗口工具**：`computer_list_windows` / `computer_activate_window` / `computer_move_window` /
  `computer_close_window`。
- **急停**：副作用调用自动弹出屏幕上方居中的蓝色圆角提示条（「DSH 正在操控你的电脑 · 按
  Ctrl+Alt+Esc 停止」）；热键（可配置）或点 Stop 写停止标记，此后所有 `computer_*` 拒绝执行直到
  重新批准。提示条是独立进程，后端忙时热键仍然有效。
- **过期状态拒绝**：`computer_screenshot` 可传 `expected_window` 做前台窗口围栏；locator 每次
  动作重新解析，失效直接报错而不是点到别处。
- **等待条件**：`computer_wait` 支持 `window` / `target` / `title_contains` + `timeout_ms`。
- **工具分档**：`tool_mode=all|lite|custom` + `enabled_tools` 白名单（默认 all=19 个，lite=9 个）。
- **doctor**：`computer_doctor` 自检 PowerShell / UIA / 临时目录 / 停止状态 / 当前模式。
- **设置页**：新增工具分档、白名单、急停热键、提示条自动收起时长与文案。
- 测试 72/72（新增 13 条：UIA 快照 id 压缩、控件动作、急停短路、提示条启动、截图围栏、条件等待、分档、doctor）。

## 0.4.1 (2026-10-29)

- **版本门禁覆盖全部 0.2.x**：peerDependencies 的 @deepseek-ai/dsh-settings 由逐个列出
  预发布版本改为 `>=0.1.0-rc.6 <0.3.0-0`。这样 0.2.0-rc.1 / 0.2.0-rc.2 /
  0.2.1-alpha.1..5 / 0.2.1-rc.1..4 / 0.2.2-alpha.2 全部通过宿主版本门禁；0.3.0 及其
  预发布仍在范围外。用 semver includePrerelease 实测全部 16 个已发布 0.2.x 版本为 true，
  0.3.0 / 0.3.0-rc.1 / 0.3.0-alpha.1 为 false。
- **不兼容复核（0.2.0-rc.1 ↔ 0.2.2-alpha.2）**：SettingsForms（describe / update /
  replace / mutate / configure）、configForms（get / whileServed / form 的 getSnapshot /
  subscribe / set / unset / mutate / dispose）与 llm/stream waterfall 在 0.2.x 全段存在且
  签名一致（0.2.0-rc.1 的 ConfigForm 构造函数多一个 persistence 参数、mirror 状态多一个
  unavailable，都不影响本插件）。唯一的实际不兼容就是门禁范围本身。
- **设置页 UI 对齐官方设置表单**：改用 @deepseek-ai/dsh-client-ui-primitives 的
  settings-form 设计语言 —— 无卡片边框、字段间 0.5px 分隔线、13px/500 标签、34px 输入框
  （--dsw-radius-md + bg-layer-3）、12px 三级提示、字段级「已覆盖」徽标 + 文字「恢复默认」、
  底部一个实心保存按钮。移除折叠「高级设置」、胶囊按钮与卡片组。
- **交互对齐官方**：草稿只在保存时通过 form.mutate(ops, revision) 原子写入；保存失败保留
  草稿；清空文本/数字 = unset（回落到组合层默认值）；数字非法阻断保存；只读部署显示只读
  提示。0.1.x 的 settingsScope 仍作为回退（逐个 set/unset）。
- 新增 tests/settings-form-ui.test.js：静态锁定官方表单语言（不再出现卡片/胶囊/details、
  使用官方 token 与 mutate 路径、覆盖徽标与恢复默认按钮存在）。
- **修复：设置页显示「未由宿主服务」且插件清单不出现**：cordis loader 的 unwrapExports
  是 `exports.default ?? exports`，而入口原来只在命名导出里提供 Config；
  `entry.fiber.runtime.Config` 因此为 undefined，`settings.describe()` 按「schema 缺失」
  跳过该 entry（工具仍注册，因为 apply 挂在 default 上）。现在 default 导出也带 Config，
  并新增 tests/plugin-entry.test.js 锁定这一形状。

## 0.4.0 (2026-10-28)

适配 DSH 内核 **0.2.x**（`@deepseek-ai/dsh-settings` 0.2 / `@deepseek-ai/dsh-llm` 0.2）：

- **设置改用插件自身的 Config 表单**：0.2 移除了带命名空间的 settings scope
  （`settings.register(ns, schema)` → `get/update/watch`），改为按 profile 条目 id
  的 `SettingsForms`（`describe` / `update` / `mutate`）。插件现在导出
  `Config`（`src/config.js`），所有字段用 `.volatile()` 声明为可热改；运行时通过
  `settings.describe()` 读取当前值，`computer_set_mode` 走
  `settings.update('computer-user', { mode })`。0.1.x 的 scope 路径按能力检测保留。
- **设置页不再被自动生成页顶掉**：插件自带卡片，`apply()` 里调用
  `settings.configure({ auto: false }, ctx.fiber)` 关掉自动生成页。
- **输出过滤器改用 `llm/stream` waterfall**：0.2 的 `LlmRuntime` 不再暴露可变的
  provider 注册对象（`registration(provider).adapter`），改为在 `ctx.on('llm/stream')`
  上包一层异步生成器，逐块过滤 `text-delta`；0.1.x 的 provider 代理作为兜底保留。
- **Web 设置卡片改走 `ctx.configForms`**：`ctx.settingsScope` 在 0.2 已不存在。
  卡片用 `configForms.get('computer-user')` 取共享 form（`getSnapshot` /
  `subscribe` / `set` / `unset` / `mutate`，以及 `writable`、`revision`），首次
  挂载用 `configForms.describe().ensure()` 触发一次 mirror 读取；共享 form 由
  provider 持有，卸载时只退订不再 `dispose`。
- **工具注册返回清理函数**：`ctx.tools.register` 的 disposer 现在由 `ctx.effect`
  统一释放（重载/卸载不再残留工具行）。
- **依赖声明**：`peerDependencies` 增加 `@deepseek-ai/dsh-settings`
  `^0.2.1-rc.3 || ^0.2.2-alpha.2`（semver 的 `^0.1.x` 不会匹配 0.2.x，缺了会被宿主
  版本门禁判为不兼容），`@deepseek-ai/schemastery` 放宽为 `>=3.18.1 <4`
  （0.2.1-rc.3 用 3.18.5，0.2.2-alpha.2 用 3.18.6-alpha.1）。

## 0.3.7 (2026-10-01)

修复 DSH 内核 0.1.3 下「更新后无法启动」([#1](https://github.com/jing-hy/computer-user/issues/1))：

- **启动崩溃**：`@deepseek-ai/dsh-settings` 0.1.3 起只导出
  `SettingsConflictError` / `SettingsProvider` / `redactSecrets` —— `settingsNamespace`
  与 `installSettingsSection` 被移除。插件入口原来的
  `import { settingsNamespace } from '@deepseek-ai/dsh-settings'` 会让整个模块图抛
  `does not provide an export named 'settingsNamespace'`，插件完全无法加载。
  现在改走内嵌垫片 `src/settings-compat.js`（`settingsNamespace` = 恒等 + kebab-case
  校验；`installSettingsSection` = 转发 `provider.installSection`），插件的 ESM 图
  不再依赖该包的导出，0.1.0-rc.6 ~ 0.1.3-alpha.x 全系可加载。
- **模式写回**：0.1.3 的 owner scope 只有 `get` / `watch` / `update` / `replace`，
  `scope.set` 已移除；`computer_set_mode` 改用 `scope.update({ [key]: value })`。
- **手动批准模式**：授权判定从单个 `sessionId` 改为会话标识集合（`agent.id` +
  `session.header.sessionId` + `exec.sessionId`），修复部分宿主下 `/computer`
  批准后工具仍报「需要批准」的问题。
- **健壮性**：settings 注册失败（服务缺失或内核 API 变更）时降级为静态配置并记
  warning，不再中断同一 `apply()` 里后续的 `/computer` 命令与输出过滤器接线。
- **依赖声明**：`peerDependencies` 的 `@deepseek-ai/dsh-settings` 范围补齐 prerelease
  版本（semver 不会用 `^0.1.0-rc.6` 匹配 `0.1.3-alpha.x`，缺了会被宿主版本门禁
  判为不兼容而跳过加载）。
- 新增回归测试 `tests/settings-compat.test.js`（垫片行为、入口不再 import 被移除的
  导出、0.1.3 scope 写回、settings 失败不中断接线）。

## 0.1.0 (2026-08-21)

- Initial release: `computer_screenshot` + `computer_click` / `computer_type` /
  `computer_keypress` / `computer_scroll` / `computer_drag` / `computer_move_mouse` /
  `computer_wait` / `computer_get_cursor_position`.
- PowerShell + Win32 SendInput backend (Windows only, zero native deps).
- Settings card with up-front **Enabled** / **Ask-before-acting** switches and a
  default-collapsed Advanced section.
- Works with picturereader to close the look → act → verify loop.
- Node:test unit suite; safe-window smoke scripts; headless integration verified.

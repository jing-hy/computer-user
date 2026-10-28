# Changelog

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

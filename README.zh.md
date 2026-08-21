# computer-user

给 DeepSeek Harness（DSH，含 EAC 桌面客户端）的 **Codex 式电脑操作**插件：读屏幕并操作
鼠标键盘 —— 截图 → 用 [picturereader] 分析 → click/type/keypress/scroll/drag → 验证。
**仅支持 Windows。**

- `computer_screenshot` 把整个虚拟屏（多显示器、DPI 感知）截成 PNG 文件并返回路径 ——
  直接喂给 picturereader 的 `image_scan` / `image_ocr`，让任何纯文本模型都能"看"屏幕。
- 另外 8 个 `computer_*` 工具，通过内置 PowerShell + Win32 `SendInput` 操作鼠标键盘
  （零原生模块、无需编译，可在 DSH/EAC 宿主进程内运行）。
- 设置卡（「电脑操作」）把两个关键开关放在最显眼处 —— **是否开启** 与 **是否要请示**，
  其余收进默认折叠的 **高级设置**。
- 已验证兼容 **DeepSeek Harness EAC** 桌面端（与 Web 同一 DSH 宿主内核）。

> English: [README.md](README.md)。

## 工具

| 工具 | 作用 |
|---|---|
| `computer_screenshot` | 保存整虚拟屏 PNG（可选 region/scale）→ `{path,width,height,virtual_offset,scale}` |
| `computer_click` | 在 `[x,y]` 点击（click / right_click / double_click） |
| `computer_type` | 输入任意 UTF-16 文本（含中文），走 `SendInput` Unicode |
| `computer_keypress` | 组合键，如 `["ctrl","c"]`、`["alt","tab"]`；字母/数字走虚拟键以触发快捷键 |
| `computer_scroll` | 在 `[x,y]` 滚轮：up / down / left / right，`clicks` 格 |
| `computer_drag` | 按下 → 分步移动 → 释放，可选 `hold_keys` |
| `computer_move_mouse` | 移动光标但不点击 |
| `computer_wait` | 等待 `ms`（让 UI 稳定） |
| `computer_get_cursor_position` | 读取当前光标位置 `[x,y]` |

坐标为「相对**虚拟屏原点**（所有显示器合并区域左上角）」的像素；`computer_screenshot`
返回的 `virtual_offset` 即该原点。`SetProcessDPIAware` 保证高分屏缩放下坐标与物理像素一致。

## 安装

```bash
npm install computer-user
```

或在 DSH profile 里：

```bash
dsh plugin --profile web add computer-user
```

然后重启 DSH（或到 EAC「设置 → 插件 → 管理」启用）。工具对所有会话生效；设置卡在「设置 →
电脑操作」。

### 搭配 picturereader（推荐闭环）

```text
computer_screenshot → path
picturereader image_scan / image_ocr <path>   # 看
computer_click / type / ...                   # 做
computer_screenshot → image_compare           # 验证
```

## 设置卡

- **是否开启**：总开关；关闭后所有 `computer_*` 工具一律拒绝。
- **是否要请示**：开启后，有副作用的操作（点击/输入/按键/滚动/拖拽/移动鼠标）须在调用里
  显式传 `confirm: true` 才放行；截图/读光标/等待不受限。
- **高级设置**（默认折叠）：截图输出目录、默认缩放、逐字输入间隔、滚动刻度、调试日志。

## 安全

- 动手前务必 `computer_screenshot` 并用 picturereader 分析，不要盲点盲输。
- 只操作与任务相关的窗口；**不要操作 DSH/EAC 客户端自身窗口**。
- 结合 `confirm: true` 语义与设置卡，让操作先请示再执行。
- 若注入输入被静默丢弃，请检查安全软件（部分杀软会过滤模拟输入）。

## 验证与已知限制

- `node --test` 单测 16/16 通过（工具注册、门禁、参数校验）。
- 实机安全窗口冒烟（一次性窗口 + cmd.exe，绝不碰用户应用）：截图 PNG 正确；光标读/移
  往返精确；`hello 中文 123!` 逐字回读一致；keypress Home/End 导航+插入验证
  （`HEADzzzTAIL`）；双击选词、单击取消、拖拽选区均通过控件状态断言。
- headless 集成：`dsh --profile headless` 真实会话中，模型成功调用 `computer_screenshot`
  与 `computer_get_cursor_position`。
- 滚轮**端到端验证通过**：滚动条位置变化 + MouseWheel 事件触发均正常。注意：鼠标若落在
  搜狗输入法等置顶悬浮窗上，滚轮事件会被悬浮窗吸收——把光标移到空白处再滚（与任何基于
  光标的输入同理）。
- EAC 兼容：与 picturereader 在同一宿主内并存加载；对全部内置插件静态扫描，
  `computer_*` 工具名 / `computer-user` 命名空间零冲突。

## 开发

```text
src/capture.ps1     DPI 感知多屏截图（System.Drawing）
src/input.ps1       SendInput 鼠标键盘后端
src/ps.js           PowerShell 运行器（base64 JSON、超时、取消）
src/tools.js       9 个 computer_* 工具定义 + enabled/confirm 门禁
src/config.js       设置命名空间 schema
src/index.js        插件入口（注册工具 + 设置热载）
client.js           Web 设置卡（ModuleLoader bundle，中英）
scripts/           实机冒烟脚本（安全窗口）
tests/             node:test 单测
```

## 许可

MIT

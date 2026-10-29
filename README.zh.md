# computer-user

给 DeepSeek Harness（DSH，含 EAC 桌面客户端）的 **Codex 式电脑操作**插件：读屏幕并操作
鼠标键盘 —— 截图 → 用 [picturereader] 分析 → click/type/keypress/scroll/drag → 验证。
**仅支持 Windows。**

- `computer_screenshot` 把整个虚拟屏（多显示器、DPI 感知）截成 PNG 文件并返回路径 ——
  直接喂给 picturereader 的 `image_scan` / `image_ocr`，让任何纯文本模型都能"看"屏幕。
- 另外 8 个 `computer_*` 工具，通过内置 PowerShell + Win32 `SendInput` 操作鼠标键盘
  （零原生模块、无需编译，可在 DSH/EAC 宿主进程内运行）。
- 设置卡（「电脑操作」）顶部是**模式下拉框** —— 禁用 / 只读 / 手动批准（`/computer`）/
  自动，其余收进默认折叠的 **高级设置**。
- **全程纯本地、不调用外部 API**：截图（PowerShell）、分析（picturereader 本地
  scan/OCR）、操作（Win32 SendInput），数据不出本机。操作流程见
  [skills/computer-use.md](skills/computer-use.md)（先定位目标窗口，再窗口内分块
  OCR，确认后一击即中并截图验证）。
- 已验证兼容 **DeepSeek Harness EAC** 桌面端（与 Web 同一 DSH 宿主内核）。

> English: [README.md](README.md)。

## 视觉：原生优先，picturereader 可选

插件不强制任何视觉插件。`computer_screenshot` 返回 PNG 路径 + 前台窗口，之后怎么"看"由模型决定：

- **有原生视觉的模型**（现在多数）：截图 → `read_image(path)` 看图 → 操作。不需要额外插件，也不用 OCR。
- **纯文本模型**：装 [picturereader](https://github.com/jing-hy/picturereader)，对同一张 PNG 跑
  `image_scan` / `image_ocr`。这条路仍然可用，只是不再是必需。
- **完全不用视觉**：`computer_snapshot` 返回 UI Automation 控件树和可重放的元素 id，
  `computer_invoke` / `computer_set_value` / `computer_focus` 直接按控件名操作，不看像素、不动鼠标。

闭环没变（看 → 操作 → 验证）；"看"这一步对有视觉的模型是 `read_image`，对纯文本模型是 `image_ocr`。
详见 [skills/computer-use.md](skills/computer-use.md)。

## 工具

共 19 个；`tool_mode` 可收敛到 9 个常用工具（见设置卡）。

| 分组 | 工具 |
|---|---|
| 看 | `computer_screenshot`（PNG + 前台窗口）、`computer_snapshot`（UIA 控件树 + locator）、`computer_list_windows`、`computer_get_cursor_position` |
| 指针与键盘 | `computer_click`、`computer_type`、`computer_keypress`、`computer_scroll`、`computer_drag`、`computer_move_mouse` |
| 控件（不动鼠标） | `computer_invoke`、`computer_set_value`、`computer_focus` |
| 窗口 | `computer_activate_window`、`computer_move_window`、`computer_close_window` |
| 等待 | `computer_wait` —— 固定等待，或等到窗口 / 元素 / 标题出现 |
| 运行时 | `computer_doctor`（自检）、`computer_set_mode` |

坐标仍是相对虚拟屏原点的像素（`virtual_offset`）。UIA locator 形如
`h=<hwnd>|r=<Role>|n=<Name>|i=<nth>`，每次动作都重新解析 —— 界面变了会直接报错，不会点到别处。
`computer_screenshot` 可传 `expected_window` 做同样的前台窗口围栏。

### 急停提示条

任何副作用调用都会在屏幕上方居中弹出蓝色圆角提示条：「DSH 正在操控你的电脑 · 按 Ctrl+Alt+Esc 停止」。
热键（可配置）或点 Stop 都会写停止标记，之后所有 `computer_*` 拒绝执行，直到重新批准。
提示条是独立进程，输入后端忙时热键依然有效。

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

兼容 DSH 0.2.x（`@deepseek-ai/dsh-settings` / `@deepseek-ai/dsh-llm` 0.2）与 0.1.x：
0.2 的 `configForms` / `SettingsForms` 设置表单与 `llm/stream` 瀑布优先使用，0.1.x 的
命名空间 settings scope 与 provider 注册保留为兜底。

### 搭配 picturereader（推荐闭环）

```text
computer_screenshot → path
picturereader image_scan / image_ocr <path>   # 看
computer_click / type / ...                   # 做
computer_screenshot → image_compare           # 验证
```

## 设置卡

设置卡（「电脑操作」）采用 DSH settings-panel 设计语言：卡片分组 + 胶囊按钮 + 32px
输入框 + chevron 下拉 + 折叠箭头；`scope.load()` 兼容无 load 宿主（EAC 桌面壳）。

- **模式下拉框**（卡片顶部）：
  - `disabled` 禁用 —— 所有 `computer_*` 工具一律拒绝。
  - `readonly` 只读 —— 仅截图 / 读光标 / 等待可用。
  - `manual` 手动批准 —— 有副作用工具需先在本会话输入 `/computer` 批准（一次批准，
    后续轮次持续有效）。
  - `auto` 自动 —— LLM 自由调用所有工具。
- **「AI 可自行修改运行模式」开关**（下拉框下方，不在高级设置里）：默认关闭；开启后
  AI 可用 `computer_set_mode` 切换模式，写入同一设置命名空间，**设置卡下拉框双向同步**。
- **高级设置**（默认折叠）：截图输出目录、默认缩放、逐字输入间隔、滚动刻度、
  **代码输出打回（output guard，默认开）**、调试日志。

**代码输出打回**：host 侧对 LLM 输出流的过滤器——若模型把伪工具调用/伪 XML 当**对话
文本**输出（比如把 `computer_click({…})`、`<invoke …>` 直接打成了字而不是真正调用），
该段会被剔除并替换为一句一次性提示；**同一内容第二次原样输出时放行不拦截**。需要故意
在回复里展示代码片段时可到高级设置关掉。

## 安全

- **先定位目标窗口**（DPI 感知 GetWindowRect，见 skills/computer-use.md）——
  桌面图标/壁纸会同时干扰 OCR 与点击；只在目标窗口内工作。
- 动手前务必 `computer_screenshot` 并用 picturereader 分析，不要盲点盲输。
- 确认坐标后一击即中，点完截图验证，不要盲目连点（很多 UI 是点击开关）。
- 手动批准模式配合 `/computer` 命令，让人在环。

## 验证与已知限制

- `node --test` 单测 39/39 通过（工具注册、门禁、参数校验、output guard）。
- 实机安全窗口冒烟（一次性窗口 + cmd.exe，绝不碰用户应用）：截图 PNG 正确；光标读/移
  往返精确；`hello 中文 123!` 逐字回读一致；keypress Home/End 导航+插入验证
  （`HEADzzzTAIL`）；双击选词、单击取消、拖拽选区均通过控件状态断言。
- headless 集成：`dsh --profile headless` 真实会话中，模型成功调用 `computer_screenshot`
  与 `computer_get_cursor_position`。
- headless 真实场景：模型在 `dsh --profile headless` 中自主完成 5 步任务
  （screenshot → image_scan → type "hello" → screenshot → image_ocr），协调 picturereader
  与 computer-user 工具，OCR 确认输入文字出现在屏幕上。
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

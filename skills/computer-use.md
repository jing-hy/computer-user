# Computer Use（电脑操作）—— 读屏 + 操作鼠标键盘

computer-user 插件提供 9 个 `computer_*` 工具，让你像操作自己的电脑一样操作本机
Windows 桌面：先看屏幕，再点击/输入/按键/滚动/拖拽，再截图验证。与 picturereader
配合构成「看 → 想 → 做 → 验」闭环。

## 标准闭环（每做一步都按这个顺序）
1. **看**：`computer_screenshot` 截全屏 → 得到 `{ path, width, height, virtual_offset:[vx,vy] }`。
2. **分析**：用 picturereader 的 `image_scan` / `image_ocr` 读 `path`（坐标/色块/文字）。
3. **做**：根据分析结果调用 `computer_click` / `computer_type` / `computer_keypress` /
   `computer_scroll` / `computer_drag` / `computer_move_mouse`。
4. **验**：再 `computer_screenshot`，必要时 `image_compare` 对比前后，确认达到预期。
5. 需要等动画/加载时用 `computer_wait`；想知道当前鼠标位置用 `computer_get_cursor_position`。

## 坐标系
- 坐标为「相对多屏**虚拟屏原点**的像素」，不是屏幕本地坐标。原点 = 最近一次
  `computer_screenshot` 返回的 `virtual_offset:[vx,vy]`。
- 也就是说：若要点击某副屏/某位置，用 `computer_screenshot` 里的坐标语义，
  操作工具的 `coordinate`/`start_coordinate`/`end_coordinate` 都填**虚拟屏坐标**。
- 已做 DPI 感知，高分屏缩放下坐标与物理像素一致，不会偏移。

## 请示范例（重要）
设置里「是否要请示」开启时，**有副作用**的操作（点击/输入/按键/滚动/拖拽/移动鼠标）
必须显式传 `confirm: true` 才放行。截图/读光标/等待不受限制。
```
computer_click({ coordinate: [970, 540], confirm: true })
computer_type({ text: "hello 世界", confirm: true })
computer_keypress({ keys: ["ctrl", "a"], confirm: true })
```
若设置里「是否开启」关闭，则所有 `computer_*` 工具一律拒绝（提示去设置开启）。

## 安全规范
- 动手前**务必先截图 + image_ocr 确认目标**，不要盲点盲输。
- 集中精力只操作任务相关的窗口；不要点击与任务无关的系统/应用（尤其不要操作
  DSH/EAC 客户端自身窗口，以免干扰会话）。
- 输入含中文等任意文本都可靠（SendInput Unicode）。需要按住修饰键拖拽时用
  `computer_drag` 的 `hold_keys`。
- 每步小操作后 `computer_wait`（例如 300–800ms）让 UI 响应，再接着做。

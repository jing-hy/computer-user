import z from '@deepseek-ai/schemastery';

/** Settings namespace for this plugin (the profile entry id of its bundle row). */
export const NS = 'computer-user';

/**
 * Mark one field hot-reloadable. DSH 0.2.x only offers `.volatile()` fields in
 * the settings form (`SettingsForms` refuses entries without them), so every
 * field here is volatile; older schemastery releases without the method keep
 * the plain schema.
 * @template T
 * @param {T} schema
 * @returns {T}
 */
const live = (schema) => (typeof schema?.volatile === 'function' ? schema.volatile() : schema);

/** Runtime settings schema (schemastery). Top fields are the "just-opened" card; the rest go to Advanced. */
export const Config = z.object({
  mode: live(z
    .union([z.const('disabled'), z.const('readonly'), z.const('manual'), z.const('auto')])
    .default('manual')
    .description('运行模式：禁用=全部拒绝 | 只读=仅截图/读光标/等待 | 手动批准=需 /computer 批准后可用 | 自动=LLM自由调用')),
  ai_can_change_mode: live(z
    .boolean()
    .default(false)
    .description('AI 是否可自行修改运行模式（computer_set_mode 工具是否可用），默认不可。AI 修改后同步更新设置下拉框')),
  screenshot_dir: live(z
    .string()
    .default('')
    .description('截图输出目录（空 = 系统临时目录）')),
  default_scale: live(z
    .number()
    .default(1)
    .description('截图默认缩放 0.1..1（1=原分辨率整屏）')),
  typing_interval_ms: live(z
    .number()
    .default(0)
    .description('逐字输入间隔（毫秒），越大越稳但越慢')),
  scroll_units: live(z
    .number()
    .default(1)
    .description('滚动刻度：一次 scroll 滚动多少格（每格 120 WHEEL delta）')),
  output_guard: live(z
    .boolean()
    .default(true)
    .description('LLM 输出过滤器：把工具调用/伪XML写成对话文本时打回并提示，第二次同内容放行')),
  debug: live(z
    .boolean()
    .default(false)
    .description('调试日志')),
  tool_mode: live(z
    .union([z.const('all'), z.const('lite'), z.const('custom')])
    .default('all')
    .description('工具分档：all=全部 | lite=常用工具 | custom=按白名单')),
  enabled_tools: live(z
    .array(z.string())
    .default([])
    .description('custom 白名单：允许注册的工具名（空=全部）')),
  stop_hotkey: live(z
    .string()
    .default('ctrl+alt+esc')
    .description('急停热键（接管提示条上显示）')),
  takeover_minutes: live(z
    .number()
    .default(30)
    .description('接管提示条自动收起的分钟数（0=不自动收起）')),
  takeover_message: live(z
    .string()
    .default('')
    .description('接管提示条文案（空=默认）')),
  cdp_port: live(z
    .number()
    .default(0)
    .description('Chromium 调试端口（0=关闭；computer_browser 用它列标签页）')),
});

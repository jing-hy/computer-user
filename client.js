/**
 * computer-user — Web settings card (client half).
 *
 * Registers a 「电脑操作 / Computer Use」 section in the DSH Web settings page.
 * Visual language mirrors the official settings form shipped by
 * @deepseek-ai/dsh-client-ui-primitives (settings-form.css): a flat field list
 * separated by hairline rules, 13px/500 labels, 34px inputs on layer-3 with an
 * --dsw-radius-md radius, 12px tertiary hints, a per-field "overridden" badge
 * plus a text reset, and one filled save button in the footer. No card chrome,
 * no capsule buttons, no disclosure.
 *
 * Interaction follows the same contract: edits are staged locally and only a
 * save writes; a failed save keeps the drafts; clearing a field stages an unset
 * so it re-inherits the composition layer.
 *
 * Hand-written ModuleLoader bundle — no build step (same shape as picturereader).
 * 0.2.x: settings transport is ctx.configForms over the plugin entry id
 * (mutate / set / unset; snapshot value / base / user / revision).
 * 0.1.x: the namespaced ctx.settingsScope still works as a fallback.
 */
window.__ModuleLoader__.load({
  id: "computer-user",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var react = require("react");
    var h = react.createElement;

    var CSS = [
      ".__cu_form{display:flex;flex-direction:column}",
      ".__cu_notice{margin:0 0 12px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}",
      ".__cu_field{display:flex;flex-direction:column;gap:6px;padding:12px 0}",
      ".__cu_field+.__cu_field{border-top:.5px solid var(--dsw-alias-border-l2)}",
      ".__cu_head{display:flex;align-items:center;gap:8px}",
      ".__cu_label{flex:1;min-width:0;font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}",
      ".__cu_badges{display:inline-flex;align-items:center;gap:8px}",
      ".__cu_badge{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}",
      ".__cu_reset{border:none;background:none;padding:0;font:inherit;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);cursor:pointer}",
      ".__cu_reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}",
      ".__cu_reset:disabled{cursor:default}",
      ".__cu_input{box-sizing:border-box;width:100%;height:34px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)}",
      ".__cu_input::placeholder{color:var(--dsw-alias-label-tertiary)}",
      ".__cu_input:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}",
      ".__cu_input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}",
      ".__cu_input[aria-invalid=true]{border-color:var(--dsw-alias-state-error-primary)}",
      "select.__cu_input{appearance:none;padding-right:34px;cursor:pointer;background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%2381858C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\");background-repeat:no-repeat;background-position:right 12px center;background-size:12px 12px}",
      "select.__cu_input:disabled{cursor:default}",
      ".__cu_check{flex:none;width:16px;height:16px;margin:0;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer}",
      ".__cu_check:disabled{cursor:default}",
      ".__cu_hint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}",
      ".__cu_invalid{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-state-error-primary)}",
      ".__cu_footer{display:flex;align-items:center;gap:8px;padding-top:16px}",
      ".__cu_failed{flex:1;min-width:0;margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-error)}",
      ".__cu_save{appearance:none;border:1px solid transparent;border-radius:var(--dsw-radius-md);padding:5px 14px;font:inherit;font-size:13px;line-height:1.5;cursor:pointer;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}",
      ".__cu_save:disabled{opacity:.4;cursor:default}",
      ".__cu_save:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}",
    ].join("");
    var tagId = "computer-user/main.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"" + tagId + "\"]") === null) {
      var tag = document.createElement("style");
      tag.dataset.plugin = "computer-user";
      tag.dataset.pluginCss = tagId;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    var NS = "computer-user";
    var inject = ["slots", "locale"];

    var TOOL_MODE_OPTS = [
      { value: "all", labelKey: "toolModeAll" },
      { value: "lite", labelKey: "toolModeLite" },
      { value: "custom", labelKey: "toolModeCustom" },
    ];

    var MODE_OPTS = [
      { value: "disabled", labelKey: "modeDisabled" },
      { value: "readonly", labelKey: "modeReadonly" },
      { value: "manual", labelKey: "modeManual" },
      { value: "auto", labelKey: "modeAuto" },
    ];

    var zh = {
      nav: "电脑操作",
      intro: "让 DSH 读屏幕并操作鼠标键盘（Codex computer-use 风格）。截图结果配合 picturereader 的 image_scan / image_ocr 使用。",
      mode: "运行模式",
      modeDisabled: "禁用",
      modeReadonly: "只读",
      modeManual: "手动批准",
      modeAuto: "自动",
      modeHint: "禁用=全部拒绝 | 只读=仅截图/读光标/等待 | 手动批准=需 /computer 命令批准后可用 | 自动=LLM自由调用所有工具",
      aiCanChangeMode: "AI 可自行修改运行模式",
      aiCanChangeModeHint: "开启后 AI 可通过 computer_set_mode 工具自行切换模式（默认关闭）。AI 修改会同步更新本下拉框。",
      screenshotDir: "截图输出目录",
      screenshotDirHint: "留空表示使用系统临时目录。",
      defaultScale: "截图默认缩放",
      defaultScaleHint: "0.1..1；1 表示原分辨率整屏。",
      typingIntervalMs: "逐字输入间隔（毫秒）",
      typingIntervalMsHint: "越大越稳但越慢；0 表示不等待。",
      scrollUnits: "滚动刻度",
      scrollUnitsHint: "一次 scroll 滚动多少格，每格 120 WHEEL delta。",
      outputGuard: "代码输出打回",
      outputGuardHint: "把工具调用/伪 XML 写成对话文本时打回并提示；同内容第二次放行。关闭则不拦截。",
      debug: "调试日志",
      debugHint: "在日志里打印 PowerShell 脚本路径，仅排查时开启。",
      toolMode: "工具分档",
      toolModeAll: "全部",
      toolModeLite: "常用",
      toolModeCustom: "自定义",
      toolModeHint: "全部=19 个工具 | 常用=截图/快照/点击/输入/按键/滚动/等待 | 自定义=按白名单注册",
      enabledTools: "自定义白名单",
      enabledToolsHint: "逗号分隔的工具名；配合\"自定义\"生效（留空=全部）。例如 computer_screenshot, computer_snapshot, computer_click",
      stopHotkey: "急停热键",
      stopHotkeyHint: "接管提示条上显示的组合键，默认 ctrl+alt+esc；也可直接点提示条上的 Stop。",
      takeoverMinutes: "提示条自动收起（分钟）",
      takeoverMinutesHint: "超过这个时长自动结束接管并写停止标记；0 表示不自动收起。",
      takeoverMessage: "提示条文案",
      takeoverMessageHint: "留空使用默认文案；{key} 会替换成急停热键。",
      cdpPort: "浏览器调试端口（CDP）",
      cdpPortHint: "填 Chrome/Edge 的 --remote-debugging-port（0=关闭）；computer_browser 用它列标签页。",
      approveObserve: "截图/观测也需要批准",
      approveObserveHint: "开启后，手动批准模式下连 computer_screenshot / computer_snapshot / 窗口列表都要先 /computer；默认关闭（观测视为只读）。",
      overridden: "已覆盖",
      reset: "恢复默认",
      save: "保存",
      saving: "保存中…",
      saveFailed: "保存没有生效，草稿已保留，请修改后重试。",
      readOnly: "本部署的设置为只读。",
      unavailable: "computer-user 未由宿主服务，暂时无法配置。",
      invalidNumber: "请填数字，或留空使用默认值。",
    };
    var en = {
      nav: "Computer Use",
      intro: "Let DSH read the screen and drive mouse & keyboard (Codex computer-use style). Screenshots pair with picturereader's image_scan / image_ocr.",
      mode: "Mode",
      modeDisabled: "Disabled",
      modeReadonly: "Read-only",
      modeManual: "Manual approval",
      modeAuto: "Automatic",
      modeHint: "Disabled=refuse all | Read-only=screenshot/cursor/wait only | Manual approval=need /computer command to unlock | Automatic=LLM freely calls all tools",
      aiCanChangeMode: "AI may change mode itself",
      aiCanChangeModeHint: "When on, the AI can switch modes via the computer_set_mode tool (default off). AI changes are reflected in this dropdown.",
      screenshotDir: "Screenshot output dir",
      screenshotDirHint: "Leave empty to use the OS temp directory.",
      defaultScale: "Screenshot default scale",
      defaultScaleHint: "0.1..1; 1 keeps the full-resolution screen.",
      typingIntervalMs: "Typing interval (ms)",
      typingIntervalMsHint: "Larger is steadier but slower; 0 means no wait.",
      scrollUnits: "Scroll units",
      scrollUnitsHint: "Wheel grid per scroll, 120 WHEEL delta each.",
      outputGuard: "Reject code-as-text output",
      outputGuardHint: "Rejects tool-call/XML written as conversation text; the same text passes on the second output. Off disables.",
      debug: "Debug logging",
      debugHint: "Logs the PowerShell script paths; enable only while diagnosing.",
      toolMode: "Tool set",
      toolModeAll: "All",
      toolModeLite: "Lite",
      toolModeCustom: "Custom",
      toolModeHint: "All=19 tools | Lite=screenshot/snapshot/click/type/keypress/scroll/wait | Custom=named allow-list",
      enabledTools: "Custom allow-list",
      enabledToolsHint: "Comma-separated tool names, used with Custom (empty = all). e.g. computer_screenshot, computer_snapshot, computer_click",
      stopHotkey: "Stop hotkey",
      stopHotkeyHint: "Hotkey shown on the takeover pill (default ctrl+alt+esc); the pill's Stop button always works.",
      takeoverMinutes: "Auto-dismiss pill (minutes)",
      takeoverMinutesHint: "After this long the takeover ends and writes the stop flag; 0 = never auto-dismiss.",
      takeoverMessage: "Pill caption",
      takeoverMessageHint: "Empty uses the default; {key} is replaced with the stop hotkey.",
      cdpPort: "Browser debug port (CDP)",
      cdpPortHint: "Chrome/Edge --remote-debugging-port (0 = off); computer_browser lists tabs through it.",
      approveObserve: "Require approval to observe",
      approveObserveHint: "When on, even screenshots / UI snapshots / window lists need /computer in manual mode. Off by default (observation counts as read-only).",
      overridden: "Overridden",
      reset: "Reset to default",
      save: "Save",
      saving: "Saving…",
      saveFailed: "The deployment did not accept these values; your drafts were kept.",
      readOnly: "This deployment stores settings read-only.",
      unavailable: "computer-user is not served by the host, so it cannot be configured right now.",
      invalidNumber: "Enter a number, or leave blank to use the default.",
    };

    var FIELDS = [
      { key: "mode", type: "mode", labelKey: "mode", hintKey: "modeHint", def: "manual" },
      { key: "ai_can_change_mode", type: "boolean", labelKey: "aiCanChangeMode", hintKey: "aiCanChangeModeHint", def: false },
      { key: "screenshot_dir", type: "text", labelKey: "screenshotDir", hintKey: "screenshotDirHint", def: "" },
      { key: "default_scale", type: "number", labelKey: "defaultScale", hintKey: "defaultScaleHint", def: 1 },
      { key: "typing_interval_ms", type: "number", labelKey: "typingIntervalMs", hintKey: "typingIntervalMsHint", def: 0 },
      { key: "scroll_units", type: "number", labelKey: "scrollUnits", hintKey: "scrollUnitsHint", def: 1 },
      { key: "output_guard", type: "boolean", labelKey: "outputGuard", hintKey: "outputGuardHint", def: true },
      { key: "debug", type: "boolean", labelKey: "debug", hintKey: "debugHint", def: false },
      { key: "tool_mode", type: "select", labelKey: "toolMode", hintKey: "toolModeHint", def: "all", options: "toolMode" },
      { key: "enabled_tools", type: "list", labelKey: "enabledTools", hintKey: "enabledToolsHint", def: [] },
      { key: "stop_hotkey", type: "text", labelKey: "stopHotkey", hintKey: "stopHotkeyHint", def: "ctrl+alt+esc" },
      { key: "takeover_minutes", type: "number", labelKey: "takeoverMinutes", hintKey: "takeoverMinutesHint", def: 30 },
      { key: "takeover_message", type: "text", labelKey: "takeoverMessage", hintKey: "takeoverMessageHint", def: "" },
      { key: "cdp_port", type: "number", labelKey: "cdpPort", hintKey: "cdpPortHint", def: 0 },
      { key: "approve_observe", type: "boolean", labelKey: "approveObserve", hintKey: "approveObserveHint", def: false },
    ];

    function hasOwn(obj, key) {
      return obj !== null && typeof obj === "object" && Object.prototype.hasOwnProperty.call(obj, key);
    }

    function draftWrite(f, text) {
      if (f.type === "boolean") return { op: "set", value: !!text };
      if (f.type === "number") {
        var trimmed = String(text).trim();
        if (trimmed === "") return { op: "unset" };
        var num = Number(trimmed);
        return Number.isFinite(num) ? { op: "set", value: num } : null;
      }
      if (f.type === "mode") return { op: "set", value: String(text) };
      if (f.type === "list") {
        var items = String(text || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
        return items.length ? { op: "set", value: items } : { op: "unset" };
      }
      if (f.type === "select") return { op: "set", value: String(text) };
      var str = String(text).trim();
      return str === "" ? { op: "unset" } : { op: "set", value: str };
    }

    function Section(props) {
      var t = props.t;
      var scope = props.scope;
      var [snapshot, setSnapshot] = react.useState(function () { return scope.getSnapshot(); });
      var [drafts, setDrafts] = react.useState({});
      var [saving, setSaving] = react.useState(false);
      var [failed, setFailed] = react.useState(false);

      react.useEffect(function () {
        if (typeof props.reload === "function") {
          try { Promise.resolve(props.reload()).catch(function () {}); } catch (_e) {}
        } else if (typeof scope.load === "function") {
          scope.load();
        }
        var alive = true;
        var sync = function () { if (alive) setSnapshot(scope.getSnapshot()); };
        var un = typeof scope.subscribe === "function" ? scope.subscribe(sync) : null;
        return function () {
          alive = false;
          if (un) un();
          if (typeof props.reload !== "function" && scope.dispose) scope.dispose();
        };
      }, [scope]);

      if (snapshot.status === "unavailable") {
        return h("p", { className: "__cu_notice" }, t("unavailable"));
      }
      if (snapshot.status !== "ready") return h("p", { className: "__cu_notice" }, "");
      var value = snapshot.value && typeof snapshot.value === "object" ? snapshot.value : {};
      var user = snapshot.user && typeof snapshot.user === "object" ? snapshot.user : {};
      var readOnly = snapshot.writable === false;
      var disabled = readOnly || saving;

      function effective(f) {
        var v = value[f.key];
        return v === undefined ? f.def : v;
      }
      function stateOf(f) {
        var d = hasOwn(drafts, f.key) ? drafts[f.key] : null;
        var overridden = hasOwn(user, f.key);
        var cleared = !!(d && d.op === "unset");
        if (f.type === "boolean") {
          var checked = d ? (d.op === "set" ? !!d.value : !!f.def) : !!effective(f);
          return { checked: checked, text: "", overridden: overridden, cleared: cleared };
        }
        if (f.type === "number") {
          if (d) {
            if (d.op === "unset") return { checked: false, text: "", overridden: overridden, cleared: true };
            if (d.op === "invalid") return { checked: false, text: String(d.text), overridden: overridden, cleared: false };
            return { checked: false, text: String(d.value), overridden: overridden, cleared: false };
          }
          return { checked: false, text: String(effective(f) ?? ""), overridden: overridden, cleared: false };
        }
        if (f.type === "list") {
          var arr = d ? (d.op === "set" && Array.isArray(d.value) ? d.value : []) : (Array.isArray(effective(f)) ? effective(f) : []);
          return { checked: false, text: arr.join(", "), overridden: overridden, cleared: cleared };
        }
        var text = d ? (d.op === "set" ? String(d.value) : "") : String(effective(f) ?? "");
        return { checked: false, text: text, overridden: overridden, cleared: cleared };
      }
      function isValid(f) {
        if (f.type !== "number") return true;
        if (!hasOwn(drafts, f.key)) return true;
        var d = drafts[f.key];
        if (d.op === "unset") return true;
        if (d.op === "invalid") return false;
        return String(d.value).trim() !== "" && Number.isFinite(Number(d.value));
      }
      function stageText(f, text) {
        var write = draftWrite(f, text);
        setDrafts(function (prev) {
          var next = Object.assign({}, prev);
          if (write === null) next[f.key] = { op: "invalid", text: text };
          else if (write.op === "unset") next[f.key] = { op: "unset" };
          else next[f.key] = { op: "set", value: write.value };
          return next;
        });
        setFailed(false);
      }
      function stageChecked(f, checked) {
        setDrafts(function (prev) {
          var next = Object.assign({}, prev);
          next[f.key] = { op: "set", value: !!checked };
          return next;
        });
        setFailed(false);
      }
      function resetField(f) {
        setDrafts(function (prev) {
          var next = Object.assign({}, prev);
          next[f.key] = { op: "unset" };
          return next;
        });
        setFailed(false);
      }

      var ops = [];
      var invalid = false;
      FIELDS.forEach(function (f) {
        var d = hasOwn(drafts, f.key) ? drafts[f.key] : null;
        if (!d) return;
        if (!isValid(f)) { invalid = true; return; }
        if (d.op === "unset") { ops.push({ op: "unset", path: [f.key] }); return; }
        if (d.op === "set") ops.push({ op: "set", path: [f.key], value: d.value });
      });
      var dirty = ops.length > 0 || invalid;

      function onSave() {
        if (!dirty || invalid) return;
        setSaving(true);
        setFailed(false);
        var pending;
        if (typeof scope.mutate === "function") {
          pending = Promise.resolve(scope.mutate(ops, snapshot.revision));
        } else {
          pending = Promise.all(ops.map(function (op) {
            return op.op === "unset" ? scope.unset(op.path[0]) : scope.set(op.path[0], op.value);
          })).then(function () { return true; });
        }
        pending.then(function (accepted) {
          setSaving(false);
          if (accepted === false) { setFailed(true); return; }
          setDrafts({});
          if (typeof props.reload === "function") {
            try { Promise.resolve(props.reload()).catch(function () {}); } catch (_e) {}
          } else if (typeof scope.load === "function") {
            scope.load();
          }
        }).catch(function () {
          setSaving(false);
          setFailed(true);
        });
      }

      function renderField(f) {
        var id = "computer-use-" + f.key;
        var state = stateOf(f);
        var showInvalid = !isValid(f);
        var badges = h("span", { className: "__cu_badges" },
          state.overridden ? h("span", { className: "__cu_badge" }, t("overridden")) : null,
          (state.overridden || state.cleared || hasOwn(drafts, f.key))
            ? h("button", {
                type: "button",
                className: "__cu_reset",
                disabled: disabled,
                onClick: function () { resetField(f); },
              }, t("reset"))
            : null
        );
        var hint = showInvalid
          ? h("p", { className: "__cu_invalid" }, t("invalidNumber"))
          : (f.hintKey ? h("p", { className: "__cu_hint" }, t(f.hintKey)) : null);

        if (f.type === "boolean") {
          return h("div", { key: f.key, className: "__cu_field" },
            h("div", { className: "__cu_head" },
              h("label", { htmlFor: id, className: "__cu_label" }, t(f.labelKey)),
              badges,
              h("input", {
                id: id,
                className: "__cu_check",
                type: "checkbox",
                checked: state.checked,
                disabled: disabled,
                onChange: function (e) { stageChecked(f, e.target.checked); },
              })
            ),
            hint
          );
        }
        var control;
        if (f.type === "mode" || f.type === "select") {
          var opts = f.type === "mode" ? MODE_OPTS : TOOL_MODE_OPTS;
          control = h("select", {
            id: id,
            className: "__cu_input",
            value: state.text || f.def,
            disabled: disabled,
            onChange: function (e) { stageText(f, e.target.value); },
          }, opts.map(function (o) {
            return h("option", { key: o.value, value: o.value }, t(o.labelKey));
          }));
        } else {
          control = h("input", {
            id: id,
            className: "__cu_input",
            type: f.type === "number" ? "number" : "text",
            step: f.type === "number" ? "any" : undefined,
            value: state.text,
            placeholder: f.def === "" ? undefined : String(f.def),
            "aria-invalid": showInvalid ? "true" : undefined,
            disabled: disabled,
            onChange: function (e) { stageText(f, e.target.value); },
          });
        }
        return h("div", { key: f.key, className: "__cu_field" },
          h("div", { className: "__cu_head" },
            h("label", { htmlFor: id, className: "__cu_label" }, t(f.labelKey)),
            badges
          ),
          control,
          hint
        );
      }

      return h("div", { className: "__cu_form" },
        h("p", { className: "__cu_notice" }, t("intro")),
        readOnly ? h("p", { className: "__cu_notice" }, t("readOnly")) : null,
        FIELDS.map(renderField),
        h("div", { className: "__cu_footer" },
          failed ? h("p", { className: "__cu_failed" }, t("saveFailed")) : null,
          h("button", {
            type: "button",
            className: "__cu_save",
            disabled: disabled || !dirty || invalid,
            onClick: onSave,
          }, saving ? t("saving") : t("save"))
        )
      );
    }

    /**
     * Slash-menu face for /computer.
     *
     * The Host command registry only accepts name + description, and the client
     * paints built-in commands from a private icon/locale table, so a plugin
     * cannot declare either. Decorate the rendered row instead: rename it, put
     * a cursor glyph in front, and keep the description short. Idempotent, and
     * re-applied whenever the menu re-renders (the Host owns that markup).
     */
    var MENU_SELECTOR = "[data-trigger-menu]";
    var MENU_ROW_PREFIX = "dsh-slash-option-command-";
    var MENU_LABEL = "电脑操作";
    var MENU_ALIAS = "computer";
    var MENU_DESCRIPTION = "批准或撤销电脑操作";
    var CURSOR_SVG = '<svg viewBox="0 0 512 512" aria-hidden="true" focusable="false"><path fill="currentColor" d="M112 56 416 306 272 322 352 452 296 486 216 356 104 432Z"/></svg>';

    function decorateMenu(menu) {
      var rows = menu.querySelectorAll('button[id^="' + MENU_ROW_PREFIX + '"]');
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var spans = row.querySelectorAll(":scope > span");
        var nameSpan = null;
        var descSpan = null;
        for (var j = 0; j < spans.length; j++) {
          var span = spans[j];
          if (span.hasAttribute("data-cu-command-alias")) {
            nameSpan = span.previousElementSibling;
            continue;
          }
          if (span.textContent === MENU_ALIAS && nameSpan === null) nameSpan = span;
          else if ((span.textContent || "").length > 4 && span !== nameSpan) descSpan = span;
        }
        if (nameSpan === null) continue;
        if (nameSpan.textContent === MENU_ALIAS) nameSpan.textContent = MENU_LABEL;
        if (descSpan !== null && descSpan.textContent !== MENU_DESCRIPTION) descSpan.textContent = MENU_DESCRIPTION;
        if (row.querySelector("[data-cu-command-alias]") === null) {
          var alias = document.createElement("span");
          alias.setAttribute("data-cu-command-alias", "1");
          alias.textContent = MENU_ALIAS;
          alias.style.cssText = "opacity:.55;font-size:.9em;margin-left:4px;";
          nameSpan.parentElement.insertBefore(alias, nameSpan.nextSibling);
        }
        var prev = nameSpan.previousElementSibling;
        if (prev === null || !prev.hasAttribute("data-cu-command-icon")) {
          var icon = document.createElement("span");
          icon.setAttribute("data-cu-command-icon", "1");
          icon.style.cssText = "display:inline-flex;flex:none;width:14px;height:14px;margin-right:6px;align-items:center;justify-content:center;";
          icon.innerHTML = CURSOR_SVG;
          nameSpan.parentElement.insertBefore(icon, nameSpan);
        }
      }
    }

    function startMenuFace() {
      if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
      var scheduled = false;
      function run() {
        scheduled = false;
        var menus = document.querySelectorAll(MENU_SELECTOR);
        for (var i = 0; i < menus.length; i++) {
          try { decorateMenu(menus[i]); } catch (error) { /* Host-owned markup */ }
        }
      }
      function schedule() {
        if (scheduled) return;
        scheduled = true;
        Promise.resolve().then(run);
      }
      var observer = new MutationObserver(schedule);
      observer.observe(document.body, { childList: true, subtree: true });
      schedule();
    }

    function apply(ctx) {
      var t = ctx.locale.bind(NS);
      ctx.effect(function () { return ctx.locale.register(NS, { zh: zh, en: en }); }, "computer-user: dictionaries");
      startMenuFace();

      var registered = false;
      function registerCard(scope, reload) {
        if (registered) return;
        registered = true;
        ctx.slots.inject("settings.section", function () {
          return ctx.slots.register({
            name: "settings.section",
            id: "computer-user",
            order: 50,
            label: function () { return t("nav"); },
            locale: NS,
          }, function (props) {
            return h(Section, Object.assign({}, props, { scope: scope, reload: reload }));
          });
        });
      }

      // DSH 0.2.x: one shared config form per Host plugin entry, fed by the
      // settings describe mirror. ensure() starts the first read if idle.
      ctx.inject(["configForms"], function (cctx) {
        var forms = cctx.configForms;
        var form = forms.get(NS);
        var mirror = typeof forms.describe === "function" ? forms.describe() : null;
        registerCard(form, mirror && typeof mirror.ensure === "function"
          ? function () { return mirror.ensure(); }
          : null);
      });
      // DSH 0.1.x: namespaced settings scope (kept for older hosts).
      ctx.inject(["settingsScope"], function (cctx) {
        registerCard(cctx.settingsScope.bind({ namespace: NS }), null);
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});

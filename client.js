/**
 * computer-user — Web settings card (client half).
 *
 * Registers a 「电脑操作 / Computer Use」 section in the DSH Web settings page:
 *   - Top (visible the moment the card opens): enabled (是否开启) and
 *     require_confirmation (是否要请示) — the two switches the user asked for.
 *   - Advanced (wrapped in a <details> so it is collapsed by default):
 *     screenshot_dir, default_scale, typing_interval_ms, scroll_units, debug.
 *
 * Hand-written ModuleLoader bundle — no build step (same shape as picturereader).
 */
window.__ModuleLoader__.load({
  id: "computer-user",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var react = require("react");
    var h = react.createElement;

    // ── CSS (theme tokens; own prefix to avoid clobbering other plugins) ──
    var CSS =
      ".__cu_root{max-width:640px;display:flex;flex-direction:column;gap:10px}" +
      ".__cu_field{display:flex;flex-direction:column;gap:4px}" +
      ".__cu_label{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);display:flex;align-items:center;gap:6px}" +
      ".__cu_hint{font-size:11px;color:var(--dsw-alias-label-tertiary)}" +
      ".__cu_row{display:flex;align-items:center;gap:8px}" +
      ".__cu_check{accent-color:var(--dsw-alias-state-business-primary)}" +
      ".__cu_input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 10px;font-size:13px;box-sizing:border-box;width:100%}" +
      ".__cu_actions{display:flex;gap:8px;align-items:center;margin-top:4px}" +
      ".__cu_btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 14px;font:inherit;font-size:13px;cursor:pointer}" +
      ".__cu_btn:hover:not(:disabled){border-color:var(--dsw-alias-state-business-primary)}" +
      ".__cu_btn:disabled{opacity:.5;cursor:default}" +
      ".__cu_btnPrimary{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-on-accent)}" +
      ".__cu_status{font-size:12px;color:var(--dsw-alias-label-tertiary)}" +
      ".__cu_error{font-size:12px;color:var(--dsw-alias-state-error-primary)}" +
      ".__cu_advanced{margin-top:8px;border-top:1px solid var(--dsw-alias-border-l2);padding-top:6px}" +
      ".__cu_advancedSummary{cursor:pointer;font-size:13px;font-weight:600;color:var(--dsw-alias-label-secondary);user-select:none;display:flex;align-items:center;gap:5px}" +
      ".__cu_advancedArrow{display:inline-block;transition:transform .18s ease;font-size:13px;line-height:1;color:var(--dsw-alias-label-secondary);transform:rotate(0)}" +
      ".__cu_advanced[open] .__cu_advancedArrow{transform:rotate(90deg)}" +
      ".__cu_unavailable{font-size:13px;color:var(--dsw-alias-label-tertiary)}";
    var tagId = "computer-user/main.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"" + tagId + "\"]") === null) {
      var tag = document.createElement("style");
      tag.dataset.plugin = "computer-user";
      tag.dataset.pluginCss = tagId;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    var NS = "computer-user";
    var inject = ["slots", "locale", "settingsScope"];
    var zh = {
      nav: "电脑操作",
      intro: "computer-user：让 DSH 读屏幕并操作鼠标键盘（Codex computer-use 风格）。顶部两个开关最重要：是否开启、是否要请示。截图结果配合 picturereader 的 image_scan/image_ocr 使用。",
      enabled: "是否开启",
      enabledHint: "总开关：关闭后所有 computer_* 工具一律拒绝执行。",
      requireConfirmation: "是否要请示",
      requireConfirmationHint: "开启后：点击/输入/按键/滚动/拖拽/移动鼠标等有副作用的操作，都须在调用里显式传 confirm:true 才放行（先截图看结果再决定）。截图/读光标/等待不受此限。",
      advanced: "高级设置",
      screenshotDir: "截图输出目录（空 = 系统临时目录）",
      defaultScale: "截图默认缩放 0.1..1",
      typingIntervalMs: "逐字输入间隔（毫秒）",
      scrollUnits: "滚动刻度（每格 120）",
      debug: "调试日志",
      save: "保存",
      reset: "恢复默认",
      saved: "已保存",
      saving: "保存中…",
      error: "保存失败",
      unavailable: "设置命名空间不可用（服务端未注册 computer-user 命名空间？）",
      loading: "加载中…",
    };
    var en = {
      nav: "Computer Use",
      intro: "computer-user: let DSH read the screen and drive mouse & keyboard (Codex computer-use style). The two switches on top matter most: enabled, and require-confirmation. Screenshots pair with picturereader's image_scan/image_ocr.",
      enabled: "Enabled",
      enabledHint: "Master switch: when off, every computer_* tool refuses to run.",
      requireConfirmation: "Ask before acting",
      requireConfirmationHint: "When on, side-effecting operations (click/type/keypress/scroll/drag/move mouse) need an explicit confirm:true in the call (screenshot first, then decide). Screenshot/cursor/read/wait are not gated.",
      advanced: "Advanced",
      screenshotDir: "Screenshot output dir (empty = OS temp)",
      defaultScale: "Screenshot default scale 0.1..1",
      typingIntervalMs: "Typing interval (ms)",
      scrollUnits: "Scroll units (120 per tick)",
      debug: "Debug logging",
      save: "Save",
      reset: "Reset",
      saved: "Saved",
      saving: "Saving…",
      error: "Save failed",
      unavailable: "Settings namespace unavailable (computer-user not registered server-side?)",
      loading: "Loading…",
    };

    // Top (always visible) vs advanced (collapsed by default).
    var TOP = ["enabled", "requireConfirmation"];
    var FIELDS = [
      { key: "enabled", type: "checkbox", labelKey: "enabled", hintKey: "enabledHint" },
      { key: "requireConfirmation", type: "checkbox", labelKey: "requireConfirmation", hintKey: "requireConfirmationHint" },
      { key: "screenshot_dir", type: "text", labelKey: "screenshotDir", advanced: true },
      { key: "default_scale", type: "number", labelKey: "defaultScale", advanced: true },
      { key: "typing_interval_ms", type: "number", labelKey: "typingIntervalMs", advanced: true },
      { key: "scroll_units", type: "number", labelKey: "scrollUnits", advanced: true },
      { key: "debug", type: "checkbox", labelKey: "debug", advanced: true },
    ];
    var CFG_KEYS = {
      enabled: "enabled", requireConfirmation: "require_confirmation",
      screenshot_dir: "screenshot_dir", default_scale: "default_scale",
      typing_interval_ms: "typing_interval_ms", scroll_units: "scroll_units", debug: "debug",
    };

    function tOf(props) { return props.t; }

    function Section(props) {
      var t = props.t;
      var scope = props.scope;
      var [snapshot, setSnapshot] = react.useState(function () { return scope.getSnapshot(); });
      var ready = snapshot.status === "ready" && snapshot.value !== void 0;
      var [draft, setDraft] = react.useState({});
      var [busy, setBusy] = react.useState(false);
      var [notice, setNotice] = react.useState(null);
      var [error, setError] = react.useState(null);

      react.useEffect(function () {
        scope.load();
        var alive = true;
        var sync = function () { if (alive) setSnapshot(scope.getSnapshot()); };
        var un = typeof scope.subscribe === "function" ? scope.subscribe(sync) : null;
        return function () { alive = false; if (un) un(); if (scope.dispose) scope.dispose(); };
      }, [scope]);
      react.useEffect(function () {
        if (ready) setDraft(function (prev) {
          var merged = Object.assign({}, valueToDraft(snapshot.value));
          for (var k in prev) merged[k] = prev[k];
          return merged;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [ready]);

      if (snapshot.status === "unavailable") {
        return h("p", { className: "__cu_unavailable" }, t("unavailable"));
      }
      if (!ready) return h("p", { className: "__cu_status" }, t("loading"));

      var value = snapshot.value;

      function onSave() {
        setBusy(true); setNotice(null); setError(null);
        var ops = [];
        FIELDS.forEach(function (f) {
          if (f.type === "checkbox") {
            ops.push({ op: "set", key: CFG_KEYS[f.key], value: draft[f.key] !== void 0 ? !!draft[f.key] : Boolean(value[CFG_KEYS[f.key]]) });
            return;
          }
          var dv = draft[f.key] !== void 0 ? String(draft[f.key]) : String(value[CFG_KEYS[f.key]] ?? "");
          if (f.type === "number") {
            var num = Number(dv);
            if (Number.isFinite(num)) { ops.push({ op: "set", key: CFG_KEYS[f.key], value: num }); }
            return;
          }
          if (String(dv).trim() === "") { ops.push({ op: "unset", key: CFG_KEYS[f.key] }); return; }
          ops.push({ op: "set", key: CFG_KEYS[f.key], value: String(dv).trim() });
        });
        Promise.all(ops.map(function (o) {
          return o.op === "set" ? scope.set(o.key, o.value) : scope.unset(o.key);
        })).then(function () {
          setBusy(false); setNotice(t("saved"));
          if (scope.load) scope.load();
        }).catch(function (e) {
          setBusy(false); setError(t("error") + ": " + String(e && e.message || e));
        });
      }
      function onReset() {
        setBusy(true);
        Promise.all(FIELDS.map(function (f) { return scope.unset(CFG_KEYS[f.key]); })).then(function () {
          setBusy(false); setNotice(t("saved"));
          setTimeout(function () {
            var fresh = scope.getSnapshot();
            if (fresh.status === "ready" && fresh.value !== void 0) setDraft(Object.assign({}, valueToDraft(fresh.value)));
          }, 120);
        }).catch(function (e) { setBusy(false); setError(t("error") + ": " + String(e && e.message || e)); });
      }

      function fieldValue(f) {
        return draft[f.key] !== void 0 ? draft[f.key] : String(value[CFG_KEYS[f.key]] ?? "");
      }
      function setField(f, v) {
        setDraft(function (prev) { var n = Object.assign({}, prev); n[f.key] = v; return n; });
        setNotice(null); setError(null);
      }
      function renderField(f) {
        if (f.type === "checkbox") {
          var checked = draft[f.key] !== void 0 ? !!draft[f.key] : Boolean(value[CFG_KEYS[f.key]]);
          return h("label", { key: f.key, className: "__cu_field" },
            h("span", { className: "__cu_row" },
              h("input", { className: "__cu_check", type: "checkbox", checked: checked, onChange: function (e) { setField(f, e.target.checked); } }),
              h("span", { className: "__cu_label" }, t(f.labelKey))
            ),
            f.hintKey ? h("span", { className: "__cu_hint" }, t(f.hintKey)) : null
          );
        }
        return h("label", { key: f.key, className: "__cu_field" },
          h("span", { className: "__cu_label" }, t(f.labelKey)),
          h("input", {
            className: "__cu_input",
            type: f.type === "number" ? "number" : "text",
            value: fieldValue(f),
            onChange: function (e) { setField(f, e.target.value); },
          })
        );
      }

      // Top switches are always rendered first, then the collapsed Advanced <details>.
      var top = FIELDS.filter(function (f) { return !f.advanced; });
      var advanced = FIELDS.filter(function (f) { return f.advanced; });
      return h("div", { className: "__cu_root" },
        h("p", { className: "__cu_hint", style: { margin: "0 0 4px" } }, t("intro")),
        top.map(renderField),
        advanced.length ? h("details", { className: "__cu_advanced" },
          h("summary", { className: "__cu_advancedSummary" },
            h("span", null, t("advanced")),
            h("span", { className: "__cu_advancedArrow" }, "\u25b8")
          ),
          advanced.map(renderField)
        ) : null,
        h("div", { className: "__cu_actions" },
          h("button", { type: "button", className: "__cu_btn __cu_btnPrimary", onClick: onSave, disabled: busy || !snapshot.writable }, t("save")),
          h("button", { type: "button", className: "__cu_btn", onClick: onReset, disabled: busy || !snapshot.writable }, t("reset")),
          notice ? h("span", { className: "__cu_status" }, notice) : null,
          busy ? h("span", { className: "__cu_status" }, t("saving")) : null,
          error ? h("span", { className: "__cu_error" }, error) : null
        )
      );
    }

    function valueToDraft(value) {
      var out = {};
      FIELDS.forEach(function (f) {
        out[f.key] = f.type === "checkbox" ? Boolean(value[CFG_KEYS[f.key]]) : String(value[CFG_KEYS[f.key]] ?? "");
      });
      return out;
    }

    function apply(ctx) {
      var t = ctx.locale.bind(NS);
      ctx.effect(function () { return ctx.locale.register(NS, { zh: zh, en: en }); }, "computer-user: dictionaries");
      var scope = ctx.settingsScope.bind({ namespace: NS });
      ctx.slots.inject("settings.section", function () {
        return ctx.slots.register({
          name: "settings.section",
          id: "computer-user",
          order: 50,
          label: function () { return t("nav"); },
          locale: NS,
        }, function (props) {
          return h(Section, Object.assign({}, props, { scope: scope }));
        });
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});

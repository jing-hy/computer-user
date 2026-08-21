/**
 * computer-user — Codex-style computer use for DeepSeek Harness (DSH).
 *
 * Reads the screen (computer_screenshot → PNG path) and drives the mouse &
 * keyboard (click / type / keypress / scroll / drag / move_mouse / wait /
 * get_cursor_position) via bundled PowerShell scripts using Win32 SendInput —
 * zero native dependencies, so it works in the same Node host that runs the
 * EAC desktop profile (same pattern as picturereader's Windows OCR).
 *
 * Pairs with picturereader: screenshot returns a file path that the model
 * feeds to image_scan / image_ocr, then acts on it.
 *
 * Settings (namespace `computer-user`, hot-reloaded via a runtime snapshot):
 *   enabled            — master switch (false ⇒ every tool refuses)
 *   require_confirmation — ask-before-acting (side-effecting tools need confirm:true)
 *   screenshot_dir / default_scale / typing_interval_ms / scroll_units / debug
 *
 * @module computer-user
 */

import { settingsNamespace } from '@deepseek-ai/dsh-settings';
import { NS, Config } from './config.js';
import { createComputerTools } from './tools.js';
import { runPs, powerShellScript } from './ps.js';

export const name = 'computer-user';
export const version = '0.1.0';

/** Services required at runtime. */
export const inject = ['tools'];

let sourceGetter = null;
const getConfig = () => (sourceGetter ? sourceGetter() : undefined);

export function apply(ctx, config) {
  // ── register tools (no settings/llm service needed) ──
  ctx.effect(() => {
    for (const tool of createComputerTools({ runPs, getConfig })) {
      ctx.tools.register(tool);
    }
  });

  // ── settings namespace (hot reload) ──
  try {
    ctx.inject(['settings'], (sctx) => {
      const settingsNs = settingsNamespace(NS);
      const scope = sctx.settings.register(settingsNs, Config, { base: config });
      sourceGetter = () => scope.get();
      scope.watch(() => { /* trigger hot reload so the runtime snapshot updates */ });
    });
  } catch (error) {
    ctx.logger?.warn?.(`[computer-user] settings disabled: ${String(error?.message ?? error)}`);
    sourceGetter = () => ({ ...Config.create?.(), ...config });
  }

  // ── debug helper: expose the bundled PowerShell scripts exist? (for tests) ──
  if (config?.debug) {
    ctx.logger?.info?.(`[computer-user] scripts: ${powerShellScript('capture.ps1')}, ${powerShellScript('input.ps1')}`);
  }
}

export default { name, version, inject, apply };

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
 * Settings (DSH 0.2.x: the plugin entry's own Config form, namespace
 * `computer-user`, every field `.volatile()` so edits apply live):
 *   mode — disabled / readonly / manual / auto
 *   screenshot_dir / default_scale / typing_interval_ms / scroll_units / debug
 *
 * 0.4.0: `@deepseek-ai/dsh-settings` 0.2 replaced the namespaced settings
 * scope (`settings.register(ns, schema)` → `get/update/watch`) with
 * `SettingsForms` over profile entry ids (`describe`/`update`/`mutate`), and
 * `@deepseek-ai/dsh-llm` 0.2 replaced mutable provider registrations with the
 * `llm/stream` waterfall. Both extension points are used here; the 0.1.x
 * paths stay behind feature detection so one build runs on either host.
 *
 * @module computer-user
 */

import { NS, Config } from './config.js';
import { createComputerTools } from './tools.js';
import { runPs, powerShellScript } from './ps.js';
import { createOutputGuard } from './output-guard.js';

export const name = 'computer-user';
export const version = '0.4.0';

/** Services required at runtime. */
export const inject = ['tools'];

/** The profile entry id this bundle's patch inserts (settings form key). */
export const ENTRY_ID = NS;

/** Settings schema for this entry: exposes the settings page and validates writes. */
export { Config };

/** In-memory set of session IDs that have been approved via /computer. */
const approvedSessions = new Set();

/**
 * Resolve the session-target set affected by /computer from a command
 * invocation: agent.id (SessionId) + session.header.sessionId, falling back
 * to '__global__' when neither is present.
 * @param {object} invocation
 * @returns {Set<string>}
 */
export function sessionTargetsFromInvocation(invocation) {
  const targets = new Set();
  try {
    if (invocation?.agent?.id) targets.add(String(invocation.agent.id));
    if (invocation?.agent?.session?.header?.sessionId) targets.add(String(invocation.agent.session.header.sessionId));
  } catch { /* ignore */ }
  if (targets.size === 0) targets.add('__global__');
  return targets;
}

/**
 * Toggle approval for a set of session targets: if any target is already
 * approved, revoke them all; otherwise approve them all.
 * @param {Set<string>} approvedSessions
 * @param {Set<string>} targets
 * @returns {{approved:boolean, targets:Set<string>}}
 */
export function toggleApproval(approvedSessions, targets) {
  const approved = [...targets].some((t) => approvedSessions.has(t));
  if (approved) {
    for (const t of targets) approvedSessions.delete(t);
    return { approved: false, targets };
  }
  for (const t of targets) approvedSessions.add(t);
  return { approved: true, targets };
}

/**
 * Wrap an assistant stream so fake tool-call text written as conversation is
 * replaced by a one-time coaching note (the `output_guard` preference).
 * @param {AsyncIterable<object>} upstream
 * @param {() => object} getCfg
 * @returns {AsyncIterable<object>}
 */
export async function* guardStream(upstream, getCfg) {
  const guard = createOutputGuard({ allowAfter: 2 });
  let noteShown = false;
  for await (const chunk of upstream) {
    const cfg = getCfg();
    if (cfg && cfg.output_guard === false) { yield chunk; continue; }
    if (chunk && chunk.type === 'text-delta' && typeof chunk.text === 'string') {
      const decision = guard.sniff(chunk.text);
      if (decision.kind === 'reject') {
        if (!noteShown) {
          noteShown = true;
          yield { ...chunk, text: decision.note };
        }
        continue; // drop the polluted delta
      }
      // pass / pass-second → forward the original delta
    }
    yield chunk;
  }
}

export function apply(ctx, config) {
  /** Live settings reader: 0.2.x SettingsForms, or a 0.1.x scoped settings scope. */
  const settings = {
    /** @returns {object|undefined} current Config values. */
    read() {
      return undefined;
    },
    /** @type {null | ((mode: string) => Promise<void>)} */
    setMode: null,
  };

  const baseConfig = config ?? {};
  const getConfig = () => {
    let live;
    try { live = settings.read(); } catch { /* ignore */ }
    const value = live && typeof live === 'object' ? live : baseConfig;
    return { ...baseConfig, ...value, mode: value.mode ?? baseConfig.mode ?? 'manual' };
  };

  // ── register tools ──
  // One definition rejected by a host schema check must not take the whole
  // plugin down: log it and keep the remaining tools (and the settings/card
  // wiring below) alive.
  ctx.effect(() => {
    const disposers = [];
    for (const tool of createComputerTools({ runPs, getConfig, approvedSessions, sessionIds: [], setMode: (m) => settings.setMode(m) })) {
      try {
        disposers.push(ctx.tools.register({
          ...tool,
          // Wrap execute to inject every session identity visible at call time.
          async execute(args, exec) {
            const sessionIds = [...new Set([
              exec?.agent?.id,
              exec?.agent?.session?.header?.sessionId,
              exec?.sessionId,
            ].filter(Boolean).map(String))];
            const tools = createComputerTools({ runPs, getConfig, approvedSessions, sessionIds, setMode: (m) => settings.setMode(m) });
            const realTool = tools.find((t) => t.name === tool.name);
            return realTool.execute(args, exec);
          },
        }));
      } catch (error) {
        ctx.logger?.warn?.(`[computer-user] tool ${tool.name} not registered: ${String(error?.message ?? error)}`);
      }
    }
    return () => { for (const dispose of disposers) dispose(); };
  });

  // ── settings (live Config over the profile entry) ──
  // The inject callback runs asynchronously, so a throw inside it is NOT caught
  // by the surrounding try — it would abort the rest of this callback silently.
  // Guard it here so an incompatible settings service degrades to the static
  // config instead of losing the /computer command and the output guard too.
  const settingsFallback = (error) => {
    ctx.logger?.warn?.(`[computer-user] settings disabled: ${String(error?.message ?? error)}`);
  };
  try {
    ctx.inject(['settings'], (sctx) => {
      try {
        const service = sctx.settings;
        if (service && typeof service.describe === 'function' && typeof service.update === 'function') {
          // DSH 0.2.x: SettingsForms over the profile entry id.
          settings.read = () => {
            const row = service.describe().find((r) => r && r.ns === ENTRY_ID);
            return row?.value;
          };
          settings.setMode = async (mode) => { await service.update(ENTRY_ID, { mode }); };
          // This plugin ships its own settings card, so suppress the generated page.
          if (typeof service.configure === 'function') {
            try { service.configure({ auto: false }, ctx.fiber); } catch { /* optional */ }
          }
          return;
        }
        if (service && typeof service.register === 'function') {
          // DSH 0.1.x: namespaced settings scope (register/get/update).
          const scope = service.register(ENTRY_ID, Config, { base: baseConfig });
          settings.read = () => scope.get();
          settings.setMode = async (mode) => { await scope.update({ mode }); };
          if (typeof scope.watch === 'function') scope.watch(() => { /* hot reload */ });
          return;
        }
        settingsFallback(new Error('unsupported settings service'));
      } catch (error) {
        settingsFallback(error);
      }
    });
  } catch (error) {
    settingsFallback(error);
  }

  // ── /computer command for session approval ──
  try {
    ctx.inject(['commands'], (sctx) => {
      sctx.commands.register({
        name: 'computer',
        description: '批准当前会话使用 computer-user 的全部工具（手动批准模式下需要）',
        handler: async (invocation) => {
          // /computer 是开关：第一次批准当前会话，再按一次撤销批准。
          const targets = sessionTargetsFromInvocation(invocation);
          const { approved } = toggleApproval(approvedSessions, targets);
          const ids = [...targets].join(', ');
          return approved
            ? { kind: 'success', text: `✅ 已批准：computer-user 全部工具在当前会话可用（${ids}）。后续轮次持续生效；再按 /computer 可撤销。` }
            : { kind: 'success', text: `🔒 已撤销批准：computer-user 有副作用工具需重新 /computer 批准（${ids}）。` };
        },
      });
      ctx.logger?.info?.('[computer-user] /computer command registered');
    });
  } catch (error) {
    ctx.logger?.warn?.(`[computer-user] commands service not available: ${String(error?.message ?? error)}`);
  }

  // ── LLM output guard: strip fake tool-call text written as conversation ──
  //     text; first occurrence replaced with a coaching note, second chance
  //     (same fingerprint) passes through. Off when output_guard=false.
  //     0.2.x: the `llm/stream` waterfall; 0.1.x: a provider-registration proxy.
  try {
    if (typeof ctx.on === 'function') {
      ctx.on('llm/stream', (_options, next) => {
        const upstream = next();
        const cfg = getConfig();
        if (cfg && cfg.output_guard === false) return upstream;
        return guardStream(upstream, getConfig);
      });
    }
    ctx.inject(['llm'], (sctx) => {
      const llm = sctx.llm;
      // 0.1.x fallback: wrap each registered provider adapter's stream().
      if (!llm || typeof llm.listProviders !== 'function' || typeof llm.registration !== 'function') return;
      const wrapProviders = () => {
        let wrapped = 0;
        for (const provider of llm.listProviders()) {
          let reg;
          try { reg = llm.registration(provider); } catch { continue; }
          if (!reg || !reg.adapter) continue;
          if (reg.adapter?.__cuOutputGuard) continue;
          const orig = reg.adapter;
          const origStream = orig.stream.bind(orig);
          const guardProxy = new Proxy(orig, {
            get(target, prop, receiver) {
              if (prop === 'stream') {
                return function (options) {
                  return guardStream(origStream(options), getConfig);
                };
              }
              const value = Reflect.get(target, prop, receiver);
              return typeof value === 'function' ? value.bind(target) : value;
            },
          });
          Object.defineProperty(guardProxy, '__cuOutputGuard', { value: true, enumerable: false, configurable: true });
          reg.adapter = guardProxy;
          wrapped++;
        }
        if (wrapped > 0) ctx.logger?.info?.(`[computer-user] output guard active on ${wrapped} provider(s)`);
      };
      wrapProviders();
      // re-wrap if providers register later (best-effort; ignore failures)
      if (typeof llm.on === 'function') {
        try { llm.on('provider/register', () => { try { wrapProviders(); } catch { /* ignore */ } }); } catch { /* ignore */ }
      }
    });
  } catch (error) {
    ctx.logger?.warn?.(`[computer-user] output guard unavailable: ${String(error?.message ?? error)}`);
  }

  // ── debug helper ──
  if (config?.debug) {
    ctx.logger?.info?.(`[computer-user] scripts: ${powerShellScript('capture.ps1')}, ${powerShellScript('input.ps1')}`);
  }
}

export default { name, version, inject, apply };

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
import backend, { runPs, isStopped, stopReason, clearStop, ensureGuard, stopGuard } from './backend.js';
import { createOutputGuard } from './output-guard.js';

export const name = 'computer-user';
export const version = '0.6.2';

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
 * Decide what /computer does for the current invocation.
 *
 * A latched stop flag wins over the toggle: after a timeout stop the session is
 * usually still approved, so a plain toggle would revoke instead of resuming and
 * the user would have to press /computer twice to get back to a working state
 * (issue #7).
 * @param {{stopped:boolean, approved:boolean}} state
 * @returns {'resume'|'toggle'}
 */
export function planCommandAction({ stopped, approved }) {
  return stopped && approved ? 'resume' : 'toggle';
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
 * The shared volatile-reference protocol (@deepseek-ai/cosmokit): a live config
 * reference exposes `get()` and carries this brand symbol, which is why the
 * brand is looked up by `Symbol.for` instead of imported from the host.
 */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write');

/**
 * Flatten a resolved plugin Config into ordinary values: a volatile reference
 * exposes its snapshot through `get()`, a plain object is copied field by field.
 * Mirrors the host's own `plainConfig`, so the result matches what the settings
 * form would show.
 * @param {unknown} value
 * @returns {unknown}
 */
export function plainConfigOf(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(plainConfigOf);
  if (typeof value === 'object' && VOLATILE_WRITE in value && typeof value.get === 'function') {
    return plainConfigOf(value.get());
  }
  return Object.fromEntries(Object.keys(value).map((key) => [key, plainConfigOf(value[key])]));
}

/**
 * Wrap an assistant stream so fake tool-call text written as conversation is
 * replaced by a one-time coaching note (the `output_guard` preference).
 * @param {AsyncIterable<object>} upstream
 * @param {() => object} getCfg
 * @returns {AsyncIterable<object>}
 */
export async function* guardStream(upstream, getCfg) {
  // Resolve the preference ONCE per stream. Reading it inside the loop put a
  // full settings-form rebuild on every text delta: on 0.2.x the live reader is
  // `SettingsForms.describe()`, which rebuilds every active profile entry's
  // form + schema JSON + revision string (~50 ms and ~1 MB of garbage at 238
  // entries on this machine). At 200 chunks/s that pinned streaming at ~18 tok/s
  // (issue #8). Toggling `output_guard` now takes effect on the next stream
  // instead of mid-stream, which costs nothing: the setting is a per-response
  // policy, not a per-token one.
  const cfg = typeof getCfg === 'function' ? getCfg() : getCfg;
  if (cfg && cfg.output_guard === false) { yield* upstream; return; }
  const guard = createOutputGuard({ allowAfter: 2 });
  let noteShown = false;
  for await (const chunk of upstream) {
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

  /**
   * Resolve the live Config from the plugin fiber when the host exposes it.
   * cordis keeps the resolved value on `fiber._effectiveConfig`, so this read is
   * O(1) and still live for every `.volatile()` field (a live settings write
   * updates that field without remounting the plugin). It is deliberately
   * preferred over the settings service: on 0.2.x `settings.read()` is
   * `SettingsForms.describe()`, which rebuilds EVERY active profile entry's
   * form, schema JSON and revision string on each call — measured ~50 ms and
   * ~1 MB of garbage per call at 238 entries on this machine.
   * @returns {object|undefined}
   */
  const fiberConfig = () => {
    try {
      const resolved = ctx?.fiber?.effectiveConfig;
      if (resolved === undefined || resolved === null) return undefined;
      const plain = plainConfigOf(resolved);
      return plain && typeof plain === 'object' ? plain : undefined;
    } catch { return undefined; }
  };

  /** Settings-form fallback window: describe() is far too expensive per chunk. */
  const SETTINGS_SNAPSHOT_MS = 500;
  let snapshotAt = 0;
  let snapshotValue;
  /** @returns {object|undefined} */
  const settingsSnapshot = () => {
    const now = Date.now();
    if (snapshotAt !== 0 && now - snapshotAt < SETTINGS_SNAPSHOT_MS) return snapshotValue;
    let value;
    try { value = settings.read(); } catch { value = undefined; }
    // Cache hits only: the tools are built before the async settings injection
    // has wired the reader, so an early undefined must not stick for a window —
    // a stale empty Config silently turns the mode gate off.
    if (value !== undefined) {
      snapshotAt = now;
      snapshotValue = value;
    }
    return value;
  };
  const invalidateSnapshot = () => { snapshotAt = 0; snapshotValue = undefined; };

  const getConfig = () => {
    const value = fiberConfig() ?? settingsSnapshot();
    const live = value && typeof value === 'object' ? value : undefined;
    return { ...baseConfig, ...live, mode: live?.mode ?? baseConfig.mode ?? 'manual' };
  };

  /**
   * Write a new mode through whichever settings API the host offers, then drop
   * the cached snapshot so the next read sees it (the mode gate must not lag).
   * @param {string} mode
   */
  const setMode = async (mode) => {
    invalidateSnapshot();
    if (typeof settings.setMode !== 'function') throw new TypeError('computer-user: settings service unavailable');
    try {
      await settings.setMode(mode);
    } finally {
      invalidateSnapshot();
    }
  };

  // ── register tools ──
  // One definition rejected by a host schema check must not take the whole
  // plugin down: log it and keep the remaining tools (and the settings/card
  // wiring below) alive.
  ctx.effect(() => {
    const disposers = [];
    for (const tool of createComputerTools({ runPs, getConfig, approvedSessions, sessionIds: [], setMode, isStopped, stopReason, ensureGuard, stopGuard })) {
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
            const tools = createComputerTools({ runPs, getConfig, approvedSessions, sessionIds, setMode, isStopped, stopReason, ensureGuard, stopGuard });
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
        description: '批准或撤销电脑操作',
        handler: async (invocation) => {
          // /computer 是开关：第一次批准当前会话，再按一次撤销批准。
          // 但急停标记（stop.flag）存在时按 /computer 必须表示「恢复」：超时自动急停
          // 之后会话往往仍处于已批准状态，若按开关语义会变成撤销，用户得连按两次
          // 才回到可用状态（issue #7）。所以先清标记，再按批准结果回话。
          const targets = sessionTargetsFromInvocation(invocation);
          const ids = [...targets].join(', ');
          const wasStopped = isStopped();
          const wasApproved = [...targets].some((t) => approvedSessions.has(t));
          if (planCommandAction({ stopped: wasStopped, approved: wasApproved }) === 'resume') {
            clearStop();
            return { kind: 'success', text: `✅ 已恢复：已清除急停标记，computer-user 全部工具在当前会话重新可用（${ids}）。` };
          }
          const { approved } = toggleApproval(approvedSessions, targets);
          if (approved) clearStop();
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
  //     The 0.1.x provider proxy is only a FALLBACK: on 0.2.x the waterfall
  //     exists and the adapter is reachable through it as well, so both layers
  //     would guard the same chunk. Two layers are not just wasted work — the
  //     outer one never sees the first fake text (the inner layer already
  //     replaced it with the note), so the second occurrence of the same text
  //     would be rejected again and the "passes the second time" promise breaks.
  //     The proxy therefore uninstalls itself the first time the waterfall runs.
  const providerGuards = [];
  const unwrapProviderGuards = () => {
    while (providerGuards.length > 0) {
      const entry = providerGuards.pop();
      try { entry.registration.adapter = entry.original; } catch { /* ignore */ }
    }
  };

  try {
    if (typeof ctx.on === 'function') {
      ctx.on('llm/stream', (_options, next) => {
        // 0.2.x: this waterfall is the live path — retire the fallback proxy
        // before next() resolves the adapter, so this stream is guarded once.
        unwrapProviderGuards();
        return guardStream(next(), getConfig);
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
          providerGuards.push({ registration: reg, original: orig });
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
    const where = backend.id === 'windows' && typeof backend.powerShellScript === 'function'
      ? backend.powerShellScript('capture.ps1') + ', ' + backend.powerShellScript('input.ps1')
      : 'macOS 原生后端（screencapture / osascript / cliclick）';
    ctx.logger?.info?.(`[computer-user] backend: ${backend.id} — ${where}`);
  }
}

export default { name, version, inject, Config, apply };

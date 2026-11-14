/**
 * Tool discovery for the macOS backend.
 *
 * macOS ships `screencapture`, `sips`, `osascript` and `system_profiler`; only
 * `cliclick` (brew) is optional. Nothing here throws — callers turn a missing
 * tool into a message that names the exact install command.
 *
 * @module platform/darwin/paths
 */

/** Names the backend depends on. */
export const TOOLS = ['screencapture', 'sips', 'osascript', 'cliclick', 'sw_vers'];

/**
 * Locate an executable with `which`. Resolves to null when it is not installed.
 * @param {import('./exec.js').Exec} exec
 * @param {string} name
 * @returns {Promise<string|null>}
 */
export async function which(exec, name) {
  try {
    const res = await exec('which', [name], { timeoutMs: 5000 });
    if (res.code !== 0) return null;
    const path = String(res.stdout || '').trim().split(/\r?\n/)[0];
    return path || null;
  } catch {
    return null;
  }
}

/**
 * Cached probe over the tool set. One `which` per tool per process.
 * @param {import('./exec.js').Exec} exec
 * @param {Map<string, string|null>} [cache]
 */
export function createToolProbe(exec, cache = new Map()) {
  return {
    /** @param {string} name */
    async path(name) {
      if (!cache.has(name)) cache.set(name, await which(exec, name));
      return cache.get(name);
    },
    /** @param {string} name */
    async has(name) {
      return (await this.path(name)) !== null;
    },
    /** Everything the doctor needs, in one round trip. */
    async snapshot() {
      /** @type {Record<string, string|null>} */
      const found = {};
      for (const name of TOOLS) found[name] = await this.path(name);
      return found;
    },
  };
}

/** The one-line fix a user needs when an optional tool is missing. */
export const CLICLICK_HINT = 'brew install cliclick（macOS 上的鼠标/键盘注入工具；没有它，点击/移动/拖拽/滚动不可用）';

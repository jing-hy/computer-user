/**
 * One error shape for "macOS backend does not do this yet".
 *
 * Silence would be worse: a model that calls `computer_snapshot` on macOS must
 * get a message that names the gap and points at the docs, not an empty result.
 *
 * @module platform/darwin/unsupported
 */

/**
 * @param {string} capability  e.g. 'computer_snapshot（控件树）'
 * @param {string} [detail]    why / what would be needed instead
 * @returns {Error}
 */
export function unsupported(capability, detail) {
  const e = new Error(
    'computer-user(mac): ' + capability + ' 暂不支持。' +
      (detail ? detail + ' ' : '') +
      'macOS 后端当前支持：截图、鼠标（需 cliclick）、键盘、窗口列表/前台/激活、等待、接管提示条。' +
      '控件树（AX API）、窗口移动/关闭尚未实现，详见 docs/mac-backend.md。'
  );
  e.unsupported = true;
  e.capability = capability;
  return e;
}

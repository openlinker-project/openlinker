/**
 * Untyped Config/Patch Bag String Readers
 *
 * Tiny narrowing helpers for reading string leaves off the untyped
 * `Record<string, unknown>` bags that flow through connection-config editing:
 * the persisted `connection.config` object, the RHF values bag, and the
 * per-keystroke structured patch handed to a plugin's
 * `ConnectionConfigContribution.applyToConfig`. Promoted here from the
 * per-plugin / per-form copies (PR #1317 review) so plugin contributions and
 * the host `EditConnectionForm` share one definition.
 *
 * @module shared/plugins
 * @see {@link ConnectionConfigContribution} for the consuming plugin seam
 */

/** Read a string leaf off an untyped config/patch bag; anything else reads as `''`. */
export function readConfigString(bag: Record<string, unknown>, key: string): string {
  const value = bag[key];
  return typeof value === 'string' ? value : '';
}

/** Read a string leaf off an untyped patch, preserving "absent" as `undefined`. */
export function readOptionalConfigString(
  bag: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = bag[key];
  return typeof value === 'string' ? value : undefined;
}

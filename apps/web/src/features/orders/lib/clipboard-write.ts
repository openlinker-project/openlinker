/**
 * Copy text to the clipboard, with a fallback (#3539)
 *
 * `navigator.clipboard` is absent in an insecure context (an operator on a
 * plain-http intranet host is a real deployment) and can reject on a permission
 * refusal. The note is something an operator pastes into a carrier's remarks
 * field, so a silent no-op is the worst outcome: fall back to a hidden textarea
 * and `execCommand('copy')`, and report whether either route worked so the
 * caller only says "Copied" when it is true.
 *
 * @module apps/web/src/features/orders/lib
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the textarea route.
    }
  }
  if (typeof document === 'undefined') return false;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    // `execCommand` is deprecated but remains the only route in an insecure context.
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(area);
  }
}

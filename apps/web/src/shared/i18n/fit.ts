/**
 * fit
 *
 * Marks a copy string that sits in a tight spot (a button, nav item, chip or
 * table header) with a character budget: `fit(18, 'Create shipment')`. At
 * runtime it returns the text unchanged; `scripts/check-copy-locales.mjs`
 * fails the build when any language's text for that key is longer than the
 * budget, so a long translation is caught before it breaks the layout.
 *
 * @module shared/i18n
 */
export function fit(maxLength: number, text: string): string {
  void maxLength;
  return text;
}

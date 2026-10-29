/**
 * Margin panel visibility gate
 *
 * The single place that decides whether the Margin panel renders on
 * /analytics. Today it is always visible; the `trackMargin` admin setting
 * (a later phase) is read here and nowhere else, so turning the panel off
 * is one edit.
 *
 * @module features/analytics/hooks
 */
export function useMarginPanelVisible(): boolean {
  return true;
}

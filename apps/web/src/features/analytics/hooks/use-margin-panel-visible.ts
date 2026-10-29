/**
 * Margin panel visibility gate
 *
 * The single place that decides whether the Margin panel renders on
 * /analytics: it is visible unless the `trackMargin` admin setting is off.
 *
 * @module features/analytics/hooks
 */
import { useTrackMargin } from './use-track-margin';

export function useMarginPanelVisible(): boolean {
  return useTrackMargin();
}

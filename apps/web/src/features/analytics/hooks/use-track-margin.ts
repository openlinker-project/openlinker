/**
 * Track-margin setting (#3588, G11-F)
 *
 * `false` only when the saved setting says so. While the settings read is in
 * flight, or if it fails, margin UI stays on: "not known yet" is not "off", and
 * a failed read must not silently remove the reminders an operator relies on.
 *
 * @module features/analytics/hooks
 */
import { useAnalyticsSettingsQuery } from './use-analytics-settings-query';

export function useTrackMargin(): boolean {
  const query = useAnalyticsSettingsQuery();
  return query.data?.trackMargin !== false;
}

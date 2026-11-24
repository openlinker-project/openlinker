/**
 * Short Period Label (#4289)
 *
 * "3 mies.", "2 lata", "nigdy": a whole-day period in the compact form a strip
 * handle or a table cell has room for.
 *
 * @module apps/web/src/features/buyer-data/hooks
 */
import { useCallback } from 'react';
import { useMessages, usePlural } from '../../../shared/i18n';
import { daysToPeriod } from '../lib/buyer-data-config';

export function useShortPeriod(): (days: number) => string {
  const copy = useMessages('buyer-data').period;
  const plural = usePlural();
  return useCallback(
    (days) => {
      if (days <= 0) return copy.shortNever;
      const { amount, unit } = daysToPeriod(days);
      return plural(amount, copy.short[unit], { n: amount });
    },
    [copy, plural]
  );
}

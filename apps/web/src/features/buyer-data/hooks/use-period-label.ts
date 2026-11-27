/**
 * Period Label Hook (#4289)
 *
 * "after 3 months", "after 1 year": a whole-day period spoken in the largest
 * unit that divides it exactly, with the active language's plural. `0` is never
 * a period (it means the rule is off), so callers branch before asking.
 *
 * @module apps/web/src/features/buyer-data/hooks
 */
import { useCallback } from 'react';
import { useMessages, usePlural } from '../../../shared/i18n';
import { daysToPeriod } from '../lib/buyer-data-config';

export function usePeriodLabel(): (days: number, options?: { capitalize?: boolean }) => string {
  const copy = useMessages('buyer-data').period;
  const plural = usePlural();
  return useCallback(
    (days, options) => {
      const { amount, unit } = daysToPeriod(days);
      const text = plural(amount, copy.after[unit], { n: amount });
      return options?.capitalize === true ? text.charAt(0).toUpperCase() + text.slice(1) : text;
    },
    [copy, plural]
  );
}

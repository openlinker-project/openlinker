/**
 * Buyer Data Summary (#4289)
 *
 * The one-line description of what a set of rules does, used wherever a surface
 * has no room for the studio (the connection list, the wizard review, the
 * "same as general" note).
 *
 * @module apps/web/src/features/buyer-data/hooks
 */
import { interpolate, useMessages } from '../../../shared/i18n';
import type { BuyerDataRules } from '../api/buyer-data.types';
import { usePeriodLabel } from './use-period-label';

export function useBuyerDataSummary(): (rules: BuyerDataRules) => string {
  const copy = useMessages('buyer-data').rules;
  const periodLabel = usePeriodLabel();
  return (rules) => {
    const hide =
      rules.hideAfterDays > 0
        ? interpolate(copy.summaryHideOn, { when: periodLabel(rules.hideAfterDays) })
        : copy.summaryHideNever;
    const erase =
      rules.eraseAfterDays <= 0
        ? copy.summaryEraseNever
        : interpolate(
            rules.mode === 'whole-order' ? copy.summaryEraseWhole : copy.summaryErasePersonal,
            { when: periodLabel(rules.eraseAfterDays) }
          );
    return `${hide} ${erase}`;
  };
}

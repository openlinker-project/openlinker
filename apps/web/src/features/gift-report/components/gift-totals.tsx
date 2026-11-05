/**
 * Gift totals + unknown-cost note (#3943)
 *
 * "Customers paid X, it cost you Y". Totals arrive split per currency because
 * the report never converts; each currency gets its own line. Gifts without a
 * purchase cost are named in the sentence and in a warning, because the cost
 * above them is then a floor, not the whole cost.
 *
 * @module features/gift-report/components
 */
import type { ReactElement } from 'react';
import { Alert } from '../../../shared/ui/alert';
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
import type { GiftReportTotals } from '../api/gift-report.types';

interface GiftTotalsProps {
  totals: readonly GiftReportTotals[];
}

export function GiftTotals({ totals }: GiftTotalsProps): ReactElement {
  const copy = useMessages('giftReport');
  const format = useFormat();
  const unknown = totals.reduce((sum, total) => sum + total.unknownCostUnits, 0);

  return (
    <div className="gift-report-totals">
      {totals.map((total) => {
        const currency = total.currency ?? undefined;
        return (
          <div key={total.currency ?? 'none'} data-testid="gift-report-whopays">
            <dl className="gift-report-totals__figures">
              <div>
                <dt>{copy.summary.paid}</dt>
                <dd>{format.money(total.paidGross, currency)}</dd>
              </div>
              <div>
                <dt>{copy.summary.cost}</dt>
                <dd data-testid="gift-report-total-cost">{format.money(total.costNet, currency)}</dd>
              </div>
              <div>
                <dt>{copy.summary.units}</dt>
                <dd data-testid="gift-report-total-units">{total.units}</dd>
              </div>
            </dl>
            <p>
              {interpolate(copy.summary.sentence, {
                paid: format.money(total.paidGross, currency),
                units: total.units,
                cost: format.money(total.costNet, currency),
              })}
              {total.unknownCostUnits > 0
                ? ` ${interpolate(copy.summary.unknownInSentence, { n: total.unknownCostUnits })}`
                : ''}
            </p>
          </div>
        );
      })}
      {unknown > 0 ? (
        <Alert tone="warning" title={interpolate(copy.unknown.title, { n: unknown })} data-testid="gift-report-unknown-alert">
          {copy.unknown.body}
        </Alert>
      ) : null}
    </div>
  );
}

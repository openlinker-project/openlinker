/**
 * Gift report KPIs
 *
 * Four figures for one currency: gifts given, orders that carried one, what it
 * cost and the cost per order. Totals arrive split per currency (the report
 * never converts), so each currency gets its own row. Gifts with no purchase
 * cost are named under the cost: the figure is then a floor, not the whole.
 *
 * @module features/gift-report/components
 */
import type { ReactElement } from 'react';
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
import type { GiftReportTotals } from '../api/gift-report.types';

export function GiftReportKpis({ totals }: { totals: readonly GiftReportTotals[] }): ReactElement {
  const copy = useMessages('gift-report').kpis;
  const format = useFormat();
  const two = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return (
    <>
      {totals.map((total) => {
        const money = (amount: number): string => format.money(amount, total.currency ?? undefined);
        const perOrder = total.orders > 0 ? total.costNet / total.orders : 0;
        return (
          <div className="gift-kpis" key={total.currency ?? 'none'} data-testid="gift-report-whopays">
            <div className="gift-kpi">
              <span className="gift-kpi__l">{copy.units}</span>
              <span className="gift-kpi__n" data-testid="gift-report-total-units">
                {format.number(total.units)}
              </span>
              <span className="gift-kpi__s">{copy.unitsNote}</span>
            </div>
            <div className="gift-kpi">
              <span className="gift-kpi__l">{copy.orders}</span>
              <span className="gift-kpi__n">{format.number(total.orders)}</span>
              <span className="gift-kpi__s">{copy.ordersNote}</span>
            </div>
            <div className="gift-kpi">
              <span className="gift-kpi__l">{copy.cost}</span>
              <span className="gift-kpi__n" data-testid="gift-report-total-cost">
                {money(total.costNet)}
              </span>
              <span className="gift-kpi__s">
                {total.unknownCostUnits > 0
                  ? interpolate(copy.costNoteUnknown, { n: total.unknownCostUnits })
                  : copy.costNote}
              </span>
            </div>
            <div className="gift-kpi">
              <span className="gift-kpi__l">{copy.perOrder}</span>
              <span className="gift-kpi__n">
                {total.orders > 0 ? format.money(Number(perOrder.toFixed(2)), total.currency ?? undefined) : format.number(0, two)}
              </span>
              <span className="gift-kpi__s">{copy.perOrderNote}</span>
            </div>
          </div>
        );
      })}
    </>
  );
}

/**
 * Margin coverage note
 *
 * The honesty line under the KPIs: how many order lines are NOT in margin and
 * how much net revenue that is, expanding to the reasons. Margin and margin %
 * are computed over covered lines only, so a gap is always visible here
 * rather than silently shrinking the figure.
 *
 * @module features/analytics/components
 */
import { useId, type ReactElement } from 'react';
import { useFormat, useMessages, usePlural } from '../../../shared/i18n';
import type { MarginFigures } from '../api/margin-analytics.types';
import { marginGapCopy, totalMarginGaps } from '../lib/margin.lib';

export const MARGIN_COVERAGE_TOGGLE_TESTID = 'margin-coverage-toggle';

interface MarginCoverageNoteProps {
  figures: MarginFigures;
  currency: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MarginCoverageNote({
  figures,
  currency,
  open,
  onOpenChange,
}: MarginCoverageNoteProps): ReactElement | null {
  const detailsId = useId();
  const copy = useMessages('analytics').marginCoverageNote;
  const format = useFormat();
  const plural = usePlural();
  const totals = totalMarginGaps(figures.gaps);
  if (totals.lineCount === 0) return null;

  return (
    <div className="analytics-margin__coverage" data-testid="margin-coverage-note">
      <div>
        <button
          type="button"
          className="chip chip--warning excl-note"
          aria-expanded={open}
          aria-controls={detailsId}
          data-testid={MARGIN_COVERAGE_TOGGLE_TESTID}
          onClick={() => onOpenChange(!open)}
        >
          {plural(totals.lineCount, copy.toggle, {
            amount: format.money(totals.netAmount, currency),
          })}
        </button>
      </div>
      <div
        id={detailsId}
        className="analytics-margin__coverage-detail data-table__container"
        data-testid="margin-coverage-details"
        hidden={!open}
      >
        <table className="data-table">
          <caption className="sr-only">{copy.caption}</caption>
          <thead>
            <tr>
              <th>{copy.columns.reason}</th>
              <th className="analytics-margin__num">{copy.columns.lines}</th>
              <th className="analytics-margin__num">{copy.columns.netRevenue}</th>
              <th>{copy.columns.whatToDo}</th>
            </tr>
          </thead>
          <tbody>
            {totals.gaps.map((gap) => (
              <tr key={gap.reason} data-testid={`margin-coverage-reason-${gap.reason}`}>
                <td>{marginGapCopy(gap.reason).reason}</td>
                <td className="analytics-margin__num">{format.number(gap.lineCount)}</td>
                <td className="analytics-margin__num">{format.money(gap.netAmount, currency)}</td>
                <td className="text-muted">{marginGapCopy(gap.reason).action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

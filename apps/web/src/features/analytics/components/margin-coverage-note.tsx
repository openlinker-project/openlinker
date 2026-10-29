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
import { formatAmount } from '../../../shared/format/format-amount';
import { useNumberFormat } from '../../../shared/i18n/use-number-format';
import type { MarginFigures } from '../api/margin-analytics.types';
import { MARGIN_GAP_COPY, totalMarginGaps } from '../lib/margin-copy';

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
  const intFormat = useNumberFormat();
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
          {intFormat.format(totals.lineCount)} {totals.lineCount === 1 ? 'line is' : 'lines are'} not
          in margin · {formatAmount(totals.netAmount, currency)} of net revenue left out
        </button>
      </div>
      <div
        id={detailsId}
        className="analytics-margin__coverage-detail data-table__container"
        data-testid="margin-coverage-details"
        hidden={!open}
      >
        <table className="data-table">
          <caption className="sr-only">Why lines are left out of margin</caption>
          <thead>
            <tr>
              <th>Reason</th>
              <th className="analytics-margin__num">Lines</th>
              <th className="analytics-margin__num">Net revenue</th>
              <th>What to do</th>
            </tr>
          </thead>
          <tbody>
            {totals.gaps.map((gap) => (
              <tr key={gap.reason} data-testid={`margin-coverage-reason-${gap.reason}`}>
                <td>{MARGIN_GAP_COPY[gap.reason].reason}</td>
                <td className="analytics-margin__num">{intFormat.format(gap.lineCount)}</td>
                <td className="analytics-margin__num">{formatAmount(gap.netAmount, currency)}</td>
                <td className="text-muted">{MARGIN_GAP_COPY[gap.reason].action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

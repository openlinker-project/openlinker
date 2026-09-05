/**
 * Analytics Money Basis Toggle (#2895)
 *
 * Page-level Net/Gross viewing preference, rendered at the same visual tier
 * as the date-range toolbar and the display-currency picker (same toolbar
 * row) — see `analytics-page.tsx`. Nothing is saved; the choice lives in the
 * URL (`?basis=`), same as `displayCurrency`/`rateBasis` (ADR-064) and the
 * date range itself.
 *
 * See `lib/money-basis.lib.ts` for why the default is `net`, not `gross`.
 *
 * @module apps/web/src/features/analytics/components
 */
import type { ReactElement } from 'react';
import { SegmentedControl } from '../../../shared/ui/segmented-control';
import type { MoneyBasis } from '../lib/money-basis.lib';

interface AnalyticsMoneyBasisToggleProps {
  basis: MoneyBasis;
  onChange: (basis: MoneyBasis) => void;
}

const OPTIONS = [
  { value: 'net' as const, label: 'Net' },
  { value: 'gross' as const, label: 'Gross' },
];

export function AnalyticsMoneyBasisToggle({
  basis,
  onChange,
}: AnalyticsMoneyBasisToggleProps): ReactElement {
  return (
    <SegmentedControl
      aria-label="Money basis"
      options={OPTIONS}
      value={basis}
      onChange={onChange}
    />
  );
}

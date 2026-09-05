/**
 * Analytics Net/Gross Toggle
 *
 * Toolbar control for the VAT basis a view is read in — `gross` (VAT-inclusive,
 * the default) or `net` (VAT-exclusive). Mirrors `AnalyticsCurrencyPicker`'s
 * shape: the current choice lives in the URL (`?netGrossBasis=`), same as the
 * date range and the display currency, so it is shareable and reversible with
 * no persisted side effect. Rendered directly below the currency picker in
 * the toolbar's trailing slot — same column, second row — since both are
 * "how to read this view" preferences and the currency picker is the taller,
 * more consequential choice of the pair.
 *
 * @module apps/web/src/features/analytics/components
 */
import type { ReactElement } from 'react';
import { SegmentedControl } from '../../../shared/ui';
import type { NetGrossBasis } from '../api/analytics-settings.types';

interface AnalyticsNetGrossToggleProps {
  value: NetGrossBasis;
  onChange: (value: NetGrossBasis) => void;
}

const OPTIONS: readonly { value: NetGrossBasis; label: string }[] = [
  { value: 'gross', label: 'Gross' },
  { value: 'net', label: 'Net' },
];

export function AnalyticsNetGrossToggle({
  value,
  onChange,
}: AnalyticsNetGrossToggleProps): ReactElement {
  return (
    <div className="analytics-toolbar__field analytics-net-gross-toggle">
      <span className="sr-only">VAT basis</span>
      <SegmentedControl aria-label="VAT basis" options={OPTIONS} value={value} onChange={onChange} />
    </div>
  );
}

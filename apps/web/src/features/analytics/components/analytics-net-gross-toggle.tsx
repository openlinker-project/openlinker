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
 * `value` accepts `null` for "not resolved yet" (#2668 review, finding 3/6):
 * the basis has a PERSISTED default, so between first paint and the settings
 * response there is genuinely no answer, and pre-selecting `gross` would
 * assert one — the toggle would show `Gross` selected for an operator whose
 * saved default is `net`, then move under them. The control renders
 * `aria-busy` with neither segment selected and refuses input for that
 * window, which is the same window `analytics-page.tsx` withholds every
 * money figure for.
 *
 * @module apps/web/src/features/analytics/components
 */
import type { ReactElement } from 'react';
import { SegmentedControl } from '../../../shared/ui';
import type { NetGrossBasis } from '../api/analytics-settings.types';

interface AnalyticsNetGrossToggleProps {
  /** `null` = the persisted default has not resolved yet — see the file header. */
  value: NetGrossBasis | null;
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
  const pending = value === null;
  return (
    <div
      className="analytics-toolbar__field analytics-net-gross-toggle"
      aria-busy={pending || undefined}
    >
      <span className="sr-only">VAT basis</span>
      <SegmentedControl
        aria-label="VAT basis"
        options={pending ? OPTIONS.map((option) => ({ ...option, disabled: true })) : OPTIONS}
        value={value}
        onChange={onChange}
      />
    </div>
  );
}

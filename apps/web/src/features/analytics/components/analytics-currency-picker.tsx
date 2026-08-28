/**
 * Analytics Currency Picker
 *
 * Toolbar control for ADR-064's display-currency preference — an operator
 * chooses a currency to view the dashboard in, on top of (never instead of)
 * the stamped `order_records.reportingCurrency`. Nothing is saved; the
 * choice lives in the URL (`?displayCurrency=`), same as the date range.
 *
 * @module apps/web/src/features/analytics/components
 */
import type { ReactElement } from 'react';
import { Select } from '../../../shared/ui';
import { DISPLAY_CURRENCY_OPTIONS } from '../lib/display-currency.lib';

interface AnalyticsCurrencyPickerProps {
  /** The system reporting currency (`ReportingCurrencySettingsView`) — `null` while trust data hasn't loaded yet. */
  reportingCurrency: string | null;
  /** `null` means no override — the dashboard renders in `reportingCurrency`. */
  displayCurrency: string | null;
  onChange: (displayCurrency: string | null) => void;
}

const NATIVE_VALUE = '';

export function AnalyticsCurrencyPicker({
  reportingCurrency,
  displayCurrency,
  onChange,
}: AnalyticsCurrencyPickerProps): ReactElement {
  const options = DISPLAY_CURRENCY_OPTIONS.filter((code) => code !== reportingCurrency);

  return (
    <label className="analytics-toolbar__field">
      <span className="sr-only">Display currency</span>
      <Select
        aria-label="Display currency"
        value={displayCurrency ?? NATIVE_VALUE}
        onChange={(event) => {
          const value = event.target.value;
          onChange(value === NATIVE_VALUE ? null : value);
        }}
      >
        <option value={NATIVE_VALUE}>
          {reportingCurrency ? `Current rate · ${reportingCurrency}` : 'Reporting currency'}
        </option>
        {options.map((code) => (
          <option key={code} value={code}>
            Convert to {code}
          </option>
        ))}
      </Select>
    </label>
  );
}

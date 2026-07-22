/**
 * ErliDispatchTimeField
 *
 * Shared, content-only field group for Erli's dispatch (handling) time —
 * the Erli-specific control that replaces Allegro's delivery-policy step.
 * Consumed by `ErliBulkConfigSection` (batch default) and `ErliBulkRowSection`
 * (per-row override) so the field never drifts (#1096).
 *
 * Controlled via `value` + `onChange` rather than bound to a specific RHF
 * form, so each host wires it into its own form state. Renders a period
 * segmented control (preset
 * quick-picks + a free-entry input) and a unit `<Select>`, with a "connection
 * default" badge while the value is unchanged from the shop default.
 *
 * @module features/listings/components/erli
 */
import { useId, useState, type ReactElement } from 'react';

import { Input } from '../../../../shared/ui/input';
import { Select } from '../../../../shared/ui/select';
import { useTranslation } from '../../../../shared/i18n';
import {
  ERLI_DISPATCH_PERIOD_PRESETS,
  ErliDispatchUnitValues,
  formatDispatch,
  type ErliDispatchTimeParam,
  type ErliDispatchUnit,
} from './erli-offer-fields.schema';

interface ErliDispatchTimeFieldProps {
  value: ErliDispatchTimeParam;
  onChange: (next: ErliDispatchTimeParam) => void;
  /** Connection default — drives the "connection default" badge + the offer count copy. */
  connectionDefault: ErliDispatchTimeParam;
  /** Number of offers this dispatch applies to (bulk) — omit/1 for single. */
  appliesToCount?: number;
  /** Soft error message rendered below the control (host validation). */
  error?: string;
}

const UNIT_LABELS: Record<ErliDispatchUnit, string> = {
  hour: 'hours',
  day: 'working days',
  month: 'months',
};

export function ErliDispatchTimeField({
  value,
  onChange,
  connectionDefault,
  appliesToCount,
  error,
}: ErliDispatchTimeFieldProps): ReactElement {
  const { t } = useTranslation();
  const periodInputId = useId();
  // Transient draft so clearing the input doesn't snap to 0 (`Number('') === 0`).
  // While the draft holds a partial/empty entry the committed `value.period` is
  // unchanged; on blur an empty/invalid draft reverts to the committed value.
  const [periodDraft, setPeriodDraft] = useState<string | null>(null);
  const periodDisplay = periodDraft ?? String(value.period);

  function commitPeriod(period: number): void {
    setPeriodDraft(null);
    onChange({ ...value, period });
  }

  const isFromDefault =
    value.period === connectionDefault.period && value.unit === connectionDefault.unit;

  const presets = ERLI_DISPATCH_PERIOD_PRESETS.includes(value.period)
    ? ERLI_DISPATCH_PERIOD_PRESETS
    : [...ERLI_DISPATCH_PERIOD_PRESETS, value.period].sort((a, b) => a - b);

  const readout =
    appliesToCount && appliesToCount > 1
      ? t(
          'listings.erli.dispatch.readoutBatch',
          `Applied to all ${appliesToCount.toLocaleString()} offers — buyers see "ships in ${formatDispatch(value)}".`,
        )
      : t(
          'listings.erli.dispatch.readout',
          `Buyers see "ships in ${formatDispatch(value)}".`,
        );

  return (
    <div className="erli-dispatch">
      <div className="erli-dispatch__top">
        <span className="erli-dispatch__label" id={`${periodInputId}-label`}>
          {t('listings.erli.dispatch.label', 'Dispatch time')}{' '}
          <span className="erli-dispatch__req">
            {t('listings.erli.dispatch.required', '· required by Erli')}
          </span>
        </span>
        {isFromDefault ? (
          <span className="erli-dispatch__from-default">
            {t('listings.erli.dispatch.fromDefault', 'connection default')}
          </span>
        ) : null}
      </div>

      <div className="erli-dispatch__dial">
        <span
          className="erli-dispatch__seg"
          role="group"
          aria-labelledby={`${periodInputId}-label`}
        >
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              className="erli-dispatch__seg-btn"
              aria-pressed={value.period === preset}
              onClick={() => commitPeriod(preset)}
            >
              {preset}
            </button>
          ))}
        </span>

        <Input
          id={periodInputId}
          type="number"
          min={0}
          className="erli-dispatch__period-input"
          value={periodDisplay}
          aria-label={t('listings.erli.dispatch.periodLabel', 'Dispatch period')}
          aria-invalid={Boolean(error)}
          onChange={(e) => {
            const raw = e.target.value;
            setPeriodDraft(raw);
            // Commit only a valid non-negative integer; an empty/partial entry
            // keeps the last committed period so the field doesn't snap to 0.
            const next = Number(raw);
            if (raw.trim() !== '' && Number.isInteger(next) && next >= 0) {
              onChange({ ...value, period: next });
            }
          }}
          onBlur={() => setPeriodDraft(null)}
        />

        <Select
          className="erli-dispatch__unit"
          value={value.unit}
          aria-label={t('listings.erli.dispatch.unitLabel', 'Dispatch unit')}
          onChange={(e) => onChange({ ...value, unit: e.target.value as ErliDispatchUnit })}
        >
          {ErliDispatchUnitValues.map((unit) => (
            <option key={unit} value={unit}>
              {UNIT_LABELS[unit]}
            </option>
          ))}
        </Select>
      </div>

      <p className="erli-dispatch__readout">{readout}</p>
      {error ? (
        <p className="erli-dispatch__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

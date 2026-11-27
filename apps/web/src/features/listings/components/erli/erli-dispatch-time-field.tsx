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
import { interpolate, useFormat, useMessages, usePlural } from '../../../../shared/i18n';
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
  /** The marketplace's display name, so copy can say whose account to check. */
  platformName: string;
  /** Number of offers this dispatch applies to (bulk) — omit/1 for single. */
  appliesToCount?: number;
  /** Soft error message rendered below the control (host validation). */
  error?: string;
}

export function ErliDispatchTimeField({
  value,
  onChange,
  connectionDefault,
  platformName,
  appliesToCount,
  error,
}: ErliDispatchTimeFieldProps): ReactElement {
  const copy = useMessages('listings').erliDispatchTimeField;
  const plural = usePlural();
  const format = useFormat();
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

  const dispatch = formatDispatch(value);
  const readout =
    appliesToCount && appliesToCount > 1
      ? plural(appliesToCount, copy.readoutBatch, { dispatch })
      : interpolate(copy.readout, { dispatch });

  return (
    <div className="erli-dispatch">
      <div className="erli-dispatch__top">
        <span className="erli-dispatch__label" id={`${periodInputId}-label`}>
          {copy.label}{' '}
          <span className="erli-dispatch__req">
            {interpolate(copy.required, { platform: platformName })}
          </span>
        </span>
        {isFromDefault ? (
          <span className="erli-dispatch__from-default">
            {copy.fromDefault}
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
              {format.number(preset)}
            </button>
          ))}
        </span>

        <Input
          id={periodInputId}
          type="number"
          min={0}
          className="erli-dispatch__period-input"
          value={periodDisplay}
          aria-label={copy.periodLabel}
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
          aria-label={copy.unitLabel}
          onChange={(e) => onChange({ ...value, unit: e.target.value as ErliDispatchUnit })}
        >
          {ErliDispatchUnitValues.map((unit) => (
            <option key={unit} value={unit}>
              {copy.units[unit]}
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

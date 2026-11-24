/**
 * Period Input (#4289)
 *
 * The precise twin of a strip handle: a number, a unit (days, months, years)
 * and a "never" switch, for the operator who knows the figure and for a phone
 * where dragging is fiddly. It reports whole days and follows the strip when a
 * handle moves.
 *
 * @module apps/web/src/features/buyer-data/components
 */
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { daysToPeriod, periodToDays, type PeriodUnit } from '../lib/buyer-data-config';

export interface PeriodInputProps {
  name: string;
  label: string;
  description?: string;
  neverLabel: string;
  /** Whole days; `0` = never. */
  days: number;
  onChange: (days: number) => void;
  error?: string;
  disabled?: boolean;
  /** Un-ticking "never" restores the last period, but never one shorter than this. */
  restoreAtLeastDays?: number;
}

const UNITS: readonly PeriodUnit[] = ['days', 'months', 'years'];

export function PeriodInput({
  name,
  label,
  description,
  neverLabel,
  days,
  onChange,
  error,
  disabled = false,
  restoreAtLeastDays = 1,
}: PeriodInputProps): ReactElement {
  const copy = useMessages('buyer-data').period;
  const labelId = useId();
  const seed = daysToPeriod(days > 0 ? days : 365);
  const [amount, setAmount] = useState(days > 0 ? String(seed.amount) : '');
  const [unit, setUnit] = useState<PeriodUnit>(seed.unit);
  const lastDays = useRef(days > 0 ? days : 365);

  // A handle moved on the strip: show its value here too.
  useEffect(() => {
    if (days > 0) {
      lastDays.current = days;
      const typed = amount === '' ? NaN : periodToDays(Number(amount), unit);
      if (typed !== days) {
        const next = daysToPeriod(days);
        setAmount(String(next.amount));
        setUnit(next.unit);
      }
    }
    // Only an outside change of `days` should re-seed the fields.
  }, [days]);

  const never = days <= 0;
  const unitLabel: Record<PeriodUnit, string> = {
    days: copy.unitDays,
    months: copy.unitMonths,
    years: copy.unitYears,
  };

  function commit(nextAmount: string, nextUnit: PeriodUnit): void {
    const n = Number(nextAmount);
    if (nextAmount !== '' && Number.isFinite(n) && n > 0) onChange(periodToDays(n, nextUnit));
  }

  return (
    <div
      className="period-field"
      role="group"
      aria-labelledby={labelId}
      data-testid={`period-input-${name}`}
    >
      <span id={labelId} className="period-field__label">
        {label}
      </span>
      {description !== undefined ? <span className="period-field__hint">{description}</span> : null}
      <div className="period-input">
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          value={never ? '' : amount}
          placeholder={never ? '∞' : undefined}
          disabled={disabled || never}
          invalid={error !== undefined}
          aria-label={`${label}: ${copy.customAmount}`}
          onChange={(event) => {
            setAmount(event.target.value);
            commit(event.target.value, unit);
          }}
        />
        <Select
          value={unit}
          disabled={disabled || never}
          aria-label={`${label}: ${copy.customUnit}`}
          onChange={(event) => {
            const next = UNITS.find((u) => u === event.target.value) ?? 'days';
            setUnit(next);
            commit(amount, next);
          }}
        >
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {unitLabel[u]}
            </option>
          ))}
        </Select>
        <label className="period-input__never">
          <input
            type="checkbox"
            checked={never}
            disabled={disabled}
            data-testid={`period-never-${name}`}
            onChange={(event) =>
              onChange(event.target.checked ? 0 : Math.max(lastDays.current, restoreAtLeastDays))
            }
          />
          <span>{neverLabel}</span>
        </label>
      </div>
      {error !== undefined ? (
        <span className="period-field__error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

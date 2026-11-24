/**
 * Buyer Data Period Field (#4289)
 *
 * One question about a period: a select of presets (the first being "never")
 * plus "Custom period", which reveals a number and a unit. The value is always
 * whole days; the unit only changes how the operator types it.
 *
 * @module apps/web/src/features/buyer-data/components
 */
import { useState, type ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { usePeriodLabel } from '../hooks/use-period-label';
import { daysToPeriod, periodToDays, type PeriodUnit } from '../lib/buyer-data-config';

export interface BuyerDataPeriodFieldProps {
  name: string;
  label: string;
  description: string;
  /** The label of the `0` preset. */
  neverLabel: string;
  presets: readonly number[];
  /** Whole days; `0` is never. */
  value: number;
  onChange: (days: number) => void;
  /** A refusal for the current value, already worded. */
  error?: string;
  disabled?: boolean;
}

const CUSTOM = 'custom';

export function BuyerDataPeriodField({
  name,
  label,
  description,
  neverLabel,
  presets,
  value,
  onChange,
  error,
  disabled = false,
}: BuyerDataPeriodFieldProps): ReactElement {
  const copy = useMessages('buyer-data').period;
  const periodLabel = usePeriodLabel();
  const [custom, setCustom] = useState(!presets.includes(value));
  const initial = daysToPeriod(value);
  const [unit, setUnit] = useState<PeriodUnit>(value === 0 ? 'days' : initial.unit);
  const [amount, setAmount] = useState(value === 0 ? '' : String(initial.amount));

  const amountNumber = Number.parseInt(amount, 10);
  const amountError =
    custom && (amount === '' || !Number.isInteger(amountNumber) || amountNumber < 1)
      ? copy.errorAmount
      : undefined;

  function commit(nextAmount: string, nextUnit: PeriodUnit): void {
    const parsed = Number.parseInt(nextAmount, 10);
    if (Number.isInteger(parsed) && parsed >= 1) onChange(periodToDays(parsed, nextUnit));
  }

  return (
    <div data-testid={`buyer-data-period-${name}`}>
      <FormField label={label} name={name} description={description} error={amountError ?? error}>
        <Select
          value={custom ? CUSTOM : String(value)}
          disabled={disabled}
          onChange={(event) => {
            if (event.target.value === CUSTOM) {
              setCustom(true);
              return;
            }
            setCustom(false);
            setAmount('');
            onChange(Number.parseInt(event.target.value, 10));
          }}
        >
          {presets.map((days) => (
            <option key={days} value={String(days)}>
              {days === 0 ? neverLabel : periodLabel(days, { capitalize: true })}
            </option>
          ))}
          <option value={CUSTOM}>{copy.custom}</option>
        </Select>
      </FormField>
      {custom ? (
        <div className="form-field-row">
          <Input
            value={amount}
            inputMode="numeric"
            aria-label={copy.customAmount}
            placeholder={copy.customAmountPlaceholder}
            disabled={disabled}
            invalid={Boolean(amountError ?? error)}
            data-testid={`buyer-data-period-${name}-amount`}
            onChange={(event) => {
              const next = event.target.value.replace(/[^0-9]/g, '');
              setAmount(next);
              commit(next, unit);
            }}
          />
          <Select
            value={unit}
            aria-label={copy.customUnit}
            disabled={disabled}
            data-testid={`buyer-data-period-${name}-unit`}
            onChange={(event) => {
              const next = event.target.value as PeriodUnit;
              setUnit(next);
              commit(amount, next);
            }}
          >
            <option value="days">{copy.unitDays}</option>
            <option value="months">{copy.unitMonths}</option>
            <option value="years">{copy.unitYears}</option>
          </Select>
        </div>
      ) : null}
    </div>
  );
}

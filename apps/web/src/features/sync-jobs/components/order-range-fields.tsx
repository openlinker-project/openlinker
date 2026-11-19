/**
 * Order Range Fields
 *
 * The inputs of the manual "import orders from a date range" run (#4228): the
 * first day, an optional last day and which end of the range is read first.
 * Presentation only; the dialog owns the values, validates them with
 * {@link validateOrderRange} and builds the job payload.
 *
 * @module apps/web/src/features/sync-jobs/components
 */
import type { ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import type { OrderRangeErrors, OrderRangeValue } from '../lib/order-range';
import { earliestOrderRangeDate, todayOrderRangeDate } from '../lib/order-range';

interface OrderRangeFieldsProps {
  value: OrderRangeValue;
  onChange: (value: OrderRangeValue) => void;
  errors: OrderRangeErrors;
  disabled: boolean;
}

export function OrderRangeFields({
  value,
  onChange,
  errors,
  disabled,
}: OrderRangeFieldsProps): ReactElement {
  const copy = useMessages('sync-jobs').triggerSyncDialog.orderRange;
  return (
    <div className="order-range">
      <div className="order-range__dates">
        <FormField label={copy.fromLabel} name="orderRangeFrom" error={errors.from}>
          <Input
            type="date"
            value={value.from}
            min={earliestOrderRangeDate()}
            max={todayOrderRangeDate()}
            disabled={disabled}
            invalid={Boolean(errors.from)}
            onChange={(event) => onChange({ ...value, from: event.target.value })}
          />
        </FormField>
        <FormField
          label={copy.toLabel}
          name="orderRangeTo"
          error={errors.to}
          description={copy.toHelp}
        >
          <Input
            type="date"
            value={value.to}
            min={value.from || earliestOrderRangeDate()}
            max={todayOrderRangeDate()}
            disabled={disabled}
            invalid={Boolean(errors.to)}
            onChange={(event) => onChange({ ...value, to: event.target.value })}
          />
        </FormField>
      </div>
      <FormField label={copy.directionLabel} name="orderRangeDirection">
        <Select
          value={value.direction}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...value, direction: event.target.value as OrderRangeValue['direction'] })
          }
        >
          <option value="oldest-first">{copy.oldestFirst}</option>
          <option value="newest-first">{copy.newestFirst}</option>
        </Select>
      </FormField>
    </div>
  );
}

/**
 * ErliDeliveryPriceListOverrideField (#1530)
 *
 * Per-row delivery-price-list override for the bulk Review edit modal. The field
 * starts pre-filled with the batch default (the value the operator picked on the
 * Config step) and reads as inherited ("Batch default"); once changed it reads as
 * overridden and offers a "Reset to batch default" affordance. Selecting the batch
 * default value again clears the override so the row inherits again.
 *
 * Controlled: `value` is the per-row override (`undefined` = inheriting), the host
 * (edit modal) persists `onChange` output into the row's
 * `platformParams.deliveryPriceList`. Options are fetched live per-connection via
 * `useDeliveryPriceListsQuery`, matching the batch/single wizard picker.
 *
 * @module features/listings/components/erli
 */
import type { ReactElement } from 'react';

import { interpolate, useMessages } from '../../../../shared/i18n';
import { Alert } from '../../../../shared/ui/alert';
import { Button } from '../../../../shared/ui/button';
import { FormField } from '../../../../shared/ui/form-field';
import { Input } from '../../../../shared/ui/input';
import { Select } from '../../../../shared/ui/select';
import { useDeliveryPriceListsQuery } from '../../hooks/use-delivery-price-lists-query';
import { serverErrorText } from '../../lib/server-error-text';

interface ErliDeliveryPriceListOverrideFieldProps {
  connectionId: string;
  /** The marketplace's display name, so copy can say whose account to check. */
  platformName: string;
  /** Per-row override value; `undefined` means the row inherits the batch default. */
  value: string | undefined;
  /** Batch-wide default from the Config step (may be empty = none). */
  batchDefault: string;
  onChange: (next: string | undefined) => void;
}

export function ErliDeliveryPriceListOverrideField({
  connectionId,
  platformName,
  value,
  batchDefault,
  onChange,
}: ErliDeliveryPriceListOverrideFieldProps): ReactElement {
  const copy = useMessages('listings').erliDeliveryPriceListOverrideField;
  const common = useMessages('listings').common;
  const query = useDeliveryPriceListsQuery(connectionId);
  const priceLists = query.data?.deliveryPriceLists ?? [];

  const isOverridden = value !== undefined;
  const effective = value ?? batchDefault;
  const batchDefaultLabel = batchDefault
    ? interpolate(copy.batchDefaultQuoted, { name: batchDefault })
    : copy.batchDefaultNone;

  // Matches FormField's `ControlProps` so the single child typechecks in every
  // branch (Input / Alert / Select all satisfy these optional props).
  let control: ReactElement<{
    id?: string;
    className?: string;
    'aria-invalid'?: boolean;
    'aria-describedby'?: string;
  }>;
  if (query.isLoading) {
    control = <Input disabled value={copy.loading} readOnly />;
  } else if (query.error) {
    control = (
      <Alert
        tone="error"
        title={copy.loadErrorTitle}
        action={
          <Button
            type="button"
            tone="ghost"
            className="button--sm"
            onClick={() => void query.refetch()}
          >
            {copy.retry}
          </Button>
        }
      >
        {serverErrorText(common.serverSaid, query.error instanceof Error ? query.error.message : undefined, copy.tryAgain)}
      </Alert>
    );
  } else if (priceLists.length === 0) {
    control = (
      <Alert
        tone="info"
        title={copy.emptyTitle}
        action={
          <Button
            type="button"
            tone="ghost"
            className="button--sm"
            onClick={() => void query.refetch()}
          >
            {copy.refresh}
          </Button>
        }
      >
        {interpolate(copy.emptyBody, { platform: platformName })}
      </Alert>
    );
  } else {
    control = (
      <Select
        value={effective}
        onChange={(e) => {
          const chosen = e.target.value;
          // Choosing the batch default clears the override so the row inherits.
          onChange(chosen === batchDefault ? undefined : chosen);
        }}
      >
        <option value="">{copy.placeholder}</option>
        {priceLists.map((list) => (
          <option key={list.id} value={list.name}>
            {list.name}
          </option>
        ))}
      </Select>
    );
  }

  return (
    <div className="bulk-edit__delivery-price-list">
      <FormField
        label={copy.label}
        name="bulk-edit-delivery-price-list"
        description={
          isOverridden
            ? interpolate(copy.overriding, { batchDefault: batchDefaultLabel })
            : interpolate(copy.inheriting, { batchDefault: batchDefaultLabel })
        }
      >
        {control}
      </FormField>
      <div className="bulk-edit__delivery-price-list-status">
        {isOverridden ? (
          <>
            <span className="bulk-edit__delivery-price-list-status-label">{copy.overridden}</span>
            <Button tone="ghost" type="button" onClick={() => onChange(undefined)}>
              {copy.resetToBatchDefault}
            </Button>
          </>
        ) : (
          <span className="bulk-edit__delivery-price-list-status-label">{copy.batchDefault}</span>
        )}
      </div>
    </div>
  );
}

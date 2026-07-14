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

import { Alert } from '../../../../shared/ui/alert';
import { Button } from '../../../../shared/ui/button';
import { FormField } from '../../../../shared/ui/form-field';
import { Input } from '../../../../shared/ui/input';
import { Select } from '../../../../shared/ui/select';
import { useDeliveryPriceListsQuery } from '../../hooks/use-delivery-price-lists-query';

interface ErliDeliveryPriceListOverrideFieldProps {
  connectionId: string;
  /** Per-row override value; `undefined` means the row inherits the batch default. */
  value: string | undefined;
  /** Batch-wide default from the Config step (may be empty = none). */
  batchDefault: string;
  onChange: (next: string | undefined) => void;
}

export function ErliDeliveryPriceListOverrideField({
  connectionId,
  value,
  batchDefault,
  onChange,
}: ErliDeliveryPriceListOverrideFieldProps): ReactElement {
  const query = useDeliveryPriceListsQuery(connectionId);
  const priceLists = query.data?.deliveryPriceLists ?? [];

  const isOverridden = value !== undefined;
  const effective = value ?? batchDefault;
  const batchDefaultLabel = batchDefault ? `"${batchDefault}"` : 'none';

  // Matches FormField's `ControlProps` so the single child typechecks in every
  // branch (Input / Alert / Select all satisfy these optional props).
  let control: ReactElement<{
    id?: string;
    className?: string;
    'aria-invalid'?: boolean;
    'aria-describedby'?: string;
  }>;
  if (query.isLoading) {
    control = <Input disabled value="Loading delivery price lists…" readOnly />;
  } else if (query.error) {
    control = (
      <Alert tone="error" title="Unable to load delivery price lists">
        {query.error instanceof Error ? query.error.message : 'Please try again.'}
      </Alert>
    );
  } else if (priceLists.length === 0) {
    control = (
      <Alert tone="info" title="No delivery price lists found">
        No delivery price lists found on this Erli account - add one in Erli, then reload.
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
        <option value="">Choose a delivery price list…</option>
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
        label="Delivery price list"
        name="bulk-edit-delivery-price-list"
        description={
          isOverridden
            ? `Overriding the batch default (${batchDefaultLabel}) for this product.`
            : `Batch default (${batchDefaultLabel}). Change to override this product only.`
        }
      >
        {control}
      </FormField>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          marginTop: 'var(--space-1)',
        }}
      >
        {isOverridden ? (
          <>
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Overridden</span>
            <Button tone="ghost" type="button" onClick={() => onChange(undefined)}>
              Reset to batch default
            </Button>
          </>
        ) : (
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Batch default</span>
        )}
      </div>
    </div>
  );
}

/**
 * ErliDeliveryPriceListField (#1530)
 *
 * Shared, content-only picker for Erli's delivery price list ("cennik
 * dostawy") — the selection that makes a created offer buyable (without it Erli
 * reports "brak metody dostawy"). Consumed by BOTH `ErliCreateOfferWizard`
 * (single) and `ErliBulkConfigSection` (bulk) so the field never drifts.
 *
 * Options are fetched live from Erli per-connection via
 * `useDeliveryPriceListsQuery`. Controlled via `value` + `onChange` (the price
 * list name) so each host wires it into its own form state. Loading / error /
 * empty states mirror the Allegro seller-policy picker.
 *
 * @module features/listings/components/erli
 */
import type { ReactElement } from 'react';

import { Alert } from '../../../../shared/ui/alert';
import { FormField } from '../../../../shared/ui/form-field';
import { Input } from '../../../../shared/ui/input';
import { Select } from '../../../../shared/ui/select';
import { useDeliveryPriceListsQuery } from '../../hooks/use-delivery-price-lists-query';

interface ErliDeliveryPriceListFieldProps {
  connectionId: string;
  /** Selected delivery price list name (empty string = none chosen). */
  value: string;
  onChange: (name: string) => void;
}

export function ErliDeliveryPriceListField({
  connectionId,
  value,
  onChange,
}: ErliDeliveryPriceListFieldProps): ReactElement {
  const query = useDeliveryPriceListsQuery(connectionId);
  const priceLists = query.data?.deliveryPriceLists ?? [];

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
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
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
    <FormField
      label="Delivery price list"
      name="deliveryPriceList"
      description="Fetched from Erli. Required for buyers to purchase."
    >
      {control}
    </FormField>
  );
}

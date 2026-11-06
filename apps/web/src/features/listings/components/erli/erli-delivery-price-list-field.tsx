/**
 * ErliDeliveryPriceListField (#1530)
 *
 * Shared, content-only picker for Erli's delivery price list ("cennik
 * dostawy") — the selection that makes a created offer buyable (without it Erli
 * reports "brak metody dostawy"). Consumed by `ErliBulkConfigSection` as the
 * batch-level delivery selection.
 *
 * Options are fetched live from Erli per-connection via
 * `useDeliveryPriceListsQuery`. Controlled via `value` + `onChange` (the price
 * list name) so each host wires it into its own form state. Loading / error /
 * empty states mirror the Allegro seller-policy picker.
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

interface ErliDeliveryPriceListFieldProps {
  connectionId: string;
  /** The marketplace's display name, so copy can say whose account to check. */
  platformName: string;
  /** Selected delivery price list name (empty string = none chosen). */
  value: string;
  onChange: (name: string) => void;
}

export function ErliDeliveryPriceListField({
  connectionId,
  platformName,
  value,
  onChange,
}: ErliDeliveryPriceListFieldProps): ReactElement {
  const copy = useMessages('listings').erliDeliveryPriceListField;
  const common = useMessages('listings').common;
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
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
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
    <FormField
      label={copy.label}
      name="deliveryPriceList"
      description={interpolate(copy.description, { platform: platformName })}
    >
      {control}
    </FormField>
  );
}

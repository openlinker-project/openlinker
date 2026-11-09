/**
 * ErliProducerField (#1531)
 *
 * Shared, content-only picker for Erli's responsible producer ("producent") —
 * the selection that clears the missing-producer block on a created product.
 * Consumed by `ErliBulkConfigSection` (batch default) and `ErliBulkRowSection`
 * (per-row override) so the field never drifts.
 *
 * Options are fetched live from Erli per-connection via
 * `useResponsibleProducersQuery`. Controlled via `value` + `onChange` (the
 * producer id) so each host wires it into its own form state. Loading / error /
 * empty states mirror the Allegro seller-policy picker.
 *
 * @module features/listings/components/erli
 */
import type { ReactElement } from 'react';

import { interpolate, useMessages } from '../../../../shared/i18n';
import { Alert } from '../../../../shared/ui/alert';
import { FormField } from '../../../../shared/ui/form-field';
import { Input } from '../../../../shared/ui/input';
import { Select } from '../../../../shared/ui/select';
import { useResponsibleProducersQuery } from '../../hooks/use-responsible-producers-query';
import { serverErrorText } from '../../lib/server-error-text';

interface ErliProducerFieldProps {
  connectionId: string;
  /** The marketplace's display name, so copy can say whose account to check. */
  platformName: string;
  /** Selected producer id (empty string = none chosen). */
  value: string;
  onChange: (producerId: string) => void;
}

export function ErliProducerField({
  connectionId,
  platformName,
  value,
  onChange,
}: ErliProducerFieldProps): ReactElement {
  const copy = useMessages('listings').erliProducerField;
  const common = useMessages('listings').common;
  const query = useResponsibleProducersQuery(connectionId);
  const producers = query.data?.responsibleProducers ?? [];

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
      <Alert tone="error" title={copy.loadErrorTitle}>
        {serverErrorText(common.serverSaid, query.error instanceof Error ? query.error.message : undefined, copy.tryAgain)}
      </Alert>
    );
  } else if (producers.length === 0) {
    control = (
      <Alert tone="info" title={copy.emptyTitle}>
        {interpolate(copy.emptyBody, { platform: platformName })}
      </Alert>
    );
  } else {
    control = (
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{copy.placeholder}</option>
        {producers.map((producer) => (
          <option key={producer.id} value={producer.id}>
            {producer.name}
          </option>
        ))}
      </Select>
    );
  }

  return (
    <FormField
      label={copy.label}
      name="producer"
      description={interpolate(copy.description, { platform: platformName })}
    >
      {control}
    </FormField>
  );
}

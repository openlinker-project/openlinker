/**
 * ErliBulkConfigSection
 *
 * Platform-specific bulk-offer config section for Erli (#1096) — the Erli
 * branch of the thin `bulk-config-step` shell. Renders the shared
 * `ErliDispatchTimeField` and writes the chosen dispatch time into the parent
 * RHF form's `platformParams.dispatchTime`. Erli has no seller/delivery
 * policies and is PLN-only, so currency is fixed and no policy picker renders.
 *
 * Registered via the Erli plugin's `platform.bulkOfferConfigSection` slot and
 * resolved by the host via `usePlatform('erli')`. Content-only (no Dialog).
 *
 * @module features/listings/components/erli
 */
import { useEffect, useMemo, type ReactElement } from 'react';

import type { BulkOfferConfigSectionProps } from '../../../../shared/plugins';
import { ErliDispatchTimeField } from './erli-dispatch-time-field';
import { ErliProducerField } from './erli-producer-field';
import {
  isValidDispatch,
  parseErliConnectionDispatchDefault,
  type ErliDispatchTimeParam,
} from './erli-offer-fields.schema';

export function ErliBulkConfigSection({
  connection,
  form,
}: BulkOfferConfigSectionProps): ReactElement {
  const connectionDefault = useMemo<ErliDispatchTimeParam>(
    () => parseErliConnectionDispatchDefault(connection.config),
    [connection.config],
  );

  const platformParams = form.watch('platformParams');
  const current: ErliDispatchTimeParam = isValidDispatch(platformParams.dispatchTime)
    ? (platformParams.dispatchTime as ErliDispatchTimeParam)
    : connectionDefault;
  // Batch-default producer (#1531). Applies to every row unless a row overrides
  // it in the per-row edit modal; empty string = no batch default chosen.
  const producer = typeof platformParams.producer === 'string' ? platformParams.producer : '';

  // Seed the form with the connection default + fix currency to PLN. Keyed on
  // the connection so switching marketplaces re-seeds; `form`/`connectionDefault`
  // are stable references so this doesn't loop.
  useEffect(() => {
    if (!isValidDispatch(form.getValues('platformParams').dispatchTime)) {
      form.setValue(
        'platformParams',
        { ...form.getValues('platformParams'), dispatchTime: connectionDefault },
        { shouldDirty: false },
      );
    }
    if (form.getValues('currency') !== 'PLN') {
      form.setValue('currency', 'PLN', { shouldDirty: false });
    }
  }, [connection.id, connectionDefault, form]);

  return (
    <div className="bulk-config__platform-section">
      <ErliDispatchTimeField
        value={current}
        connectionDefault={connectionDefault}
        onChange={(next) => {
          form.setValue(
            'platformParams',
            { ...form.getValues('platformParams'), dispatchTime: next },
            { shouldDirty: true },
          );
        }}
      />
      <ErliProducerField
        connectionId={connection.id}
        value={producer}
        onChange={(next) => {
          form.setValue(
            'platformParams',
            { ...form.getValues('platformParams'), producer: next },
            { shouldDirty: true },
          );
        }}
      />
      <p className="erli-config__note">
        Erli has no seller/delivery policies — dispatch time stands in for Allegro's policy step.
        The producer applies to every product in this batch (override it per product in the Review
        step). Prices are sent in PLN; images are pulled from each product (Erli requires at least
        one), and the Resolving step flags any product missing one.
      </p>
    </div>
  );
}

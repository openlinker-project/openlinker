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

import { interpolate, useMessages } from '../../../../shared/i18n';
import { usePlatforms, type BulkOfferConfigSectionProps } from '../../../../shared/plugins';
import { resolvePlatformLabel } from '../../../mappings';
import { ErliDeliveryPriceListField } from './erli-delivery-price-list-field';
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
  const note = useMessages('listings').erliBulkConfigSection.note;
  const platformName = resolvePlatformLabel(usePlatforms(), connection);
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
  const deliveryPriceList =
    typeof platformParams.deliveryPriceList === 'string' ? platformParams.deliveryPriceList : '';

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
        platformName={platformName}
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
        platformName={platformName}
        value={producer}
        onChange={(next) => {
          form.setValue(
            'platformParams',
            { ...form.getValues('platformParams'), producer: next },
            { shouldDirty: true },
          );
        }}
      />
      <ErliDeliveryPriceListField
        connectionId={connection.id}
        platformName={platformName}
        value={deliveryPriceList}
        onChange={(next) => {
          form.setValue(
            'platformParams',
            { ...form.getValues('platformParams'), deliveryPriceList: next },
            { shouldDirty: true },
          );
        }}
      />
      <p className="erli-config__note">
        {[
          interpolate(note.noPolicies, { platform: platformName }),
          note.producer,
          note.currency,
          interpolate(note.images, { platform: platformName }),
        ].join(' ')}
      </p>
    </div>
  );
}

/**
 * FulfilmentOwnershipSection (#2118)
 *
 * The one checkbox behind `config.fulfilmentOwnedByDestination`: "this system
 * packs and ships orders itself". Rendered only for connections that can be an
 * order destination (`OrderProcessorManager`); on anything else the flag could
 * persist and be read by nothing - the configuration-that-decides-nothing shape.
 *
 * Display-only. It enforces nothing and blocks no write, so the copy says what
 * it changes (the packing affordances OpenLinker shows) and what it does not.
 *
 * Follows the `RateLimitSection` / `StockAndPricingSection` ordering rule: the
 * section calls `form.setValue` FIRST and then the host's whole-object
 * serializer, which reads the current form state.
 *
 * @module features/connections/components
 */
import type { ReactElement } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { FULFILMENT_OWNERSHIP_COPY } from '../lib/fulfilment-ownership.copy';
import type { EditConnectionFormValues } from './edit-connection.schema';

export interface FulfilmentOwnershipSectionProps {
  form: UseFormReturn<EditConnectionFormValues>;
  /** When false, raw JSON is unparseable - the checkbox is disabled (divergence gate). */
  configIsParseable: boolean;
  /** Host whole-object serializer; called AFTER setValue. */
  syncFulfilmentOwnershipToJson: () => void;
}

export function FulfilmentOwnershipSection({
  form,
  configIsParseable,
  syncFulfilmentOwnershipToJson,
}: FulfilmentOwnershipSectionProps): ReactElement {
  const checked = form.watch('fulfilmentOwnedByDestination') === true;

  const handleChange = (next: boolean): void => {
    form.setValue('fulfilmentOwnedByDestination', next, { shouldDirty: true });
    syncFulfilmentOwnershipToJson();
  };

  return (
    <section className="rate-limit-section" data-testid="fulfilment-ownership-section">
      <h3 className="rate-limit-section__title">{FULFILMENT_OWNERSHIP_COPY.heading}</h3>
      <label className="rate-limit-section__toggle">
        <input
          type="checkbox"
          checked={checked}
          disabled={!configIsParseable}
          data-testid="fulfilment-owned-by-destination-checkbox"
          onChange={(event) => handleChange(event.target.checked)}
        />
        <span>{FULFILMENT_OWNERSHIP_COPY.toggle}</span>
      </label>
      <p className="rate-limit-section__help">{FULFILMENT_OWNERSHIP_COPY.help}</p>
    </section>
  );
}

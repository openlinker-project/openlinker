/**
 * Source Options Reader Capability
 *
 * Optional sub-capability of `OrderSourcePort` (#472) — adapters that can list
 * option values for the source side of carrier / order-status / payment-method
 * mappings declare `implements SourceOptionsReader`. Used by
 * `MappingOptionsController` to populate the source dropdowns in the
 * connection-mappings UI.
 *
 * Returns documented or live values per the underlying platform's API. Note
 * that some platforms (Allegro today) do not expose live endpoints for every
 * dimension — `listOrderStatuses` and `listPaymentMethods` may return values
 * sourced from the platform's developer documentation rather than a runtime
 * fetch. The capability guard's "implements" semantic means "returns data
 * from documented sources", not "always live". See `#472` design doc §5.2 for
 * the trade-off.
 *
 * Adapters that don't implement this capability cause the controller to throw
 * `501 Not Implemented`; FE renders an empty dropdown.
 *
 * @module libs/core/src/orders/domain/ports/capabilities
 * @see {@link OrderSourcePort} for the base port
 * @see {@link DestinationOptionsReader} for the symmetric destination-side capability
 */

import type { MappingOption } from '../../types/mapping-option.types';
import type { OrderSourcePort } from '../order-source.port';

export interface SourceOptionsReader {
  /**
   * List every order-status the source platform exposes on incoming orders.
   * For Allegro today this is sourced from the `developer.allegro.pl`
   * checkout-form documentation (no live API endpoint exists).
   */
  listOrderStatuses(): Promise<MappingOption[]>;

  /**
   * List every distinct delivery method the seller's account offers on the
   * source platform. For Allegro this means flattening per-rate-table
   * (`/sale/shipping-rates/{id}`) into the underlying carrier methods (e.g.
   * "Allegro Paczkomaty InPost") with their stable `methodId` and display
   * `name`. Deduped by `value`.
   */
  listDeliveryMethods(): Promise<MappingOption[]>;

  /**
   * List every payment method the source platform exposes on incoming
   * orders. For Allegro today this is sourced from the documented
   * `checkoutForm.payment.type` enum.
   */
  listPaymentMethods(): Promise<MappingOption[]>;
}

export function isSourceOptionsReader(
  adapter: OrderSourcePort,
): adapter is OrderSourcePort & SourceOptionsReader {
  const partial = adapter as Partial<SourceOptionsReader>;
  return (
    typeof partial.listOrderStatuses === 'function' &&
    typeof partial.listDeliveryMethods === 'function' &&
    typeof partial.listPaymentMethods === 'function'
  );
}

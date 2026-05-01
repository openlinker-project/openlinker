/**
 * Destination Options Reader Capability
 *
 * Optional sub-capability of `OrderProcessorManagerPort` (#472) — adapters that
 * can list option values for the destination side of carrier / order-status /
 * payment-method mappings declare `implements DestinationOptionsReader`. Used
 * by `MappingOptionsController` to populate the Carriers / Statuses / Payments
 * dropdowns in the connection-mappings UI.
 *
 * Returns the live, per-connection list — not a static catalogue. Backed by
 * the destination platform's listing endpoints (e.g. PrestaShop
 * `GET /carriers`, `GET /order_states`, `GET /modules`).
 *
 * Adapters that don't implement this capability cause the controller to throw
 * `501 Not Implemented`; FE renders an empty dropdown with a clear empty-state
 * message rather than crashing.
 *
 * @module libs/core/src/orders/domain/ports/capabilities
 * @see {@link OrderProcessorManagerPort} for the base port
 * @see {@link SourceOptionsReader} for the symmetric source-side capability
 */

import type { MappingOption } from '../../types/mapping-option.types';
import type { OrderProcessorManagerPort } from '../order-processor-manager.port';

export interface DestinationOptionsReader {
  /**
   * List every active, non-deleted carrier on the destination platform.
   * `value` is the stable cross-edit identifier (PS `id_reference`, not
   * `id_carrier` which mutates on edit).
   */
  listCarriers(): Promise<MappingOption[]>;

  /**
   * List every order-state defined on the destination platform.
   * `value` is the platform-native id, `label` is the display name in the
   * default workspace language (PS: `id_lang=1` for v1; revisit if
   * operators ask for a per-connection language picker).
   */
  listOrderStatuses(): Promise<MappingOption[]>;

  /**
   * List every active payment method (PS module of payment-gateway type).
   * `value` is the platform-native module name / code; `label` is the
   * display name.
   */
  listPaymentMethods(): Promise<MappingOption[]>;
}

export function isDestinationOptionsReader(
  adapter: OrderProcessorManagerPort,
): adapter is OrderProcessorManagerPort & DestinationOptionsReader {
  const partial = adapter as Partial<DestinationOptionsReader>;
  return (
    typeof partial.listCarriers === 'function' &&
    typeof partial.listOrderStatuses === 'function' &&
    typeof partial.listPaymentMethods === 'function'
  );
}

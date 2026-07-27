/**
 * Dispatch Protocol Reader Capability
 *
 * Optional sub-capability of `ShippingProviderManagerPort` — adapters that can
 * produce the carrier handover protocol (the "protokół odbioru" / courier
 * hand-off manifest covering a batch of already-generated shipments) declare
 * `implements DispatchProtocolReader`. Call sites narrow via
 * `isDispatchProtocolReader(adapter)` before invoking `generateProtocol`; after
 * the guard TypeScript knows the method is present.
 *
 * This is the sibling reserved by `label-document-reader.capability.ts`: the
 * label is a per-PARCEL document (one shipment → one label), the protocol is a
 * per-BATCH document (N shipments → one manifest the courier signs on pickup).
 * Like `LabelDocumentReader`, the capability names the business verb, not the
 * wire format — the returned `LabelDocument.contentType` carries the real
 * format (PDF today; provider-dependent). It reuses `LabelDocument` rather than
 * inventing a near-identical "ProtocolDocument" type.
 *
 * Carrier-neutral and OPTIONAL: carriers with no handover-manifest concept
 * simply don't implement it, and the bulk-dispatch protocol endpoint reports
 * the gap rather than failing. InPost implements it via ShipX
 * `dispatch_orders/printouts` (#1543); Allegro Delivery (#831) reuses this
 * exact capability for its dispatch manifest.
 *
 * @module libs/core/src/shipping/domain/ports/capabilities
 */

import type { ShippingProviderManagerPort } from '../shipping-provider-manager.port';
import type { LabelDocument } from '../../types/label-document.types';

export interface DispatchProtocolReader {
  /**
   * Produce the handover protocol covering the given provider shipments. The
   * caller resolves each `providerShipmentId` from the persisted `Shipment`
   * rows (only shipments with a provider id can appear on a manifest) and
   * asserts they all belong to one carrier connection — the protocol is
   * per-carrier-account. Throws (provider error) when the provider rejects the
   * request; the application service maps that to a
   * `ShippingProviderRejectionException`.
   */
  generateProtocol(input: { providerShipmentIds: string[] }): Promise<LabelDocument>;
}

export function isDispatchProtocolReader(
  adapter: ShippingProviderManagerPort,
): adapter is ShippingProviderManagerPort & DispatchProtocolReader {
  return typeof (adapter as Partial<DispatchProtocolReader>).generateProtocol === 'function';
}

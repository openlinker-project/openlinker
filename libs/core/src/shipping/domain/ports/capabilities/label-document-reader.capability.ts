/**
 * Label Document Reader Capability
 *
 * Optional sub-capability of `ShippingProviderManagerPort` — adapters that can
 * return the printable label document for an already-generated shipment
 * declare `implements LabelDocumentReader`. Call sites narrow via
 * `isLabelDocumentReader(adapter)` before invoking `fetchLabel`; after the
 * guard TypeScript knows the method is present.
 *
 * The capability names the business verb (fetch the label), NOT the wire
 * format: the returned `LabelDocument.contentType` carries the real format
 * (PDF / ZPL / EPL / PNG, provider- and seller-config-dependent). A `*Pdf`
 * name would be a lying contract on this published, plugin-facing port.
 *
 * The dispatch protocol / handover manifest (#831) is a DIFFERENT document
 * (per-batch, not per-parcel) and is intentionally NOT modelled here — it will
 * be a sibling sub-capability (`DispatchProtocolReader`) when it ships.
 *
 * Mirrors the listings sub-capability pattern (e.g. `OfferCanceller`) per
 * engineering-standards §"Port sub-capabilities".
 *
 * @module libs/core/src/shipping/domain/ports/capabilities
 */

import type { ShippingProviderManagerPort } from '../shipping-provider-manager.port';
import type { LabelDocument } from '../../types/label-document.types';

export interface LabelDocumentReader {
  /**
   * Fetch the printable label document for an already-generated shipment.
   * The caller resolves `providerShipmentId` from the persisted `Shipment`
   * (same shape as `cancelShipment` / `getTracking`). Throws (provider error)
   * when the provider rejects the fetch; the application service maps that to
   * a `ShippingProviderRejectionException`.
   */
  fetchLabel(input: { providerShipmentId: string }): Promise<LabelDocument>;
}

export function isLabelDocumentReader(
  adapter: ShippingProviderManagerPort,
): adapter is ShippingProviderManagerPort & LabelDocumentReader {
  return typeof (adapter as Partial<LabelDocumentReader>).fetchLabel === 'function';
}

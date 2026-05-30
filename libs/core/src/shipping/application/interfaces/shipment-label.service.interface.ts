/**
 * Shipment Label Service Interface
 *
 * Query seam for fetching the printable label document of a generated
 * shipment (#884). Resolves the shipment's shipping-provider adapter, narrows
 * the `LabelDocumentReader` sub-capability, and returns the raw bytes +
 * provider-reported content type. The HTTP layer streams them as an
 * attachment.
 *
 * @module libs/core/src/shipping/application/interfaces
 */

import type { LabelDocument } from '../../domain/types/label-document.types';

export interface IShipmentLabelService {
  /**
   * Fetch the label document for a shipment. Throws
   * `ShipmentNotFoundException` when absent, `LabelNotAvailableException` when
   * no label has been generated (no `providerShipmentId`),
   * `LabelDocumentNotSupportedException` when the provider adapter lacks
   * `LabelDocumentReader`, and `ShippingProviderRejectionException` when the
   * provider rejects the fetch.
   */
  fetchLabel(shipmentId: string): Promise<LabelDocument>;
}

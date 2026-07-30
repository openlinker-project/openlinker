/**
 * Reconciled Shipment Types
 *
 * Neutral shape returned by the `ShipmentReferenceReconciler` sub-capability
 * (#1917): the minimum a carrier must report for OL to adopt an already-created
 * shipment instead of creating a second one.
 *
 * Deliberately narrower than `GenerateLabelResult` - adoption recovers identity
 * and trackability, not the label PDF. `labelPdfRef` stays null on an adopted
 * row; the operator re-fetches the document through the existing
 * `LabelDocumentReader` path, which is keyed on `providerShipmentId` and works
 * once that id is known.
 *
 * @module libs/core/src/shipping/domain/types
 */

export interface ReconciledShipment {
  /** Carrier-native shipment id - the value OL failed to record. */
  providerShipmentId: string;

  /** Waybill / tracking number when the carrier issues one synchronously. */
  trackingNumber: string | null;
}

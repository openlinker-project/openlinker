/**
 * Fake DPD Polska Shipping Adapter
 *
 * In-memory `ShippingProviderManagerPort` (+ `LabelDocumentReader`,
 * `PickupPointFinder`) for plugin-author / consumer unit tests that need
 * deterministic shipping behaviour without hitting DPDServices. Mirrors the
 * real adapter's observable contract — courier + pickup pre-submit validation,
 * seeded pickup points, and the `getTracking` throw — and adds `seed*` /
 * `clear` helpers for arranging test state.
 *
 * Consumed only from `*.spec.ts` via `@openlinker/integrations-dpd-polska/testing`,
 * never from runtime code.
 *
 * @module libs/integrations/dpd-polska/src/testing
 */
import {
  ShippingProviderRejectionException,
  type DispatchProtocolReader,
  type FindPickupPointsQuery,
  type GenerateLabelCommand,
  type GenerateLabelResult,
  type LabelDocument,
  type LabelDocumentReader,
  type PickupPoint,
  type PickupPointFinder,
  type ShippingMethod,
  type ShippingProviderManagerPort,
  type TrackingSnapshot,
} from '@openlinker/core/shipping';

const SUPPORTED_METHODS: readonly ShippingMethod[] = ['kurier', 'pickup'];

export class FakeDpdShippingAdapter
  implements
    ShippingProviderManagerPort,
    LabelDocumentReader,
    PickupPointFinder,
    DispatchProtocolReader
{
  private counter = 0;
  private seededFailure: Error | null = null;
  private seededPoints: PickupPoint[] = [];
  private seededTracking: TrackingSnapshot = { status: 'in-transit' };

  getSupportedMethods(): readonly ShippingMethod[] {
    return SUPPORTED_METHODS;
  }

  generateLabel(cmd: GenerateLabelCommand): Promise<GenerateLabelResult> {
    if (this.seededFailure) {
      return Promise.reject(this.seededFailure);
    }
    if (cmd.shippingMethod !== 'kurier' && cmd.shippingMethod !== 'pickup') {
      return Promise.reject(
        new ShippingProviderRejectionException(
          'dpd',
          'preflight.unsupported-method',
          `DPD Polska supports 'kurier' and 'pickup' only; got '${String(cmd.shippingMethod)}'`,
        ),
      );
    }
    if (cmd.shippingMethod === 'pickup' && !cmd.paczkomatId) {
      return Promise.reject(
        new ShippingProviderRejectionException(
          'dpd',
          'preflight.missing-paczkomat-id',
          'paczkomatId (the DPD Pickup point id) is required for a pickup shipment',
        ),
      );
    }
    if (cmd.shippingMethod === 'kurier' && !cmd.recipient.address) {
      return Promise.reject(
        new ShippingProviderRejectionException(
          'dpd',
          'preflight.missing-recipient-address',
          'recipient.address is required for a DPD courier shipment',
        ),
      );
    }
    const waybill = `fake-dpd-${(this.counter += 1)}`;
    return Promise.resolve({ providerShipmentId: waybill, trackingNumber: waybill, labelPdfRef: waybill });
  }

  findPickupPoints(_query: FindPickupPointsQuery): Promise<PickupPoint[]> {
    return Promise.resolve([...this.seededPoints]);
  }

  fetchLabel(_input: { providerShipmentId: string }): Promise<LabelDocument> {
    if (this.seededFailure) {
      return Promise.reject(this.seededFailure);
    }
    return Promise.resolve({
      contentType: 'application/pdf',
      body: new Uint8Array([0x25, 0x50, 0x44, 0x46]), // %PDF
    });
  }

  getTracking(_input: { providerShipmentId: string }): Promise<TrackingSnapshot> {
    if (this.seededFailure) {
      return Promise.reject(this.seededFailure);
    }
    return Promise.resolve(this.seededTracking);
  }

  generateProtocol(_input: { providerShipmentIds: string[] }): Promise<LabelDocument> {
    if (this.seededFailure) {
      return Promise.reject(this.seededFailure);
    }
    return Promise.resolve({
      contentType: 'application/pdf',
      body: new Uint8Array([0x25, 0x50, 0x44, 0x46]), // %PDF
    });
  }

  // --- test helpers ----------------------------------------------------------

  /** Make the next `generateLabel` / `fetchLabel` / `generateProtocol` throw the given error. */
  seedFailure(error: Error): void {
    this.seededFailure = error;
  }

  /** Set the points returned by `findPickupPoints`. */
  seedPickupPoints(points: readonly PickupPoint[]): void {
    this.seededPoints = [...points];
  }

  /** Set the snapshot returned by `getTracking`. */
  seedTracking(snapshot: TrackingSnapshot): void {
    this.seededTracking = snapshot;
  }

  /** Reset all in-memory state between tests. */
  clear(): void {
    this.counter = 0;
    this.seededFailure = null;
    this.seededPoints = [];
    this.seededTracking = { status: 'in-transit' };
  }
}

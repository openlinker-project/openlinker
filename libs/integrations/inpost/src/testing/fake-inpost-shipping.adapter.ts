/**
 * Fake InPost Shipping Adapter (#765)
 *
 * In-memory `ShippingProviderManagerPort` (+ `ShipmentCanceller`,
 * `PickupPointFinder`) for plugin-author / consumer unit tests that need
 * deterministic shipping behaviour without hitting sandbox ShipX. Mirrors the
 * real adapter's observable contract — including the locker/courier pre-submit
 * validation — and adds `seed*` / `clear` helpers for arranging test state.
 *
 * Consumed only from `*.spec.ts` via `@openlinker/integrations-inpost/testing`,
 * never from runtime code.
 *
 * @module libs/integrations/inpost/src/testing
 */
import type {
  ShippingProviderManagerPort,
  ShipmentCanceller,
  PickupPointFinder,
  LabelDocumentReader,
  DispatchProtocolReader,
  GenerateLabelCommand,
  GenerateLabelResult,
  LabelDocument,
  TrackingSnapshot,
  ShipmentStatus,
  ShippingMethod,
  PickupPoint,
  FindPickupPointsQuery,
} from '@openlinker/core/shipping';
import { ShippingProviderRejectionException } from '@openlinker/core/shipping';

const SUPPORTED_METHODS: readonly ShippingMethod[] = ['paczkomat', 'kurier'];

export class FakeInpostShippingAdapter
  implements
    ShippingProviderManagerPort,
    ShipmentCanceller,
    PickupPointFinder,
    LabelDocumentReader,
    DispatchProtocolReader
{
  private counter = 0;
  private seededFailure: Error | null = null;
  private seededPoints: PickupPoint[] = [];
  private readonly statusByShipmentId = new Map<string, ShipmentStatus>();
  private readonly cancelled = new Set<string>();

  getSupportedMethods(): readonly ShippingMethod[] {
    return SUPPORTED_METHODS;
  }

  // Methods return resolved/rejected promises rather than `async` bodies: the
  // fake does no real I/O, so there's nothing to await — and validation
  // failures must surface as promise rejections (not sync throws) to match the
  // real adapter's contract and `.rejects` assertions.
  generateLabel(cmd: GenerateLabelCommand): Promise<GenerateLabelResult> {
    if (this.seededFailure) {
      return Promise.reject(this.seededFailure);
    }
    if (cmd.shippingMethod === 'paczkomat' && !cmd.paczkomatId) {
      return Promise.reject(
        new ShippingProviderRejectionException(
          'inpost',
          'preflight.missing-paczkomat-id',
          'paczkomatId is required for a paczkomat shipment',
        ),
      );
    }
    if (cmd.shippingMethod === 'kurier' && !cmd.recipient.address) {
      return Promise.reject(
        new ShippingProviderRejectionException(
          'inpost',
          'preflight.missing-recipient-address',
          'recipient.address is required for a courier shipment',
        ),
      );
    }
    const providerShipmentId = `fake-${(this.counter += 1)}`;
    this.statusByShipmentId.set(providerShipmentId, 'generated');
    return Promise.resolve({
      providerShipmentId,
      trackingNumber: null,
      labelPdfRef: `shipx:label:${providerShipmentId}`,
    });
  }

  getTracking(input: { providerShipmentId: string }): Promise<TrackingSnapshot> {
    if (this.cancelled.has(input.providerShipmentId)) {
      return Promise.resolve({ status: 'cancelled', providerStatus: 'canceled', carrier: 'inpost' });
    }
    const status = this.statusByShipmentId.get(input.providerShipmentId) ?? 'generated';
    return Promise.resolve({ status, providerStatus: status, carrier: 'inpost' });
  }

  cancelShipment(input: { providerShipmentId: string }): Promise<void> {
    this.cancelled.add(input.providerShipmentId);
    this.statusByShipmentId.set(input.providerShipmentId, 'cancelled');
    return Promise.resolve();
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

  generateProtocol(input: { providerShipmentIds: string[] }): Promise<LabelDocument> {
    if (this.seededFailure) {
      return Promise.reject(this.seededFailure);
    }
    if (input.providerShipmentIds.length === 0) {
      return Promise.reject(
        new ShippingProviderRejectionException(
          'inpost',
          'preflight.empty-protocol-batch',
          'At least one shipment id is required to generate a handover protocol',
        ),
      );
    }
    return Promise.resolve({
      contentType: 'application/pdf',
      body: new Uint8Array([0x25, 0x50, 0x44, 0x46]), // %PDF
    });
  }

  // --- test helpers ----------------------------------------------------------

  /** Make the next `generateLabel` throw the given error. */
  seedFailure(error: Error): void {
    this.seededFailure = error;
  }

  /** Set the points returned by `findPickupPoints`. */
  seedPickupPoints(points: readonly PickupPoint[]): void {
    this.seededPoints = [...points];
  }

  /** Override the status `getTracking` reports for a shipment. */
  seedTracking(providerShipmentId: string, status: ShipmentStatus): void {
    this.statusByShipmentId.set(providerShipmentId, status);
  }

  /** Reset all in-memory state between tests. */
  clear(): void {
    this.counter = 0;
    this.seededFailure = null;
    this.seededPoints = [];
    this.statusByShipmentId.clear();
    this.cancelled.clear();
  }
}

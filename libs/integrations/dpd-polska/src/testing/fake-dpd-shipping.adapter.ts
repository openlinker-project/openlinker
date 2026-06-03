/**
 * Fake DPD Polska Shipping Adapter
 *
 * In-memory `ShippingProviderManagerPort` (+ `LabelDocumentReader`) for
 * plugin-author / consumer unit tests that need deterministic shipping
 * behaviour without hitting DPDServices. Mirrors the real adapter's observable
 * contract — including the courier pre-submit validation and the
 * `getTracking` throw — and adds `seed*` / `clear` helpers for arranging test
 * state.
 *
 * Consumed only from `*.spec.ts` via `@openlinker/integrations-dpd-polska/testing`,
 * never from runtime code.
 *
 * @module libs/integrations/dpd-polska/src/testing
 */
import {
  ShippingProviderRejectionException,
  type GenerateLabelCommand,
  type GenerateLabelResult,
  type LabelDocument,
  type LabelDocumentReader,
  type ShippingMethod,
  type ShippingProviderManagerPort,
  type TrackingSnapshot,
} from '@openlinker/core/shipping';

const SUPPORTED_METHODS: readonly ShippingMethod[] = ['kurier'];

export class FakeDpdShippingAdapter implements ShippingProviderManagerPort, LabelDocumentReader {
  private counter = 0;
  private seededFailure: Error | null = null;

  getSupportedMethods(): readonly ShippingMethod[] {
    return SUPPORTED_METHODS;
  }

  generateLabel(cmd: GenerateLabelCommand): Promise<GenerateLabelResult> {
    if (this.seededFailure) {
      return Promise.reject(this.seededFailure);
    }
    if (cmd.shippingMethod !== 'kurier') {
      return Promise.reject(
        new ShippingProviderRejectionException(
          'dpd',
          'preflight.unsupported-method',
          `DPD Polska supports 'kurier' only; got '${String(cmd.shippingMethod)}'`,
        ),
      );
    }
    if (!cmd.recipient.address) {
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
    return Promise.reject(
      new ShippingProviderRejectionException(
        'dpd',
        'tracking.unavailable',
        'DPD tracking is not available until DPD InfoServices is wired (#965)',
      ),
    );
  }

  // --- test helpers ----------------------------------------------------------

  /** Make the next `generateLabel` / `fetchLabel` throw the given error. */
  seedFailure(error: Error): void {
    this.seededFailure = error;
  }

  /** Reset all in-memory state between tests. */
  clear(): void {
    this.counter = 0;
    this.seededFailure = null;
  }
}

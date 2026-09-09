/**
 * Shipping-stub Shipping Adapter
 *
 * Implements `ShippingProviderManagerPort` against the standalone perf-lab
 * HTTP stub (`perf/openlinker-throughput/stubs/shipping/server.mjs`, #3043).
 * This is a REAL adapter making a REAL outbound HTTP call, so
 * `ShipmentDispatchService.dispatch` and `ShipmentStatusSyncService`'s
 * `null -> value` tracking backfill (#1947) both run through their exact,
 * unmodified core code paths - the only thing this adapter's destination
 * fakes is a carrier's own decision latency and tracking-mint timing.
 *
 * A dedicated stub adapter (rather than pointing the REAL InPost/DPD Polska
 * adapters at a stub server) is necessary here, not a stylistic choice:
 * `InpostShippingProviderAdapter` resolves its host from a closed
 * `BASE_URLS[config.environment]` enum with no override, unlike eparagony's
 * `apiBaseUrl`/`authBaseUrl` (both documented "intended for testing"). This
 * package is the InPost/DPD-adapter-shaped equivalent of `@openlinker/
 * integrations-invoicing-stub` (#3006) - same reasoning, same
 * `requiresCredentials: false` pattern (ADR-055).
 *
 * NEVER register this plugin unconditionally - see the package README and
 * `apps/{api,worker}/src/plugins.ts` for the `OL_SHIPPING_STUB_ENABLED` gate.
 * No label this adapter "buys" is a real carrier waybill.
 *
 * @module libs/integrations/shipping-stub/src/infrastructure/adapters
 */
import type { LoggerPort } from '@openlinker/shared/logging';
import type { FetchLike } from '@openlinker/shared/http';
import type {
  GenerateLabelCommand,
  GenerateLabelResult,
  ShippingMethod,
  ShippingProviderManagerPort,
  TrackingSnapshot,
} from '@openlinker/core/shipping';

interface StubLabelResponse {
  providerShipmentId: string;
  trackingNumber: string | null;
  labelPdfRef: string;
}

interface StubTrackingResponse {
  status: TrackingSnapshot['status'];
  trackingNumber: string | null;
  carrier: string;
  providerStatus: string;
}

export class ShippingStubConfigException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShippingStubConfigException';
  }
}

export class ShippingStubShippingAdapter implements ShippingProviderManagerPort {
  constructor(
    private readonly connectionId: string,
    private readonly baseUrl: string,
    private readonly fetchImpl: FetchLike,
    private readonly logger: LoggerPort,
  ) {}

  async generateLabel(cmd: GenerateLabelCommand): Promise<GenerateLabelResult> {
    const response = await this.fetchImpl(`${this.baseUrl}/labels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // No PII forwarded — this is a lab-only fake destination; the fields
      // below are the minimum a driver-side log can correlate a response
      // against.
      body: JSON.stringify({
        shipmentId: cmd.shipmentId,
        orderId: cmd.orderId,
        shippingMethod: cmd.shippingMethod,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `shipping-stub answered HTTP ${String(response.status)} for shipmentId=${cmd.shipmentId}`,
      );
    }

    const body = (await response.json()) as StubLabelResponse;
    this.logger.log(
      `shipping-stub issued label ${body.providerShipmentId} for shipmentId=${cmd.shipmentId} ` +
        `connectionId=${this.connectionId}`,
    );

    return {
      providerShipmentId: body.providerShipmentId,
      trackingNumber: body.trackingNumber,
      labelPdfRef: body.labelPdfRef,
    };
  }

  async getTracking(input: { providerShipmentId: string }): Promise<TrackingSnapshot> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/shipments/${encodeURIComponent(input.providerShipmentId)}/tracking`,
    );

    if (!response.ok) {
      throw new Error(
        `shipping-stub answered HTTP ${String(response.status)} for providerShipmentId=` +
          `${input.providerShipmentId}`,
      );
    }

    const body = (await response.json()) as StubTrackingResponse;
    return {
      status: body.status,
      trackingNumber: body.trackingNumber ?? undefined,
      carrier: body.carrier,
      providerStatus: body.providerStatus,
    };
  }

  getSupportedMethods(): readonly ShippingMethod[] {
    return ['kurier', 'paczkomat'];
  }
}

/**
 * Carrier-Hint Resolution Helper
 *
 * Resolves the neutral `DispatchCarrierHint` for a shipping-provider connection
 * — its `platformType` — which the lifecycle relay threads to whichever source
 * adapter attaches the waybill (#837 Q5). Shared by the two services that relay
 * a `dispatched` event: the operator dispatch notification and the tracking
 * backfill (#1947).
 *
 * **The hint is NOT cosmetic, despite the non-fatal failure mode.** How a source
 * adapter treats an absent hint differs per platform:
 *
 * - Allegro degrades gracefully — `resolveCarrier` falls back to its catch-all
 *   carrier id plus a generic carrier name, so the waybill still lands.
 * - Erli does NOT — its shipment registration is guarded on
 *   `if (trackingNumber && vendor)`, where `vendor` IS this hint. With no hint
 *   the waybill is silently dropped even though OL knows it.
 *
 * So a resolution failure is a real (if rare) data-loss risk on some
 * destinations, not merely a downgraded label. It stays non-fatal — failing the
 * whole dispatch because a carrier's metadata lookup blipped would be worse —
 * but it is logged so the downgrade is traceable rather than invisible.
 *
 * A bare colocated helper rather than a service: it is a pure two-line
 * resolution over an injected port, with no state and no interface worth
 * mocking. Mirrors the `shipment-dispatch-lock.ts` precedent.
 *
 * @module libs/core/src/shipping/application/services
 */
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { DispatchCarrierHint } from '@openlinker/core/orders';
import type { LoggerPort } from '@openlinker/shared/logging';

/**
 * Resolve the carrier hint for `connectionId`, or `undefined` when the
 * connection's adapter metadata cannot be read.
 */
export async function resolveCarrierHint(
  integrations: IIntegrationsService,
  connectionId: string,
  logger: LoggerPort,
): Promise<DispatchCarrierHint | undefined> {
  try {
    const { metadata } = await integrations.getAdapter(connectionId);
    return { platformType: metadata.platformType };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.debug(
      `Carrier-hint resolution failed for connection ${connectionId}; a waybill (if any) ` +
        `will use the source adapter's catch-all carrier, or be skipped entirely by a ` +
        `source that requires a vendor: ${message}`,
    );
    return undefined;
  }
}

/**
 * Subiekt Order Processor Adapter
 *
 * Implements `OrderProcessorManagerPort.createOrder` over
 * `SubiektOrdersBridgeClient`, writing a ZK (Zamówienie od Klienta) into
 * Subiekt GT via `Sfera.CreateZk` on the bridge side (already shipped for the
 * WooCommerce-shim spike; this adapter is the first REAL, port-typed caller).
 *
 * Per the port's own contract this adapter creates UNCONDITIONALLY at the OL
 * layer — idempotency (skip-if-already-created) and the external<->internal
 * mapping write are owned by `OrderSyncService` under a per-(order,
 * destination) lock. It carries no create-or-skip guard of its own.
 *
 * #3369: the BRIDGE itself now guards against a duplicate ZK/kontrahent —
 * `createOrder` checks `dok_NrPelnyOryg` for an existing document before
 * inserting, and `EnsureKontrahent` is now given a resolved existing id
 * (by NIP, else by the deterministic derived symbol) rather than always
 * `existingId: 0`. This closes the gap `OrderSyncService`'s own comment names
 * as "the adapter's own platform-side duplicate recovery" — Subiekt had none
 * before this fix, confirmed live to create duplicate kontrahent rows under a
 * retried createOrder call.
 *
 * ## Source-authoritative pricing (#895, ADR-014)
 *
 * Every line is priced at `order.items[].price` (the buyer-paid source price),
 * never a catalogue lookup — matching `Sfera.CreateZk`'s own
 * `LiczonyOdCenBrutto = true` / `WartoscBruttoPrzedRabatem` convention.
 *
 * ## Product resolution
 *
 * A line's Subiekt `symbol` is resolved via `identifier_mappings` for THIS
 * connection (`item.productId` -> external symbol) — mirrors
 * `PrestashopOrderProcessorManagerAdapter`'s "Product not found in PrestaShop"
 * guard, not a bare `item.sku` read. A raw `item.sku` is the SOURCE's own SKU
 * spelling and only accidentally equals the Subiekt symbol; trusting it would
 * silently create a ZK line against the wrong towar (or an empty-symbol
 * service line) whenever the two diverge. A product with no mapping for this
 * connection — i.e. never synced from Subiekt via ProductMaster — throws
 * `SubiektOrderProductMappingException` rather than guessing.
 *
 * ## Buyer resolution
 *
 * `OrderCreate` carries no buyer name/NIP field directly (only an internal
 * `customerId`) — the buyer is derived from `billingAddress ?? shippingAddress`
 * (`company` for the name, falling back to `firstName lastName`; `taxId` for
 * the NIP). An order with neither address creates a kontrahent with an empty
 * name, which the bridge is expected to reject the same way `Invoicing.cs`'s
 * `UpsertCustomer` would (no name to save).
 *
 * ## NOT LIVE-VERIFIED (built with no Windows access) — see
 * `subiekt-order-source.adapter.ts`'s header for the same caveat.
 *
 * @module libs/integrations/subiekt/src/infrastructure/adapters
 */
import type { LoggerPort } from '@openlinker/shared/logging';
import type {
  OrderProcessorManagerPort,
  OrderCreate,
  OrderRef,
  Address,
  OrderStatus,
  OrderLifecycleEvent,
  OrderWritebackResult,
} from '@openlinker/core/orders';
import type { OrderFulfillmentUpdater, OrderStatusWriteback } from '@openlinker/core/orders';
import type { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import type { SubiektOrdersBridgeClient } from '../../bridge/subiekt-orders-bridge.client';
import type { BridgeOrderLine, BridgeOrderBuyer } from '../../bridge/subiekt-bridge-orders.types';
import { SubiektOrderProductMappingException } from '../../domain/exceptions/subiekt-order-product-mapping.exception';
import { SubiektBridgeUnreachableError, SubiektRejectedError } from '../../bridge/subiekt-bridge.errors';
import { SubiektBridgeAuthError } from '../../domain/exceptions/subiekt-bridge-auth.exception';
import { SubiektBridgeTransportError } from '../../domain/exceptions/subiekt-bridge-transport.exception';
import type { SubiektTransportRetryability } from '../../domain/types/subiekt-transport-retryability.types';

/** Read the retryability phase, defaulting to the fiscal-safe `'indeterminate'` (mirrors the Inventory/Invoicing/ProductMaster adapters' identical helper). */
function readRetryability(error: SubiektBridgeUnreachableError): SubiektTransportRetryability {
  const phase = (error as { retryability?: unknown }).retryability;
  return phase === 'safe' || phase === 'indeterminate' ? phase : 'indeterminate';
}

/**
 * Neutral `OrderStatus` -> Polish operator-facing label, written into the
 * ZK's `Uwagi`/`UwagiExt` remarks fields (`Sfera.WriteShipping` — Subiekt
 * exposes no dedicated fulfillment-status field on a ZK to write a real enum
 * onto). Not a Subiekt-native status code; a human label only.
 */
const STATUS_LABEL_PL: Record<OrderStatus, string> = {
  pending: 'Oczekujące',
  processing: 'W realizacji',
  shipped: 'Wysłane',
  delivered: 'Dostarczone',
  cancelled: 'Anulowane',
  refunded: 'Zwrócone',
};

function resolveBuyer(order: OrderCreate): BridgeOrderBuyer {
  const addr: Address | undefined = order.billingAddress ?? order.shippingAddress;
  const fullName = [addr?.firstName, addr?.lastName].filter(Boolean).join(' ').trim();
  const name = addr?.company ?? (fullName.length > 0 ? fullName : '');

  return {
    nazwa: name,
    nip: addr?.taxId ?? null,
    telefon: addr?.phone,
    ulica: addr?.address1,
    kodPocztowy: addr?.postalCode,
    miejscowosc: addr?.city,
  };
}

export class SubiektOrderProcessorAdapter
  implements OrderProcessorManagerPort, OrderFulfillmentUpdater, OrderStatusWriteback
{
  constructor(
    private readonly bridge: SubiektOrdersBridgeClient,
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly connectionId: string,
    private readonly logger: LoggerPort,
  ) {}

  /**
   * Resolves each line's Subiekt symbol via `identifier_mappings` for this
   * connection — see the class docblock. Throws
   * `SubiektOrderProductMappingException` on the first unmapped product,
   * rather than creating a ZK with a wrong or empty symbol.
   */
  private async resolveLines(order: OrderCreate): Promise<BridgeOrderLine[]> {
    const lines: BridgeOrderLine[] = [];
    for (const item of order.items) {
      const externalIds = await this.identifierMapping.getExternalIds(
        CORE_ENTITY_TYPE.Product,
        item.productId,
      );
      const mapping = externalIds.find((e) => e.connectionId === this.connectionId);
      if (!mapping) {
        throw new SubiektOrderProductMappingException(item.productId, this.connectionId);
      }
      lines.push({
        symbol: mapping.externalId,
        ilosc: item.quantity,
        // Buyer-paid TOTAL for the line, not the unit price — mirrors
        // `Sfera.CreateZk`'s `GrossTotal` convention (`ZkLine.GrossTotal`).
        wartoscBrutto: item.price * item.quantity,
      });
    }
    // #3347: the item loop above never carried shipping — every ZK silently
    // under-recorded the buyer-paid order value by the shipping amount. A
    // symbol-less service line (mirroring the invoicing bridge's identical
    // convention for a line with no catalogue match) carries it explicitly.
    if (order.totals.shipping > 0) {
      lines.push({
        symbol: '',
        ilosc: 1,
        wartoscBrutto: order.totals.shipping,
        nazwa: 'Dostawa',
      });
    }
    return lines;
  }

  async createOrder(order: OrderCreate): Promise<OrderRef> {
    const buyer = resolveBuyer(order);
    const lines = await this.resolveLines(order);

    if (buyer.nazwa === '') {
      this.logger.warn(
        'Creating a Subiekt ZK with no resolvable buyer name (no billing/shipping company or first/last name on the order)',
      );
    }

    let response;
    try {
      response = await this.bridge.createOrder({
        buyer,
        lines,
        orderRef: order.orderNumber ?? '',
        uwagi: order.orderNumber ? `OpenLinker order ${order.orderNumber}` : undefined,
      });
    } catch (error) {
      throw this.translateBridgeError(error);
    }

    this.logger.log(`Created Subiekt ZK ${response.numer} (id ${response.id})`);

    return {
      orderId: String(response.id),
      orderNumber: response.numer,
    };
  }

  /**
   * `OrderFulfillmentUpdater` (#837) — writes a post-create status + tracking
   * update onto the ZK via `Sfera.WriteShipping`. Subiekt exposes no
   * fulfillment-status field on a ZK, so this is a remarks write
   * (`d.Uwagi`/`d.UwagiExt`), not a native status transition — an honest
   * "best available" surface, not a Subiekt-native state machine.
   */
  async updateFulfillment(input: {
    externalOrderId: string;
    status: OrderStatus;
    trackingNumber?: string;
  }): Promise<void> {
    let numer: string;
    try {
      ({ numer } = await this.bridge.writeShipping(input.externalOrderId, {
        status: STATUS_LABEL_PL[input.status],
        trackingNumber: input.trackingNumber,
      }));
    } catch (error) {
      throw this.translateBridgeError(error);
    }
    this.logger.log(
      `Wrote fulfillment status '${input.status}' onto Subiekt ${numer} ` +
        `(id ${input.externalOrderId})${input.trackingNumber ? `, tracking ${input.trackingNumber}` : ''}`,
    );
  }

  /**
   * `OrderStatusWriteback` (#3349) — the single event-as-data writeback the
   * lifecycle relay dispatches through. Before this method existed the class
   * implemented only `OrderFulfillmentUpdater`, whose `updateFulfillment` is
   * never reachable from the relay path (`OrderLifecycleRelayService`
   * resolves candidates exclusively via `isOrderStatusWriteback`) — so no
   * status update from OL ever reached Subiekt in production. Delegates to
   * the existing `updateFulfillment` remarks write, mirroring PrestaShop's/
   * WooCommerce's own thin delegation. Subiekt carries no dedicated
   * "already shipped" field on a ZK to refuse a cancel against (unlike
   * PrestaShop's richer state read), so the `cancelled` arm writes the
   * cancelled label unconditionally rather than refusing.
   */
  async write(event: OrderLifecycleEvent): Promise<OrderWritebackResult> {
    try {
      switch (event.type) {
        case 'dispatched': {
          await this.updateFulfillment({
            externalOrderId: event.externalOrderId,
            status: 'shipped',
            trackingNumber: event.trackingNumber,
          });
          return { outcome: 'applied' };
        }

        case 'cancelled': {
          await this.updateFulfillment({
            externalOrderId: event.externalOrderId,
            status: 'cancelled',
          });
          return { outcome: 'applied' };
        }

        default: {
          // Unreachable in-tree: the binding is the compile break when an
          // `OrderLifecycleEvent` member is added without an arm here
          // (#2286). Returns rather than throws so a caller compiled
          // against a widened union gets a surfaced no-op (ADR-055
          // forward-compat), never a `rejected` from the enclosing catch.
          const unhandled: never = event;
          return {
            outcome: 'unsupported',
            detail: `unsupported order lifecycle event: ${JSON.stringify(unhandled)}`,
          };
        }
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `OrderStatusWriteback '${event.type}' failed for Subiekt order ` +
          `${event.externalOrderId}: ${detail}`,
        error instanceof Error ? error.stack : undefined,
      );
      return { outcome: 'rejected', detail };
    }
  }

  /**
   * #3369/#3373 fix: before this method existed, a transport failure from
   * `this.bridge` propagated raw — `SubiektRetryClassifierAdapter` only
   * pattern-matches `SubiektBridgeTransportError`, so the raw
   * `SubiektBridgeUnreachableError` (including the phase-carrying
   * `SubiektBridgeUnreachableWithPhaseError` subclass thrown by
   * `SubiektOrdersBridgeClient`) was never recognized, the classifier
   * abstained, and the job runner's UNCLASSIFIED DEFAULT applied to an
   * ambiguous `createOrder` timeout — exactly the condition under which a
   * duplicate ZK/kontrahent risk exists. Mirrors the identical pattern
   * already correct in `SubiektInventoryMasterAdapter`/`SubiektInvoicingAdapter`.
   */
  private translateBridgeError(error: unknown): Error {
    if (error instanceof SubiektBridgeUnreachableError) {
      return new SubiektBridgeTransportError(error.message, readRetryability(error));
    }
    if (
      error instanceof SubiektBridgeAuthError ||
      error instanceof SubiektRejectedError ||
      error instanceof SubiektOrderProductMappingException
    ) {
      return error;
    }
    return new SubiektBridgeTransportError(
      error instanceof Error ? error.message : 'Unknown Subiekt orders bridge error',
      'indeterminate',
      { cause: error },
    );
  }
}

/**
 * Subiekt Order Processor Adapter
 *
 * Implements `OrderProcessorManagerPort.createOrder` over
 * `SubiektOrdersBridgeClient`, writing a ZK (Zamówienie od Klienta) into
 * Subiekt GT via `Sfera.CreateZk` on the bridge side (already shipped for the
 * WooCommerce-shim spike; this adapter is the first REAL, port-typed caller).
 *
 * Per the port's own contract this adapter creates UNCONDITIONALLY — idempotency
 * (skip-if-already-created) and the external<->internal mapping write are owned
 * by `OrderSyncService` under a per-(order, destination) lock. It carries no
 * create-or-skip guard of its own.
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
import type { OrderProcessorManagerPort, OrderCreate, OrderRef, Address } from '@openlinker/core/orders';
import type { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import type { SubiektOrdersBridgeClient } from '../../bridge/subiekt-orders-bridge.client';
import type { BridgeOrderLine, BridgeOrderBuyer } from '../../bridge/subiekt-bridge-orders.types';
import { SubiektOrderProductMappingException } from '../../domain/exceptions/subiekt-order-product-mapping.exception';

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

export class SubiektOrderProcessorAdapter implements OrderProcessorManagerPort {
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

    const response = await this.bridge.createOrder({
      buyer,
      lines,
      orderRef: order.orderNumber ?? '',
      uwagi: order.orderNumber ? `OpenLinker order ${order.orderNumber}` : undefined,
    });

    this.logger.log(`Created Subiekt ZK ${response.numer} (id ${response.id})`);

    return {
      orderId: String(response.id),
      orderNumber: response.numer,
    };
  }
}

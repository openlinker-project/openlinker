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
 * A line's Subiekt `symbol` is resolved from `item.sku` when present (a Subiekt
 * towar is conventionally keyed by its SKU/symbol in this bridge's product
 * surface — see the parallel `ProductMaster` adapter). A line with no `sku`
 * cannot be resolved to a Subiekt towar and is created as an empty-symbol line;
 * the bridge is expected to treat an empty `symbol` as a one-off service line,
 * mirroring `Invoicing.cs`'s `DodajUslugeJednorazowa()` fallback pattern for
 * invoice lines with no `towarSymbol`.
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
import type { SubiektOrdersBridgeClient } from '../../bridge/subiekt-orders-bridge.client';
import type { BridgeOrderLine, BridgeOrderBuyer } from '../../bridge/subiekt-bridge-orders.types';

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

function resolveLines(order: OrderCreate): BridgeOrderLine[] {
  return order.items.map((item) => ({
    symbol: item.sku ?? '',
    ilosc: item.quantity,
    // Buyer-paid TOTAL for the line, not the unit price — mirrors
    // `Sfera.CreateZk`'s `GrossTotal` convention (`ZkLine.GrossTotal`).
    wartoscBrutto: item.price * item.quantity,
  }));
}

export class SubiektOrderProcessorAdapter implements OrderProcessorManagerPort {
  constructor(
    private readonly bridge: SubiektOrdersBridgeClient,
    private readonly logger: LoggerPort,
  ) {}

  async createOrder(order: OrderCreate): Promise<OrderRef> {
    const buyer = resolveBuyer(order);
    const lines = resolveLines(order);

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

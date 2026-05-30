/**
 * IncomingOrder Fixtures (#535)
 *
 * Deterministic `IncomingOrder` builders for the Allegro → PrestaShop
 * carrier-mapping int-spec. The fixture is intentionally minimal — one
 * line item, fixed Polish shipping address, fixed createdAt/updatedAt
 * timestamps — so failure messages diff cleanly across runs and CI
 * environments.
 *
 * Used by `allegro-prestashop-carrier-mapping.int-spec.ts` together with
 * `installAllegroTestSourceStub` (see `helpers/allegro-test-source-stub.helper.ts`):
 * the spec builds an IncomingOrder per scenario, hands it to the stub, then
 * calls `OrderIngestionService.syncOrderFromSource` to drive the carrier-
 * resolution chain.
 *
 * @module apps/api/test/integration/fixtures
 */
import type { IncomingOrder } from '@openlinker/core/orders';

export interface CarrierMappingFixtureOpts {
  /** Marketplace-native order id. The stub keys IncomingOrders by this value. */
  externalOrderId: string;
  /** Allegro delivery-method id — the carrier-mapping lookup key. */
  methodId: string;
  /** Optional display label; defaults to `'InPost Paczkomat (test)'`. */
  methodName?: string;
  /** Allegro offer id (matches the source-side identifier-mapping seed). */
  externalOfferId: string;
  /** Per-unit price in the order currency; defaults to 100.00. */
  unitPrice?: number;
  /** Shipping total; defaults to 12.50. */
  shippingTotal?: number;
  /** Optional SKU for the line; defaults to `SEEDED-SKU-${externalOrderId}`. */
  sku?: string;
  /**
   * OL order status. Defaults to `'pending'` (an *unpaid* order → PS state 1).
   * Pass `'processing'` to model a PAID marketplace order (the real Allegro
   * case — `payment.finishedAt` set → `'processing'`), which maps to PS state 2
   * ("Payment accepted") so `validateOrder` records the payment and
   * `total_paid_real == total`.
   */
  status?: IncomingOrder['status'];
}

/**
 * Build an `IncomingOrder` shaped for the carrier-mapping vertical-slice spec.
 *
 * Customer fields are populated so `OrderIngestionService.resolveCustomerId`
 * walks the email-fallback path and writes a `customer_projections` row —
 * the PS order-processor adapter reads that projection to provision a
 * guest customer via PS WS.
 */
export function createIncomingOrderForCarrierMapping(
  opts: CarrierMappingFixtureOpts,
): IncomingOrder {
  const unitPrice = opts.unitPrice ?? 100.0;
  const shippingTotal = opts.shippingTotal ?? 12.5;
  const methodName = opts.methodName ?? 'InPost Paczkomat (test)';
  const sku = opts.sku ?? `SEEDED-SKU-${opts.externalOrderId}`;

  return {
    externalOrderId: opts.externalOrderId,
    orderNumber: opts.externalOrderId,
    status: opts.status ?? 'pending',
    customerExternalId: `ALG-BUYER-${opts.externalOrderId}`,
    customerEmail: `buyer-${opts.externalOrderId.toLowerCase()}@allegromail.pl`,
    items: [
      {
        id: `${opts.externalOrderId}-line-1`,
        productRef: { type: 'offer', externalId: opts.externalOfferId },
        quantity: 1,
        price: unitPrice,
        sku,
        name: `Integration test product (${opts.externalOrderId})`,
      },
    ],
    totals: {
      subtotal: unitPrice,
      tax: 0,
      shipping: shippingTotal,
      total: unitPrice + shippingTotal,
      currency: 'PLN',
    },
    shippingAddress: {
      firstName: 'Test',
      lastName: 'Buyer',
      address1: 'Marszałkowska 1',
      city: 'Warszawa',
      postalCode: '00-001',
      country: 'PL',
      phone: '+48123456789',
    },
    billingAddress: {
      firstName: 'Test',
      lastName: 'Buyer',
      address1: 'Marszałkowska 1',
      city: 'Warszawa',
      postalCode: '00-001',
      country: 'PL',
      phone: '+48123456789',
    },
    shipping: {
      methodId: opts.methodId,
      methodName,
    },
    createdAt: '2026-05-01T10:00:00.000Z',
    updatedAt: '2026-05-01T10:00:00.000Z',
  };
}

/**
 * Analytics fixture seeding (#2482)
 *
 * Flow-driven seeds for the mockup-parity spec's real-app states — no direct
 * database writes anywhere in this file, per the issue's own constraint. Two
 * of the fifteen mockup states (`detail-tax` / `detail-postrollout`, both
 * keyed on `order_records.taxRateEra = 'pre-rollout'`) have NO flow-driven
 * seed at all — that value is written only once, by a historical backfill
 * migration, never by ingestion — see #2855 for the proposed test-only seam
 * and `tests/analytics/mockup-parity.spec.ts` for where those two states are
 * skipped rather than faked.
 *
 * @module support
 */
import type { ApiClient } from '../api/api-client';
import type { SyncJobs } from './jobs';
import type { Poller } from './poller';
import type { World } from '../world/world';
import { synthesizeOrder, type SynthesizedOrder } from './order-synthesis';
import { PlatformType } from '../world/world';

export interface AnalyticsSeedContext {
  api: ApiClient;
  world: World;
  jobs: SyncJobs;
  poll: Poller;
}

export interface CurrencyMismatchFixture {
  order: SynthesizedOrder;
  /** The reporting currency this order was actually stamped in ("old"). */
  stampedCurrency: string;
  /**
   * The reporting-currency setting to restore on teardown — call this in the
   * spec's `finally`/`afterAll`. Changing the reporting currency is
   * deployment-wide, so leaving it flipped would silently move every OTHER
   * analytics figure a later test (or a human) reads.
   */
  restore: () => Promise<void>;
}

/** ISO date window wide enough to contain anything this suite just seeded. */
export function widePastToFutureRange(): { from: string; to: string } {
  const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const to = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  return { from, to };
}

/**
 * Seeds ONE order and then flips the deployment's reporting-currency setting
 * to the other supported currency, which is what actually produces a
 * currency-mismatch row: `reportingCurrency` (#2124) is the currency the
 * order was stamped in AT INGESTION TIME, and the coverage detector's
 * predicate is `reportingCurrency != currentReportingCurrency` — an order's
 * OWN native currency plays no part (see
 * `libs/core/src/orders/infrastructure/persistence/repositories/order-record.repository.ts`'s
 * `CURRENCY_MISMATCH_FRAGMENT`).
 *
 * `GET /orders/:id` exposes no `reportingCurrency` field to poll directly
 * (`OrderRecordResponseDto` — checked), so readiness is confirmed the same
 * way the coverage panel itself would show it: after the flip, poll
 * `getCurrencyMismatchOrders` for THIS order id to appear. That also means
 * the flip must happen only once the order is fully `ready` (the FX stamp
 * is attempted inline during ingestion, so a `ready` order has already had
 * its shot at a stamp) — racing ahead of `ready` risks flipping onto a
 * still-unstamped order, which reads `reportingCurrency IS NULL` (the
 * "unconverted" bucket, not this fixture's "outdated currency" one).
 */
export async function seedCurrencyMismatchOrder(
  ctx: AnalyticsSeedContext,
): Promise<CurrencyMismatchFixture> {
  const { api, poll } = ctx;

  const settingsBefore = await api.currencySettings.get();
  const originalReportingCurrency = settingsBefore.reportingCurrency;
  const otherCurrency = settingsBefore.supportedCurrencies.find(
    (code) => code !== originalReportingCurrency,
  );
  if (!otherCurrency) {
    throw new Error(
      `seedCurrencyMismatchOrder needs a second supported reporting currency besides ` +
        `${originalReportingCurrency} (deployment reports ${JSON.stringify(settingsBefore.supportedCurrencies)})`,
    );
  }

  // `synthesizeOrder` already waits for `recordStatus === 'ready'`, which is
  // what makes the flip below safe — see the doc comment above.
  const order = await synthesizeOrder(ctx);

  await api.currencySettings.setReportingCurrency(otherCurrency);

  const range = widePastToFutureRange();
  await poll.until(
    async () => {
      const page = await api.analytics.getCurrencyMismatchOrders({ ...range, limit: 100 });
      return page.items.some((item) => item.internalOrderId === order.order.internalOrderId);
    },
    (found) => found === true,
    {
      timeoutMs: 60_000,
      message: `order ${order.order.internalOrderId} to appear in the currency-mismatch coverage list after the reporting-currency flip`,
    },
  );

  return {
    order,
    stampedCurrency: originalReportingCurrency,
    restore: () => api.currencySettings.setReportingCurrency(originalReportingCurrency).then(() => undefined),
  };
}

/**
 * Seeds an order OL cannot map to a product — the `detail-mapping`
 * (`product-matching`) coverage category. Creates a throwaway PrestaShop
 * product directly via the webservice (bypassing OL's own catalogue sync
 * entirely, so OL never gets a chance to mint an identifier mapping for it)
 * and orders it, so ingestion resolves the line to nothing and the record
 * lands `recordStatus: 'awaiting_mapping'`.
 */
export async function seedUnmappedProductOrder(
  ctx: AnalyticsSeedContext,
): Promise<{ internalOrderId: string; sourceConnectionId: string }> {
  const { api, world, jobs } = ctx;
  const prestashop = world.requireConnection(PlatformType.prestashop);
  const { buildPrestashopWebserviceClient } = await import('./order-synthesis');
  const ps = buildPrestashopWebserviceClient(world);
  if (!ps) {
    throw new Error(
      'seedUnmappedProductOrder requires OL_PS_WEBSERVICE_KEY (+ a resolvable PS base URL)',
    );
  }

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const product = await ps.createProduct({
    name: `E2E unmapped ${suffix}`,
    reference: `e2e-unmapped-${suffix}`,
    ean13: '',
    price: '19.99',
    quantity: 5,
  });

  const countryId = (await ps.getCountryIdByIso('PL')) ?? '1';
  const customerName = { firstName: 'Nieprzypisany', lastName: 'Testowy' };
  const customer = await ps.createCustomer({
    ...customerName,
    email: `e2e-unmapped-${suffix}@e2e.openlinker.test`,
    password: 'e2e-Password-123',
  });
  const address = await ps.createAddress({
    idCustomer: customer.id,
    alias: `e2e-unmapped-${suffix}`,
    ...customerName,
    address1: 'ul. Niezmapowana 1',
    city: 'Warszawa',
    postcode: '00-001',
    idCountry: countryId,
  });
  const cart = await ps.createCart({
    idCustomer: customer.id,
    idAddressDelivery: address.id,
    idAddressInvoice: address.id,
    rows: [{ productId: product.id, productAttributeId: '0', quantity: 1 }],
  });
  const created = await ps.createOrder({
    idCustomer: customer.id,
    idAddressDelivery: address.id,
    idAddressInvoice: address.id,
    idCart: cart.id,
    totalProducts: '19.99',
    totalProductsWt: '19.99',
    totalPaidTaxExcl: '19.99',
    totalPaidTaxIncl: '19.99',
    totalShippingTaxIncl: '0.00',
    rows: [
      {
        productId: product.id,
        productAttributeId: '0',
        quantity: 1,
        unitPriceTaxIncl: '19.99',
      },
    ],
  });

  const { waitForOrderByExternalId } = await import('./orders');
  const order = await waitForOrderByExternalId(api, {
    sourceConnectionId: prestashop.id,
    externalOrderId: created.id,
    // This order can never reach `ready` — the product it references was
    // never synced, so item resolution fails and it lands `awaiting_mapping`
    // (`OrderIngestionService`, the `product-matching` coverage category's
    // own trigger). Waiting on the default `['ready']` would time out.
    recordStatuses: ['awaiting_mapping', 'source_deleted'],
    timeoutMs: 180_000,
    intervalMs: 3_000,
    retriggerPoll: () =>
      jobs.trigger({ connectionId: prestashop.id, jobType: 'marketplace.orders.poll' }),
  });

  return { internalOrderId: order.internalOrderId, sourceConnectionId: prestashop.id };
}

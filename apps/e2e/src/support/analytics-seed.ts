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
   * The reporting currency the deployment is flipped to RIGHT NOW (until
   * `restore()` runs) — the ONLY currency a display-currency-picker scenario
   * can meaningfully "convert to" in the same test run, since converting to
   * whatever reporting ALREADY is is a no-op that never triggers a fetch or
   * shows a "Converting…" transient state.
   */
  currentReportingCurrency: string;
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
    currentReportingCurrency: otherCurrency,
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

  // DELETE the product now, before waiting on the order below — while it
  // merely EXISTS-but-unsynced, this stack's webhook-driven catalog sync
  // resolves it within seconds (verified live: the very first `#2482`
  // full-suite run raced this and the product-matching coverage row was
  // gone — "Nothing to do" — by the time the `detail-mapping` step ran,
  // several minutes into the same test). A product that no longer exists
  // at all can never be synced by anything, so the order it references
  // stays PERMANENTLY unresolvable, matching the fixture's own documented
  // intent below rather than merely hoping no sync wins the race.
  await ps.deleteProduct(product.id);

  const { waitForOrderByExternalId } = await import('./orders');
  const order = await waitForOrderByExternalId(api, {
    sourceConnectionId: prestashop.id,
    externalOrderId: created.id,
    // This order can never reach `ready` — the product it references was
    // deleted before OL ever synced it, so item resolution fails and it
    // lands `awaiting_mapping` (`OrderIngestionService`, the
    // `product-matching` coverage category's own trigger). Waiting on the
    // default `['ready']` would time out.
    recordStatuses: ['awaiting_mapping', 'source_deleted'],
    timeoutMs: 180_000,
    intervalMs: 3_000,
    // See order-synthesis.ts: direct per-order sync bypasses the broken
    // `date_upd` feed sort (#2877) that `marketplace.orders.poll` always hits
    // on this PrestaShop version.
    // See `SyncJobs.retriggerDirectOrderSync` for why this is a
    // direct-per-order sync (not `marketplace.orders.poll`, #2877) and
    // rate-limited rather than fired on every poll tick.
    retriggerPoll: jobs.retriggerDirectOrderSync(prestashop.id, created.id),
  });

  return { internalOrderId: order.internalOrderId, sourceConnectionId: prestashop.id };
}

/**
 * Finds an already-existing tax-b order, for a stack where
 * `seedNoRateProductOrder`'s flow-driven PrestaShop path cannot land one.
 *
 * **Why this exists.** `seedNoRateProductOrder` produces a real, ready,
 * catalogue-synced order whose tax rate is genuinely unresolved at the
 * PRODUCT level — but PrestaShop's own order adapter stamps EVERY order
 * `taxTreatment: 'exclusive'` (`prestashop-order.mapper.ts`, #2440's
 * deliberate net-pricing assumption), and `netSalesOrderNetEligibleSql`
 * treats an `'exclusive'`-priced order as net-eligible UNCONDITIONALLY,
 * bypassing the rate-resolution requirement entirely
 * (`net-sales-tax-rate.types.ts`). The same is true of the WooCommerce
 * adapter. So a PrestaShop/WooCommerce order can **never** reach tax-a/b/c —
 * confirmed live against this stack's full order history (35+ orders spanning
 * 2025-08-01..2026-09-05): those three categories were permanently empty.
 * Filed as a real production bug; not something this test suite should paper
 * over by faking a state PrestaShop/WooCommerce structurally cannot produce.
 *
 * Allegro's order adapter DOES report `taxTreatment: 'inclusive'`
 * (`allegro-order-source.adapter.ts`), which is the one live path into
 * tax-a/b/c — but exercising it needs a real Allegro sandbox offer (OAuth
 * connection, seller defaults incl. a GPSR responsible-producer entry created
 * by hand in Allegro's own seller panel — no API for that — plus a category
 * carrying no required product parameters) and then a REAL buyer-side
 * checkout on the sandbox, which no script can perform. That one-time setup
 * was done manually for this project (see the epic thread) and produced a
 * real order (`ol_order_ccb3046a96f84642a2c4919ad0e61a40` at the time of
 * writing) permanently sitting in this deployment's tax-b bucket.
 *
 * This helper is therefore a deliberate compromise: it reads whatever is
 * ALREADY in the tax-b coverage list rather than seeding a fresh one on every
 * run. It is honest about that — the returned order is real, its coverage
 * membership is asserted against the live API exactly like a freshly-seeded
 * one would be, and if the bucket is ever empty (a fresh install, or this
 * order's history is purged) the helper fails loudly naming the manual step
 * required rather than silently skipping the assertion.
 *
 * **Caller obligation**: the tax coverage query is a strict
 * `reportingCurrency = :currentReportingCurrency` equality
 * (`order-record.repository.ts`'s `netExcludedAndNotCancelled`), so this must
 * only be called while the deployment's reporting currency matches the
 * fixture order's own stamped (native) currency — i.e. AFTER any
 * `seedCurrencyMismatchOrder` fixture in the same run has been `restore()`d,
 * never while it is still flipped. Caught live: calling this inside that
 * window made a real, permanently-existing tax-b order read as "does not
 * exist" for the window's whole duration.
 */
export async function findExistingNoRateOrder(
  ctx: AnalyticsSeedContext,
): Promise<{ internalOrderId: string; sourceConnectionId: string }> {
  const { api, poll } = ctx;
  const range = widePastToFutureRange();
  // Retried with a budget well past ONE request's own 30s client timeout —
  // a 30s poll budget gives a single slow request under real suite load
  // (this step runs after several heavier fixtures) exactly one shot before
  // the poll gives up having attempted nothing else, misreporting a
  // deployment-configuration absence as a transient timing artifact.
  let items: Array<{ internalOrderId: string; sourceConnectionId: string }> = [];
  try {
    await poll.until(
      async () => {
        const page = await api.analytics.getTaxCoverageOrders({
          ...range,
          category: 'tax-b',
          limit: 100,
        });
        items = page.items;
        return items.length > 0;
      },
      (found) => found === true,
      {
        timeoutMs: 90_000,
        intervalMs: 3_000,
        message: 'an existing tax-b order to appear in the coverage list',
      },
    );
  } catch {
    // fall through to the throw below with the same message
  }
  const item = items[0];
  if (!item) {
    throw new Error(
      'No tax-b order exists in this deployment. seedNoRateProductOrder cannot produce one ' +
        "(PrestaShop/WooCommerce order adapters hardcode taxTreatment: 'exclusive', which makes " +
        'tax-a/b/c structurally unreachable from those sources — see this function\'s docblock). ' +
        'A real Allegro sandbox order is required: publish an offer for a no-rate product on a ' +
        'category with no required product parameters, wait for it to validate, then buy it as a ' +
        'test buyer on the sandbox.',
    );
  }
  return { internalOrderId: item.internalOrderId, sourceConnectionId: item.sourceConnectionId };
}

/**
 * Seeds a NORMALLY-SYNCED order whose product's tax rate is genuinely
 * unresolved — the `detail-novat` (`tax-b`) coverage category. Unlike
 * `seedUnmappedProductOrder`, the product IS synced into OL first (via
 * `master.product.syncAll`), so ingestion resolves the line and the record
 * reaches `recordStatus: 'ready'` — the only thing missing is the tax rate,
 * because the product's `id_tax_rules_group` names a group with zero
 * `tax_rules` (`PrestashopTaxRateResolver.selectRule` reports `{kind:
 * 'none'}`, which `IProductsService.getEffectiveTaxRate` surfaces as
 * `taxRateState() === 'no-rate'` — see
 * `libs/core/src/products/domain/types/tax-rate.types.ts`).
 */
export async function seedNoRateProductOrder(
  ctx: AnalyticsSeedContext,
): Promise<{ internalOrderId: string; sourceConnectionId: string }> {
  const { api, world, jobs, poll } = ctx;
  const prestashop = world.requireConnection(PlatformType.prestashop);
  const { buildPrestashopWebserviceClient } = await import('./order-synthesis');
  const ps = buildPrestashopWebserviceClient(world);
  if (!ps) {
    throw new Error(
      'seedNoRateProductOrder requires OL_PS_WEBSERVICE_KEY (+ a resolvable PS base URL)',
    );
  }

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const taxRulesGroup = await ps.createTaxRulesGroup(`e2e-no-rate-${suffix}`);
  const product = await ps.createProduct({
    name: `E2E no-rate ${suffix}`,
    reference: `e2e-no-rate-${suffix}`,
    ean13: '',
    price: '14.99',
    quantity: 5,
    idTaxRulesGroup: taxRulesGroup.id,
  });

  // Sync the catalogue so OL learns about this product (and, via the same
  // resolver, that its tax rate is unresolved) before the order arrives —
  // ingestion reads the CATALOGUE's cached rate, never PrestaShop live.
  await jobs.triggerAndWait(
    { connectionId: prestashop.id, jobType: 'master.product.syncAll' },
    { expectSuccess: false, timeoutMs: 180_000 },
  );
  await ctx.poll.until(
    async () => {
      const page = await api.products.list({ search: product.reference, limit: 10 });
      return page.items.some((item) => item.sku === product.reference);
    },
    (found) => found === true,
    { timeoutMs: 120_000, message: `product ${product.reference} to appear in OL's catalogue` },
  );

  const countryId = (await ps.getCountryIdByIso('PL')) ?? '1';
  const customerName = { firstName: 'Bezstawki', lastName: 'Testowy' };
  const customer = await ps.createCustomer({
    ...customerName,
    email: `e2e-no-rate-${suffix}@e2e.openlinker.test`,
    password: 'e2e-Password-123',
  });
  const address = await ps.createAddress({
    idCustomer: customer.id,
    alias: `e2e-no-rate-${suffix}`,
    ...customerName,
    address1: 'ul. Bezstawkowa 1',
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
    totalProducts: '14.99',
    totalProductsWt: '14.99',
    totalPaidTaxExcl: '14.99',
    totalPaidTaxIncl: '14.99',
    totalShippingTaxIncl: '0.00',
    rows: [
      {
        productId: product.id,
        productAttributeId: '0',
        quantity: 1,
        unitPriceTaxIncl: '14.99',
      },
    ],
  });

  const { waitForOrderByExternalId } = await import('./orders');
  const order = await waitForOrderByExternalId(api, {
    sourceConnectionId: prestashop.id,
    externalOrderId: created.id,
    timeoutMs: 180_000,
    intervalMs: 3_000,
    // See `SyncJobs.retriggerDirectOrderSync` for why this is a
    // direct-per-order sync (not `marketplace.orders.poll`, #2877) and
    // rate-limited rather than fired on every poll tick.
    retriggerPoll: jobs.retriggerDirectOrderSync(prestashop.id, created.id),
  });

  // `recordStatus: 'ready'` is NOT sufficient — the tax-b coverage candidate
  // query additionally requires `order_records.reportingCurrency` to equal
  // the CURRENT reporting-currency setting (`findNetExcludedOrderCandidates`,
  // `order-record.repository.ts`), and that FX stamp can land asynchronously
  // after ingestion (a retry job, not always inline — see
  // `docs/architecture-overview.md` § Currency). Without this poll the order
  // could reach `ready` with its FX stamp still pending, and the caller's own
  // `openCoverageDetail('tax-b')` click would time out waiting for a row
  // that data-wise exists but hasn't reached the coverage read yet — caught
  // live: the very first full-suite run after the currency-mismatch fixture
  // in this same test flipped the reporting currency raced exactly this.
  // Mirrors `seedCurrencyMismatchOrder`'s own poll-the-coverage-list pattern
  // rather than trusting a status field to imply coverage-list membership.
  const range = widePastToFutureRange();
  await poll.until(
    async () => {
      const page = await api.analytics.getTaxCoverageOrders({
        ...range,
        category: 'tax-b',
        limit: 100,
      });
      return page.items.some((item) => item.internalOrderId === order.internalOrderId);
    },
    (found) => found === true,
    {
      timeoutMs: 60_000,
      message: `order ${order.internalOrderId} to appear in the tax-b coverage list`,
    },
  );

  return { internalOrderId: order.internalOrderId, sourceConnectionId: prestashop.id };
}

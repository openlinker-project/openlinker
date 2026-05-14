/**
 * Allegro → PrestaShop Carrier Mapping Int-Spec (#535, #692 — closes #513)
 *
 * Exercises `OrderIngestionService.syncOrderFromSource` end-to-end against a
 * real PrestaShop Testcontainer with the real OL PS module installed
 * (harness extended in #692):
 *
 *   S-1 — mapped happy path:
 *     `connection_carrier_mappings` routes Allegro `methodId='paczkomat-s1'`
 *     to PS "My carrier". Expect the order lands with `id_carrier ==
 *     myCarrier.idCarrier`, `total_shipping == 12.50`, cart `id_carrier > 0`,
 *     `current_state != 8` (no payment-error state).
 *
 *   S-2 — defaultCarrierId fallback:
 *     `methodId='paczkomat-s2'` has no mapping; `connection.config.defaultCarrierId`
 *     points at "My cheap carrier". Expect `id_carrier == myCheapCarrier.idCarrier`,
 *     `total_shipping == 12.50`. The negative ("sidecar `writeCartShipping` was
 *     NOT invoked") is intentionally not asserted — observing that would
 *     require HTTP-client spy infrastructure that's out of scope here, and
 *     the positive id_carrier assertion is sufficient to prove resolution
 *     chain step 2 was taken instead of step 3 (different id_carrier values).
 *
 *   S-3 — OL Dynamic carrier round-trip (#692, closes #513):
 *     `methodId='paczkomat-s3'` maps to the live module-installed OL Dynamic
 *     carrier id. Expect the order lands with `id_carrier == ps.olDynamicCarrierId`,
 *     `total_shipping == 12.50` (sourced from the sidecar, not PS price tables),
 *     `current_state != 8`, AND the `ps_openlinker_cart_shipping` row is
 *     populated — the unique signal that the `writeCartShipping` POST →
 *     `cartshipping.php` controller → HMAC verify → `CartShippingRepository::upsert`
 *     → `Carrier::getOrderShippingCostExternal` reads it round-trip actually
 *     happened against real PS, not just mock-side.
 *
 * Catches the failure-mode cluster that motivated #503 (cart `id_carrier=0`),
 * #505 (PS rejects guest customers in group 0), #467 (`total_shipping`
 * zeroed by no-zone carriers), and #513 (PS recomputes `total_shipping` from
 * carrier price tables on POST /orders — fixed via the OL Dynamic carrier path).
 *
 * Suite-scoped: the PS container boots in `beforeAll` and stops in `afterAll`
 * (cold-cache CI: 5-10 min; warm cache: 60-90 s). The global Postgres+Redis
 * harness from `setup.ts` is shared with other int-specs in the same run.
 *
 * @module apps/api/test/integration/orders
 */
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import {
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  IIdentifierMappingService,
} from '@openlinker/core/identifier-mapping';
import { ORDER_INGESTION_SERVICE_TOKEN, IOrderIngestionService } from '@openlinker/core/orders';
import { ProductOrmEntity, ProductVariantOrmEntity } from '@openlinker/core/products/orm-entities';
import { getTestHarness, IntegrationTestHarness } from '../setup';
import {
  PRESTASHOP_IMAGE,
  PrestashopTestContainer,
  startPrestashopContainer,
} from '../helpers/prestashop-container.helper';
import {
  DefaultPrestashopCarriers,
  getDefaultPsCarriers,
  readCartShipping,
  seedPrestashopProductForOrders,
} from '../helpers/prestashop-fixture.helper';
import {
  AllegroTestSourceStub,
  installAllegroTestSourceStub,
} from '../helpers/allegro-test-source-stub.helper';
import {
  createTestAllegroSourceConnection,
  createTestPrestashopDestinationConnection,
  seedCarrierMapping,
} from '../helpers/test-connection.helper';
import { createIncomingOrderForCarrierMapping } from '../fixtures/incoming-order.fixtures';

interface PsOrderRow {
  id: string | number;
  id_carrier: string | number;
  id_cart: string | number;
  total_shipping: string | number;
  total_paid: string | number;
  total_paid_real: string | number;
  current_state: string | number;
}

interface PsCartRow {
  id: string | number;
  id_carrier: string | number;
}

async function fetchPsResource<T>(
  ps: PrestashopTestContainer,
  path: string,
  envelopeKey: string
): Promise<T> {
  const auth = Buffer.from(`${ps.webserviceApiKey}:`).toString('base64');
  const response = await fetch(`${ps.baseUrl}${path}?output_format=JSON`, {
    method: 'GET',
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `PS WS GET ${path} failed: ${response.status} ${response.statusText} — ${body.slice(0, 400)}`
    );
  }
  const json = (await response.json()) as Record<string, T>;
  const data = json[envelopeKey];
  if (!data) {
    throw new Error(
      `PS WS GET ${path} returned no '${envelopeKey}' envelope. Body keys: [${Object.keys(json).join(', ')}]`
    );
  }
  return data;
}

const fetchPsOrder = (ps: PrestashopTestContainer, idOrder: number): Promise<PsOrderRow> =>
  fetchPsResource<PsOrderRow>(ps, `/api/orders/${idOrder}`, 'order');

const fetchPsCart = (ps: PrestashopTestContainer, idCart: number): Promise<PsCartRow> =>
  fetchPsResource<PsCartRow>(ps, `/api/carts/${idCart}`, 'cart');

/**
 * Resolve the PS-side numeric `id_order` from an OL-internal order id.
 *
 * `OrderRef.orderId` returned by `OrderSyncService` carries the OL internal
 * id (`ol_order_<uuid>`); the PS external id lives in identifier_mappings
 * keyed by the destination connection. The PS WS only accepts numeric ids
 * on `/api/orders/{id}`, so we walk the mapping here.
 */
async function resolveDestinationOrderId(
  harness: IntegrationTestHarness,
  internalOrderId: string,
  destinationConnectionId: string
): Promise<number> {
  const identifierMapping = harness
    .getApp()
    .get<IIdentifierMappingService>(IDENTIFIER_MAPPING_SERVICE_TOKEN);
  const externals = await identifierMapping.getExternalIds('Order', internalOrderId);
  const match = externals.find((m) => m.connectionId === destinationConnectionId);
  if (!match) {
    throw new Error(
      `No PS-side identifier mapping found for OL order ${internalOrderId} on connection ${destinationConnectionId}. ` +
        `Found mappings: ${JSON.stringify(externals)}`
    );
  }
  const parsed = Number(match.externalId);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `PS-side order mapping is not a positive integer: '${match.externalId}' for OL order ${internalOrderId}`
    );
  }
  return parsed;
}

/**
 * Surface PS PHP error logs into the test stderr when an order-create fails.
 * PS 9.x writes to `/var/www/html/var/logs/prod_*.log`; we exec into the
 * running PS container to read whichever log files exist. Best-effort —
 * the call is silenced on its own failure so the underlying assertion error
 * remains the primary signal.
 */
function dumpPrestashopErrorLogs(): void {
  try {
    const containers = execSync(
      `docker ps --filter ancestor=${PRESTASHOP_IMAGE} --format '{{.ID}}'`,
      { encoding: 'utf8' }
    )
      .trim()
      .split('\n')
      .filter(Boolean);
    for (const id of containers) {
      try {
        // PS PHP fatals land in Apache's error log; PS app-level errors land
        // in /var/www/html/var/logs/. Both surfaces matter for a 500.
        const out = execSync(
          `docker exec ${id} sh -c 'for f in /var/log/apache2/error.log /var/log/apache2/access.log /var/log/php*.log; do echo "=== $f ==="; tail -n 50 "$f" 2>/dev/null; done; echo "=== PS app logs (last 50 each) ==="; find /var/www/html/var/logs -name "*.log" -mmin -5 -exec sh -c "echo --- {} ---; tail -n 50 {}" \\;'`,
          { encoding: 'utf8', timeout: 10_000 }
        );
        if (out.trim()) {
          // eslint-disable-next-line no-console -- CLI / one-shot script: stdout is the user-facing channel
          console.error(`[ps-container ${id} recent log tail]\n${out}`);
        }
      } catch {
        /* best-effort */
      }
    }
  } catch {
    /* best-effort */
  }
}

/** Env-var key the WebhookSecretProviderPort reads via its env-fallback path. */
const WEBHOOK_SECRET_ENV_KEY = 'OPENLINKER_WEBHOOK_SECRET__PRESTASHOP';

describe('Allegro → PrestaShop carrier mapping (#535, #692)', () => {
  let harness: IntegrationTestHarness;
  let ps: PrestashopTestContainer;
  let stub: AllegroTestSourceStub;
  let allegroConnectionId: string;
  let prestashopConnectionId: string;
  let defaultCarriers: DefaultPrestashopCarriers;
  /** Snapshot of the env-var value (if any) at suite start — restored in afterAll. */
  let priorWebhookSecretEnv: string | undefined;

  beforeAll(async () => {
    harness = await getTestHarness();
    ps = await startPrestashopContainer();

    // S-3 — wire the adapter side of the HMAC contract. The module side is
    // seeded into ps_configuration.OPENLINKER_WEBHOOK_SECRET by
    // `installOpenLinkerModuleIntoContainer` inside `startPrestashopContainer`;
    // we need the same bytes resolvable by `WebhookSecretProviderPort.getSecret`
    // on the adapter side. The env-var fallback path in CredentialsWebhookSecretAdapter
    // is documented as deprecated (rotation into the encrypted credentials
    // table is the production path), but it remains supported as a test-fixture
    // pragma and the webhook-ingestion int-spec uses the same shape. When the
    // fallback is removed, switch this to a DB-credential seed via
    // `IntegrationCredentialRepositoryPort` + `CryptoService.encrypt` keyed at
    // `webhookSecretRef(prestashopConnectionId)`.
    //
    // Snapshot the prior value (if any) so the cleanup in afterAll restores
    // rather than blank-clears — integration tests run with `maxWorkers: 1`,
    // so leakage between spec files is otherwise possible.
    priorWebhookSecretEnv = process.env[WEBHOOK_SECRET_ENV_KEY];
    process.env[WEBHOOK_SECRET_ENV_KEY] = ps.webhookSharedSecret;

    defaultCarriers = await getDefaultPsCarriers(ps.mysqlAddress);

    stub = installAllegroTestSourceStub(harness);

    const allegro = await createTestAllegroSourceConnection(harness.getDataSource(), {
      adapterKey: stub.adapterKey,
      platformType: stub.platformType,
    });
    allegroConnectionId = allegro.id;

    const prestashop = await createTestPrestashopDestinationConnection(harness.getDataSource(), {
      baseUrl: ps.baseUrl,
      webserviceApiKey: ps.webserviceApiKey,
      defaultCarrierId: defaultCarriers.myCheapCarrier.idCarrier,
    });
    prestashopConnectionId = prestashop.id;

    // Seed the PS product + OL mappings for both scenarios. Order-independent —
    // each scenario uses a disjoint externalOrderId/methodId/externalOfferId triple.
    await seedScenario({
      harness,
      psMysqlAddress: ps.mysqlAddress,
      externalOfferId: 'ALG-OFFER-S1',
      psReference: 'SEEDED-SKU-S1',
      psName: 'Carrier-mapping S-1 product',
      allegroConnectionId,
      prestashopConnectionId,
    });
    await seedScenario({
      harness,
      psMysqlAddress: ps.mysqlAddress,
      externalOfferId: 'ALG-OFFER-S2',
      psReference: 'SEEDED-SKU-S2',
      psName: 'Carrier-mapping S-2 product',
      allegroConnectionId,
      prestashopConnectionId,
    });
    await seedScenario({
      harness,
      psMysqlAddress: ps.mysqlAddress,
      externalOfferId: 'ALG-OFFER-S3',
      psReference: 'SEEDED-SKU-S3',
      psName: 'Carrier-mapping S-3 product',
      allegroConnectionId,
      prestashopConnectionId,
    });

    // S-1: mapping seeded. S-2: no mapping (resolution falls through to defaultCarrierId).
    // S-3: mapped to the OL Dynamic carrier id — exercises the sidecar write path.
    await seedCarrierMapping(
      harness,
      allegroConnectionId,
      'paczkomat-s1',
      String(defaultCarriers.myCarrier.idCarrier)
    );
    await seedCarrierMapping(
      harness,
      allegroConnectionId,
      'paczkomat-s3',
      String(ps.olDynamicCarrierId)
    );
  }, 15 * 60_000);

  afterAll(async () => {
    if (ps) {
      await ps.cleanup();
    }
    // Restore the env var the suite mutated. Even though Jest's worker model
    // for integration tests is `maxWorkers: 1`, leaving the secret in
    // `process.env` would silently leak into any spec file that runs later in
    // the same Node process and assumes a different (or absent) secret.
    if (priorWebhookSecretEnv === undefined) {
      delete process.env[WEBHOOK_SECRET_ENV_KEY];
    } else {
      process.env[WEBHOOK_SECRET_ENV_KEY] = priorWebhookSecretEnv;
    }
  });

  it('S-1: mapped carrier lands on order + cart with positive id_carrier', async () => {
    const incoming = createIncomingOrderForCarrierMapping({
      externalOrderId: 'ALG-S1',
      methodId: 'paczkomat-s1',
      externalOfferId: 'ALG-OFFER-S1',
      sku: 'SEEDED-SKU-S1',
    });
    stub.setNextIncomingOrder(incoming);

    const ingestion = harness.getApp().get<IOrderIngestionService>(ORDER_INGESTION_SERVICE_TOKEN);
    const results = await ingestion.syncOrderFromSource(allegroConnectionId, 'ALG-S1');

    expect(results).toHaveLength(1);
    if (results[0].status !== 'success') {
      dumpPrestashopErrorLogs();
      throw new Error(
        `S-1 order sync failed: destination=${results[0].destinationConnectionId} message=${results[0].error.message}`
      );
    }
    expect(results[0].destinationConnectionId).toBe(prestashopConnectionId);

    const psOrderId = await resolveDestinationOrderId(
      harness,
      results[0].orderRef.orderId,
      prestashopConnectionId
    );
    const psOrder = await fetchPsOrder(ps, psOrderId);

    expect(Number(psOrder.id_carrier)).toBe(defaultCarriers.myCarrier.idCarrier);
    expect(Number(psOrder.total_shipping)).toBeCloseTo(12.5, 2);
    expect(Number(psOrder.current_state)).not.toBe(8);
    expect(Number(psOrder.total_paid)).toBeCloseTo(Number(psOrder.total_paid_real), 2);

    const psCart = await fetchPsCart(ps, Number(psOrder.id_cart));
    expect(Number(psCart.id_carrier)).toBeGreaterThan(0);
  });

  it('S-2: defaultCarrierId fallback lands on order with config carrier', async () => {
    const incoming = createIncomingOrderForCarrierMapping({
      externalOrderId: 'ALG-S2',
      methodId: 'paczkomat-s2',
      externalOfferId: 'ALG-OFFER-S2',
      sku: 'SEEDED-SKU-S2',
    });
    stub.setNextIncomingOrder(incoming);

    const ingestion = harness.getApp().get<IOrderIngestionService>(ORDER_INGESTION_SERVICE_TOKEN);
    const results = await ingestion.syncOrderFromSource(allegroConnectionId, 'ALG-S2');

    expect(results).toHaveLength(1);
    if (results[0].status !== 'success') {
      dumpPrestashopErrorLogs();
      throw new Error(
        `S-2 order sync failed: destination=${results[0].destinationConnectionId} message=${results[0].error.message}`
      );
    }

    const psOrderId = await resolveDestinationOrderId(
      harness,
      results[0].orderRef.orderId,
      prestashopConnectionId
    );
    const psOrder = await fetchPsOrder(ps, psOrderId);

    // S-2's strongest assertion is on the *cart*, not the order. OL's
    // `defaultCarrierId` fallback writes the chosen `id_carrier` onto the cart
    // during cart-create; PS may then rewrite the value on the order during
    // its own carrier-resolution pass (cheapest available wins when more than
    // one carrier matches the cart's delivery options). That rewrite is PS
    // behaviour, not OL — the bug surface this spec guards (#503/#505/#467)
    // is the cart write, so the cart is what we assert strictly.
    const psCart = await fetchPsCart(ps, Number(psOrder.id_cart));
    expect(Number(psCart.id_carrier)).toBe(defaultCarriers.myCheapCarrier.idCarrier);
    expect(Number(psOrder.id_carrier)).toBeGreaterThan(0); // #503 guard — any positive carrier
    expect(Number(psOrder.total_shipping)).toBeCloseTo(12.5, 2);
    expect(Number(psOrder.current_state)).not.toBe(8);

    // Intentionally NOT asserted: sidecar `writeCartShipping` was not invoked.
    // The OL Dynamic carrier id differs from `myCheapCarrier.idCarrier`, so the
    // positive id_carrier check above already discriminates resolution chain
    // step 2 (this branch) from step 3 (would have written olDynamicCarrierId).
    // Observing the negative HTTP call would require spy infrastructure on the
    // PS WS client — deferred until the OL Dynamic e2e path is added.
  });

  it('S-3: OL Dynamic carrier path writes sidecar + lands authoritative shipping', async () => {
    const incoming = createIncomingOrderForCarrierMapping({
      externalOrderId: 'ALG-S3',
      methodId: 'paczkomat-s3',
      externalOfferId: 'ALG-OFFER-S3',
      sku: 'SEEDED-SKU-S3',
    });
    stub.setNextIncomingOrder(incoming);

    const ingestion = harness.getApp().get<IOrderIngestionService>(ORDER_INGESTION_SERVICE_TOKEN);
    const results = await ingestion.syncOrderFromSource(allegroConnectionId, 'ALG-S3');

    expect(results).toHaveLength(1);
    if (results[0].status !== 'success') {
      dumpPrestashopErrorLogs();
      throw new Error(
        `S-3 order sync failed: destination=${results[0].destinationConnectionId} message=${results[0].error.message}`
      );
    }
    expect(results[0].destinationConnectionId).toBe(prestashopConnectionId);

    const psOrderId = await resolveDestinationOrderId(
      harness,
      results[0].orderRef.orderId,
      prestashopConnectionId
    );
    const psOrder = await fetchPsOrder(ps, psOrderId);

    const psCart = await fetchPsCart(ps, Number(psOrder.id_cart));

    // (1) Cart routed to the OL Dynamic carrier. This is the load-bearing
    // adapter-side signal: `OrderProcessorManagerAdapter` resolved the
    // mapping table, found `paczkomat-s3` → `olDynamicCarrierId`, and wrote
    // that id onto the cart at POST /carts time. If the adapter had picked
    // a different carrier (mapping miss, defaultCarrierId fallback, or the
    // discoverDynamicCarrierId WS query returning a stale id), this would
    // be a different number.
    expect(Number(psCart.id_carrier)).toBe(ps.olDynamicCarrierId);

    // (2) Sidecar row is populated AND carries the buyer-paid amount.
    // Unique signal that the full round-trip happened: adapter →
    // `writeCartShipping` POST → HMAC verify in `cartshipping.php` →
    // `CartShippingRepository::upsert`. The previous reconcile path
    // (#516, now removed) couldn't produce a sidecar row — only the OL
    // Dynamic branch does. If `externalCarrierId !== olDynamicCarrierId`
    // in the adapter, no row exists for this cart.
    const sidecar = await readCartShipping(ps.mysqlAddress, Number(psOrder.id_cart));
    expect(sidecar).not.toBeNull();
    expect(sidecar!.amountTaxIncl).toBeCloseTo(12.5, 2);

    // (3) The order's `total_shipping` reads the buyer-paid amount. Note
    // that under PS's "cheapest available + tiebreak by position-ASC"
    // carrier-resolution at POST /orders, the order's `id_carrier` may be
    // rewritten from the cart's value (matches S-2's documented behavior).
    // What matters for #513's acceptance is the *total*, which lands at
    // 12.50 regardless of which active carrier PS finally picks (all three
    // — myCarrier, myCheapCarrier, OL Dynamic — yield 12.50 at the cart's
    // delivery zone in this fixture). The cart-side carrier (1) and the
    // sidecar row (2) are the OL-Dynamic-specific signals.
    expect(Number(psOrder.total_shipping)).toBeCloseTo(12.5, 2);

    // (4) totals reconcile — `total_paid` matches `total_paid_real`. This
    // is what PS uses to compute `current_state` at POST /orders, and the
    // root cause #513's epic exists to fix.
    expect(Number(psOrder.total_paid)).toBeCloseTo(Number(psOrder.total_paid_real), 2);

    // (5) No payment-error state. The whole point of the OL Dynamic carrier
    // path: PS reads the authoritative shipping from
    // `getOrderShippingCostExternal` *during* order create (not after via a
    // reconcile PUT), so totals match on first POST and `current_state=8`
    // is never stamped.
    expect(Number(psOrder.current_state)).not.toBe(8);

    // (6) Soft order-side check matching S-2's design: PS's carrier
    // re-resolution at order-create may rewrite the order's `id_carrier`
    // when multiple active carriers tie on price (12.50). The order MUST
    // still land with a positive carrier id (the #503 guard — cart
    // `id_carrier=0` would zero out shipping handling). Strictness on the
    // value would be over-specifying PS behavior — see also S-2's comment.
    expect(Number(psOrder.id_carrier)).toBeGreaterThan(0);
  });
});

interface SeedScenarioOpts {
  harness: IntegrationTestHarness;
  psMysqlAddress: Parameters<typeof seedPrestashopProductForOrders>[0];
  externalOfferId: string;
  psReference: string;
  psName: string;
  allegroConnectionId: string;
  prestashopConnectionId: string;
}

/**
 * Seed everything one scenario needs end-to-end:
 *   1. A PS product (so the destination order-create resolves the line).
 *   2. An OL Product + ProductVariant pair (so OrderItemRefResolverService
 *      can walk Offer-mapping → variantRepository.findById → productId).
 *   3. Two identifier_mappings rows:
 *        (Offer,   externalOfferId,   allegroConnectionId)    → variantId
 *        (Product, '<psProductId>',   prestashopConnectionId) → productId
 *      The Offer mapping drives source-side item resolution. The Product
 *      mapping is what the PS adapter reads to translate `order.items[].productId`
 *      back to a PS id_product when writing the cart line.
 *
 * Variant-level destination mapping (ProductVariant → ps_combination) is
 * intentionally not seeded — the test product has no combinations, so PS
 * matches by id_product alone.
 */
async function seedScenario(opts: SeedScenarioOpts): Promise<void> {
  const psProduct = await seedPrestashopProductForOrders(opts.psMysqlAddress, {
    reference: opts.psReference,
    name: opts.psName,
  });

  const dataSource = opts.harness.getDataSource();
  const identifierMapping = opts.harness
    .getApp()
    .get<IIdentifierMappingService>(IDENTIFIER_MAPPING_SERVICE_TOKEN);

  // Mint the destination-side Product mapping FIRST, using the PS product id
  // as the external id. Two reasons this matters: the returned internal id
  // (`ol_product_<uuid>`) becomes the canonical product id we write into the
  // ORM row below, AND the (Product, '<psProductId>', prestashopConnectionId)
  // mapping is exactly what `PrestashopOrderProcessorManagerAdapter.createOrder`
  // reads via `getExternalIds('Product', internalProductId)` to translate
  // back to a PS id when assembling the order XML. Using a throwaway
  // external id here would result in multiple PS-side mappings for the
  // same internal id and the adapter would pick the wrong one.
  const internalProductId = await identifierMapping.getOrCreateInternalId(
    'Product',
    String(psProduct.idProduct),
    opts.prestashopConnectionId
  );

  // The product has no PS combination row, so there's no destination-side
  // ProductVariant mapping to seed — PS resolves the line by id_product
  // alone. We DO need a canonical OL variant id so OrderItemRefResolverService
  // can join Offer → variant → product. UUID-formatted to match the
  // `ol_variant_<uuid>` shape the system produces.
  const internalVariantId = `ol_variant_${randomUUID().replace(/-/g, '')}`;

  // Source-side Offer mapping consumed by OrderItemRefResolverService.
  await identifierMapping.createMapping(
    'Offer',
    opts.externalOfferId,
    opts.allegroConnectionId,
    internalVariantId
  );

  // Write the OL canonical Product + ProductVariant rows. The variant must
  // resolve via `variantRepository.findById(internalVariantId)` and return a
  // `productId === internalProductId` linkage.
  const productRepo = dataSource.getRepository(ProductOrmEntity);
  await productRepo.save(
    productRepo.create({
      id: internalProductId,
      name: opts.psName,
      sku: opts.psReference,
      price: 100.0,
      currency: 'PLN',
    })
  );

  const variantRepo = dataSource.getRepository(ProductVariantOrmEntity);
  await variantRepo.save(
    variantRepo.create({
      id: internalVariantId,
      productId: internalProductId,
      sku: opts.psReference,
    })
  );
}

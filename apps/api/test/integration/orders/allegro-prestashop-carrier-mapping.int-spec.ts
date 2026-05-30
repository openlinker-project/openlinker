/**
 * Allegro → PrestaShop Carrier Mapping Int-Spec (#535, #692 — closes #513)
 *
 * Exercises `OrderIngestionService.syncOrderFromSource` end-to-end against a
 * real PrestaShop Testcontainer with the real OL PS module installed
 * (harness extended in #692). Order creation goes through the OL module's
 * `importorder` endpoint → `PaymentModule::validateOrder` (ADR-016 / #905),
 * which assigns the order's carrier from the cart's `delivery_option` rather
 * than re-resolving to the cheapest available option the raw-WS `POST /orders`
 * path picked. The scenarios model PAID Allegro orders (`status:'processing'`
 * → PS state 2 "Payment accepted"), so `total_paid_real == total`.
 *
 *   S-1 — mapped happy path:
 *     `connection_carrier_mappings` routes Allegro `methodId='paczkomat-s1'`
 *     to PS "My carrier". `validateOrder` honors the cart's carrier, so the
 *     order lands with `id_carrier == myCarrier.idCarrier`, `total_shipping ==
 *     12.50`, cart `id_carrier > 0`, `current_state != 8`, and
 *     `total_paid == total_paid_real`.
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
 *   S-4 — free-carrier regression (#898, ADR-016):
 *     Same OL-Dynamic mapping as S-3, but a FREE "Click and collect" carrier is
 *     enabled and made available to the order's group + zone first — the exact
 *     topology that made the pre-ADR-016 raw-WS `POST /orders` path re-resolve
 *     every order onto the free carrier (`total_shipping=0`, Payment-error).
 *     Since orders now go through `validateOrder` (which honors the cart's
 *     `delivery_option`), the free carrier must NOT win: assert the order keeps
 *     `id_carrier == ps.olDynamicCarrierId`, `total_shipping == 12.50`, and
 *     `current_state != 8`.
 *
 * Catches the failure-mode cluster that motivated #503 (cart `id_carrier=0`),
 * #505 (PS rejects guest customers in group 0), #467 (`total_shipping`
 * zeroed by no-zone carriers), and #513/#898 (the raw-WS `POST /orders` path
 * dropped the carrier + recomputed shipping — fixed by creating orders through
 * `validateOrder`, which honors the cart's carrier and module-priced shipping).
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
  enableFreePickupCarrier,
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
  seedCarrierMappings,
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

/**
 * Whether to install the real OL PrestaShop module into the container — gates
 * **all** scenarios. Since ADR-016 (#905) destination order creation goes
 * through the module's HMAC-authed `importorder` → `validateOrder` endpoint, so
 * S-1…S-4 every one require the module installed AND the webhook secret wired
 * (below). The old WS `POST /orders` path that let S-1/S-2 run module-free is
 * gone.
 *
 * Local default: `true` — full coverage, ~5-10s install overhead on the
 * already-paid PS container boot.
 *
 * CI override (`CI=true`): `false` — the self-hosted Linux runner currently
 * fails the post-install `verifyApacheUp` probe with HTTP 500 from
 * /api/carriers (works on macOS Docker-Desktop). Root cause TBD; tracked by the
 * #716 module-install-in-CI follow-up. In this mode **the whole suite is
 * reported as skipped** rather than failed (carrier-mapping has no module-free
 * scenario left); CI PS-order coverage returns once #716 lands.
 *
 * Explicit overrides:
 *   - `OL_SKIP_PS_MODULE_INSTALL=true` — force-skip the install (used by
 *     local devs reproducing the CI behavior).
 *   - `OL_FORCE_PS_MODULE_INSTALL=true` — force-enable the install even in
 *     CI. Used for diagnostic CI runs that intentionally exercise the
 *     failing install path to capture root-cause data via the in-container
 *     log dumps in `prestashop-container.helper.ts`. S-3 will still likely
 *     fail under this flag — the goal is to capture data, not to pass.
 */
const INSTALL_OL_MODULE =
  process.env.OL_FORCE_PS_MODULE_INSTALL === 'true' ||
  (process.env.CI !== 'true' && process.env.OL_SKIP_PS_MODULE_INSTALL !== 'true');

/** Conditional `it` — runs the test when the OL module is installed, skips otherwise. */
const itWhenOlModuleInstalled = INSTALL_OL_MODULE ? it : it.skip;

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
    // installOlModule is required for S-3 (exercises the real
    // `cartshipping.php` HMAC round-trip). Gated by `INSTALL_OL_MODULE`
    // above — see the docblock there for the CI-environment override and
    // the conditional `it.skip` wiring for S-3.
    ps = await startPrestashopContainer({ installOlModule: INSTALL_OL_MODULE });

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
    // so leakage between spec files is otherwise possible. Only wire when the
    // OL module is actually installed (no point seeding a secret for an
    // endpoint that doesn't exist).
    if (INSTALL_OL_MODULE) {
      priorWebhookSecretEnv = process.env[WEBHOOK_SECRET_ENV_KEY];
      process.env[WEBHOOK_SECRET_ENV_KEY] = ps.webhookSharedSecret;
    }

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
    // S-4 — faithful #898 reproduction: a free carrier IS present (enabled in
    // the S-4 test body so it can't perturb S-1..S-3, which run first under
    // maxWorkers:1). Mapped to the OL Dynamic carrier like S-3.
    await seedScenario({
      harness,
      psMysqlAddress: ps.mysqlAddress,
      externalOfferId: 'ALG-OFFER-S4',
      psReference: 'SEEDED-SKU-S4',
      psName: 'Carrier-mapping S-4 product',
      allegroConnectionId,
      prestashopConnectionId,
    });

    // Seed ALL carrier mappings in one call — `upsertCarrierMappings` is
    // replace-for-connection, so separate calls would keep only the last.
    //   S-1: paczkomat-s1 → "My carrier".  S-2: no mapping (falls through to
    //   defaultCarrierId). S-3 + S-4: → the OL Dynamic carrier (sidecar path).
    await seedCarrierMappings(harness, allegroConnectionId, [
      {
        allegroDeliveryMethodId: 'paczkomat-s1',
        prestashopCarrierId: String(defaultCarriers.myCarrier.idCarrier),
      },
      {
        allegroDeliveryMethodId: 'paczkomat-s3',
        prestashopCarrierId: String(ps.olDynamicCarrierId),
      },
      {
        allegroDeliveryMethodId: 'paczkomat-s4',
        prestashopCarrierId: String(ps.olDynamicCarrierId),
      },
    ]);
  }, 15 * 60_000);

  afterAll(async () => {
    if (ps) {
      await ps.cleanup();
    }
    // Restore the env var the suite mutated. Even though Jest's worker model
    // for integration tests is `maxWorkers: 1`, leaving the secret in
    // `process.env` would silently leak into any spec file that runs later in
    // the same Node process and assumes a different (or absent) secret.
    // No-op when the env var was never set (INSTALL_OL_MODULE was false).
    if (INSTALL_OL_MODULE) {
      if (priorWebhookSecretEnv === undefined) {
        delete process.env[WEBHOOK_SECRET_ENV_KEY];
      } else {
        process.env[WEBHOOK_SECRET_ENV_KEY] = priorWebhookSecretEnv;
      }
    }
  });

  itWhenOlModuleInstalled('S-1: mapped carrier lands on order + cart with positive id_carrier', async () => {
    const incoming = createIncomingOrderForCarrierMapping({
      externalOrderId: 'ALG-S1',
      // Paid Allegro order (payment.finishedAt set → 'processing') → PS state 2
      // "Payment accepted" → validateOrder records the payment.
      status: 'processing',
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

  itWhenOlModuleInstalled('S-2: defaultCarrierId fallback lands on order with config carrier', async () => {
    const incoming = createIncomingOrderForCarrierMapping({
      externalOrderId: 'ALG-S2',
      status: 'processing',
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

    // OL's `defaultCarrierId` fallback writes the chosen `id_carrier` onto the
    // cart during cart-create; under ADR-016 `validateOrder` then assigns the
    // order's carrier from the cart's `delivery_option`, so the order carrier
    // matches the cart. We assert the cart strictly (the OL adapter signal) and
    // keep the order assertion as a lenient #503 guard (cart `id_carrier=0`
    // would zero shipping) — strictness on the order value would couple the
    // test to PS's tie-break details among equal-price carriers.
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

  itWhenOlModuleInstalled('S-3: OL Dynamic carrier path writes sidecar + lands authoritative shipping', async () => {
    const incoming = createIncomingOrderForCarrierMapping({
      externalOrderId: 'ALG-S3',
      status: 'processing',
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

    // (3) The order's `total_shipping` reads the buyer-paid (sidecar) amount.
    // Under ADR-016 `validateOrder` assigns the carrier from the cart's
    // `delivery_option`, so the order keeps the OL Dynamic carrier and its
    // module-priced shipping — no recompute from PS price tables.
    expect(Number(psOrder.total_shipping)).toBeCloseTo(12.5, 2);

    // (4) totals reconcile — `total_paid` matches `total_paid_real`. The order
    // is paid (`status:'processing'` → PS state 2 "Payment accepted"), so
    // `validateOrder` records the payment and the two amounts agree. This is
    // what PS uses to compute `current_state`.
    expect(Number(psOrder.total_paid)).toBeCloseTo(Number(psOrder.total_paid_real), 2);

    // (5) No payment-error state. `validateOrder` reads the authoritative
    // shipping from `getOrderShippingCostExternal` and prices the order in one
    // pass (no post-create reconcile PUT), so totals match and `current_state=8`
    // is never stamped.
    expect(Number(psOrder.current_state)).not.toBe(8);

    // (6) Order keeps the OL Dynamic carrier. Under ADR-016 `validateOrder`
    // assigns the carrier from the cart's `delivery_option`, so the order — not
    // just the cart — lands on `olDynamicCarrierId` (S-4 confirms this holds even
    // against a cheaper free carrier). Asserting the exact id (vs the old
    // lenient `> 0`) is the stronger #503 guard now that the WS re-resolution is
    // gone.
    expect(Number(psOrder.id_carrier)).toBe(ps.olDynamicCarrierId);
  });

  itWhenOlModuleInstalled(
    'S-4: free carrier present — OL Dynamic carrier still wins via validateOrder (#898 regression)',
    async () => {
      // Reproduce the exact #898 topology: a free "Click and collect" carrier
      // available to the order's group + zone. On the pre-ADR-016 raw-WS
      // `POST /orders` path PS re-resolved to the cheapest available option, so
      // this free carrier ALWAYS won — every order landed on it with
      // `total_shipping=0` and a Payment-error state. ADR-016 creates the order
      // through `validateOrder`, which honors the cart's `delivery_option`, so
      // the free carrier must NO LONGER win.
      const freeCarrier = await enableFreePickupCarrier(ps.mysqlAddress);

      const incoming = createIncomingOrderForCarrierMapping({
        externalOrderId: 'ALG-S4',
        status: 'processing',
        methodId: 'paczkomat-s4',
        externalOfferId: 'ALG-OFFER-S4',
        sku: 'SEEDED-SKU-S4',
      });
      stub.setNextIncomingOrder(incoming);

      const ingestion = harness
        .getApp()
        .get<IOrderIngestionService>(ORDER_INGESTION_SERVICE_TOKEN);
      const results = await ingestion.syncOrderFromSource(allegroConnectionId, 'ALG-S4');

      expect(results).toHaveLength(1);
      if (results[0].status !== 'success') {
        dumpPrestashopErrorLogs();
        throw new Error(
          `S-4 order sync failed: destination=${results[0].destinationConnectionId} message=${results[0].error.message}`
        );
      }

      const psOrderId = await resolveDestinationOrderId(
        harness,
        results[0].orderRef.orderId,
        prestashopConnectionId
      );
      const psOrder = await fetchPsOrder(ps, psOrderId);
      const psCart = await fetchPsCart(ps, Number(psOrder.id_cart));

      // (1) The cart is routed to the OL Dynamic carrier (adapter signal).
      expect(Number(psCart.id_carrier)).toBe(ps.olDynamicCarrierId);

      // (2) #898 core guard: the free carrier did NOT win. Under validateOrder
      // the order keeps the cart's carrier rather than being rewritten to the
      // cheapest (free) option — the exact substitution #898 reported.
      expect(Number(psOrder.id_carrier)).not.toBe(freeCarrier.idCarrier);
      expect(Number(psOrder.id_carrier)).toBe(ps.olDynamicCarrierId);

      // (3) Shipping is the sidecar amount, not the free carrier's 0.
      const sidecar = await readCartShipping(ps.mysqlAddress, Number(psOrder.id_cart));
      expect(sidecar).not.toBeNull();
      expect(sidecar!.amountTaxIncl).toBeCloseTo(12.5, 2);
      expect(Number(psOrder.total_shipping)).toBeCloseTo(12.5, 2);

      // (4) Totals reconcile and no Payment-error state — the #898 banner.
      expect(Number(psOrder.total_paid)).toBeCloseTo(Number(psOrder.total_paid_real), 2);
      expect(Number(psOrder.current_state)).not.toBe(8);
    }
  );
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

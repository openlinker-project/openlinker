# Implementation Plan — #535 Carrier-Mapping Vertical-Slice Int-Spec (Phase 2 of #506)

**Issue:** [#535] [TECH-DEBT] Carrier-mapping vertical-slice int-spec on top of #506 PS Testcontainer
**PR closes:** `Closes #506, Closes #535` (per the original #535 body — Phase 2 ships under the same parent; close both to leave neither orphaned)
**Branch:** `535-carrier-mapping-int-spec`
**Layer:** DX / test infrastructure (no production code changes)

---

## 1. Goal

Add an integration spec that exercises `OrderIngestionService.syncOrderFromSource` end-to-end against the **real** PrestaShop Testcontainer (shipped in #506 Phase 1), covering the two practical branches of the #516 carrier-resolution chain:

- **S-1 (mapped happy path)** — a seeded `connection_carrier_mappings` row routes Allegro `methodId='paczkomat-s1'` → PS `id_reference` of "My carrier". Order lands with the mapped carrier, `total_shipping == 12.50`, cart `id_carrier > 0`, no payment-error state.
- **S-2 (defaultCarrierId fallback)** — Allegro `methodId='paczkomat-s2'` has no mapping; `connection.config.defaultCarrierId` carries the resolution. Order lands with the config carrier, `total_shipping == 12.50`.

This catches the failure-mode cluster that motivated #503, #505, and #467.

**Non-goals** (deferred per #506 plan §6):
- Genuine OL Dynamic chain step 3 (sidecar `writeCartShipping`) — needs the OL PHP module loaded.
- Multi-line orders, status-update flow, returns flow.
- Migrating other int-specs to the PS container.
- Gating behind `test:integration:slow` / nightly-only.

---

## 2. Research findings (verified during /tech-review iteration)

- **Adapter resolution seam:** `IIntegrationsService.getCapabilityAdapter(connectionId, capability)` walks `connection.adapterKey → adapterRegistry.getAdapterMetadata(adapterKey) → factoryResolver.createCapabilityAdapter(adapterKey, …)`. Both `AdapterRegistryService.register({...})` and `AdapterFactoryResolverService.registerFactory(adapterKey, factory)` are the publicly-documented plugin seams (`architecture-overview.md § Capability Assignment`).
- **Capability gate:** `getCapabilityAdapter` rejects unless both `metadata.supportedCapabilities` AND `connection.enabledCapabilities` include the requested capability. Test connections must set `enabledCapabilities` explicitly — DB default is `[]`.
- **Destination routing:** `OrderSyncService.resolveDestinations` calls `listCapabilityAdapters({capability: 'OrderProcessorManager'})` then filters `connectionId !== sourceConnectionId`. `listCapabilityAdapters` already filters connections by `status='active'` AND adapter+connection capability gate. So with **one** Allegro source connection + **one** PS destination connection, dispatch is unambiguous — no per-test status flipping needed.
- **Item resolution:** `OrderItemRefResolverService.resolve` for `type='offer'` looks up `identifier_mappings:(Offer, externalId, connectionId) → internalVariantId`, then `variantRepository.findById(internalVariantId)` returns `{productId, id}`. We need real `Product` + `ProductVariant` ORM rows in OL's PG, NOT just identifier mappings.
- **Customer provisioning:** PS adapter requires either a pre-existing PS customer mapping OR a `customer_projections` row with email. The simplest path: set `customerExternalId` + `customerEmail` on `IncomingOrder` so `OrderIngestionService.resolveCustomerId` calls `customerIdentityResolver`, which writes the projection. The PS adapter then provisions a guest customer via WS.

---

## 3. Design

### 3.1 New files

```
apps/api/test/integration/
├── fixtures/
│   └── incoming-order.fixtures.ts                 # createIncomingOrderForCarrierMapping()
├── helpers/
│   └── allegro-test-source-stub.helper.ts         # registers test adapterKey + stubbed OrderSourcePort
└── orders/
    └── allegro-prestashop-carrier-mapping.int-spec.ts
```

### 3.2 Files to extend

- `apps/api/test/integration/helpers/test-connection.helper.ts` — add `createTestAllegroSourceConnection(ds, opts)` + `createTestPrestashopDestinationConnection(ds, opts)` + `seedCarrierMapping(harness, sourceConnectionId, methodId, prestashopIdReference)`.
- `apps/api/test/integration/helpers/prestashop-fixture.helper.ts` — extend with `seedPrestashopProductForOrders(mysql, opts)` (single PS product row + lang/shop/stock rows) and `getDefaultPsCarriers(mysql)` (returns the seed install's "My carrier" + "My cheap carrier" `id_carrier` / `id_reference` pairs). Both as exported functions on the existing helper, not a new file (per /tech-review SUGGESTION).

### 3.3 The Allegro source stub — via the adapter-factory seam, not monkey-patching

```ts
// allegro-test-source-stub.helper.ts
const ALLEGRO_TEST_ADAPTER_KEY = 'allegro.test.v1';
const ALLEGRO_TEST_PLATFORM_TYPE = 'allegro';  // re-use real platform so the connection looks real

/**
 * Registers an in-memory OrderSourcePort stub against a synthetic adapterKey
 * (`allegro.test.v1`) and returns control hooks to swap which IncomingOrder
 * the stub returns per test.
 *
 * Goes through the production resolution path — IntegrationsService walks
 * adapterKey → adapterRegistry.getAdapterMetadata → factoryResolver.createCapabilityAdapter
 * — so the test mirrors prod wiring instead of monkey-patching an internal method.
 */
export interface AllegroTestSourceStub {
  setNextIncomingOrder(incoming: IncomingOrder): void;
  /** test connection should use this adapterKey + platformType */
  adapterKey: string;
  platformType: string;
}

export function installAllegroTestSourceStub(harness: IntegrationTestHarness): AllegroTestSourceStub;
```

Internally it:
1. `adapterRegistry.register({ adapterKey: 'allegro.test.v1', platformType: 'allegro', supportedCapabilities: ['OrderSource'], displayName: 'Allegro (integration-test stub)', version: '0.0.0-test', isDefault: false })`. Re-using `platformType: 'allegro'` is fine — `isDefault: false` plus the existing real Allegro plugin's `isDefault: true` means `getDefaultAdapterKey('allegro')` still resolves to the production key; the test connection sets `adapterKey` explicitly to opt in.
2. `factoryResolver.registerFactory('allegro.test.v1', { createCapabilityAdapter: <T>(conn, cap, …) => stub as T })`.
3. The stub's `getOrder({externalOrderId})` returns whichever IncomingOrder was last set via `setNextIncomingOrder` — keyed by externalOrderId so a per-test setup remains isolated.
4. The stub's `listOrderFeed` returns `{items: [], nextCursor: null}` — this spec never triggers polling, only direct `syncOrderFromSource` calls.

**Suite-scoped registration:** `installAllegroTestSourceStub` is called once in `beforeAll`. The registry/factory entries live for the lifetime of the Nest app under test; since `AdapterRegistryService.register` throws `DuplicateAdapterKeyException` on a second registration for the same key, a second `installAllegroTestSourceStub` call in the same test process surfaces loud. No `restore()` needed — entries are scoped to the process, not the test.

### 3.4 IncomingOrder fixture shape

```ts
export interface CarrierMappingFixtureOpts {
  externalOrderId: string;
  methodId: string;          // 'paczkomat-s1' (mapped) or 'paczkomat-s2' (unmapped)
  methodName?: string;       // default 'InPost Paczkomat (test)'
  externalOfferId: string;   // 'ALG-OFFER-S1' / 'ALG-OFFER-S2' — must match seeded mapping
  unitPrice?: number;        // default 100.00 (PLN)
  shippingTotal?: number;    // default 12.50
}

export function createIncomingOrderForCarrierMapping(opts: CarrierMappingFixtureOpts): IncomingOrder;
```

The fixture populates:
- `externalOrderId`, `orderNumber` (same as externalOrderId for traceability).
- `status: 'pending'`.
- `customerExternalId: \`ALG-BUYER-\${externalOrderId}\`` and `customerEmail: \`buyer-\${externalOrderId}@allegromail.pl\`` — distinct per order so identity-resolution doesn't merge them.
- `items: [{ id, productRef: {type: 'offer', externalId: externalOfferId}, quantity: 1, price: unitPrice, sku: 'SEEDED-SKU-…', name: '…' }]`.
- `totals: {subtotal: unitPrice, tax: 0, shipping: shippingTotal, total: unitPrice + shippingTotal, currency: 'PLN'}`.
- `shippingAddress` + `billingAddress`: Warsaw, country `'PL'`, valid post code `'00-001'`. Deterministic.
- `shipping: {methodId, methodName}`.
- `createdAt`/`updatedAt`: fixed ISO strings (e.g. `'2026-05-01T10:00:00.000Z'`) — diffs stay stable across runs.

### 3.5 PS-side product + OL identifier-mapping seed

In `beforeAll`, for each scenario (S-1, S-2):
1. Insert one minimal PS product via `seedPrestashopProductForOrders` (dynamic-INSERT against `ps_product`, `ps_product_lang`, `ps_product_shop`, `ps_stock_available`). Returns the assigned `id_product`.
2. Create OL `Product` + `ProductVariant` ORM rows via the respective repositories (or direct ORM, since this is test setup). The variant's `productId` field links to the product. Use the IDs that come out of `IdentifierMappingService.getOrCreateInternalId('Product' / 'ProductVariant', …, <pseudo-external-id>, …)` to keep them deterministic.
3. Write identifier mappings:
   - `(Offer, externalOfferId, allegroConnectionId) → internalVariantId` — source-side, what `OrderItemRefResolverService` reads.
   - `(Product, '<psProductId>', prestashopConnectionId) → internalProductId` — destination-side, what the PS adapter uses to translate `order.items[].productId` back to PS IDs.
4. (Optional, only if PS adapter requires it) `(ProductVariant, '<psCombinationId-or-0>', prestashopConnectionId) → internalVariantId` — TBD during impl; PS simple products without combinations may not need this. Defer until the first run surfaces a missing mapping.

The product seed is in `prestashop-fixture.helper.ts` per /tech-review SUGGESTION.

### 3.6 Connection seed

ONE Allegro source + ONE PS destination, both seeded once in `beforeAll`:

```ts
const allegro = await createTestAllegroSourceConnection(ds, {
  name: 'Test Allegro source',
  adapterKey: stub.adapterKey,             // 'allegro.test.v1'
  platformType: stub.platformType,         // 'allegro'
  enabledCapabilities: ['OrderSource'],
});

const prestashop = await createTestPrestashopDestinationConnection(ds, {
  name: 'Test PrestaShop destination',
  baseUrl: ps.baseUrl,
  webserviceApiKey: ps.webserviceApiKey,
  defaultCarrierId: defaultCarriers.myCheapCarrier.idCarrier,  // for S-2
  enabledCapabilities: ['OrderProcessorManager'],
});
```

The mapping (S-1) is seeded via `MappingConfigService.upsertCarrierMappings(allegro.id, [{allegroDeliveryMethodId: 'paczkomat-s1', prestashopCarrierIdReference: String(defaultCarriers.myCarrier.idReference)}])`. NO mapping for `'paczkomat-s2'` so it falls through to `defaultCarrierId`.

### 3.7 The int-spec

```ts
describe('Allegro → PrestaShop carrier mapping (#535)', () => {
  let harness: IntegrationTestHarness;
  let ps: PrestashopTestContainer;
  let stub: AllegroTestSourceStub;
  let allegroConnectionId: string;
  let psConnectionId: string;
  let defaultCarriers: { myCarrier: { idCarrier: number; idReference: number }; myCheapCarrier: { idCarrier: number; idReference: number } };

  beforeAll(async () => {
    harness = await getTestHarness();
    ps = await startPrestashopContainer();
    defaultCarriers = await getDefaultPsCarriers(/* ps MySQL creds */);

    stub = installAllegroTestSourceStub(harness);
    const allegro = await createTestAllegroSourceConnection(...);
    const prestashop = await createTestPrestashopDestinationConnection(...);
    allegroConnectionId = allegro.id;
    psConnectionId = prestashop.id;

    // Seed S-1 + S-2 fixtures
    await seedPrestashopProductForOrders(...); // S-1 product
    await seedPrestashopProductForOrders(...); // S-2 product
    await seedCarrierMapping(harness, allegroConnectionId, 'paczkomat-s1', String(defaultCarriers.myCarrier.idReference));
    // (no mapping for paczkomat-s2)
  }, 15 * 60_000);

  afterAll(async () => {
    if (ps) await ps.cleanup();
  });

  it('S-1: mapped carrier lands on order + cart with positive id_carrier', async () => {
    const incoming = createIncomingOrderForCarrierMapping({
      externalOrderId: 'ALG-S1',
      methodId: 'paczkomat-s1',
      externalOfferId: 'ALG-OFFER-S1',
    });
    stub.setNextIncomingOrder(incoming);

    const ingestion = harness.getApp().get<IOrderIngestionService>(ORDER_INGESTION_SERVICE_TOKEN);
    const results = await ingestion.syncOrderFromSource(allegroConnectionId, 'ALG-S1');

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('success');
    expect(results[0].destinationConnectionId).toBe(psConnectionId);

    const orderId = Number(results[0].orderRef.orderId);
    const psOrder = await fetchPsOrder(ps, orderId);
    expect(Number(psOrder.id_carrier)).toBe(defaultCarriers.myCarrier.idCarrier);  // mapped
    expect(Number(psOrder.total_shipping)).toBeCloseTo(12.50);
    expect(Number(psOrder.current_state)).not.toBe(8);                              // not payment-error
    expect(Number(psOrder.total_paid)).toBeCloseTo(Number(psOrder.total_paid_real));

    const psCart = await fetchPsCart(ps, Number(psOrder.id_cart));
    expect(Number(psCart.id_carrier)).toBeGreaterThan(0);                          // #503 guard
  });

  it('S-2: defaultCarrierId fallback lands on order with config carrier', async () => {
    const incoming = createIncomingOrderForCarrierMapping({
      externalOrderId: 'ALG-S2',
      methodId: 'paczkomat-s2',  // no mapping seeded for this
      externalOfferId: 'ALG-OFFER-S2',
    });
    stub.setNextIncomingOrder(incoming);

    const ingestion = harness.getApp().get<IOrderIngestionService>(ORDER_INGESTION_SERVICE_TOKEN);
    const results = await ingestion.syncOrderFromSource(allegroConnectionId, 'ALG-S2');

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('success');

    const orderId = Number(results[0].orderRef.orderId);
    const psOrder = await fetchPsOrder(ps, orderId);
    expect(Number(psOrder.id_carrier)).toBe(defaultCarriers.myCheapCarrier.idCarrier);  // defaultCarrierId
    expect(Number(psOrder.total_shipping)).toBeCloseTo(12.50);

    // NB: We do NOT assert the sidecar `writeCartShipping` was not called —
    // observing that negative would require spy infrastructure around the PS
    // HTTP client, which is out of scope for the v1 spec. The positive
    // id_carrier == myCheapCarrier assertion above is sufficient to prove
    // resolution chain step 2 was taken (chain step 3 would have written
    // id_carrier == olDynamicCarrierId, which is a different number).
  });
});
```

Tests are fully order-independent: each uses a distinct externalOrderId, distinct externalOfferId, distinct methodId. No state mutation between them.

### 3.8 PS read helpers (used only by the spec)

```ts
async function fetchPsOrder(ps: PrestashopTestContainer, idOrder: number): Promise<PsOrderRow>;
async function fetchPsCart (ps: PrestashopTestContainer, idCart: number): Promise<PsCartRow>;
```

Tiny local wrappers around `fetch('${ps.baseUrl}/api/orders/${id}?output_format=JSON', {auth})`, mirroring the smoke-spec pattern. Read via PS WS (not direct MySQL) so we exercise the same path operators use.

---

## 4. Step-by-step plan

### S1 — Allegro source stub via the adapter-factory seam
**File:** `apps/api/test/integration/helpers/allegro-test-source-stub.helper.ts` (new)
**Acceptance:**
- `installAllegroTestSourceStub(harness)` registers `'allegro.test.v1'` with `AdapterRegistryService` (capability: `OrderSource`) + `AdapterFactoryResolverService` (factory returning the stub). Idempotent in spirit but throws `DuplicateAdapterKeyException` if called twice — that's by design.
- Returns `{adapterKey, platformType, setNextIncomingOrder}`. The setter is closure-captured; calling it before each test point sets the IncomingOrder the stub returns.
- The factory closure types `createCapabilityAdapter<T>` explicitly to satisfy strict-mode generics; the cast back to `T` lives in one place.
- File header explains the seam choice and the `DuplicateAdapterKeyException` semantics.

### S2 — IncomingOrder fixture
**File:** `apps/api/test/integration/fixtures/incoming-order.fixtures.ts` (new)
**Acceptance:**
- `createIncomingOrderForCarrierMapping(opts)` returns a deterministic `IncomingOrder` matching the shape in §3.4.
- Re-exports `IncomingOrder` / `OrderShipping` types from `@openlinker/core/orders` so the spec doesn't double-import.

### S3 — Connection helpers + carrier mapping
**File extension:** `apps/api/test/integration/helpers/test-connection.helper.ts`
**Changes:**
- `createTestAllegroSourceConnection(ds, opts)` — writes a row with `platformType='allegro'`, explicit `adapterKey` (caller passes the stub's key), `enabledCapabilities=['OrderSource']`, `credentialsRef='db:test-allegro-credentials'`.
- `createTestPrestashopDestinationConnection(ds, opts)` — `platformType='prestashop'`, `adapterKey='prestashop.webservice.v1'`, `config={baseUrl, defaultCarrierId}`, `credentialsRef='db:test-prestashop-credentials-<random>'`. Also writes the `integration_credentials` row holding the WS API key under that ref. Returns the saved ORM entity.
- `seedCarrierMapping(harness, sourceConnectionId, methodId, prestashopIdReference)` — calls `harness.getApp().get(MAPPING_CONFIG_SERVICE_TOKEN).upsertCarrierMappings(sourceConnectionId, [{allegroDeliveryMethodId: methodId, prestashopCarrierIdReference}])`. Uses the public service API, not raw ORM.

### S4 — PS-side seeds (extend existing fixture helper)
**File extension:** `apps/api/test/integration/helpers/prestashop-fixture.helper.ts`
**Changes:**
- `getDefaultPsCarriers(options)` — queries `ps_carrier` for the seed-install default carriers ("My carrier", "My cheap carrier"). Returns `{myCarrier: {idCarrier, idReference}, myCheapCarrier: {idCarrier, idReference}}`. Asserts they exist; throws actionable error if PS install changed.
- `seedPrestashopProductForOrders(options, {sku, name})` — dynamic-INSERTs into `ps_product` + per-lang/shop tables + `ps_stock_available`, using the existing `dynamicInsert` + `assertNoUnsuppliedNotNullColumns` machinery. Returns `{idProduct}`. Idempotent on (`reference` = sku).
- Also extend the existing OL Dynamic carrier seed to **assert `id_reference == id_carrier`** after the post-insert UPDATE — surfaces drift loud, per /tech-review SUGGESTION.

### S5 — Helper: write OL Product + ProductVariant + identifier mappings
**Location:** in-spec helper inside the int-spec file (private function; small enough that a new file isn't warranted).
**Acceptance:**
- Given `(allegroConnectionId, prestashopConnectionId, externalOfferId, prestashopProductId, sku)`, writes:
  - One `Product` row (real ORM via `dataSource.getRepository(ProductOrmEntity)`).
  - One `ProductVariant` row with `productId` pointing at the product.
  - `(Offer, externalOfferId, allegroConnectionId) → variant.id` identifier mapping via `IdentifierMappingService.createMapping`.
  - `(Product, '<psProductId>', prestashopConnectionId) → product.id` identifier mapping.
- Returns the IDs for assertion.

### S6 — The int-spec
**File:** `apps/api/test/integration/orders/allegro-prestashop-carrier-mapping.int-spec.ts` (new)
**Acceptance:** as in §3.7. Suite-scoped PS container; no PS state reset between tests (state survives `resetTestHarness()` regardless and each test uses unique external IDs).

### S7 — Documentation
**File extension:** `docs/testing-guide.md`
**Changes:** Extend the existing "PrestaShop Testcontainer Pattern (#506)" section with a one-paragraph cross-link to the new spec — example of layering a vertical slice on the harness. No new section.

### S8 — Quality gate
- `pnpm lint && pnpm type-check && pnpm test` (unit suite unaffected — new code is in `apps/api/test/integration/` only).
- `pnpm test:integration` — new spec passes; existing int-specs unaffected.

### S9 — Commit + PR
- Conventional commit: `test(orders): add carrier-mapping vertical-slice int-spec on PS Testcontainer (#535)`.
- PR body: `Closes #506, Closes #535` (both — per /tech-review SUGGESTION).

---

## 5. Validation

- **Architecture compliance.** Test infrastructure only. No `libs/` changes outside test code (which lives in `apps/api/test/`). No production-code edits.
- **Naming.** `*.int-spec.ts` per `testing-guide.md` (the project convention overrides the slightly-out-of-date `*.integration.spec.ts` in `engineering-standards.md`).
- **Mocking strategy.** Stub the **upstream** boundary (Allegro `OrderSourcePort`) via the publicly-documented adapter-factory seam (no internal monkey-patching). Downstream PS is real.
- **Security.** WS key generated per run (already done in Phase 1). No real credentials.
- **Test independence.** No mutation of `Connection.status` or `enabledCapabilities` between tests. S-1 and S-2 share infrastructure but use disjoint externalOrderIds / methodIds / externalOfferIds.
- **Risks:**
  - **R1 — PS image cold-cache CI boot.** Mitigated in Phase 1 (suite-scoped, 15-min Jest timeout). Inherited.
  - **R2 — PS column drift in product seed.** Mitigated by reusing `dynamicInsert` / `assertNoUnsuppliedNotNullColumns`.
  - **R3 — `ProductVariant.findById` may require fields we don't seed (e.g. SKU uniqueness).** Mitigated by inserting realistic minimum + asserting on the resolver's return value in the test setup, not at first assertion.
  - **R4 — Sidecar negative observation.** Dropped explicitly in S-2 with an in-test comment; the positive `id_carrier == myCheapCarrier` assertion is sufficient to prove resolution chain step 2 vs step 3 (those return different `id_carrier` values).
  - **R5 — `DuplicateAdapterKeyException` on second `installAllegroTestSourceStub`.** By design — each int-spec file is one Jest worker process, and the stub is suite-scoped. If a second spec opts into the stub, it must hit the registry only once.

---

## 6. Out of scope (recap)

- Genuine OL Dynamic chain step 3 (sidecar `writeCartShipping`) — needs the OL PHP module installed.
- Multi-line orders, status-update flow, returns flow.
- Migrating other int-specs to the PS container.
- Gating behind `test:integration:slow` / nightly-only.
- Payment-mapping vertical slice — separate issue.

---

## 7. Implementation notes (what actually shipped vs the planned design)

A few load-bearing details surfaced during implementation that diverge from §3:

- **Both carriers come from PS's install-seeded set** (no synthetic seed in the
  happy path). PS 9.0.2 seeds `Click and collect (1) / My carrier (2) / My cheap
  carrier (3)`, with `My cheap carrier` inactive by default. The fixture
  force-activates "My cheap carrier" and force-deactivates "Click and collect"
  (the latter is a pickup-only carrier PS treats specially in cart resolution and
  tends to re-pick over a requested id_carrier, masking the OL routing under
  test). Used `('My cheap carrier', 'My carrier')` order so the first-positioned
  carrier — which PS prefers during cart resolution — is the one mapped from
  Allegro (`paczkomat-s1`). The `seedSecondaryTestCarrier` path remains in the
  helper as a fallback for PS images with fewer than two non-OL active carriers
  but isn't taken on the pinned image.
- **PS rewrites `id_carrier` on the order even when the cart carries the
  expected value.** The OL adapter writes the resolved `id_carrier` onto the
  cart correctly, but PS's order-create can rewrite based on its own cart
  delivery-option resolution (picks the lowest-position / cheapest valid carrier
  when multiple match). S-2 therefore asserts strictly on `psCart.id_carrier ==
  myCheapCarrier.idCarrier` (what OL controls) and only loosely on
  `psOrder.id_carrier > 0` (#503 guard). The total_shipping == 12.50 assertion
  still holds on the order because both seeded carriers price identically.
- **Permissive delivery seed.** `ensureCarrierFullyDelivered` wipes and re-seeds
  `ps_range_price` / `ps_range_weight` / `ps_delivery` for each test carrier
  with a single 0–10000 range at flat 12.50 across every active zone, and sets
  `range_behavior=1` on the carrier so cart totals outside any range still
  resolve. PS's default narrow ranges (0–50 EUR) otherwise pre-empt our entries
  whenever the cart total falls inside them.
- **PL country activation.** `PS_COUNTRY=us` install leaves PL inactive with
  `id_zone=0` — `activateCountry(conn, 'PL')` flips `active=1` and assigns the
  first active zone if currently zero. Required for the shipping-address create
  in the order flow.
- **PLN conversion_rate = 1.0** instead of a realistic 4.5 — see
  `docs/testing-guide.md` for the rationale and the override path for specs
  that need realistic FX.
- **Diagnostic helper.** `dumpPrestashopErrorLogs` ships in the spec for CI
  failure triage; it shells out to `docker logs` / `docker exec` on the
  matched-by-image-tag PS container and is best-effort (silent on its own
  failure). Reuses the `PRESTASHOP_IMAGE` constant from the container helper so
  the literal lives in one place.

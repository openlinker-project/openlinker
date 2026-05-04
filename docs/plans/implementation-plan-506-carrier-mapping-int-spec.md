# Implementation Plan — #506 Integration test: Allegro→PS carrier-mapping vertical slice

**Branch:** `506-carrier-mapping-int-spec`
**Closes:** #506 (in two stages — see Delivery Phasing below)

---

## Delivery Phasing

The full vertical slice has a heavy upstream-wiring tail (Allegro source stub, identifier-mapping product seeds, customer-identity resolver setup) on top of the PS Testcontainer foundation. To land working, reviewable infrastructure first — and de-risk the heavy Testcontainer boot before the spec depends on it — this issue ships in two PRs:

- **Phase 1 (this PR)**: Reusable PrestaShop Testcontainer harness (`prestashop-container.helper.ts` + `prestashop-fixture.helper.ts`) + a smoke int-spec that proves the container boots, PS WS responds with the seeded API key, and the OL Dynamic carrier row appears in `/api/carriers`. Adds `mysql2` + `@testcontainers/mysql` deps. Documents the suite-scoped pattern in `docs/testing-guide.md`.
- **Phase 2 ([#535](https://github.com/SilkSoftwareHouse/openlinker/issues/535))**: The full `OrderIngestionService.syncOrderFromSource` exercise (S-1 mapped happy path, S-2 `defaultCarrierId` fallback) on top of Phase 1's harness. Adds Allegro stub helper, OL-side identifier-mapping seeds, PS-side product seed via WS POST, and the assertion battery against `id_carrier`, `total_shipping`, and customer-group provisioning. The Phase 2 PR closes #506.

**Why split?** The Phase 1 harness is itself substantial (cold-cache CI boot 5-10 min, MySQL+PS network plumbing, WS-key/carrier/currency seed) and benefits from landing on its own so it can be reviewed and exercised in CI before code that depends on it goes in. Phase 2 reuses Phase 1 verbatim — no rework.

---

## 1. Understand the task

**Goal.** Add an end-to-end integration test that exercises `OrderIngestionService.syncOrderFromSource` against a real PrestaShop instance, catching the failure modes #503 (cart's `id_carrier` not set → PS resolves `id_carrier=0` from cart, ignores order body) and #505 (PS rejects orders for customers in group 0 due to carrier-group restrictions) before they ship. Both bugs landed because mapper/provisioner unit tests asserted body shape, not PS's actual response to that body.

**Layer.** Test infrastructure (no production code changes).

**Explicit non-goals** (per issue):
- Coverage of every PS WS edge case — happy-path + one defensive-fallback variant, that's all.
- Migrating existing `*.int-spec.ts` files to the new PS container.
- Catching genuinely novel PS WS rules we don't already know about (impossible without running PS — that's the whole point).

---

## 2. Research summary

### Existing test harness (reusable)
- `apps/api/test/integration/setup.ts` + `harness.ts`: Testcontainers Postgres + Redis, full `AppModule` boot, lifecycle helpers (`getTestHarness`, `resetTestHarness`, `teardownTestHarness`).
- ~14 existing `.int-spec.ts` files cover webhook ingestion, connection CRUD, sync jobs, etc. **Zero touch PrestaShop** — every one mocks `OrderProcessorManagerPort`. This issue introduces the first real PS-container fixture.
- Helpers under `test/integration/helpers/`, fixtures under `test/integration/fixtures/`.

### Vertical slice anchors
- `OrderIngestionService.syncOrderFromSource(connectionId, externalOrderId, sourceEventId?)` (`libs/core/src/orders/application/services/order-ingestion.service.ts`) — the entry point. Resolves `OrderSourcePort` via `IntegrationsService`, hydrates `IncomingOrder`, persists, dispatches to `OrderSyncService` → `OrderProcessorManagerPort.createOrder()`.
- `IncomingOrder.shipping = { methodId, methodName? }` — the load-bearing field. `methodId` is what the carrier-mapping resolution chain (#516) keys off.
- `MappingConfigService.resolveCarrierMapping(connectionId, allegroDeliveryMethodId)` reads `connection_carrier_mappings` (cols: `id`, `connection_id`, `allegro_delivery_method_id`, `prestashop_carrier_id`).
- `PrestashopOrderProcessorManagerAdapter.resolveExternalCarrierId()` chain (#516): mapping → `defaultCarrierId` → OL Dynamic. **The OL Dynamic discovery (`discoverDynamicCarrierId()`) runs eagerly in `createOrder()` and throws `PrestashopOlCarrierMissingException` if no `external_module_name='openlinker'` carrier exists** — so even when mapping resolves, the OL Dynamic carrier must be present in PS for `createOrder()` to succeed at all.

### PS dev image
- `prestashop/prestashop:9.0.2-2.0-classic-8.4` (docker-compose). Apache + Classic theme + PHP 8.4. ~1GB.
- Default install: admin `demo@prestashop.com` / `prestashop_demo`, MySQL 8.4 backend, ~6 default carriers (id_reference 1–6 typically). **WS API key NOT seeded.**
- Post-install scripts in `docker/prestashop/post-install/` exist but only handle currency + product seeding.

### Gotchas surfaced
- **PS WS API key bootstrap.** No automatic seed today. Cleanest path: SQL `INSERT INTO ps_api_access` (and `ps_api_access_lang`/`ps_api_access_resource`) directly against the test container's MySQL after install completes. PS's admin auth is cookie-based — programmatic API-key creation via the admin UI is awkward.
- **OL Dynamic carrier requirement.** The order-processor adapter throws `PrestashopOlCarrierMissingException` if no `external_module_name='openlinker'` carrier exists, even on the mapped path — `discoverDynamicCarrierId()` runs eagerly at the top of `createOrder()`. SQL-seeding the carrier row passes that eager check.
- **OL Dynamic *runtime* path needs the OL PS module loaded.** When `externalCarrierId === olDynamicCarrierId` (chain step 3), the adapter calls `openlinkerModuleClient.writeCartShipping()` (adapter line 343), which POSTs to `/index.php?fc=module&module=openlinker&controller=cartshipping` — a front-controller that only exists when the OL PHP module is installed. SQL-seeding the carrier row alone is **NOT enough** for an end-to-end OL-Dynamic test. Two paths forward: (a) reframe the second scenario as the `defaultCarrierId` fallback (resolution-chain step 2) — no module needed, sidecar correctly skipped; (b) volume-mount + install the OL PS module. **MVP picks (a)**; (b) deferred to follow-up.
- **Cold-cache boot.** PS image is ~1GB; auto-install takes 60-180s. Realistic CI cold-cache: 5-10 min on first run, ~60-90s when the image is cached. Local dev laptop with a warm Docker image cache: ~60s. Document both numbers in the helper JSDoc.
- **PS Testcontainer suite scope.** Recommendation: **suite-scoped** — start in `beforeAll`, kill in `afterAll`, NOT global. Only this int-spec pays the cost; future tests opt in.
- **Wait strategy.** Don't HTTP-probe the storefront — auto-install can race that. Poll MySQL for `ps_configuration.PS_VERSION_DB` non-null; PS writes that row only at the very end of install. Most reliable completion signal.
- **`id_reference` vs `id_carrier`.** The carrier-mapping picker (#517) stores `id_reference` (the stable family id); the order-processor adapter (`adapter.ts:646`) feeds the persisted value verbatim as `id_carrier` for cart/order writes. On a fresh PS install (which is exactly what the Testcontainer gives us), `id_carrier === id_reference` for every default carrier — so the test can use either interchangeably. Add a one-line comment in the seed call so a future maintainer doesn't wonder why we don't translate.

---

## 3. Design

### 3.1 New harness module: `setup-prestashop.ts`

A standalone helper that spins up PS + MySQL containers, waits for install completion, and runs SQL fixtures. Invoked from the int-spec's `beforeAll` — NOT wired into the global Postgres+Redis harness.

Shape:

```ts
// apps/api/test/integration/helpers/prestashop-container.helper.ts

export interface PrestashopTestContainer {
  baseUrl: string;               // e.g. http://localhost:34567
  webserviceApiKey: string;      // 32-char generated key seeded into ps_api_access
  carriers: { idCarrier: number; idReference: number; name: string; isDynamic: boolean }[];
  cleanup: () => Promise<void>;
}

export async function startPrestashopContainer(): Promise<PrestashopTestContainer> { ... }
```

Internally:
1. `Network.newNetwork()` so PS + MySQL can talk.
2. `MySqlContainer('mysql:8.4')` with PS's expected schema (auto-created by PS install).
3. `GenericContainer('prestashop/prestashop:9.0.2-2.0-classic-8.4')` with env: `DB_SERVER`, `DB_USER`, `DB_PASSWD`, `DB_NAME`, `PS_DOMAIN`, `ADMIN_MAIL`, `ADMIN_PASSWD`, `PS_INSTALL_AUTO=1`. Wait strategy: poll MySQL for `SELECT value FROM ps_configuration WHERE name='PS_VERSION_DB'` → non-empty value (PS writes this row only at the very end of auto-install).
4. After install, the helper invokes `applyPrestashopFixture(mysql, options)` (TS, not a `.sql` file — see S2) that:
   - Generates a 32-char alphanumeric WS API key per run.
   - INSERTs into `ps_api_access` + `ps_api_access_resource` (grants on carriers, carts, orders, customers, products, addresses, currencies, languages — the full set the adapter touches).
   - INSERTs an OL Dynamic carrier row: `external_module_name='openlinker'`, `is_module=1`, `shipping_external=1`, `id_tax_rules_group=0`, `active=1`, `deleted=0`. Captures the resulting `id_carrier`. **Note**: this is a stub row to satisfy `discoverDynamicCarrierId()`, NOT a substitute for the OL PHP module — see §6 (out of scope) and the helper's source-of-truth comment pointing at `apps/prestashop-module/openlinker/openlinker.php`'s `installCarrier()`.
   - Reads back the existing carrier set (PS seeds 6+ default carriers) so the test can pick a stable `id_reference` for the mapped path.
5. Returns `{ baseUrl, webserviceApiKey, carriers, cleanup }`.

### 3.2 Allegro `OrderSourcePort` stub

Two ways to inject:
- (a) Override `IntegrationsService.getCapabilityAdapter(connectionId, 'OrderSource')` to return a hand-rolled stub.
- (b) Override the `AllegroAdapterFactory` to produce a stubbed `AllegroOrderSourceAdapter`.

(a) is simpler and the rest of the harness already uses NestJS `Test.createTestingModule().overrideProvider()` for similar overrides. Stub returns a fixture `IncomingOrder` from `getOrder(input)` and a single-item `OrderFeedOutput` from `listOrderFeed()`.

The stub fixture in `test/integration/fixtures/incoming-order.fixtures.ts`:

```ts
export function createIncomingOrderForCarrierMapping(): IncomingOrder {
  return {
    externalOrderId: 'allegro-checkout-form-test-1',
    orderNumber: 'ALL-TEST-1',
    status: 'pending',
    items: [{ sku: 'SEEDED-SKU-1', quantity: 1, unitPriceTaxIncl: 49.99 }],
    totals: { subtotal: 49.99, tax: 0, shipping: 12.50, total: 62.49, currency: 'PLN' },
    customer: { /* Allegro masked email */ },
    shippingAddress: { /* PL address */ },
    shipping: { methodId: 'paczkomat-test-id', methodName: 'InPost Paczkomat' },
    // ...
  };
}
```

### 3.3 Connection seed + carrier mapping

In `beforeAll`:
1. `getTestHarness()` (existing global Postgres+Redis+Nest).
2. `startPrestashopContainer()` (new — suite-scoped).
3. Seed via existing `test-connection.helper.ts`:
   - Allegro connection (the source) with `platformType='allegro'`, dummy credentials.
   - PS connection (the destination) with `platformType='prestashop'`, `config={baseUrl, defaultCarrierId: <staticCarrierIdReference>}`, `credentialsRef` pointing at a credentials row that holds the test PS's `webserviceApiKey`.
4. Seed `connection_carrier_mappings`: `(allegroConnectionId, 'paczkomat-test-id') → '<paczkomatIdReference>'`.
5. Seed enough `IdentifierMapping` rows that the order-ingestion path can resolve a product/variant by external SKU (`SEEDED-SKU-1` → `internal-product-1` → PS product id `<seeded>`).

**Pre-seeded PS data needs**: at least one PS product matching the SKU. The existing dev `30-seed-test-products.php` could be reused or copied as a Testcontainer post-install step. Simplest: insert one minimal product row via SQL fixture (sufficient for the order to land).

### 3.4 The int-spec scenarios

Two cases (per issue's "happy path + one defensive-fallback variant"):

**S-1 (mapped happy path):** carrier-mapping seeded for `paczkomat-test-id → <paczkomatIdReference>`; OL Dynamic carrier row present (so `discoverDynamicCarrierId()` succeeds); `defaultCarrierId` set on connection config. Expectation: order lands in PS with `id_carrier == <paczkomatIdCarrier>`, `total_shipping == 12.50`, `total_paid == total_paid_real`, `current_state != 8` (no payment-error state). Cart read confirms `id_carrier > 0` (#503 guard). Sidecar `writeCartShipping` is NOT called on this path (resolution chain step 1).

**S-2 (defaultCarrierId fallback):** carrier-mapping NOT seeded; `connection.config.defaultCarrierId = <secondStaticIdReference>` (a different default PS carrier — e.g. "My Carrier" `id_reference`). Expectation: order lands with `id_carrier == <secondStaticIdCarrier>`, `total_shipping == 12.50`, sidecar still NOT called (`externalCarrierId !== olDynamicCarrierId`). This exercises resolution-chain step 2 (#516).

The genuine OL Dynamic e2e (chain step 3) is **deferred** — see §6. It would need the OL PHP module loaded in the PS container to make `writeCartShipping` succeed; reusing the dev-stack volume-mount of `apps/prestashop-module/openlinker` is feasible but adds module-install + activation steps that double the helper's surface area.

Each scenario reads PS state via the existing `PrestashopWebserviceClient` (instantiated against the test container) — `GET /orders/{id}`, `GET /carts/{idCart}`, `GET /order_carriers?filter[id_order]=...`. Reading via the same client we ship in production catches drift in our XML parsing too.

### 3.5 What this catches

- #503 regression: if `mapCartCreate` stops setting `id_carrier`, S-1 fails with `id_carrier == 0` on the cart read.
- #505 regression: if guest-customer provisioning silently drops `id_default_group` (or otherwise fails the carrier-group restriction), the order-create fails inside PS (current_state=8 or 400) and the test fails on the assert. Affects both S-1 and S-2.
- #467 regression: if `total_shipping` gets zeroed by PS due to a no-zone carrier, S-1 / S-2 fail.
- #516 resolution chain steps 1 (S-1) and 2 (S-2) are exercised end-to-end.

What it doesn't catch (acceptable per non-goals):
- Multi-line orders, returns, status-update flows, PS-version drift.
- The OL Dynamic runtime fallback (chain step 3) and its sidecar write — separate follow-up because of the module-install requirement.

---

## 4. Step-by-step plan

### S1 — Testcontainers PrestaShop helper
**File:** `apps/api/test/integration/helpers/prestashop-container.helper.ts` (new)
**Acceptance:**
- `startPrestashopContainer()` returns a healthy PS container with WS reachable on `baseUrl`, API key works, OL Dynamic carrier row exists in PS, MySQL companion is running.
- Wait strategy: poll MySQL for `ps_configuration.PS_VERSION_DB` non-null (NOT HTTP probe — see §3.1).
- Boot time documented in JSDoc: ~60-90s with warm Docker image cache (developer laptop, CI re-runs); 5-10 min on cold-cache first run (CI image pull + auto-install).
- `cleanup()` stops both containers cleanly.

### S2 — PS fixture seeding (TS, not raw SQL)
**File:** `apps/api/test/integration/helpers/prestashop-fixture.helper.ts` (new — `applyPrestashopFixture(mysql, options)`)
**Why TS, not `.sql`**: the WS API key is generated per run, so a static SQL file can't carry it. Use `mysql2`-prepared queries from TS so the random key flows through parameter binding.
**Acceptance:**
- WS API key (32-char alphanumeric, generated per run) + permissions seeded.
- OL Dynamic carrier row inserted with stable `id_reference`. Returns `idCarrier`.
- Comment in the helper points at `apps/prestashop-module/openlinker/openlinker.php`'s `installCarrier()` as the source of truth — drift here means the SQL stub got out of sync.
- One minimal product row seeded so the order-ingestion path resolves SKU `SEEDED-SKU-1`.
- Idempotent (re-runnable against the same container — `INSERT … ON DUPLICATE KEY UPDATE` or guarded by `SELECT … LIMIT 1`).

### S3 — Allegro `OrderSourcePort` stub fixture
**Files:**
- `apps/api/test/integration/fixtures/incoming-order.fixtures.ts` (new — `createIncomingOrderForCarrierMapping`).
- `apps/api/test/integration/helpers/allegro-source-stub.helper.ts` (new — `installAllegroSourceStub(harness, connectionId, incomingOrder)`).

**Acceptance:** the stub satisfies `OrderSourcePort` and the override pipeline routes calls for the test Allegro connection through it.

### S4 — Connection + mapping seed helpers
**File extension:** `apps/api/test/integration/helpers/test-connection.helper.ts`
**Changes:**
- `createTestPrestashopConnection({ baseUrl, webserviceApiKey, defaultCarrierId })` — wires the new PS container's address into a connection row. Persists the WS API key into the connection's `credentialsRef`-pointed credentials row (use the existing `integration_credentials` infrastructure).
- `seedCarrierMapping(harness, connectionId, allegroDeliveryMethodId, prestashopCarrierIdReference)` — calls `harness.getApp().get(MAPPING_CONFIG_SERVICE_TOKEN).upsertCarrierMappings(connectionId, [...])` (the public `MappingConfigService` API), NOT a direct ORM write. This catches contract drift the same way prod does.
- One-line comment in the seed call documenting `id_reference` vs `id_carrier`: on a fresh PS install they coincide for default carriers, so the fixture treats them as interchangeable.

### S5 — The int-spec
**File:** `apps/api/test/integration/orders/allegro-prestashop-carrier-mapping.int-spec.ts` (new)
**Acceptance:**
- Boots PS container in `beforeAll`, tears down in `afterAll`. Suite-scoped — does NOT touch the global Postgres+Redis harness.
- S-1 (mapped happy path) + S-2 (defaultCarrierId fallback) tests pass.
- Scenarios are additive (each creates an order with a unique reference) — no PS-side reset between tests, since PS state isn't reset by `resetTestHarness()` anyway.
- Total run time under 3 min in CI (warm image cache).
- Failures produce actionable messages (assert on the specific PS field, not a wrapped exception).

### S6 — Documentation
**File extension:** `docs/testing-guide.md`
**Changes:**
- New section: "PrestaShop Testcontainer pattern" — one screen of prose explaining the helper, when to opt in, and the gotchas (image pull time, MySQL companion, SQL fixture required for WS access).
- Note that this pattern is suite-scoped (per int-spec, not global).

### S7 — Quality gate
`pnpm lint && pnpm type-check && pnpm test:integration` (only the new file). The new int-spec must pass; existing int-specs unaffected.

### S8 — Commit + PR
Conventional commit. PR body uses `Closes #506`.

---

## 5. Validation

- **Architecture compliance.** Test infrastructure only — no production code changes. New files all under `apps/api/test/integration/`. No `libs/` touches.
- **Naming.** `*.int-spec.ts` per `engineering-standards.md` "Test Files" and `testing-guide.md`.
- **Mocking strategy.** Mocks the *upstream* boundary (Allegro `OrderSourcePort`) only. Downstream PS is *real* — that's the entire point of the issue.
- **Security.** No real credentials. WS key is generated per-test-run.
- **Public-API seeding.** Carrier mappings are seeded via `MappingConfigService.upsertCarrierMappings`, not direct ORM writes — same code path the FE config screen uses, so the test surfaces contract drift.
- **Risks:**
  - **R1 — PS image flakiness.** PS's auto-install can fail intermittently. Mitigation: poll `ps_configuration.PS_VERSION_DB` (PS only writes that row at the very end of install) instead of an HTTP probe; retry on container start.
  - **R2 — PS version drift.** Pinning to `9.0.2-2.0-classic-8.4` (matches dev-stack). When dev-stack updates, this test has to follow. Documented in `docs/testing-guide.md`.
  - **R3 — Boot time blows out CI budget.** Cold-cache first run is 5-10 min; warm cache is ~60-90s. Mitigation: suite-scoped (one boot per file), not global. Follow-up: gate this spec behind `test:integration:slow` or a nightly-only tag (separate issue).
  - **R4 — Schema-write fixture brittleness.** PS schema changes between minor versions could break the WS-key INSERT. Mitigation: tests pin to a specific PS version (R2 restated); when bumping, update the helper.
  - **R5 — OL Dynamic carrier seed via SQL drifts from the real OL PS module install.** Mitigation: comment in `applyPrestashopFixture` pointing at `apps/prestashop-module/openlinker/openlinker.php`'s `installCarrier()` method as the source of truth. The seed is sufficient ONLY for `discoverDynamicCarrierId()` to succeed; it does NOT enable the runtime OL Dynamic path (which requires the PHP module loaded for `writeCartShipping()`). When the genuine OL Dynamic e2e is needed, replace the SQL stub with a volume-mount of the OL module + `php bin/console module:install openlinker` — separate follow-up.

---

## 6. Out of scope (recap)

- Multi-line orders, status-update flow, returns flow.
- Migrating existing `.int-spec.ts` files to use the PS container.
- Volume-mount install of the OL PS module — the genuine OL Dynamic runtime path (chain step 3 + sidecar `writeCartShipping`) is a follow-up. Today's fixture seeds only the carrier row to pass `discoverDynamicCarrierId()`.
- Gating this spec behind `test:integration:slow` or a nightly-only tag — follow-up issue if CI budget becomes a problem.
- Coverage of payment-mapping / status-mapping vertical slices (separate issues).

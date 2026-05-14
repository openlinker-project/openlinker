# Implementation Plan — #692: OL Dynamic carrier end-to-end int-spec

**Closes**: #513 (epic), #692 (this issue). Optionally folds in #693 (stale JSDoc cleanup).

## 1. Understand the task

**Goal**. The `allegro-prestashop-carrier-mapping.int-spec.ts` file currently covers two of three carrier-resolution branches against a real PrestaShop Testcontainer:

- **S-1** — Allegro method → mapped static PS carrier
- **S-2** — Allegro method unmapped → `defaultCarrierId` fallback to a static PS carrier

The third branch — **Allegro method → OL Dynamic carrier (via the real `cartshipping.php` HTTP round-trip)** — is asserted only by unit tests with mocks. Against a real PS install the full path (`writeCartShipping` POST → `HmacRequestVerifier::verify` → `CartShippingRepository::upsert` → `Carrier::getOrderShippingCostExternal` reads the sidecar at order-create time → `ps_orders.total_shipping == 12.50`) is **untested**. This is the test that closes the #513 epic's acceptance criterion.

**Layer classification**:

- **Test code only** — `apps/api/test/integration/{helpers,orders}/`. No production-source changes.
- Touches **infrastructure-side test fixtures** (PS Testcontainer helper, fixture helper, MySQL seed SQL).
- Touches the **runtime PS module artefacts** only by *copying* them into the test container — no edits to `apps/prestashop-module/openlinker/`.

**Explicit non-goals**:

- No production code changes to the PS adapter, the OL PS module, or the order-ingestion service.
- No new generic test framework — extend the existing PS Testcontainer harness in place.
- No backfill of pre-#516 reconcile-path orders (explicit out-of-scope in #513).
- No HTTP-client spy infrastructure for the negative case ("S-2 did NOT call cartshipping") — the sidecar-row read in S-3 is the load-bearing positive signal; S-1/S-2 keep their current id_carrier-based discriminator.
- No new test framework dependencies (testcontainers already supports the post-start `copyDirectoriesToContainer` + `exec` APIs we need).

## 2. Research the codebase

### Existing PS Testcontainer fixture (post-Phase 1 / #506)

`apps/api/test/integration/helpers/prestashop-container.helper.ts` boots a PS 9.0.2 + MySQL 8.4 pair on an isolated Docker network. The flow today:

1. `startPrestashopContainer()` boots both containers (`/var/www/html` bind-mounted from a host tmpdir so PS's admin-rename install step works on overlayfs).
2. `waitForPrestashopInstall(mysqlOptions)` polls `ps_configuration.PS_VERSION_DB` — the canonical "auto-install complete" signal.
3. `applyPrestashopFixture(mysqlOptions)` SQL-seeds: a WS API key (random per run), an **OL Dynamic carrier *stub* row** (`external_module_name='openlinker'`, but no PHP module installed — `getOrderShippingCostExternal()` is never reached), and the PLN currency.
4. `configurePrestashopAccessUrl(mysqlOptions, host:port)` makes the container's WS reachable from outside (rewrites `ps_shop_url`, enables `PS_WEBSERVICE`, sets `PS_DEV_MODE=1` for actionable error surfaces).
5. `verifyApacheUp(baseUrl, apiKey)` HTTP-probes `/api/carriers` with the seeded key — confirms Apache + WS + key are all wired.

The harness exposes `mysqlAddress` to the int-spec so direct MySQL seeds/reads (products, identifier-mapping bootstrap, carrier fully-delivered top-up) live in `prestashop-fixture.helper.ts` alongside the install-time seeds.

### Current SQL stub: `seedOlDynamicCarrier`

Lines 301-411 of `prestashop-fixture.helper.ts`. Inserts a `ps_carrier` row with `external_module_name='openlinker'`, `is_module=1`, `shipping_external=1`, plus zone/lang/shop link rows. **Idempotent** — if a row with that `external_module_name` already exists (e.g. because the real PHP module was just installed), early-returns the existing `id_carrier`. This makes the "module install first, fixture second" ordering safe without code changes.

### Real OL PS module install hook

`apps/prestashop-module/openlinker/openlinker.php::install()` (extends `CarrierModule`):

- Calls `parent::install()` (registers module row in `ps_module`).
- Registers the five hooks (`actionProductSave`, `actionValidateOrderAfter`, `actionOrderHistoryAddAfter`, `actionUpdateQuantity`, `actionCarrierUpdate`).
- Creates `ps_openlinker_webhook_outbox` (webhook outbox table — pre-existing capability).
- Creates `ps_openlinker_cart_shipping` (sidecar table — `id_cart PRIMARY KEY`, `amount_tax_excl`, `amount_tax_incl`, `source`, `created_at`, `updated_at`).
- Calls `setDefaultConfiguration()` — resets `OPENLINKER_WEBHOOK_SECRET` to **empty string** (relevant for HMAC wiring; see below).
- Calls `installDynamicCarrier()` — creates a Carrier row via `Carrier::add()` (so PS auto-assigns `id_carrier == id_reference`), tags it `external_module_name='openlinker'` + `is_module=1` + `shipping_external=1` + `id_tax_rules_group=0`, links to all active zones via `addZone()`, copies the carrier logo (fail-fast on copy error), and stores the carrier id in `OPENLINKER_DYNAMIC_CARRIER_ID` config key.

### HMAC contract: both sides

**Module side** (`apps/prestashop-module/openlinker/controllers/front/cartshipping.php`):
- Reads `OPENLINKER_WEBHOOK_SECRET` from `ps_configuration`.
- `HmacRequestVerifier::verify(rawBody, X-OpenLinker-Timestamp, X-OpenLinker-Signature, secret)`.
- Signed payload: `timestamp + "." + rawBody`. Algorithm: HMAC-SHA256. Signature header format: `sha256=<64-char hex>`.

**Adapter side** (`libs/integrations/prestashop/src/infrastructure/http/prestashop-openlinker-module.client.ts`):
- Resolves secret via `WebhookSecretProviderPort.getSecret('prestashop', connectionId)`.
- Same payload + algorithm + header format. Mirror image of the receiver.

**Secret-resolution chain** (`libs/core/src/integrations/infrastructure/adapters/credentials-webhook-secret.adapter.ts::CredentialsWebhookSecretAdapter`):
1. Encrypted DB credential at `ref = webhook-secret:<connectionId>` (production path).
2. Env-var fallback: `OPENLINKER_WEBHOOK_SECRET__PRESTASHOP__<CONNECTION_ID>` (per-connection) or `OPENLINKER_WEBHOOK_SECRET__PRESTASHOP` (provider-wide). **Deprecated but functional**, used by `apps/api/test/integration/webhook-ingestion.int-spec.ts` (line 21).

The webhook-ingestion int-spec sets `process.env.OPENLINKER_WEBHOOK_SECRET__PRESTASHOP = webhookSecret` directly — same pattern we'll use here.

### Adapter resolution chain (`prestashop-order-processor-manager.adapter.ts:294-374`)

Step 5b: `const olDynamicCarrierId = await this.discoverDynamicCarrierId()` — queries PS WS `/api/carriers` filtered by `external_module_name='openlinker'`, `active=1`, `deleted=0`. Throws `PrestashopOlCarrierMissingException` if missing — operator-actionable.

Step 5c: `resolveExternalCarrierId(order, config, olDynamicCarrierId)` — three-step chain:
1. Mapping table lookup keyed by `(allegroConnectionId, methodId)`.
2. `connection.config.defaultCarrierId` fallback.
3. `olDynamicCarrierId` as runtime last-resort (so unmapped orders still produce a sidecar-priced order rather than failing).

Step 6.5 — when `externalCarrierId === olDynamicCarrierId`, write the sidecar row via `openlinkerModuleClient.writeCartShipping({ idCart, amountTaxExcl, amountTaxIncl, source })` **before** `POST /orders`. Static-carrier paths skip the sidecar.

### testcontainers post-start API

`node_modules/testcontainers/build/test-container.d.ts:66-69` confirms `StartedTestContainer` exposes:
- `copyDirectoriesToContainer(directoriesToCopy: DirectoryToCopy[]): Promise<void>` — runtime directory copy.
- `exec(command: string | string[], opts?: Partial<ExecOptions>): Promise<ExecResult>` — runtime command exec.

Both are what we need. **The previously-considered builder-time `withCopyDirectoriesToContainer` won't work** — the existing bind-mount on `/var/www/html` (which PS uses to copy bundled PHP source during entrypoint) would mask any builder-time copy into that path.

### PS 9.x module-install quirk

`docs/operations/prestashop-module-rename-migration.md:127-131` documents that PS 9.0.2's `php bin/console prestashop:module install openlinker` **occasionally bypasses the legacy `install()` hook on first invocation**. Verified on the same `prestashop:9.0.2-2.0-classic-8.4` image we run in CI. Workaround: run `uninstall + install` once to force the legacy hook. We'll do this unconditionally — it costs ~2-5s and removes a class of CI flake.

### Existing S-1 / S-2 structure for cribbing

`apps/api/test/integration/orders/allegro-prestashop-carrier-mapping.int-spec.ts:179-328` shows the established pattern:

- `beforeAll(async () => { ps = await startPrestashopContainer(); ... }, 15 * 60_000)` — generous timeout for cold-cache.
- `seedScenario(opts)` helper builds (PS product + OL Product/Variant + identifier mappings) for each scenario, keyed on a unique `externalOfferId` / `methodId` so scenarios don't interfere.
- `seedCarrierMapping(harness, allegroConnectionId, methodId, psCarrierId)` writes the mapping table row.
- Per-scenario `it()` builds an `IncomingOrder` via `createIncomingOrderForCarrierMapping`, stubs the Allegro source, calls `ingestion.syncOrderFromSource`, asserts on the PS order/cart fetched via WS.
- `dumpPrestashopErrorLogs()` is a best-effort `docker exec` helper that runs after a failed sync to tail PS app + Apache logs.

S-3 will follow the same shape verbatim — only difference is the carrier id maps to OL Dynamic and we additionally read the sidecar row from MySQL.

## 3. Design the solution

### Container-state architecture

Current state after Phase 1 (#506):

```
[StartedTestContainer]
  /var/www/html (bind-mount from host tmpdir, populated by PS entrypoint)
    └── modules/  (no openlinker — bare PS install)
[MySQL]
  ps_configuration: PS_VERSION_DB, PS_WEBSERVICE=1, ...  (no OPENLINKER_*)
  ps_carrier: 1=Click&collect, 2=My carrier, 3=My cheap carrier, N=OL Dynamic STUB
  (no ps_openlinker_cart_shipping table)
```

Target state after S-3 fixture changes:

```
[StartedTestContainer]
  /var/www/html
    └── modules/
        └── openlinker/  (copied from worktree's apps/prestashop-module/openlinker/)
[MySQL]
  ps_configuration:
    + OPENLINKER_DYNAMIC_CARRIER_ID = <new id>
    + OPENLINKER_WEBHOOK_SECRET = <random per-run>
    + OPENLINKER_BASE_URL, OPENLINKER_CONNECTION_ID, OPENLINKER_CRON_TOKEN  (defaults)
  ps_module:
    + (N+1, 'openlinker', 1)
  ps_carrier:
    1=Click&collect, 2=My carrier, 3=My cheap carrier, N=OL Dynamic (module-installed)
  + ps_openlinker_cart_shipping  (sidecar table, empty)
  + ps_openlinker_webhook_outbox (outbox table, empty — coexists, not exercised by S-3)
```

S-1 / S-2 see the OL module installed but **never resolve to its carrier id** (their mappings point at `myCarrier` / `myCheapCarrier`). The fixture's `seedOlDynamicCarrier` early-returns when it finds the module-installed row — so the stub-vs-real conflict is auto-resolved.

### Install ordering (load-bearing)

The OL module install must happen **between** `waitForPrestashopInstall` and `applyPrestashopFixture`:

- **After** `waitForPrestashopInstall`: PS needs `PS_VERSION_DB` set, the legacy bootstrap reachable, languages active, MySQL fully writable. Module install needs all of this.
- **Before** `applyPrestashopFixture`: the fixture's `seedOlDynamicCarrier` is idempotent against the module-installed row (early-returns if `external_module_name='openlinker'` exists). Running fixture first would create the stub *then* let the module install create a second row — leaving two carriers tagged `external_module_name='openlinker'` and a non-deterministic `discoverDynamicCarrierId()`.

The HMAC-secret seed happens **after** `applyPrestashopFixture` and **before** `verifyApacheUp` — anywhere in that gap is safe; choose just before `verifyApacheUp` so the secret is in place before the first WS probe (paranoia hedge against future WS probes that might exercise the cartshipping endpoint).

### Files touched

| File | Change |
|---|---|
| `apps/api/test/integration/helpers/prestashop-container.helper.ts` | New helper `installOpenLinkerModule(prestashop, mysqlAddress, sharedSecret)`. Wire into `startPrestashopContainer()` between `waitForPrestashopInstall` and `applyPrestashopFixture`. Extend `PrestashopTestContainer` interface with `webhookSharedSecret: string`. |
| `apps/api/test/integration/helpers/prestashop-fixture.helper.ts` | New helpers: `discoverInstalledOlDynamicCarrierId(options)`, `readCartShipping(options, idCart)`. Both wrap MySQL queries against the running PS DB. |
| `apps/api/test/integration/orders/allegro-prestashop-carrier-mapping.int-spec.ts` | Add S-3 scenario. `beforeAll` wires `process.env.OPENLINKER_WEBHOOK_SECRET__PRESTASHOP = ps.webhookSharedSecret`. Existing S-1/S-2 unchanged. |
| `libs/integrations/prestashop/src/infrastructure/mappers/prestashop-order.mapper.ts` | (optional — fold #693) Remove stale `reconcileShippingCost` reference in line 324 JSDoc. |

### HMAC wiring

Per-run pseudo-random secret generated in the helper via `randomBytes(32).toString('hex')` (64 hex chars — generous, matches the module's `generateRandomToken` shape). Wired in two places:

**PS side**: After `bin/console prestashop:module install openlinker` (which resets `OPENLINKER_WEBHOOK_SECRET` to `''`), the helper SQL-upserts the row:

```sql
INSERT INTO ps_configuration (name, value, date_add, date_upd)
VALUES ('OPENLINKER_WEBHOOK_SECRET', ?, NOW(), NOW())
ON DUPLICATE KEY UPDATE value = VALUES(value), date_upd = NOW();
```

**Adapter side**: The spec's `beforeAll` does `process.env.OPENLINKER_WEBHOOK_SECRET__PRESTASHOP = ps.webhookSharedSecret` before `getTestHarness()` resolves the `WebhookSecretProviderPort` adapter (env-var fallback path — same pattern `webhook-ingestion.int-spec.ts:21` uses today).

**Pre-flight assertion** in the helper (cheap belt-and-braces): SELECT the `OPENLINKER_WEBHOOK_SECRET` row back after the seed, assert it equals the generated value. Catches a future PS-version regression in `Configuration::updateValue()` semantics with a precise diagnostic instead of a 401 from `cartshipping.php`.

### Helper-API shape

```ts
// prestashop-container.helper.ts

export interface PrestashopTestContainer {
  // ...existing fields...
  /** HMAC shared secret (random per run). Same bytes seeded into
   *  ps_configuration.OPENLINKER_WEBHOOK_SECRET AND returned to the spec
   *  for env-var wiring of WebhookSecretProviderPort. */
  webhookSharedSecret: string;
  /** id_carrier of the module-installed OL Dynamic carrier
   *  (`external_module_name='openlinker'`). Coincides with
   *  ps_configuration.OPENLINKER_DYNAMIC_CARRIER_ID. */
  olDynamicCarrierId: number;  // already present; semantics shift from "stub" to "module-installed"
  // ...
}

async function installOpenLinkerModule(
  prestashop: StartedTestContainer,
  mysqlAddress: ApplyFixtureOptions,
  sharedSecret: string,
  modulePath: string,
): Promise<void>;
```

```ts
// prestashop-fixture.helper.ts

export interface CartShippingRow {
  amountTaxExcl: number;
  amountTaxIncl: number;
  source: string | null;
}

export async function readCartShipping(
  options: ApplyFixtureOptions,
  idCart: number,
): Promise<CartShippingRow | null>;
```

### Test-spec shape (S-3)

```ts
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
    throw new Error(`S-3 order sync failed: ${results[0].error.message}`);
  }

  const psOrderId = await resolveDestinationOrderId(
    harness, results[0].orderRef.orderId, prestashopConnectionId,
  );
  const psOrder = await fetchPsOrder(ps, psOrderId);

  // (1) Order routed to the OL Dynamic carrier
  expect(Number(psOrder.id_carrier)).toBe(ps.olDynamicCarrierId);
  // (2) Total shipping reads the buyer-paid amount from the sidecar
  expect(Number(psOrder.total_shipping)).toBeCloseTo(12.5, 2);
  // (3) No payment-mismatch state — the whole point of #513
  expect(Number(psOrder.total_paid)).toBeCloseTo(Number(psOrder.total_paid_real), 2);
  expect(Number(psOrder.current_state)).not.toBe(8);

  // (4) Sidecar row populated — unique signal that the round-trip happened
  const sidecar = await readCartShipping(ps.mysqlAddress, Number(psOrder.id_cart));
  expect(sidecar).not.toBeNull();
  expect(sidecar!.amountTaxIncl).toBeCloseTo(12.5, 2);
});
```

`beforeAll` extension (minimal — three new lines):

```ts
ps = await startPrestashopContainer();
// Wire the adapter side of the HMAC contract — module side is seeded
// by startPrestashopContainer's installOpenLinkerModule step.
process.env.OPENLINKER_WEBHOOK_SECRET__PRESTASHOP = ps.webhookSharedSecret;

// S-3 mapping (new — alongside the existing S-1 mapping):
await seedCarrierMapping(harness, allegroConnectionId, 'paczkomat-s3', String(ps.olDynamicCarrierId));
// And seedScenario for the new offer/product (same pattern as S-1/S-2):
await seedScenario({ /* ...ALG-OFFER-S3 / SEEDED-SKU-S3... */ });
```

## 4. Step-by-step implementation plan

Each step lists the file path, the change, and the acceptance criterion that proves the step landed.

### Step 1 — `installOpenLinkerModule` helper

**File**: `apps/api/test/integration/helpers/prestashop-container.helper.ts`

**Change**:

- Add helper `installOpenLinkerModule(prestashop: StartedTestContainer, mysqlAddress: ApplyFixtureOptions, sharedSecret: string, modulePath: string): Promise<void>`.
- Body:
  1. `await prestashop.copyDirectoriesToContainer([{ source: modulePath, target: '/var/www/html/modules/openlinker' }])`.
  2. Ensure file ownership matches the Apache user inside the container — `await prestashop.exec(['chown', '-R', 'www-data:www-data', '/var/www/html/modules/openlinker'])`. PS module-install reads the PHP files and writes the logo back; without chown the copy lands owned by root and the carrier-logo step fails silently.
  3. Force install via the `uninstall + install` cycle (per `docs/operations/prestashop-module-rename-migration.md:127-131`):
     - `await prestashop.exec(['php', 'bin/console', 'prestashop:module', 'install', 'openlinker'], { workingDir: '/var/www/html' })`.
     - `await prestashop.exec(['php', 'bin/console', 'prestashop:module', 'uninstall', 'openlinker'], { workingDir: '/var/www/html' })`.
     - `await prestashop.exec(['php', 'bin/console', 'prestashop:module', 'install', 'openlinker'], { workingDir: '/var/www/html' })`.
     Each call asserts `exitCode === 0`; throws with the captured stdout/stderr on non-zero.
  4. SQL-upsert `OPENLINKER_WEBHOOK_SECRET = sharedSecret` into `ps_configuration` via `mysql2`.
  5. Pre-flight assertion: SELECT the row back, throw if `value !== sharedSecret`.

- Update the `PrestashopTestContainer` interface: add `webhookSharedSecret: string`. Update JSDoc on `olDynamicCarrierId` — its semantics shift from "stub carrier" to "module-installed carrier".
- In `startPrestashopContainer`:
  - Generate `webhookSharedSecret` (e.g. `randomBytes(32).toString('hex')`) up front.
  - Resolve the worktree's module path via `path.resolve(__dirname, '../../../../prestashop-module/openlinker')`.
  - Insert `await installOpenLinkerModule(prestashop, mysqlOptions, webhookSharedSecret, modulePath)` **between** `waitForPrestashopInstall` and `applyPrestashopFixture`.
  - After the install, re-read `OPENLINKER_DYNAMIC_CARRIER_ID` from `ps_configuration` and pass it through `applyPrestashopFixture` (or accept the fixture's existing return, which will idempotently find the module-installed row). Return value populates `olDynamicCarrierId` on the harness.
  - Include `webhookSharedSecret` in the returned harness object.

**Acceptance**:

- A `pnpm test:integration --filter allegro-prestashop-carrier-mapping` run reaches `beforeAll` completion without `installOpenLinkerModule` throwing.
- `docker exec <ps-container> mysql -e "SELECT name, value FROM ps_configuration WHERE name IN ('OPENLINKER_DYNAMIC_CARRIER_ID','OPENLINKER_WEBHOOK_SECRET')"` shows both rows populated, secret == the test-side env var.
- `docker exec <ps-container> mysql -e "SHOW TABLES LIKE 'ps_openlinker_%'"` shows `ps_openlinker_cart_shipping` AND `ps_openlinker_webhook_outbox`.

### Step 2 — `readCartShipping` fixture helper

**File**: `apps/api/test/integration/helpers/prestashop-fixture.helper.ts`

**Change**: Append a new export under the existing "Carrier-mapping vertical-slice helpers" section:

```ts
export interface CartShippingRow {
  amountTaxExcl: number;
  amountTaxIncl: number;
  source: string | null;
}

/**
 * Read a row from the OpenLinker module's per-cart shipping sidecar table.
 * Returns null when no row exists for the given id_cart. Used by S-3 to
 * prove the writeCartShipping → cartshipping.php → CartShippingRepository::upsert
 * round-trip actually persisted the buyer-paid amount.
 */
export async function readCartShipping(
  options: ApplyFixtureOptions,
  idCart: number,
): Promise<CartShippingRow | null>;
```

Body: `SELECT amount_tax_excl, amount_tax_incl, source FROM ps_openlinker_cart_shipping WHERE id_cart = ? LIMIT 1` via the existing `mysql2/promise` connection pattern. Map `DECIMAL(20,6)` to `Number(...)` at the boundary.

**Acceptance**: Unit-equivalent — a manual smoke (insert a row via SQL, call `readCartShipping`, assert shape). The S-3 spec is the integration-level smoke.

### Step 3 — S-3 spec scenario

**File**: `apps/api/test/integration/orders/allegro-prestashop-carrier-mapping.int-spec.ts`

**Change**:

1. Imports: add `readCartShipping` to the `prestashop-fixture.helper` import list.
2. `beforeAll`: after `ps = await startPrestashopContainer()`, add `process.env.OPENLINKER_WEBHOOK_SECRET__PRESTASHOP = ps.webhookSharedSecret;`.
3. `beforeAll` seeds: add an S-3 `seedScenario({ externalOfferId: 'ALG-OFFER-S3', psReference: 'SEEDED-SKU-S3', psName: 'Carrier-mapping S-3 product', ... })` block alongside the existing two.
4. `beforeAll` mappings: add `await seedCarrierMapping(harness, allegroConnectionId, 'paczkomat-s3', String(ps.olDynamicCarrierId));` after the S-1 mapping seed.
5. Add the new `it('S-3: …')` block following the structure in § 3 (Test-spec shape).

**Acceptance**: `it('S-3: …')` passes. Spec file shape unchanged otherwise.

### Step 4 — Verify S-1 and S-2 still pass

**File**: `apps/api/test/integration/orders/allegro-prestashop-carrier-mapping.int-spec.ts` (no edits — verification only)

**Change**: None. This is a regression check.

**Acceptance**: `pnpm test:integration --filter allegro-prestashop-carrier-mapping` runs all three scenarios green. S-1 still asserts `id_carrier == myCarrier.idCarrier`; S-2 still asserts `id_carrier == myCheapCarrier.idCarrier`. The OL module being installed in the same container is invisible to those branches because their carrier resolution never reaches the OL Dynamic id.

### Step 5 — (Optional) Fold #693 JSDoc cleanup

**File**: `libs/integrations/prestashop/src/infrastructure/mappers/prestashop-order.mapper.ts:323-325`

**Change**: Drop the trailing "Without this every synced order lands at `id_carrier=0`, no `order_carriers` row is created, and `reconcileShippingCost` cannot write…" sentence — the function is gone, the consequences are documented at the adapter call site.

**Acceptance**: `grep -rn reconcileShippingCost libs/integrations/prestashop/src` returns zero hits. `pnpm lint && pnpm type-check && pnpm test` green.

### Step 6 — Quality gate

**Commands**:

```bash
pnpm lint        # all 8 invariants must pass
pnpm type-check  # zero errors
pnpm test        # 1853+ unit tests, all green (no production source changed → no unit regressions expected)
pnpm test:integration --filter allegro-prestashop-carrier-mapping
```

**Acceptance**: All four green. Cold-cache CI run completes within the existing 15-minute `beforeAll` timeout — flag in PR description if module install pushes total run over 12 min.

### Step 7 — Self-review + commit + PR

Per `docs/code-review-guide.md`. Look specifically for:

- Domain/infra/test boundary respected (yes — all changes in `apps/api/test/`).
- No `any` types, no inline secrets (the random secret is fine; it's per-run and per-container).
- No `console.log` outside the existing error-dump path.
- Architecture: the `installOpenLinkerModule` helper sits at the same layer as the existing `applyPrestashopFixture` / `getDefaultPsCarriers` helpers.
- PR body: `Closes #513`, `Closes #692`, `Closes #693` (if Step 5 included).

## 5. Validate

### Architecture compliance

- Tests stay in `apps/api/test/integration/`. No CORE/Integration boundary crossed.
- Helper APIs are new exports from existing helper files — no new top-level modules.
- The PS module artefacts at `apps/prestashop-module/openlinker/` are read-only inputs to the test fixture; no edits.
- The `OPENLINKER_WEBHOOK_SECRET__PRESTASHOP` env-var pattern is already exercised by `webhook-ingestion.int-spec.ts:21` — using the same path keeps the test-fixture surface uniform.

### Naming / file conventions

- `installOpenLinkerModule` — camelCase function, `*.helper.ts` co-location (matches `applyPrestashopFixture`, `getDefaultPsCarriers`, `seedPrestashopProductForOrders`).
- `readCartShipping`, `CartShippingRow` — matches the read-side naming used by the existing fixture helpers.
- S-3 follows S-1/S-2 naming (`paczkomat-s3`, `ALG-OFFER-S3`, `SEEDED-SKU-S3`).

### Testing strategy

- One canonical assertion bundle per scenario; no test interdependence (each scenario uses a disjoint `externalOrderId` / `methodId` / `externalOfferId`).
- Sidecar-row assertion is the **unique** signal for the OL Dynamic path. Without it, S-3 could pass even if the cartshipping endpoint was bypassed and PS read a stale or default shipping value.
- HMAC pre-flight (Step 1.5) catches secret-drift before any test runs the cartshipping POST — fast-fail on misconfig.

### Security

- The HMAC secret is random per run, lives only in the test process memory + the test container, never logged. The container is destroyed in `afterAll`.
- The env var is set in `beforeAll` and not unset in `afterAll` — slight test pollution but Jest workers are per-file in this repo; cross-spec interference is bounded. Acceptable for now; if it becomes an issue, add `delete process.env.OPENLINKER_WEBHOOK_SECRET__PRESTASHOP` in `afterAll`.

### Risks

1. **PS 9.x module-install CLI flake** (documented in #519 runbook). Mitigation: unconditional `uninstall + install` cycle as the helper's install routine.
2. **Boot-time over budget**. Phase A install adds ~5-30s after `waitForPrestashopInstall`. Existing 12-min cold-cache deadline holds; if it doesn't, revisit Option A2 (pre-baked image).
3. **PS 9.x CLI command name drift**. The pinned image (`prestashop:9.0.2-2.0-classic-8.4`) is documented to support `php bin/console prestashop:module install <name>`. If a future image bump breaks this, the helper's exec-step failure surfaces a precise diagnostic (captured stdout/stderr); cost is one CI iteration to update the command.
4. **HMAC env-var leakage between test files**. Bounded by Jest's per-file worker model. If a future spec file in the same worker assumes a different secret, add explicit cleanup. Not blocking.
5. **MySQL conversion-rate edge** — the fixture seeds PLN at `conversion_rate=1.0` to keep `total_shipping == 12.50` literal. No change here; S-3 relies on the same property as S-1/S-2.

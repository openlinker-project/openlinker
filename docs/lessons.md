# Lessons

Recurring patterns and mistakes to avoid. **Review at the start of a work session.**

## What belongs here (and what doesn't)

This file is a **regression ledger** — empirical gotchas discovered while doing the work, written forward so the same mistake isn't repeated. It is **not** the place for architectural rules. Those stay canonical in:

- `docs/engineering-standards.md` — coding standards, naming, layering
- `docs/architecture-overview.md` — bounded contexts, ports, data flow
- `docs/architecture/adrs/` — decisions and their rationale
- `.claude/rules/*` — agent-facing rule sheets

When a lesson hardens into a rule, **graduate it** to the canonical doc and leave the lesson pointing at it. Keep entries empirical, dated by the PR/ADR that established them, and scoped with **Applies to** so they're easy to match against the file you're touching.

**Entry format** — one `##` heading per lesson (the heading *is* the rule, imperative), then:

- `**Context**:` the situation it came up in
- `**Problem**:` what went wrong
- `**Rule**:` the preventive measure
- `**Applies to**:` files / modules / scope
- `**Source**:` PR / ADR reference

---

## A top-level value import between two barrels that reference each other's `*Module` class can crash NestJS boot even when the DI graph is acyclic

**Context**: #2157 (write-path guard) and #2156 (cross-capability gate) each added a top-level value import from `@openlinker/core/fiscalization` into a file exported from `@openlinker/core/invoicing`'s own barrel (`FISCAL_REGISTRATION_SERVICE_TOKEN` in `invoice.service.ts`; `toRegisterTransactionCommand` in `auto-issue-trigger.service.ts`). `fiscalization.module.ts` separately has a real, one-way `import { InvoicingModule } from '@openlinker/core/invoicing'` for its `@Module({ imports: [...] })` array — a documented, deliberate edge, with the reverse direction resolved lazily via `ModuleRef.get(..., { strict: false })` specifically so no NestJS DI cycle exists.
**Problem**: `type-check`, `lint`, every unit `.spec.ts`, and `check-cross-context-imports.mjs` all passed clean — none of them execute Node's module system, so none could see this. Only an actual `NestFactory.create(AppModule)` boot crashed, with "Nest cannot create the FiscalizationModule instance. The module at index [n] of the imports array is undefined." Root cause: `app.module.ts` requires `@openlinker/core/invoicing` first; loading it hits the offending file mid-barrel (before the barrel's own, later-exported `InvoicingModule`), which requires `@openlinker/core/fiscalization`; *that* barrel's `fiscalization.module.ts` requires `@openlinker/core/invoicing` back — landing on invoicing's own **still-partially-populated** `module.exports`, where `InvoicingModule` isn't assigned yet. `@Module({ imports: [...] })` decorator arguments evaluate once, synchronously, at class-definition time — not live bindings — so the `undefined` is captured permanently. The existing `ModuleRef` lazy-DI pattern (added specifically to avoid a cycle) broke the **NestJS dependency-graph** cycle only; the plain top-level imports left a genuinely different **CommonJS require-graph** cycle wide open one layer down, and nothing in the repo's invariant suite checks for that shape.
**Rule**: When context A's `*.module.ts` value-imports context B's `*Module` class for its `imports: [...]` array (a documented, allowed one-way edge per `docs/architecture-overview.md § Cross-context dependencies`), audit **every other file B exports** for a top-level value import back into A — even a single Symbol token or a plain function counts, and `import type` does not help if the *value* is genuinely needed at runtime (a lazy `require()` inside the consuming method does; type it via a **named**, never wildcard, `import type { X as XType } from '@openlinker/core/B'` + `typeof XType` cast, so `check-cross-context-imports.mjs`'s wildcard ban and `consistent-type-imports`'s inline-`import()` ban both stay satisfied). Prove the fix with an actual boot, not just `type-check`/`lint`/unit specs — none of those execute the module graph. A throwaway script works when Testcontainers integration tests aren't available: `NestFactory.create(AppModule, { abortOnError: false })` against a deliberately-unreachable DB/Redis host still reaches (and, before the fix, crashes on) module construction, well before any real connection is attempted.
**Applies to**: any pair of core contexts where one's `*.module.ts` imports the other's `*Module` class — check both directions' *other* files, not just the module files themselves, whenever adding a new cross-context symbol.
**Source**: #2154 epic Phase 4 live e2e (found the app couldn't boot at all on the demo stack); fixed by commit `cf55c4d4e`.

## A column written by a narrow out-of-band UPDATE must be excluded from the full-row upsert's write set

**Context**: `order_records` carries denormalized columns that no ingestion payload supplies and that a different context pushes in with a narrow `UPDATE` - `fulfillmentState` (a rollup over the order's shipments, written by `updateFulfillmentState`) and `cancelledAt` (written by `markCancelled`). `OrderRecordRepository.upsert` is a full-object TypeORM `save()`.
**Problem**: `toOrm` mapped `fulfillmentState` unconditionally while `persistOrder` never populated it (it is the 12th constructor argument and only 11 were passed), so every re-ingestion - a poll re-read, a webhook-triggered sync, a manual re-sync - wrote `null` over a committed `'dispatched'`. A dispatched order silently reappeared as not-shipped in the ship-by SLA buckets and the not-shipped list filter. The same class of defect had already been fixed for `cancelledAt` in the same method (#1984) and the exclusion comment sat three lines below the offending assignment.
**Rule**: When a column has a dedicated out-of-band writer, that writer must be its **only** writer: leave the ORM entity property unset in `toOrm` so TypeORM omits the column from the generated statement, and say so in a comment next to the columns that *are* mapped. Do not "fix" it by reading the row first and carrying the value onto the new instance - an unlocked upsert racing the out-of-band UPDATE still loses a value that commits between the read and the save. Pin it with a unit test asserting the property is `undefined` on the entity handed to `save()` **and** an integration test proving the committed value survives a second persist (a mocked spec cannot prove TypeORM really omits the column). Note the consequence: the record returned by the upsert reports such a column as `null` whatever the row holds, so a caller needing its live value must re-read. Sweep the **whole method**, not just the column you came for: #2101 excluded `fulfillmentState` and left its exclusion comment sitting directly *below* two more assignments with the identical defect (`syncStatus`, `syncAttempts`), which then needed #2140 - so re-read every remaining assignment and ask which out-of-band writer owns it, and keep the exclusions in one consolidated block rather than interleaved with the assignments, or the next author drops a fresh one into the gap. Two follow-on traps #2140 surfaced: (1) an excluded **array** column needs a `?? []` guard where `toDomain` reads it, because the update path has no `RETURNING` clause and hands the property straight back `undefined` - `null`able scalars were already guarded, so #2101 never hit it; (2) for a `NOT NULL` column, omitting it makes the insert depend on the DB `DEFAULT` (TypeORM emits `DEFAULT` for an `undefined` column on Postgres), so verify that default is actually guaranteed rather than reading it off the creating migration - `1770000000000` wraps its `CREATE TABLE` in `if (!table)`, so a schema first built by `synchronize` skipped it entirely and took the column from the ORM decorator instead. Declare the `default` on the decorator (it is what a synchronize-built schema, including the int-spec harness, uses) *and* assert it on the migration-built schema with an idempotent `ALTER COLUMN ... SET DEFAULT`.
**Applies to**: any repository whose `upsert`/`save` coexists with a narrow `UPDATE` writer on the same table - today `libs/core/src/orders/infrastructure/persistence/repositories/order-record.repository.ts` (`syncStatus`, `syncAttempts`, `fulfillmentState`, `cancelledAt`).
**Source**: #2101 (surfaced reviewing #2050 / ADR-040, which adopts the narrow-conditional-UPDATE shape for its own columns); the `cancelledAt` precedent is #1984; #2140 closed the same defect for `syncStatus` / `syncAttempts` in the same method.

## Claim an ADR number from the "Reserved numbers" note, not from the last row of the index table

**Context**: #2066 authored three ADRs and numbered them 039/040/041 by reading the index table in `docs/architecture/adrs/README.md` and taking "last merged row + 1".
**Problem**: The index lists only **merged** ADRs; several are normally in flight. All three numbers were taken — 041 was already merged, 039 was claimed by #2014 **and already referenced by name six times from `docs/plans/implementation-plan-order-cancellation-record-state.md` on `main`**, and 040 was claimed by #2050. Merging would have silently repointed a live link on `main` to the wrong ADR. Compounding it, the branch had also deleted `main`'s ADR-041 row *and* the "Reserved numbers" note itself — removing the warning against the exact mistake, then making it. That was the third numbering collision in two days.
**Rule**: Before authoring an ADR, read `git show origin/main:docs/architecture/adrs/README.md | tail -12` — the last rows **and** the reserved-numbers note beneath them — and claim your number by adding it to that note in your PR. Never edit the README from a stale local copy; `git fetch origin main` first, because a stale copy silently drops other people's rows. When renumbering afterwards, **never blanket find-replace `ADR-0NN` across `docs/`** — other plans legitimately reference the real ADR at that number. Scope the replace to an explicit list of files your PR authored, then verify the untouched ones are byte-identical to `main`.
**Applies to**: `docs/architecture/adrs/**`, and any doc that references an ADR by number.
**Source**: #2066 (found in review). Mechanical enforcement tracked as #2082.

## A new authenticated principal must never land on `req.user` — `RolesGuard` default-allows every route without `@Roles()`

**Context**: #1032's planned pack station proposed a warehouse "device principal" placed on `req.user`, with an endpoint allowlist described in the design as "the security boundary".
**Problem**: `RolesGuard.canActivate` returns **`true`** when a route carries no `@Roles()` decorator (`apps/api/src/auth/guards/roles.guard.ts`), and it is a global `APP_GUARD`. So any principal that satisfies `JwtAuthGuard` and reaches `req.user` is authorized on **every undecorated route** — including the customers controller (buyer PII), products, inventory, webhooks and cursors. The allowlist would have been decorative. This is currently latent, not exploitable, only because every principal in the system today is an OL user with a role.
**Rule**: A non-user principal (device, station, WMS service identity, agent token) gets `@Public()` plus its own dedicated verifier, in its own controller — never `req.user`. This is the split MCP already uses (`mcp-transport.controller.ts` vs `mcp-tokens.controller.ts`, which documents it). Copying only the *storage* half of the `mcp_tokens` pattern (opaque prefix + SHA-256 + revoke) is not enough; the auth-model separation is the load-bearing half. Where a service identity genuinely suits an OL user, prefer a service-account user under the existing role ladder over a new principal type.
**Applies to**: `apps/api/src/**/http/*.controller.ts`, `apps/api/src/auth/**`, any PR introducing a new authentication path.
**Source**: #1032 planning (found in stress test); guard hardening tracked as #2079.

## A supplementary write added inside an existing per-item sync loop must degrade, never abort

**Context**: #2024 extends the existing #816 `marketplace.offer.statusSync` per-offer loop to also persist a commercial (price/quantity) observation, reusing the same fetched object rather than a second marketplace call.
**Problem**: The first cut called the new write unguarded inside the loop. A single throw (an unvalidated marketplace-supplied string hitting a `numeric` column, a unique-constraint race with a concurrent `refreshOne`) aborted every remaining offer's **status** update for that page too, and skipped the `nextOffset` cursor advance — so the next tick re-read the same page, hit the same poison offer, and wedged that connection's status sync permanently. The repo already had this exact precedent (the Smart-classification readback, "must not fail the offer-creation job") and repeated the mistake anyway.
**Rule**: When bolting a second, non-essential write onto an existing per-item loop, wrap it in its own try/catch that warn-logs and continues — never let it propagate into the loop's control flow. Verify with a test that asserts the *primary* write still happened and the cursor still advanced when the secondary write throws, not just that the secondary write's own effect is absent.
**Applies to**: any application service that adds work inside `libs/core/src/**/application/services/*-sync.service.ts`'s per-item loop.
**Source**: #2024 (found reviewing PR #2035).

## Guard a numeric field from untyped wire JSON with `typeof` + `Number.isFinite`, never a bare `=== undefined` check

**Context**: #2024's Erli adapter projected a marketplace price with `if (product.price === undefined) return null`.
**Problem**: A JSON `null` (not `undefined`) slips past that guard, and `null / 100` evaluates to `0` — persisting a fabricated `"0.00"` price for an offer that is not actually free. There is no finite check either: a non-numeric value produces `NaN`, and Postgres `numeric` accepts the string `'NaN'` silently, so it stores rather than erroring. Separately, `typeof x === 'number'` alone still admits `Infinity` — reachable from `JSON.parse('{"a":1e999}')` — so an `Infinity` quantity would pass too.
**Rule**: For a numeric value read off untyped wire JSON, guard with `typeof x === 'number' && Number.isFinite(x)`, and treat `null`/`undefined`/non-numeric/`NaN`/`Infinity` uniformly as "absent" rather than coercing to `0`. A sparse marketplace response must persist as "not reported," never as a fabricated zero — an operator cannot tell a real `0` apart from a missing read.
**Applies to**: any adapter mapping a numeric field from a raw marketplace/shop API response, especially one persisted downstream.
**Source**: #2024 (found reviewing PR #2035); the Allegro side of the same adapter pair needed the identical fix.

## Never copy another platform's `defaultRateLimit` figure — an uncalibrated manifest default is a silent throughput regression

**Context**: Each #1810 Phase 5 adopter wires its HTTP client to `HostServices.http`, and may declare an `AdapterMetadata.defaultRateLimit` as the fallback when a connection has no explicit `config.rateLimit`.
**Problem**: PrestaShop's `{ requestsPerMinute: 60, maxConcurrent: 4 }` is the only such default in the repo and it is calibrated for an operator's OWN shop webserver (#1815) — simultaneously the throughput bottleneck and busy serving customers. Copying that figure onto a *carrier/marketplace* platform reads as "conservative" but is a guess about someone else's quota, and it is not a soft ceiling: `requestsPerMinute` is minimum-interval spacing (capacity ~1, no burst) — and, since the registry became Redis-shared across every process/replica (#2015), that figure is now the true aggregate cap with nothing dividing it further. On InPost it would have capped a previously-unlimited path at 1 req/s — bulk shipment dispatch (N≤25, sequential, on the *interactive* request path) going from seconds to a ≥25 s floor, invisible until an operator noticed slow dispatch. WooCommerce declines a default too, for the adjacent reason (an unenforced default fabricates a "Default: 60" readout in the FE `RateLimitSection`).
**Rule**: Declare `defaultRateLimit` only with a **documented quota for that platform** to calibrate against. Absent one, ship none: the transport already respects a real limit reactively via `Retry-After` (`limiter.noteRetryAfter`), and an operator who hits one sets `config.rateLimit` per connection. State the omission and its reason in the manifest — the absence is a decision, and the next adopter will otherwise read it as an oversight and "fix" it.
**Applies to**: every `AdapterMetadata` in `libs/integrations/*/src/*-plugin.ts` as it adopts `host.http`.
**Source**: #1971 (found reviewing PR #1981, which had added the copied 60/4 to InPost).

## Assert `host.http.forConnection` in a spec when a client stops calling bare `fetch`

**Context**: #1810 Phase 5 replaces each plugin client's `fetch()` with an injected `fetchImpl`, guarded by an ESLint `no-restricted-globals` rule plus `scripts/check-outbound-http.mjs`.
**Problem**: Both guards only detect a *bare `fetch(`* in the scanned package. Once the client's own call site is `this.fetchImpl(...)` with a `?? globalThis.fetch` default, a regression that simply stops threading the transport (a dropped constructor argument, a new call site built without it) reintroduces the un-rate-limited bypass while lint stays green — the fallback is the bypass.
**Rule**: Every adopting package needs a spec asserting `host.http.forConnection` is called for each construction path (the capability-adapter factory *and* the connection tester), with exactly the arguments intended — a single-argument `toHaveBeenCalledWith(connection)` also pins that no manifest default is being passed. Prefer closing the gap at the type level over the spec alone where the client's own signature allows it: make the client constructor's `fetchImpl` parameter **required** (no `?? globalThis.fetch` default) rather than optional-with-fallback. A required parameter turns "a dropped constructor argument" into a compile error at every construction site instead of a silent runtime fallback the spec has to remember to keep pinning — InPost (#1981) adopted this after PrestaShop/WooCommerce had already shipped the optional-with-fallback shape; the same tightening is worth carrying to those two.
**Applies to**: `libs/integrations/*/src/__tests__/*-plugin.spec.ts`, `.../adapters/__tests__/*-connection-tester.adapter.spec.ts`, and each package's `*-http-client.ts` constructor.
**Source**: #1971 (gap found reviewing PR #1981); PrestaShop's `prestashop-plugin.spec.ts` is the reference shape.

## A destructive sweep keyed on an internal id alone needs an explicit sole-claimant check, because internal ids are only per-connection by convention

**Context**: The master-sync staleness prunes (`MasterProductSyncService.markVariantsStaleExcept`, `MasterInventorySyncService.pruneStaleVariants`) mark every row of an internal product id stale, keyed on that id and nothing else.
**Problem**: `getOrCreateInternalId` namespaces per `(entityType, externalId, connectionId)`, so two connections *normally* never converge on one internal id - which made the missing connection scoping look safe and go unnoticed through two features (#1599 products, #1688 inventory). Nothing in the schema or the code enforces it: `product_variants` / `inventory_items` carry no provenance column, so a single converged mapping turns one connection's 404 into a sweep over a sibling connection's live rows, silently and unattributably.
**Rule**: When a sweep/delete/prune keys on an internal id that is only *conventionally* single-owner, add an explicit sole-claimant check at the call site and **withhold the destructive half** when it fails (log loudly, report it on the result) - do not rely on the id-generation convention alone. Reuse `IEntityClaimService.findRivalClaimants` (`@openlinker/core/integrations`): it reads the claimants via `getExternalIds` and narrows them to connections that actually have the writing capability enabled, short-circuiting before the connection listing in the common single-claimant case.
**Applies to**: any connection-blind sweep over `identifier_mappings`-derived internal ids - today `libs/core/src/products/application/services/master-product-sync.service.ts`, `libs/core/src/inventory/application/services/master-inventory-sync.service.ts`.
**Source**: #1904 (found reviewing PR #1903 / #1688); guard shipped with `EntityClaimService`.

## Re-prefix every generated migration timestamp to the synthetic sequence before committing

**Context**: `migration:generate` names files with a real `Date.now()` millisecond prefix; the repo's migrations use synthetic sequential prefixes (`17XX000000000` + small offsets).
**Problem**: A real epoch prefix can sort into the *middle* of merged history (PR #881's `1779985594755-AddShipmentCarrier.ts` sorted before the migration creating the `shipments` table), so fresh-database `migration:run` fails with `relation … does not exist` while incremental dev DBs keep working — the break stays invisible until someone installs from scratch.
**Rule**: After generating a migration, bump its filename prefix to the next free synthetic timestamp greater than every migration on `main` (current tail + 1 step) and update the class suffix to match. `scripts/check-migration-timestamps.mjs` now fails lint on any new file that sorts at or below `origin/main`'s max.
**Applies to**: `apps/api/src/migrations/`, plugin migration dirs in `scripts/plugin-migration-dirs.json`.
**Source**: #1013 (escaped via PR #881); fix migration `1802000000000-add-shipment-carrier.ts`.

## A `check:invariants` guard that shells out to `git` must tolerate the self-hosted runner having NO git binary, and distinguish git-absent from ref-missing

**Context**: `scripts/check-migration-timestamps.mjs`'s ordering invariant (#1013) derives its baseline from `git ls-tree origin/main`, degrading to a skip when the command fails.
**Problem**: Two layered gotchas. (1) `actions/checkout@v4` shallow-fetches only the triggering ref, so `refs/remotes/origin/main` is absent on `pull_request` builds. (2) **The self-hosted runner has no `git` binary on the `run`-step PATH at all** — `actions/checkout` silently uses its tarball/API fallback, so even `git ls-tree` (and a naive `git fetch` step) fail with `git: command not found` (exit 127). A first fix that added a bare `git fetch origin/main` step + a `CI=true` hard-fail-on-missing-ref turned a green-but-skipping CI **red** on every PR (the fetch 127'd; the hard-fail would have blocked all PRs once git was absent).
**Rule**: For any CI step / invariant that shells out to git on a self-hosted runner: (a) **guard `git` invocations on `command -v git`** so a missing binary degrades gracefully instead of exit-127-failing the job; (b) in the guard, **distinguish git-absent (exit 127 / `ENOENT`) → skip even in CI** (the runner can't support the check — an environment limitation, not a per-PR failure) **from git-present-but-ref-missing (exit 128) → hard-fail in CI** (a fixable workflow misconfig); (c) pair the git-capable path with an explicit `git fetch --no-tags --depth=1 origin +refs/heads/main:refs/remotes/origin/main` (forced refspec, tolerates reused workspaces). Full CI enforcement of git-history-dependent guards is gated on a git-capable runner (#662/#557).
**Applies to**: `scripts/check-*.mjs` guards that shell out to git; the `lint` job in `.github/workflows/ci.yml`.
**Source**: #1020 (reviewer-caught on PR #1015; git-absence surfaced on the live CI run).

## Create destination PrestaShop orders via `validateOrder`, never the raw webservice `POST /orders`

**Context**: Creating marketplace orders on a destination PrestaShop shop.
**Problem**: `POST /orders` over the PrestaShop webservice bypasses `PaymentModule::validateOrder` — it drops the posted carrier and re-resolves shipping to the cheapest *available* option (a free click-&-collect can win), corrupting the order's carrier and totals.
**Rule**: Create destination orders through PrestaShop's canonical `PaymentModule::validateOrder`, invoked via the OpenLinker module's HMAC-authed `importorder` endpoint. This requires the OL PrestaShop module to be installed on the destination shop. Do not "fix up" the carrier with a post-create `PUT` — it is rejected.
**Applies to**: PrestaShop order-processor adapter; destination order creation in `libs/integrations/prestashop`.
**Source**: ADR-016 (`docs/architecture/adrs/016-prestashop-order-create-via-validateorder.md`), PR #916.

## Rebuild `libs` dist after pulling/merging main, before type-check or commit

**Context**: Cross-package TypeScript resolves `@openlinker/*` against each library's built `dist`, not its source.
**Problem**: After pulling or merging `main`, stale `dist` output makes `pnpm type-check` (and the pre-commit hook) fail in ways that look like a merge defect but are just stale artifacts.
**Rule**: After pulling/merging `main`, rebuild the libraries before type-checking or committing: `pnpm -r --filter "./libs/**" build` (this is exactly what the root `type-check` and `test:ci` scripts do first).
**Applies to**: any session that pulls main mid-work; pre-commit hook failures referencing `@openlinker/*` types.
**Source**: root `package.json` `type-check` / `test:ci` scripts.

## FE Zod schemas over OL snapshots must use `.nullish()`, not `.optional()`

**Context**: OpenLinker serialises absent optional fields in persisted snapshots as JSON `null` (not omitted).
**Problem**: A frontend Zod schema using `.optional()` rejects an explicit `null`, so one null sub-field fails validation for the whole section and the cell/section renders blank.
**Rule**: When a FE Zod schema models an OL snapshot, use `.nullish()` (accepts `null` and `undefined`) for every optional field, not `.optional()`.
**Applies to**: `apps/web/src` Zod schemas that parse backend snapshot payloads.
**Source**: PR #941.

## Worker integration specs are not covered by the lint / type-check gate

**Context**: `apps/worker/tsconfig.build.json` excludes `test` (and `**/*.spec.ts` / `**/*.test.ts`); the root `type-check` and `lint` don't compile `apps/worker/test`.
**Problem**: Worker `*.int-spec.ts` files are only compile-checked by ts-jest at integration-test runtime, so a broken worker int-spec slips past `pnpm lint` + `pnpm type-check` and isn't caught until the integration suite runs (and may not run in CI).
**Rule**: After changing worker integration specs, run them explicitly with the integration suite — do not assume the standard quality gate covers them.
**Applies to**: `apps/worker/test/**/*.int-spec.ts`.
**Source**: `apps/worker/tsconfig.build.json`.

## Allegro shipping label PDF is `POST /shipment-management/label` — not the protocol/handover endpoint

**Context**: Generating Allegro shipping artifacts.
**Problem**: A label is not the same as a handover protocol / manifest; using the protocol endpoint returns the wrong document, and the shipping HTTP clients lacked a binary-response path.
**Rule**: Download the label PDF via `POST /shipment-management/label`; keep label and protocol/handover-manifest endpoints distinct, and ensure the HTTP client supports binary responses.
**Applies to**: `libs/integrations/allegro/src/infrastructure/adapters/allegro-delivery-shipping.adapter.ts` and the Allegro HTTP client interface.
**Source**: Allegro shipping adapter implementation.

## PS module PHP fatal errors surface as opaque `testPingTriggered=false` — debug via Apache logs, not OL logs

**Context**: Configuring webhooks on a PrestaShop connection via "Re-configure webhooks" in the OL UI.
**Problem**: `ping.php` called `EventIdGenerator::generate()`, a method that does not exist — only `EventIdGenerator::generateEventId(provider, connectionId, eventType, objectType, externalId, occurredAt)` exists. PHP threw a fatal `Error` (not `Exception`), bypassed all `catch (Exception $e)` blocks, and Apache returned HTTP 500. OL's `firePing()` saw `res.ok = false` and set `testPingTriggered: false`. There is no OL-side log of the failing request — the error is entirely inside the PS module PHP process.
**Rule**: When debugging `testPingTriggered=false` after webhook install, **first check Apache error logs** inside the PS container (`docker compose exec prestashop tail -50 /var/log/apache2/error.log`) before investigating the OL side. A PHP `Fatal error: Call to undefined method` (or any other fatal) shows up there, not in NestJS logs. When writing PS module front controllers, prefer `catch (\Throwable $e)` over `catch (Exception $e)` to also catch PHP `Error` subclasses and return a structured 5xx rather than letting Apache serve a blank 500.
**Applies to**: `apps/prestashop-module/openlinker/controllers/front/`, `apps/prestashop-module/openlinker/classes/EventIdGenerator.php`.
**Source**: Discovered during local webhook setup; fixed in `apps/prestashop-module/openlinker/controllers/front/ping.php`.

## Allegro buyer-placed time is `lineItems[].boughtAt`, not a top-level checkout-form field

**Context**: Capturing the buyer-placed timestamp from an Allegro order.
**Problem**: There is no top-level checkout-form `placed`/`created` timestamp; an `AllegroCheckoutForm.createdAt` field would be fictional.
**Rule**: Read the buyer-placed time from `lineItems[].boughtAt`. The PrestaShop equivalent is `date_add`.
**Applies to**: `libs/integrations/allegro/src/infrastructure/adapters/allegro-order-source.adapter.ts`; `libs/core/src/orders/domain/types/incoming-order.types.ts`.
**Source**: Allegro order-source adapter.

## A credentials/config payload shape shared by FE, shape validator, and adapter factory needs one cross-layer test — per-layer green suites can all pass against divergent assumed shapes

**Context**: KSeF connection create: the FE wizard sent `credentials: { authType, secret }` while the BE shape validator and adapter factory expected `{ authType, secretRef }` plus a second nested credentials lookup — every wizard-created KSeF connection failed at create with a 400.
**Problem**: Each layer had green unit tests against its *own assumed* payload shape, so the contract drift between FE payload, credentials-shape validator, and adapter factory went unnoticed until a live end-to-end attempt. Nothing type-checks across the FE/BE wire boundary, and the validator + factory each hand-roll their expected shape independently.
**Rule**: When a wire payload shape (credentials, connection config) is consumed by more than one layer, add at least one test that drives the real FE-produced payload through the BE validator and adapter factory together (or assert all layers against a single shared fixture) — do not rely on per-layer specs that each construct their own payload.
**Applies to**: connection credentials/config shape validators (`plugin.register` validators), adapter factories in `libs/integrations/**`, FE connection-wizard schemas in `apps/web/src/features/connections/`.
**Source**: #1318 / PR #1319.

## `@modelcontextprotocol/sdk` is the **v1** line — SDK v2 ships as a scoped package family

**Context**: Checking whether the MCP TypeScript SDK v2 had shipped, as #1486's acceptance criteria required.
**Problem**: `npm view @modelcontextprotocol/sdk` reports `latest: 1.30.0` with no `2.x` version and no v2 prerelease, which reads as "v2 has not been released". It has — v2 shipped 2026-07-27 as a **scoped package family** under new names (`@modelcontextprotocol/core`, `/server`, `/client`, `/express`, `/node`, `/hono`, `/fastify`, `/server-legacy`, `/codemod`, all `2.0.0`). The old package name was left on the v1 line. Concluding "not released" from the v1 name would have wrongly parked the whole issue.
**Rule**: When a dependency's major version appears missing, check the **GitHub releases page and the org's other package names**, not just `npm view <old-name>`. A monorepo SDK that splits packages at a major bump will leave the original name frozen on the previous line.
**Applies to**: any `@modelcontextprotocol/*` dependency decision; dependency-availability checks generally.
**Source**: #1486.

## Verify a new SDK's API against its installed `.d.ts`, never a fetched doc summary

**Context**: Planning the MCP transport wiring against a two-day-old SDK.
**Problem**: A web-fetched summary of the SDK docs produced `createExpressHandler(server)` — a function that **does not exist** in `@modelcontextprotocol/express@2.0.0`. A plan and a set of design decisions were built on it before the package was installed and its `index.d.cts` read. The real surface is `createMcpExpressApp` / `requireBearerAuth` / `toNodeHandler`. The SDK's own prose also referred to `ctx.http.authInfo` while its types declare `McpRequestContext.authInfo` — so even first-party documentation disagreed with the shipped types.
**Rule**: For any newly-adopted or recently-majored dependency, `npm install` it into a scratch directory and read the shipped `.d.ts`/`.d.cts` **before** committing to an API in a plan or a diff. Treat doc prose (including the vendor's own) as a hint, and the type declarations as the contract.
**Applies to**: adopting or major-upgrading any external SDK; `libs/integrations/**`, `apps/api/src/mcp/`.
**Source**: #1486.

## A service in `apps/**` may not inject a core `*RepositoryPort` — put the service in the owning context instead

**Context**: Placing the MCP-token mint/verify service, following the `RefreshTokenService` precedent (`apps/api/src/auth/` over a `libs/core/src/users/` repository port).
**Problem**: That precedent passes `check-cross-context-imports` **only because it is grandfathered** in the script's `ALLOW_LIST` (tracked tech debt, #718/#722). Copying it for greenfield code fails `pnpm lint` on the first commit, and "fixing" it by adding new ALLOW_LIST entries grows a list that exists to shrink.
**Rule**: Cross-context callers go through an `I*Service` + Symbol token, never a `*RepositoryPort`. If a new service needs a core context's repository, put the **service** in that context (`libs/core/src/<ctx>/application/services/`) and export its interface. Bonus: `check-service-interfaces` only scans `libs/core`, so the `I*Service` rule becomes machine-enforced rather than merely conventional.
**Applies to**: any new service in `apps/{api,worker}` that needs core persistence; `scripts/check-cross-context-imports.mjs`.
**Source**: #1486 (`/pre-implement` gate caught it pre-code).

## Integration-test schema is built by `synchronize`, not migrations — migration-only FKs don't exist there

**Context**: Asserting that deleting a user cascade-deletes their MCP tokens.
**Problem**: The assertion failed: the row survived. The FK is declared in the migration (`REFERENCES users(id) ON DELETE CASCADE`) but the ORM entity carries only a plain `user_id` column, and `apps/api/test/integration/setup.ts` builds its schema with `synchronize` — so migration-only constraints are absent from the test database. `setup.ts` already documents this for `connection_carrier_mappings` and `fulfillment_routing_rules`.
**Rule**: Don't assert migration-only DDL (FKs, cascades, check constraints) in an int-spec — it can't be there. Assert the **behaviour** the constraint backs instead (e.g. an orphaned credential still fails authentication), and add the table to `setup.ts`'s truncate list explicitly, since there is no FK for `users` to cascade from and rows will otherwise leak between cases.
**Applies to**: `apps/api/test/integration/**`, any table whose FKs live only in a migration.
**Source**: #1486.
## Default a response DTO's redaction flag to REDACTED, never to "show it"

**Context**: `ShipmentResponseDto.fromDomain(shipment, customerId, canWrite)` gates the raw carrier `errorMessage` (which can embed a rejected address fragment) on the requester holding `shipments:write` (#1826).
**Problem**: `canWrite` was declared `canWrite = true` so the command endpoints could omit it. That makes the *failure mode of forgetting the argument* a silent data disclosure: a new read endpoint that doesn't thread `@CurrentUser()` through compiles clean and serves the unredacted field to every role. The same trap applies to the error path - the carrier-rejection 502 body carried the same provider text with no gate at all, so a route without `@Roles` (label download, deliberately open to viewers) leaked what the persisted field withheld.
**Rule**: Make a security-relevant redaction parameter **required and un-defaulted** so a new call site cannot compile without deciding, and pass it explicitly (`true` with a one-line "this route is `@Roles`-gated" comment) at the sites that don't need redaction. If a default is unavoidable, default to redacted. Then sweep every *other* surface that carries the same text - error bodies included - not just the persisted field.
**Applies to**: `apps/api/src/shipping/http/dto/shipment-response.dto.ts`, `apps/api/src/shipping/http/shipment.controller.ts` (`toHttpException`); any response DTO with a role-gated field.
**Source**: #1826 review round (PR #1905).

## A hand-copied FE/BE literal union needs a `check:invariants` guard, not a "keep in sync" comment

**Context**: `PermissionValues` exists twice - authoritative in `libs/core/src/users/domain/types/role.types.ts`, hand-mirrored in `apps/web/src/shared/auth/session.types.ts` (the browser bundle can't import `@openlinker/core`).
**Problem**: The mirror carried only a prose "keep the two in sync" comment. Drift is silent in both directions: a permission added only to core never reaches `usePermission`, and one added only to the FE type-checks against a `permissions[]` array the API will never populate. A prior analysis had already recorded the risk and nothing enforced it.
**Rule**: When a union of string literals must be duplicated across the FE/BE boundary, add a textual-parse invariant script (`scripts/check-*-mirror.mjs`, no TS import, `--self-check` for the pure differ) and chain it into `check:invariants` - the same shape as `check-service-interfaces.mjs`. A comment is not enforcement.
**Applies to**: `scripts/check-permission-mirror.mjs`; any future FE/BE mirrored `as const` vocabulary.
**Source**: #1826 review round (PR #1905).
## An upsert overlay must not assign a lifecycle-state column unconditionally when two decoupled writers share the row

**Context**: `webhook_deliveries` is stamped by the ingress API (`received`, then `published` after the stream publish) and, independently, by the stream consumer that reads that publish (`job_enqueued` / `deadlettered`). Both go through the same `INSERT ... ON CONFLICT DO UPDATE`, whose set-list is built from the caller-supplied overlay columns.
**Problem**: `"status" = EXCLUDED."status"` makes the *last* write win, and the consumer routinely wins the stream read before the API's follow-up write lands. So `published` overwrote `job_enqueued`, producing rows that claim `published` while carrying a `downstreamJobId` - and a `main` pipeline that went red on the #1511 drain assertion whenever the coin landed that way. Note the shape of the trap: the write that got lost was *not* the racy-looking one, and both callers were individually correct.
**Rule**: When a column encodes lifecycle progression and more than one process upserts the row, resolve the conflict by an explicit precedence ladder in SQL (`CASE WHEN rank(EXCLUDED) >= rank(current) THEN EXCLUDED ELSE current END`) rather than by arrival order, and keep the rank map beside the status union so the two cannot drift. Do not "fix" it by reordering the callers - they are deliberately decoupled, and neither can reason about the other's timing. Prove it with an integration test: the guard lives in SQL, so a mocked repository cannot exercise it.
**Applies to**: repository upserts over a status/lifecycle column with more than one writer - today `webhook_deliveries` (`libs/core/src/webhooks/infrastructure/persistence/repositories/webhook-delivery.repository.ts`); the same shape would apply to any future `*_snapshots` or delivery-audit table written from both an ingress and a consumer path.
**Source**: #1916 (CI run 30435342214).

## Profile the test harness before optimising a "slow suite" - the cost is usually per-test or per-teardown plumbing, not the test

**Context**: The `Integration Tests` job took ~18.5 min. Four hypotheses looked obvious: a slow spec (`order-reingestion-echo-guard`, 37 s), TypeORM `synchronize` running on every app boot, `TRUNCATE ... CASCADE` fan-out, and Postgres durability settings.
**Problem**: All four were wrong, and each would have cost a day. Measured instead: `synchronize` on an already-synced schema is **73 ms**; the 37 s "slow spec" runs in **6.4 s** warm and **76.3 s** cold, i.e. it was the run's first file absorbing the one-time ts-jest transform; `CASCADE` is irrelevant (the schema has **4** foreign keys); `fsync=off` + friends changed nothing and passing them via `withCommand` made a sample run *worse*. The real costs were a hardcoded `setTimeout(2000)` in a consumer's `onModuleDestroy` (paid on all 77 int-spec teardowns) and `TRUNCATE` costing ~10 ms per table **even when the table is empty**, times 18 tables, times 485 tests.
**Rule**: Before optimising an integration suite, instrument the harness phases (boot, per-test reset, teardown) and the suite ordering, and measure each candidate in isolation with a revert in between. Numbers first: a plausible mechanism that is real (`quit()` does queue behind an in-flight blocking read) can still be the wrong explanation for where the time goes. Watch specifically for (a) fixed sleeps in shutdown hooks, (b) per-test cleanup that scales with the schema rather than with what the test touched, (c) the first suite of a run absorbing cold-compile cost and looking like a slow test.
**Applies to**: `libs/test-kit/src/harness.ts`, `apps/{api,worker}/test/jest-integration.cjs`, any `onModuleDestroy` on a long-lived consumer loop.
**Source**: #1920 (four refuted hypotheses recorded in that issue's Verification log).

## An "authenticates" assertion is not a "works" assertion — assert a successful call, not just the absence of 401

**Context**: Phase 0 (#1486) shipped one MCP tool, `whoami`, reading the principal from `ctx.authInfo`. Its int-spec asserted the minted token was accepted by `/mcp` via `.expect(res => { if (res.status === 401 || res.status === 403) throw ... })`.
**Problem**: That assertion passes on a 400. `whoami` was in fact broken end-to-end: the principal lives on the **request-scoped** `McpRequestContext` handed to the server *factory*, and NOT on the context the SDK passes a tool callback at dispatch time — so every real `whoami` call would have returned "No OpenLinker principal on this request." Nothing caught it for a full phase, because the only test of the path asserted a negative (not-401) rather than the positive (a parseable result). #1487's first genuine `tools/call` surfaced it immediately.
**Rule**: When a slice's whole purpose is "X now works end-to-end", assert the SUCCESS shape — parse the response body and check a field. A not-an-error assertion is a placeholder, and it will keep passing while the feature rots. Corollary for the MCP SDK specifically: thread the factory's `ctx` into anything a tool handler needs; treat the dispatch-time context as carrying no auth.
**Applies to**: `apps/api/src/mcp/transport/mcp-server.factory.ts`, `apps/api/src/mcp/tools/tool-registry.service.ts`, any int-spec whose only assertion is a status-code exclusion.
**Source**: #1487.

## MCP protocol revision 2026-07-28 requires a per-request envelope + agreeing headers — a missing one looks like an auth/routing 400

**Context**: Hand-rolling JSON-RPC calls against `/mcp` in an int-spec (supertest, no MCP client library).
**Problem**: Every call 400'd. The revision named in `MCP-Protocol-Version` carries the handshake **on every request** (which is what makes OL's stateless, session-free serving legal per ADR-033), and enforces header/body agreement. Three separate omissions each produced a bare HTTP 400 that read like a bad token or a dead route: (1) `params._meta` absent; (2) `_meta` present but missing `io.modelcontextprotocol/protocolVersion` + `io.modelcontextprotocol/clientCapabilities`; (3) the `Mcp-Method` header absent, and for `tools/call` also `Mcp-Name` — both must match the body so an intermediary can route without parsing the payload. The SDK's error *bodies* name the missing key precisely; the status code alone tells you nothing.
**Rule**: When an MCP request 400s, read the JSON-RPC `error.message` in the response body before suspecting auth or routing — the SDK says exactly which envelope key or header is missing. Build the request helper once, with `_meta` + `Mcp-Method` (+ `Mcp-Name`) derived from the call, rather than per test.
**Applies to**: `apps/api/test/integration/mcp-tools.int-spec.ts`; any hand-rolled MCP JSON-RPC caller.
**Source**: #1487.

## `--testPathPattern` is silently ignored when a Jest config sets `testRegex` — use `--testRegex` to run one int-spec

**Context**: Iterating on a single `*.int-spec.ts` in `apps/api`, where `test/jest-integration.cjs` sets `testRegex: 'test/integration/.*\\.int-spec\\.ts$'`.
**Problem**: `--testPathPattern=mcp` and a positional `"mcp-"` both ran the ENTIRE integration suite — including the PrestaShop/MySQL container specs, so each "targeted" iteration cost ~15 minutes and booted containers that exhaust Docker. `--listTests` confirms it: the filter is dropped, not narrowed. This is the mechanism behind the older note that `test:integration -- <pattern>` doesn't filter.
**Rule**: To run one int-spec in this repo, override the config's own key: `pnpm --filter @openlinker/api exec jest --config test/jest-integration.cjs --testRegex="<file>\\.int-spec\\.ts$"`. Verify with `--listTests` before the real run — it is instant and proves the filter took.
**Applies to**: `apps/api/test/jest-integration.cjs`, `apps/worker/test/jest-integration.cjs`.
**Source**: #1487.

## A new feature's premise about an existing code path must be verified against that path's *entry point*, not against the layer it names

**Context**: #1837 added a pre-flight "already listed" confirm whose marketplace copy promised "creates a duplicate offer / Publish anyway", justified by `OfferCreationExecutionService` calling `createOffer` unconditionally. #1741 had, five days earlier, added `BulkListingSubmitService.filterAlreadyListed` - an intake guard that silently drops already-listed variants before any job is enqueued.
**Problem**: Both statements were true of the layer each named, and the premise was still false end-to-end: on the wizard path (the only FE entry point since #1754) the intake guard runs first, so confirming "Publish anyway (creates duplicate)" produced no duplicate. When *every* selected variant was already listed the empty post-filter list surfaced as the generic `EmptyBulkSubmissionException` ("requires at least one productId"), telling an operator who had just confirmed a real selection that they had submitted nothing. `docs/architecture-overview.md` meanwhile asserted the confirm was "a warning only - never a hard block" while the backend hard-excluded, and nothing reconciled the two.
**Rule**: When a feature's justification is a claim about existing behaviour ("X always happens, so warn about it"), trace the claim from the **caller the feature actually sits in front of** down to the layer that performs it, and check for guards added in between - especially for sibling features shipping in parallel under one epic. Then make the tree consistent in one pass: code, FE copy, and the `architecture-overview.md` bullet that states the guarantee. A doc bullet describing operator-visible semantics is part of the contract, not commentary.
**Applies to**: `libs/core/src/listings/application/services/bulk-listing-submit.service.ts`, `apps/web/src/features/listings/components/duplicate-guard-modal.tsx`, `docs/architecture-overview.md` §Listings; any pre-flight warning UI fronting a guarded pipeline.
**Source**: #1933 (PR #1935); premise introduced by #1837 (PR #1857) against #1741 (PR #1757).

## A gating primitive built for write affordances does not gate content — check which policy demo mode needs before reusing it

**Context**: `useWriteAccess` + `ReadOnlyLock` (#1615) were the only access primitives in `apps/web`, used at ~113 sites. `ConnectionCapabilitiesPanel` rendered an operator-facing hint ("MCP tools follow these capabilities — an already-connected agent must reconnect to see a change") with no identity check at all.
**Problem**: The existing primitive deliberately *shows* a disabled control to a demo viewer, to advertise that the capability exists. Applied to informational content that policy is backwards, so nobody applied it — and the content shipped ungated instead. A public-demo viewer holding `connections:read` alone was told to reconnect an agent it cannot have, over a toggle it cannot operate. A wider sweep then found the same omission across the app: 40 sites where a read-only session can trigger a real write, plus 26 identity-driven content decisions, reachable from only 22 helper-hook calls and 13 inline `role === 'admin'` comparisons. The primitive existing was not the same as the primitive fitting.
**Rule**: Before reusing an access primitive, ask what it should do in **demo mode** for the thing you are gating: a write affordance renders disabled (advertise), content does not render (avoid misleading). Content uses `AccessGate` (`shared/ui/access-gate.tsx`), affordances use `useWriteAccess` + `ReadOnlyLock`, and non-subtree decisions use `usePermission`. Never compare `session.user?.role` inline — it is typed `string`, so a typo compiles and returns false. Keep the session-hydration guard (`isReady` ⇒ render neither branch) inside the primitive; spelled per call site it was present at 2 of 13 sites.
**Applies to**: `apps/web/src/shared/ui/access-gate.tsx`, `apps/web/src/shared/ui/read-only-lock.tsx`, `apps/web/src/shared/auth/use-permission.ts`; any new identity-driven visibility decision in `apps/web`. Rule sheet: `.claude/rules/frontend.md` § Access control; rationale: `docs/frontend-architecture.md` § Access Control And UI Visibility.
**Source**: #1993; the write-affordance policy it contrasts with is #1615.

## `renderWithProviders` defaults to an ANONYMOUS session — a test that asserts permission-gated UI must pass its own session adapter

**Context**: #1993 moved an informational alert behind `AccessGate require="connections:write"`. Three pre-existing tests in `ConnectionCapabilitiesPanel.test.tsx` asserted that alert with plain `renderWithProviders(<Panel …/>)`.
**Problem**: `renderWithProviders` defaults `sessionAdapter` to `createNoopSessionAdapter()` (`apps/web/src/test/test-utils.tsx`), which returns `ANONYMOUS_SESSION` — `user: null`, so `usePermission` is false for **every** permission. `DEFAULT_TEST_USER` (which does carry all of `PermissionValues`) applies only when a test explicitly calls `createAuthenticatedSessionAdapter()`. The gated alert therefore never rendered, and the failure read as a *timing* problem — the gate also defers until `useSession().isReady`, so a first, wrong fix swapped `getByText` for `await findByText` and CI failed identically. Worse in the other direction: the suite's **negative** assertion ("hint absent when no capability backs an MCP tool") kept passing under the anonymous default while proving nothing, since the hint was absent for a reason unrelated to what it claimed to test.
**Rule**: When gating existing UI on a permission, pass an explicit `sessionAdapter: createAuthenticatedSessionAdapter({ …, permissions: [...] })` to every test that asserts the gated element is **present** — and to every test that asserts it is **absent**, so the absence is attributable to the condition under test rather than to a missing permission. Add one deliberate anonymous-session case so the others cannot silently revert to the default and keep passing. When a permission-gated assertion fails, check the session the test actually renders with **before** reaching for `await`/`waitFor`; `findByText` on something that will never appear looks exactly like a race.
**Applies to**: `apps/web/src/test/test-utils.tsx` (`renderWithProviders`, `createAuthenticatedSessionAdapter`); any `*.test.tsx` asserting UI behind `AccessGate`, `usePermission`, or `useWriteAccess`.
**Source**: #1993 (cost two red CI runs before the cause was read correctly).

## A boot-time singleton must resolve `globalThis.fetch` per call, or it silently escapes an integration test's `global.fetch` stub to the real network

**Context**: #1810 routed every plugin's outbound HTTP through the `@Global()` `HttpTransportFactory`; #1972 migrated the DPD plugin onto it. `HttpTransportFactory`'s constructor captured its default transport as `globalThis.fetch.bind(globalThis)`.
**Problem**: `dpd-tracking.int-spec.ts` stubs `global.fetch`, then resolves the adapter through real DI — the pre-#1972 clients read `globalThis.fetch` at *client construction*, which happens after the stub is installed, so the stub took. Routing through the factory moved that read to *app boot*, before the stub existed: the SOAP call left the CI runner and hit the real `dpdinfoservicesdemo.dpd.com.pl`, which answered with a genuine `Access denied to secured webservice method` fault. The test failed with a plausible-looking auth error rather than anything pointing at the stub being bypassed.
**Rule**: A process-wide singleton that defaults to a global (`fetch`, `Date`, `crypto`) must read it inside the call, not in the constructor — `(input, init) => globalThis.fetch(input, init)`, which also keeps the receiver an explicit `bind` was there for. When migrating a plugin client onto a shared transport, re-run the int-specs that stub `global.fetch`: an escaped call surfaces as a *remote* error, not as a missing-mock error.
**Applies to**: `libs/shared/src/http/http-transport-factory.ts`; any plugin client migrating onto `HttpTransportFactoryPort.forConnection`.
**Source**: #1972 (CI run 31015159797).
## Read attempt 1 before concluding a CI failure was spurious

**Context**: the `Build` job failed on PR #2007 (run `31081388177`), was re-run with zero code change, and passed.
**Problem**: the GitHub API returns only the **latest** attempt, so `/actions/runs/{id}/jobs` showed the green attempt 2 and the failure vanished from every default view — the PR page, `gh run view`, `gh pr checks`. Two independent investigations of that run therefore concluded "nothing was broken". The failure was a real, reproducible race in the build graph (`libs/core` and `libs/shared` in the same `pnpm -r` chunk, two `tsc -b` processes emitting into one `dist/`), which #2011 then fixed. Attempt 2 had run the *identical* four-package chunk — it just won the interleaving. The rate was 1 in 40 runs, which is the worst case: rare enough to read as "CI is moody, hit re-run", frequent enough to keep costing time.
**Rule**: when a re-run turns a job green, fetch the earlier attempt explicitly — `gh api "repos/{owner}/{repo}/actions/runs/{id}/attempts/1/jobs"` — and read the failing job's log by its own job id (`gh api repos/{owner}/{repo}/actions/jobs/{jobId}/logs`). A green re-run is evidence about scheduling, not about correctness. Before re-running a red job a second time, check whether the same job also runs a `pnpm -r <script>` whose chunk composition could differ between attempts.
**Applies to**: any investigation of a "flaky" CI failure; `gh api /actions/runs/**`; `pnpm -r` build ordering.
**Source**: #2011 (CI run `31081388177`, attempt-1 job `92550857312`).

## Redis `PX`/`PEXPIRE` take milliseconds — a TTL floor typed in seconds and passed through unconverted silently truncates

**Context**: `RedisRateLimiterAdapter`'s pace-key Lua scripts CAS-advance a "next-available-at" timestamp and set its TTL to `max(a seconds-typed floor, time-until-the-stored-timestamp)`.
**Problem**: An earlier draft passed the seconds-typed floor straight into `SET key val PX <floor>` — `PX` expects milliseconds, so the key expired ~1000x sooner than intended (a few seconds instead of the intended one-hour floor) regardless of how far in the future the stored timestamp was. This silently discarded almost every `noteRetryAfter` backoff (and any real pacing interval) almost immediately after it was set, with no error anywhere — the key just quietly vanished early.
**Rule**: When a TTL constant is expressed in one unit (seconds, for readability/config) but the Redis command it feeds expects another (`PX` = ms, `EXPIRE` = seconds), convert at the call site and compute the actual TTL from the value it must outlive (`max(floorMs, timestamp - now)`), never from the fixed floor alone. A fixed floor by itself silently truncates any stored value larger than the floor.
**Applies to**: `libs/shared/src/rate-limit/redis-rate-limiter.adapter.ts` (`PACE_ADMIT_SCRIPT` / `PACE_ADVANCE_SCRIPT` / `CONCURRENCY_CLAIM_SCRIPT`); any future Lua script setting a Redis TTL from a config-shaped duration.
**Source**: #2015 (found while drafting the pace-key TTL logic, pinned by a regression test before merge).

## A test's happy path must not depend on a self-heal/eviction window at or above the test framework's own default timeout

**Context**: `rate-limit-redis-cross-process.int-spec.ts`'s original `maxConcurrent` cross-process test awaited four `acquire()` calls via one `Promise.all` with no `release()` in between — the 3rd/4th call could only ever admit via the inflight ZSET's orphan self-heal (`MAX_CALL_LIFETIME_MS`, then 120s).
**Problem**: `MAX_CALL_LIFETIME_MS` sat at exactly Jest's default 120000ms per-test timeout — the test's only path to success (the self-heal) and its own failure clock (Jest's timeout) were racing each other with no margin, so it failed CI reliably (CI run 31472849426). The fix was two-fold: rewrite the test to drive the state transition explicitly via a real `release()` rather than waiting out an eviction window, AND decouple the two constants (`MAX_CALL_LIFETIME_MS` moved to 300s) so they can never coincide again by construction.
**Rule**: Never let a test's happy path depend on a background self-heal/eviction/orphan-timeout window — drive the state transition explicitly (call the release/complete/cancel path yourself) instead of waiting for time to pass. Separately, audit any two "looks unrelated" duration constants that happen to share a numeric value (here `MAX_CALL_LIFETIME_MS` and `MAX_TOTAL_WAIT_MS`, both 120000) — an accidental equality between two constants that bound different things is exactly the kind of coincidence that turns into exactly this bug the next time either one is tuned.
**Applies to**: `apps/api/test/integration/rate-limit-redis-cross-process.int-spec.ts`; any int-spec whose assertion path relies on a TTL/eviction window rather than an explicit state change.
**Source**: #2015 (CI run 31472849426).

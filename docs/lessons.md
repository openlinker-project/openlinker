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

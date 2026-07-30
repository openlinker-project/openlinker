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

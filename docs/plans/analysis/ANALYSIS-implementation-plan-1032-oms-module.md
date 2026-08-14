# Readiness Analysis — implementation-plan-1032-oms-module

**Gate:** `/pre-implement` (read-only)
**Date:** 2026-08-13
**Target:** [`docs/plans/analysis/ANALYSIS-1032-oms-module.md`](./ANALYSIS-1032-oms-module.md), [ADR-039](../../architecture/adrs/039-order-lifecycle-derived-from-fact-ledger.md), [ADR-040](../../architecture/adrs/040-order-changeset-proposed-then-confirmed.md), PR #2066

## Verdict: **NEEDS-REVISION** → *addressed 2026-08-13*

> **Resolution.** Every Critical and Warning below was folded into the plan in the same PR
> (D11/D12 added to § 2; § 4 Placement/naming/schema conventions added; Wave 4 Step 0 added;
> § 6F authorization corrected; § 7 testing strategy added; ADR-039/040 trimmed to the template's
> word budget). A follow-up `/tech-review` additionally flagged that permissions are display-only in
> this codebase — that is D12, and it was the one BLOCKING finding.

Three **Critical** contract findings, all in later waves, all fixable by plan edits rather than
redesign. **No reuse collision** — nothing the plan proposes to build already exists. The Wave 0/1/2
foundation is sound as specified; Waves 4 and 5 carry the Criticals.

Close call against `NEEDS-MAJOR-REVISION`: the three Criticals *are* currently unaddressed contract
breaks. Held at `NEEDS-REVISION` because each is a sequencing or naming correction inside a wave, not
a change to the architecture the ADRs establish.

---

## Reuse findings

| Plan artifact | Verdict | Evidence |
|---|---|---|
| `order_axis_states`, `order_axis_transitions`, `order_pack_events`, `order_stages`, `order_stage_history`, `order_record_items`, `return_requests`, `inventory_reservations` | **NEW** (all 8) | Zero hits across `*.orm-entity.ts` + `apps/api/src/migrations/**`. Orders has exactly one ORM entity — `order-record.orm-entity.ts:37` |
| `OrderAxisLedgerRepositoryPort` | **NEW** | Orders has 3 ports only; `order-record-repository.port.ts` has 11 methods, of which `updateFulfillmentState` / `markCancelled` are the current single-axis writers |
| `OrderLifecycleService` / `IOrderLifecycleService` / `ORDER_LIFECYCLE_SERVICE_TOKEN` | **NEW but colliding** | `OrderLifecycleRelayService` (`order-lifecycle-relay.service.ts:50`), `IOrderLifecycleRelayService`, `ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN` (`orders.tokens.ts:18`) — one word apart, same folder |
| `derive-canonical-lifecycle.ts` | **NEW, consumes existing** | Must consume `deriveSlaState` (`order-sla.ts:22`) and `deriveFulfillmentRollup` (`fulfillment-rollup.ts:39`) rather than re-derive them |
| `warehouse` role | **PARTIAL — prefer reuse** | `operator` already exists (`role.types.ts:20`) and already holds `orders:write` / `shipments:write` |
| Station device token | **PARTIAL — pattern exists** | `mcp_tokens` (`mcp-token.entity.ts:17-48`): opaque prefix + SHA-256 at rest + scopes + revoke + `lastUsedAt`. `McpTokenService` itself is MCP-specific (hardcoded prefix, scope union, RFC 8707 `resource`) |
| PIN / badge identification | **NEW** | Zero hits |
| `requirePackVerification` connection-config key | **NEW key, existing pattern, no migration** | `stockSafetyBuffer` (`connection.types.ts:77`) / `pricingRule` (:85); config is JSONB round-tripped verbatim |
| Delayed job (`schedule({ runAfter })`) | **ALREADY EXISTS** | `sync-jobs.service.ts:36`, `ScheduleJobInput` (`sync-jobs.types.ts:12-25`) |
| Out-of-`AppShell` station route | **ALREADY EXISTS (precedent)** | `/consent` — `router.tsx:32`, `consent-layout.tsx` |

---

## Critical findings

### C1 — Extending `OrderLifecycleEventTypeValues` silently mis-routes (Wave 4)

`OrderLifecycleEventTypeValues = ['dispatched', 'cancelled']`
(`order-lifecycle-event.types.ts:24`). **No consumer uses an exhaustive `switch` with a `never`
default** — all five are two-branch `if/else`:

| Consumer | Behaviour on a new `returned` value |
|---|---|
| `order-lifecycle-relay.service.ts:122-130` | rewritten as `cancelled` |
| `allegro-order-source.adapter.ts:104-118` | cancelled branch |
| **`erli-order-source.adapter.ts:525-547`** | **dispatched branch — writes status `sent`** |
| `woocommerce-order-processor.adapter.ts:281-300` | cancelled branch |
| `prestashop-order-processor-manager.adapter.ts:791-812` | cancelled branch |

Adding `returned` compiles cleanly everywhere and mis-routes at runtime; a returned order would be
reported to Erli as shipped.

**Required plan change:** add a Wave-4 step 0 — convert all five consumers to exhaustive handling
with a `never` default (and update the two test stub helpers) **before** the union is extended.

### C2 — Redefining `totalAvailable` as ATP is a silent semantic break (Wave 5)

`VariantAvailability` is `{ productVariantId, totalAvailable, locationCount }`
(`inventory.types.ts:85-89`); `totalAvailable` is `SUM(availableQuantity)`.

*Adding* `reserved` / `availableToPromise` is safe everywhere (structural typing; the API DTO and the
MCP tool both project explicitly). **Changing what `totalAvailable` means is not**, and produces zero
compile errors and no test failures:

| Consumer | Silent consequence |
|---|---|
| `bulk-listing-submit.service.ts:655` | published marketplace quantities drop by reserved qty |
| `stock-at-risk-read.service.ts:84-97` | the field is surfaced to operators **as `masterStock`**; alert volume changes with no code change |
| `offer-stock-restore.service.ts:111` | contradicts its own header invariant ("master is source of truth") |
| `get-availability.tool.ts:87` | agent-visible semantics change silently |

**Required plan change:** keep `totalAvailable` as raw available and add a **new**
`availableToPromise` field. Precedent in the same file: `ProductStockAggregate`
(`inventory.types.ts:100-105`) already keeps `totalAvailable` and `totalReserved` distinct.

### C3 — Feeding ATP into `applyStockSafetyBuffer` double-subtracts reservations (Wave 5)

`applyStockSafetyBuffer(masterStock, reserve) = max(0, masterStock - reserve)`
(`stock-safety-buffer.types.ts:76`); its contract explicitly says *master stock* (:1-11, :70-75).
Plan item 23 feeds it ATP at all three call sites (`offer-builder.service.ts:250`,
`product-publish-builder.service.ts:153`, `inventory-sync.service.ts:76`), giving
`master − reserved − buffer`.

Operator-visible effect: **listed quantities drop the moment orders are open**, with no config change
and no log line — and items cross the at-risk threshold in `stock-at-risk-read.service.ts:90` earlier.

**Required plan change:** either (a) apply the buffer *before* reservations, or (b) explicitly accept
the double-count and re-document the helper header + `connection.types.ts:74`. The plan currently
implies (b) without saying so.

---

## Warnings

| # | Finding | Suggested path |
|---|---|---|
| W1 | **Naming collision** — `OrderLifecycleService` vs existing `OrderLifecycleRelayService` | Rename to `OrderAxisLedgerService` / `OrderCanonicalStateService` |
| W2 | **Two competing status sources on the API contract** — `order-record-response.dto.ts:113,120` already exposes enum-typed `fulfillmentState` + `slaState` driving list badges/filters | Decide explicitly: additive `canonicalState` (FE has two sources) vs deprecation (breaking). Plan is silent |
| W3 | **`order_stages` vs existing `order_state_mapping`** — the latter is per-destination-connection operator config mapping OL `OrderStatus` → external state id, with full CRUD UI | State whether stages map onto `OrderStatus` (existing table still applies) or become a third axis. Two operator-facing "order state" vocabularies otherwise |
| W4 | **`InventoryMasterPort` method removal** is safe (structural excess is legal; zero non-spec call sites) but requires deleting 2 specs and updating `docs/capabilities.md:29` + `engineering-standards.md` snippets | Sequence doc updates with the removal |
| W5 | **A 4th role is high blast radius** — `RolesGuard` is exact-membership; every `@Roles('admin','operator')` list needs auditing, pinned by `write-guard-coverage.spec.ts` | Prefer extending `operator` + a new permission over a new role |
| W6 | **Station token vs `mcp_tokens` invariant** — `expiresAt` is non-nullable by design | A "never expires" station token contradicts it; copy the pattern into a sibling table, don't extend MCP scopes |
| W7 | **New event stream** needs a MAXLEN entry (`redis-streams-event-publisher.ts`) **and a dedicated blocking Redis client** — two `XREADGROUP` loops cannot share a connection | Follow `events.master.deletion` + `apps/worker/src/events/events.tokens.ts:7-10` |
| W8 | **`SyncJobRequest.connectionId` is non-nullable** (#1943) | A pack job with no natural connection needs a scaffold connection, as `destination.taxonomy.sync` does |
| W9 | **Migrations** must be synthetic-sequential, `≥ 1833000000001`, class-name suffix == filename prefix; ordering vs `origin/main` is a **hard CI failure** | `docs/migrations.md`; guard is `check-migration-timestamps.mjs` |
| W10 | **`OrderAuthorityResolver` in `mappings`** passes the lint guard (symbol-shape only, no cycle detection) but `orders.module.ts:32` already imports `MappingsModule` — a value import back would need `forwardRef` | Keep it type-only + `I*Service` + token, or place it in `orders` |
| W11 | `OrderRecord` has **14 positional constructor params / 33 call sites** | Append new fields with `= null` defaults (0 breaks), or prefer a derived **getter** — the entity already has 6 snapshot-derived getters |

---

## Open questions blocking a clean implementation

1. **W2** — canonical vs existing `fulfillmentState`/`slaState` on the response DTO.
2. **W3** — relationship between `order_stages` and `OrderStatus` / `resolveOrderStateMapping`.
3. **C3** — buffer-before-or-after-reservations is a product decision, not just a code one.
4. Plan §8 items 8–10 (packing slips, no-EAN variants, batch packing) remain unanswered and gate the
   Wave 2 UI.

---

## What is already sound

- All eight proposed tables are genuinely new; no schema collision.
- `SyncJobsService.schedule({ runAfter })` supports the delayed-action requirement as claimed.
- The connection-config flag needs no migration, as claimed.
- The out-of-shell station route has a working precedent (`/consent`).
- Wave 0's justification (three ad-hoc claims → one primitive, plus the lost-cancel bug) is confirmed
  against the code.

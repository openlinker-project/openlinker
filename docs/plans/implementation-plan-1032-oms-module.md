# Implementation Plan — #1032 OMS module

**Parent issue:** #1032 (reopened 2026-08-13)
**Spec:** [`docs/specs/product-spec-1032-order-status-state-machine.md`](../specs/product-spec-1032-order-status-state-machine.md)
**Readiness gate:** [`analysis/ANALYSIS-implementation-plan-1032-oms-module.md`](./analysis/ANALYSIS-implementation-plan-1032-oms-module.md)
**Status:** plan of record. Waves are separately gated — see § 8 Checkpoint.

> Supersedes the scoping in #2064 (closed as duplicate of #1032).
> [ADR-039](../architecture/adrs/039-order-lifecycle-derived-from-fact-ledger.md) and
> [ADR-040](../architecture/adrs/040-order-changeset-proposed-then-confirmed.md) must move from
> `Proposed` to `Accepted` **before** any Wave 0 code merges.

---

## 1. Framing

OpenLinker holds most of an OMS's *data* and none of its *stance*. This program adds the stance:
an OL-owned order lifecycle, the operator workbench that expresses it, and the orchestration that
acts on it.

**Archetype:** operator workbench on an orchestration spine. Not a channel-protocol relay, not an
OMS of record.

**The organising principle:**

> OpenLinker is never the executor. It does not create orders — it ingests them. It does not move
> money. It does not physically ship. Every mutation it performs is a **proposal against a remote
> authority that may decline it**, plus an **observation** of what that authority did.

| Instead of | Do this | Because |
|---|---|---|
| a stored order-status field | a derived projection over recorded facts | three systems report status; none can own it |
| mutating the order | a changeset: proposed → confirmed/declined | the remote may decline; you need audit + preview |
| a status enum per line | quantity counters | "3 of 5 shipped" is not a status |
| one lifecycle enum | independent nullable timestamps | a carrier can report *delivered* before OL saw *shipped* |

**Permanent non-goals** (ADR-014, spec §6.1): payment capture/settlement, accounting/GL, warehouse
mechanics (bins, putaway, cycle counts, slotting), customer master beyond projections.

---

## 2. Settled decisions

| # | Decision | Basis |
|---|---|---|
| D1 | Canonical status is a **derived projection over a fact ledger**, never a stored contested scalar | spec Phase C adversarial review; Vendure's non-monotone `Shipped→PartiallyDelivered` edge is the cost of the alternative; Saleor's recompute is incidentally robust to late events |
| D2 | **Per-line quantity counters** carry fulfilment/return progress; `partially_*` always derived | Medusa `order_item.*_quantity` + its validation ladder |
| D2a | Counters are a projection over an append-only event ledger, **never free-floating** | Bagisto ships these counters without a ledger and has documented drift |
| D3 | **Do not embed Medusa** — steal the model | spike: boots standalone, but 605 packages, a second ORM, a second DI container, and an unresolved Enterprise-Edition carve-out on the mandatory `framework`/`utils`/`types` tier |
| D4 | Rules engine = hand-rolled **versioned condition AST** + the existing `sync_jobs` scheduler | capability-gating and durable delay are ours regardless |
| D5 | **Dry-run is the differentiator**, and nearly free | preview and apply are one replay function. Requires purity: no I/O during evaluation |
| D6 | Returns is a **child aggregate**, not an axis | axis rows are one per order×axis; returns are N per order |
| D7 | Reservations get their **own table**; never overload `inventory_items.reservedQuantity` | that column is a master mirror, rewritten on every sync |
| D8 | Invoice issuance is an **observed** event keyed on the KSeF-returned date | art. 106na — the legal issue date is assigned at transmission |
| D9 | **Invert Medusa's concurrency model**: atomic conditional UPDATE + CHECK constraint | Medusa has zero `FOR UPDATE`, zero CHECK constraints, read-then-write LWW; no surveyed OSS platform does better |
| D10 | Lifecycle facts as **independent nullable timestamps**, not one enum | a single flag cannot carry both "did it happen" and "did we relay it" (#1947) |
| **D11** | **`totalAvailable` keeps its current meaning (raw available). ATP is a NEW field.** | Redefining it is a silent semantic break across 6 consumers with zero compile errors — see § 6 C2 |
| **D12** | **Backend authorization is `@Roles(...)`, not permissions.** Permissions drive UI visibility only | `frontend-architecture.md` § Access Control; `role.types.ts` doc comment — see § 5F |

---

## 3. The core abstraction: the changeset

A change is `PENDING | REQUESTED → CONFIRMED | DECLINED | CANCELED`, carrying `requested_by` /
`confirmed_by` / `declined_reason` and timestamps. Actions are append-only, `ordering`-sequenced,
each with an `applied` boolean. Action types register into an open `{ validate, operation }`
registry. **One replay function produces both the preview and the applied result.**

`applied: boolean` generalises OL's existing at-most-once claims (`waybillRelayedAt`,
`bulk_batch_advancements`). Two corrections to the reference implementation: enforce "one open
change per order" with a **partial unique index** (OL runs concurrent workers), and **cap the
replay window**.

See [ADR-040](../architecture/adrs/040-order-changeset-proposed-then-confirmed.md).

---

## 4. Placement, naming and schema conventions

Binding on every wave. Derived from the readiness gate.

- **Service naming.** The coordinating writer is **`OrderAxisLedgerService`** — *not*
  `OrderLifecycleService`, which is one word from the existing `OrderLifecycleRelayService` in the
  same folder. It implements `IOrderAxisLedgerService` in a sibling `*.service.interface.ts`
  (required by `check-service-interfaces.mjs`) and binds via `ORDER_AXIS_LEDGER_SERVICE_TOKEN` in
  `orders.tokens.ts`.
- **Repository ports stay intra-context.** `OrderAxisLedgerRepositoryPort` must **not** be exported
  from `libs/core/src/orders/index.ts` — `*RepositoryPort` is a denied cross-context symbol shape.
- **ORM entities go on the sub-barrel.** New axis-ledger / pack / stage ORM entities are exported
  from `libs/core/src/orders/orm-entities.ts`, never the main barrel (`index.ts:175-177` documents
  the split).
- **Entity changes are append-only.** `OrderRecord` has 14 positional constructor params across 33
  call sites. Append new fields with `= null` defaults (breaks 0 sites) — or better, add a derived
  **getter**, matching the six snapshot-derived getters the entity already carries.
- **Migrations.** Synthetic sequential prefixes only, strictly greater than the current tail
  (`1833000000000`, so start at `1833000000001`); class-name suffix must repeat the filename prefix;
  hand-author DDL for partial indexes. `migration:generate` emits a real epoch prefix that sorts into
  the middle of history — **re-prefix before committing**. Ordering vs `origin/main` is a hard CI
  failure (`docs/migrations.md` rule 3).
- **New event stream** requires a stream constant, a DLQ constant, a **MAXLEN entry** in
  `redis-streams-event-publisher.ts`, module wiring, and a **dedicated blocking Redis client** — two
  `XREADGROUP` loops cannot share a connection.
- **New job types** need a `JobTypeValues` literal, a handler, registration in
  `handler-registration.service.ts` + `sync-worker.module.ts`. `SyncJobRequest.connectionId` is
  non-nullable (#1943), so a pack job with no natural connection needs a scaffold connection, as
  `destination.taxonomy.sync` already does.

---

## 5. Waves

### Wave 0 — Lifecycle foundation (no user-visible change)

Justified independently of the strategic bet: replaces three ad-hoc at-most-once claims with one
primitive and closes a documented lost-cancel bug (a cancel arriving before the order's create job
runs finds no targets and is silently lost — `order-ingestion.service.ts`).

1. `order-lifecycle-state.types.ts` — axes, ordinals, canonical states, documented precedence
2. `derive-canonical-lifecycle.ts` — pure projection, sibling of `order-sla.ts`; **consumes**
   `deriveSlaState` and `deriveFulfillmentRollup` rather than re-deriving them
3. Migration: `order_axis_states`, `order_axis_transitions`, `order_records.canonicalState`
4. `OrderAxisLedgerRepository` — conditional-claim + monotonic-UPDATE primitives
5. `OrderAxisLedgerService` — the sole coordinating writer
6. Re-route the three existing claim sites; delete `isFirst*Transition` **in the same commit**
   (they are today's only at-most-once guarantee; removing them early double-relays)

Idempotency key: `(internalOrderId, axis, originConnectionId, sourceEventId)`. Scoping by
`originConnectionId` is required — external event ids are only connection-unique, which is why
`webhook_deliveries` keys on `(provider, connection_id, event_id)`.

**API contract decision (W2).** `canonicalState` is **additive** on
`order-record-response.dto.ts`; `fulfillmentState` and `slaState` keep their current enum-typed
meaning and keep driving the list badge and filters. Deprecating them is explicitly **deferred** —
until then the FE treats `canonicalState` as the headline and the other two as contributing detail.

### Wave 1 — Event path + durable relay

7. `events.order.lifecycle` stream + `OrderLifecycleToJobHandler` (clone `MasterDeletionToJobHandler`)
8. **Ledger-as-outbox**: `order_axis_transitions.relayState` (`pending → done | unsupported | failed`)
   plus a `relaySweep`. Master-deletion's at-most-once is tolerable there because `isStale` stays
   authoritative and an hourly sweep re-reads it; an outbound obligation has no re-derivable backing
   state, so a lost event is a lost notification
9. ADR-028 amendment: cancellation → stock-restore becomes an event consumer
10. Exploit Allegro's `checkoutForm.revision` / 409 CONFLICT for safe status write-back

### Wave 2 — Operator workbench (see § 6)

### Wave 3 — Orchestration

11. Rules engine over **OL's own event surface** — parity on triggers you cannot emit is not parity
12. Delayed actions via `SyncJobsService.schedule({ runAfter })`; guards re-evaluated **at resume**
13. Dry-run + negative-evaluation logging (reuses the changeset replay)
14. SLA: the product is *managing the dispatch declaration as a risk position*, not showing a number

### Wave 4 — Post-sale

**Step 0 (blocking, do first).** Convert all five `OrderLifecycleEventType` consumers to exhaustive
handling with a `never` default — `order-lifecycle-relay.service.ts:122`, the Allegro and Erli order
sources, and the WooCommerce and PrestaShop processors — plus the two int-test stub helpers. All five
are today two-branch `if/else`, so extending the union **compiles cleanly and mis-routes at
runtime**; Erli would report a returned order as `sent`. See § 6 C1.

15. `return_requests` + `return_request_lines`; `damaged_quantity` distinct from `received_quantity`
16. Extend `OrderLifecycleEventTypeValues` (only after Step 0)
17. Return → `CorrectionIssuer` mapper — the capability is already return-shaped
18. Restock — the real gap: nothing writes master inventory upward today
19. Disputes (a richer writable Allegro surface than returns)
20. Plan-vs-execution split for refunds: OL records intent, observes execution

### Wave 5 — Allocation

21. `inventory_reservations` + a shortfall column
22. **Add `availableToPromise` (and `reserved`) to `VariantAvailability` (D11).** `totalAvailable`
    keeps meaning raw available. Precedent: `ProductStockAggregate` already keeps `totalAvailable`
    and `totalReserved` distinct. Migrate the six consumers to ATP **explicitly, one at a time**
23. `applyStockSafetyBuffer` consumes ATP — see § 6 C3 for the accepted trade-off and required
    doc updates
24. Atomic reserve (D9): `UPDATE … SET reserved = reserved + $1 WHERE stocked - reserved >= $1
    RETURNING` plus `CHECK (reserved_quantity >= 0)`
25. Reserve/release at three existing seams; expiry sweeper
26. Remove `reserveInventory` / `releaseInventory` from `InventoryMasterPort`. Safe (structural
    excess is legal; zero non-spec call sites) but requires deleting two adapter specs and updating
    `docs/capabilities.md:29` + the `engineering-standards.md` port snippets **in the same PR**

---

## 6. Wave 2 in detail, and the three Critical corrections

### 6A. Operator stage pipeline

`order_stages` — operator-defined, seeded `New → To pack → Packed → Ready to ship → Shipped → Done`.
Columns: `name`, `ordinal`, `canonicalState` (**one-way** map onto the guarded core), `color`,
`isTerminal`, `isActive`. Placement: `order_records.stageId` + `stageEnteredAt`.
`order_stage_history` records (from, to, actor, at).

A stage is an *operator label*, never an axis — it does not feed the canonical derivation, or
operators could corrupt the guarded core. Moving to a stage is legal iff the implied canonical
transition is legal.

**Relationship to the existing `order_state_mapping` (W3).** That table is an **outbound translation
table**: per *destination* connection, canonical `OrderStatus` → the platform's native state id, with
its own CRUD UI. It is untouched. Stages map onto `canonicalState`, and `resolveOrderStateMapping`
continues to translate `OrderStatus` — stages are **never** an input to it. Two operator-facing
vocabularies now exist; the Mappings page must label its own as "destination order states" to keep
them distinct.

### 6B. Per-line counters

`order_record_items` — one row per order line. Identity: `internalOrderId`, `lineId`, `variantId`.
**Denormalised** `sku`, `ean`, `name` so a stale/deleted master variant (#1689) cannot make a
historical order unreadable. Counters: `packed_quantity`, `fulfilled_quantity`, `shipped_quantity`,
`delivered_quantity`, `return_requested_quantity`, `return_received_quantity`,
`written_off_quantity` — plain integers (no `raw_*` doubling; OL owns no money).

Validation ladder, each rung rejecting with an operator-readable message:
`packed ≤ ordered` · `shipped ≤ packed` (when the gate is on) or `≤ ordered` · `delivered ≤ shipped`.

Populated at ingestion from `orderSnapshot.items`; backfill required for open orders.
**D2a: counters are derived from `order_pack_events` and shipment facts — never free-floating.**

### 6C. Pack station

`order_pack_events` — append-only, the ledger behind `packed_quantity`. Columns: `orderId`,
`lineId`, `quantity`, `actorUserId`, `method` (`scan | manual`), `clientEventId` **UNIQUE**,
`createdAt`. The unique client id makes a double-scan idempotent — the real concurrency hazard at a
bench is one packer scanning twice, not two packers.

Barcode resolution uses `ProductVariant.ean`, already populated by the master sync. Four distinct
rejection reasons: barcode not on this order · line already fully packed · order not in a packable
stage · variant is stale.

Completion auto-advances to the configured packed stage. **Short-pack** is explicitly allowed with a
reason, recorded as an exception, and does *not* auto-advance — without it, one missing item seizes
the bench.

### 6D. Station authentication — highest-risk item

Two layers: a long-lived **device session** scoped to warehouse permissions and packable-stage orders
only, plus a **per-order actor** resolved by PIN or badge scan, stamped on each pack event.

Copy the `mcp_tokens` *pattern* (opaque prefix + SHA-256 at rest + revoke + `lastUsedAt`) into a
sibling table — **do not** extend MCP scopes; `McpTokenService` hardcodes its prefix, scope union and
RFC 8707 `resource`. Note `mcp_tokens.expiresAt` is **non-nullable by design**: a
"never expires" station token contradicts that invariant, so station tokens carry a finite expiry and
a renewal flow.

**This warrants its own ADR and a security review before implementation.**

### 6E. Dispatch gate

`connection.config.requirePackVerification` (JSONB, default `false`), matching the
`stockSafetyBuffer` / `pricingRule` precedent — no migration. Read via a pure
`readRequirePackVerification(config)` coercer. Enforced at label generation, naming the unpacked
lines. Later expressible as a rule.

### 6F. Authorization — corrected (D12)

**Permissions are display-only in this codebase.** `RolesGuard` is exact-role membership; there is no
permission-based guard, and `role.types.ts` documents that adding a permission does not open an
endpoint.

Therefore:

- **Extend the existing `operator` role** rather than adding a fourth. `operator` already holds
  `orders:write` and `shipments:write`; a new role means auditing every `@Roles('admin','operator')`
  list, pinned by `write-guard-coverage.spec.ts`.
- Every new pack/stage endpoint declares `@Roles('admin', 'operator')` **explicitly**, and the new
  permission strings (`pack:write`, `stage:write`) exist **only** to drive FE affordance visibility.
- The station device session is a separate principal (§ 6D) and is authorized by its own guard, not
  by the role ladder.

### 6G. Frontend

The station page is a **documented departure** from the responsive contract: `frontend-ui-style-guide.md`
§ Responsive makes complex editors read-only below 1024 px, but a pack bench is fully interactive at
tablet width — same shape of exception as the offer-picker modal (#1754/#1779), and recorded there.
Tap targets ≥ 44 px; scanner input is a keyboard-emulating device but assume nothing until tested.

It renders **outside `AppShell`**, as a top-level sibling of `consentRoute` with its own
`StationLayout` (the `/consent` precedent), and must satisfy `route-lazy.test.ts`.

### 6H. Sequencing — Wave 2 can precede Wave 0

6B + 6C have no hard dependency on the axis ledger; only the stage pipeline's `canonicalState`
mapping does, and stages can ship bound to `fulfillmentState` / `cancelledAt` and be re-bound later.

- **Fast path:** 6B → 6C → 6A → Wave 0/1 later. Visible value sooner; rework bounded to one column.
- **Foundation first:** Wave 0 → 1 → 2. Cleaner; nothing user-visible for longer.

Recommended: **fast path**.

### The three Critical corrections

**C1 — extending `OrderLifecycleEventTypeValues`.** Handled by Wave 4 Step 0 above.

**C2 — ATP must be a new field, not a redefinition (D11).** Changing `totalAvailable` to mean ATP
produces zero compile errors and no test failures while silently changing published marketplace
quantities (`bulk-listing-submit.service.ts:655`), the operator-facing "stock at risk" panel — which
surfaces that field **as `masterStock`** (`stock-at-risk-read.service.ts:84`) — and the
`get-availability` MCP tool. It would also contradict `offer-stock-restore.service.ts`'s own header
invariant.

**C3 — the buffer double-subtraction is accepted, and must be documented.** After Wave 5, published
stock is `master − reserved − buffer`. This is *correct* — reservations cover known allocations,
the buffer covers unknown sync latency — but it is a behaviour change with no config change and no
log line. Required in the same PR: update the `stock-safety-buffer.types.ts` header and
`connection.types.ts:74` to say the input is ATP, and note in release notes that operators may want
to reduce their configured buffer. Also re-check the at-risk threshold in
`stock-at-risk-read.service.ts:90`, which will fire earlier.

---

## 7. Testing strategy

| Subject | Level | Why |
|---|---|---|
| `derive-canonical-lifecycle` | unit, exhaustive precedence table | pure function; core domain logic target is 90%+ |
| Monotonic rejection + ledger claim | unit (repository port faked) + **int-spec** | the conditional `UPDATE` is a DB behaviour, not a code path |
| **D9 atomic reserve** | **int-spec with parallel attempts** | a concurrency guarantee cannot be proven by a unit test — this is the single most important test in the programme |
| Changeset replay | unit — same fixture drives preview and apply | proves D5's purity constraint holds |
| Counter validation ladder | unit, one case per rung | each rung has an operator-readable message |
| Pack-event idempotency (`clientEventId`) | int-spec — duplicate insert | unique-constraint behaviour |
| Wave 4 Step 0 exhaustiveness | compile-time (`never` default) + unit per adapter | the point is that the compiler starts catching it |
| Station auth | int-spec + security review | new bearer-token surface |

New tables must be added to `tablesToTruncate` in the integration harness.

---

## 8. Checkpoint

**Treat the end of Wave 2 as a real gate.** At that point the Orders workspace and pack station
exist, and the foundation is paid for by the bug it fixed. Waves 3–5 should each require fresh
justification rather than inheriting today's approval.

---

## 9. ADRs

| # | Subject | State |
|---|---|---|
| [ADR-039](../architecture/adrs/039-order-lifecycle-derived-from-fact-ledger.md) | Canonical lifecycle as a derived projection over a fact ledger | Proposed |
| [ADR-040](../architecture/adrs/040-order-changeset-proposed-then-confirmed.md) | Changeset model for remote-authority mutations | Proposed |
| — | `order_axis_transitions` as a third dedup layer (vs ADR-005, ADR-007) | to write |
| — | Ledger-as-outbox vs fire-after-commit | to write |
| — | `OrderAuthorityResolver` — per-(source, axis) coarse roles | to write |
| — | Self-echo posture: origin exclusion + outbound write records | to write |
| — | `connections.orderAuthority` (Posture A/B) | to write |
| — | **Late / out-of-order event policy** — no prior art in any surveyed platform | to write |
| — | Pack-station authentication | to write (before Wave 2 6D) |
| — | Rules engine: AST + capability-gated actions + purity constraint | to write |
| — | Returns as a child aggregate | to write |
| — | ADR-028 amendment | to write |

**`OrderAuthorityResolver` placement (W10).** `orders ↔ mappings` is already a package-level cycle,
tolerated because the `mappings → orders` half is `import type` only. Placing the resolver in
`mappings` passes the lint guard (symbol-shape, no cycle detection) **only** if it stays type-only
plus `I*Service` + token. `orders.module.ts:32` already imports `MappingsModule`, so a value import
back would need `forwardRef`. Prefer placing it in `orders`.

---

## 10. Open questions

1. **Open-core / paid module** — raised, undecided. Tension: the best-corroborated PL demand signal
   is pricing flight from the incumbent, and scanning is the cheap half of pack verification. If
   gating, gate hosting / support / agency dashboard / SSO, not warehouse basics. No entitlement
   infrastructure exists today.
2. **Dispatch declaration as a risk position** — `Szybka wysyłka` is max +160 / min 0 but only if
   ≤ 1 day is declared; `Wysyłka w terminie` runs to −360, and −460 from 26 August.
3. **Returns ambition** — Allegro permits read + reject-refund only. Is the value in disputes?
4. **Legal vs marketplace return state** — when the statutory withdrawal clock and the Allegro return
   disagree, which does the operator's screen show?
5. **COD reconciliation** — a batch-to-line join. Carrier API or bank-statement import?
6. **Allegro customer-returns status enum** — pull from `swagger.yaml` before Wave 4.
7. **Packing slips at the station** — in scope or out?
8. **Variants with no EAN** — manual tick, or scan the SKU?
9. **Batch packing** — out of v1; the standard is to batch the *pick* and single-thread the *pack*.

---

## 11. Risks

- Guardrails are non-optional and mostly absent; Wave 0 is not skippable
- Station auth is the largest new security surface
- Counter drift if 6B ships without the pack-event ledger (D2a)
- Rule loops through marketplace round-trips need a causation-depth cap
- Fan-out amplification: 5k orders × rules × actions against marketplace quota (#2019 limiter mitigates)
- Delayed-action staleness — no incumbent publishes an answer
- Stale-variant fail-open: rules must respect the #1689 guard
- Backfill of `order_record_items` for open orders
- Value concentrates in later waves while cost is front-loaded — hence § 8

---

## 12. Demand basis (recorded honestly)

A prospective agency asked for an OMS that shows the order, its status, and whether it is packed —
and separately wants orchestration. That fires **#827**'s defer condition squarely (deferred for lack
of demand; "is it packed" is its core, and the ask is broader than #827 as written, which excluded
barcode scanning and per-operator accountability). It does **not** fire any of #1032's three un-defer
triggers. The reopening of #1032 is a maintainer decision to make the OMS-positioning bet, consistent
with the *STRATEGIC BET* posture recorded at Gate A on 2026-06-18 — not new evidence that the
original triggers fired.

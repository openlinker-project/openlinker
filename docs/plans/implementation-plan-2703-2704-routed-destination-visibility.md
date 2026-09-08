# Implementation Plan — Routed-destination visibility (#2703 + #2704)

**Branch**: `2703-2704-routed-destination-visibility`
**Issues**: #2703 (`/orders` cannot distinguish "the router sent this nowhere" from "nothing is configured"), #2704 (a routed order whose single destination is momentarily disabled becomes a total failure)
**Layer**: CORE (`orders`) + Interface (API DTO/controller) + Frontend (`apps/web`) + DX (invariant script, migration)

---

## 1. Understand the task

Both issues are halves of **one** defect, live in **one** file
(`libs/core/src/orders/application/services/order-sync.service.ts`), and are
self-documented there. They therefore ship as one branch.

### What the code does today

`resolveDestinations` lists `OrderProcessorManager` adapters (**active-only**),
drops the source connection, then narrows by the router's
`destinationConnectionIds`. `syncOrder` then distinguishes three conditions
behind an empty destination list:

| # | Condition | Today |
|---|---|---|
| (a) | nothing configured / all inactive | throws `NoOrderDestinationsAvailableException`, no ids |
| (b) | router positively named NOBODY | `logger.warn` + returns `[]`, **no rows written** |
| (c) | router named ids, none eligible | throws, carrying the source-echo-excluded ids |

### The two gaps, restated precisely

- **#2703**: (a) and (b) are distinguishable *at the branch* and **identical on
  `/orders`** — both render through `rollup.total === 0 → 'No destinations'`
  (`apps/web/src/features/orders/lib/order-health.ts:144,159,165`). A router
  quietly sending everything nowhere looks exactly like a router never set up.

- **#2704**: (c) makes an order whose only routed destination is momentarily
  disabled a **total failure**, where an unfiltered fan-out would have reached
  its siblings.

### VERIFIED FINDING 1 — a partial case exists, and it is silently under-provisioned

The task brief asked whether a partial-eligibility case exists and is handled.
**It exists, is reached, and is log-only.** `resolveDestinations` returns
`unresolvedRequestedIds` **only when `filtered.length === 0`**
(`order-sync.service.ts:558-561`). So when the router names `[a, b]` and only
`b` is eligible:

- `filtered = [b]` → `destinations.length === 1`
- the `(c)` throw branch is **never entered**
- `a` is dropped behind a single `logger.warn` (`order-sync.service.ts:545-551`)

The order mirrors to fewer destinations than routing asked for, and **nothing
outside the log says so**. Same defect shape as #2703 — a narrowing invisible on
the operator surface — and it is exactly #2704's acceptance criterion 3 ("an
operator can see *why*"). In scope.

### VERIFIED FINDING 2 — all three routing branches are LATENT today

**No production caller populates `destinationConnectionIds`.** A repo-wide grep
over `libs/core/src`, `libs/oms/src`, `apps/api/src`, `apps/worker/src`
(excluding tests) finds only the field declaration, `OrderSyncService`'s own
consumption of it, and doc comments. `OrderIngestionService`'s sole `syncOrder`
call (`order-ingestion.service.ts:609-613`) passes `order`,
`sourceConnectionId`, `sourceEventId` and nothing else.

Consequences, stated so nothing here is oversold:

1. Branches (b), (c) and the partial case are **unreachable in production
   today**. #2704's regression is **latent, not live**.
2. Therefore the new column is `NULL` on every row of every existing install —
   the identical posture `fulfillmentBlockReason` documents for itself ("or NULL
   when it did not, which is every install today").
3. Therefore this change is **behaviour-preserving on every existing install**:
   no order changes bucket, no count moves off zero, no badge appears.
4. Building the visibility mechanism ahead of its producer is this repo's
   established posture (#2400's `record()` has no production caller; #2393,
   #2304 and #2391 all ship vocabulary first), and it is precisely what #2703
   and #2704 ask for — they close recorded gaps in a shipped-but-latent slice.

### Explicit non-goals

- **No fallback / destination substitution.** See §3.1.
- **No change to the (b) `return []` ruling.** Deliberate and correct:
  `MarketplaceOrderSyncHandler` wraps a throw in `SyncJobExecutionError` and
  `isNonRetryableError` consults a per-plugin classifier registry where a core
  `orders` exception is registered nowhere — so a throw is **retryable** and
  would re-run a live marketplace `getOrder` ~10× before dead-lettering with a
  `lastError` blaming connection config for what the router chose.
- **No new `OrderHealth` member**, and **no sixth `OrderSyncStatusFilter`
  member** (see §3.2).
- No routing *rule* authoring surface (that is `@openlinker/oms`, #2408).
- `order-lifecycle-relay.service.ts` and the shipping relay (#2073) are being
  worked concurrently by another agent — **untouched here**.

---

## 2. Research — what already exists (reuse, not invention)

| Need | Existing precedent to copy | Location |
|---|---|---|
| Reason vocabulary + read-side coercion guard | `FulfillmentBlockReasonValues` / `isFulfillmentBlockReason` / `FulfillmentBlock` | `libs/core/src/fulfillment/domain/types/fulfillment-block-reason.types.ts` |
| Counted-subset derivation by `.filter` | `SalesDocumentAttentionReasonValues` | `libs/core/src/sales-documents/domain/types/sales-document-reason.types.ts:180` |
| Two peer reason columns on `order_records` | `fulfillmentBlock*` (#2396) `:451-497`; `salesDocumentBlock*` (#2100) `:143-173` | `order-record.orm-entity.ts` |
| Narrow guarded writer | `updateFulfillmentBlock` — `IS DISTINCT FROM` no-op guard in the `WHERE` | `order-record.repository.ts:2083-2097` |
| `toOrm` exclusion (+ `upsert()` raw tuple + `upsertWithLineItems`) | consolidated block; `fromRawRow` DERIVES the reset from the write set | `order-record.repository.ts:2492-2515`, `:2703-2740`, `:3039-3067` |
| Counted IN-list (never `IS NOT NULL`) | `IS_SALES_DOCUMENT_BLOCKED` + the `COALESCE(…, '')` NULL-safety trap | `order-record.repository.ts:1349-1397` |
| Aggregate + filter + chip trio | `salesDocumentBlocked` | repo `:323-332`, `:468-471`; DTO `list-orders-query.dto.ts:160-179`; chip `orders-list-page.tsx:1528-1562` |
| FE mirror + guard script | `check-sales-document-reason-mirror.mjs`; mirror in `orders.types.ts:120-152` | `scripts/`, `apps/web` |
| "gate reports, caller persists" | `persistFulfillmentOutcome` → `markFulfillmentBlock` | `order-ingestion.service.ts:1157-1170` |

### Reuse collisions checked

- **`RoutingOutcome` is TAKEN** — `libs/core/src/sync/application/types/inbound-routing-policy.types.ts:27`,
  exported from `libs/core/src/sync/index.ts`; plus `InboundWebhookRoutingOutcome`
  in `apps/api`. Those are **inbound webhook** routing (which job type a webhook
  routes to) — unrelated. **Everything here is namespaced `DestinationRouting*`**,
  which collides with nothing.
- No `destinationRouting*` / `routingBlock*` identifier exists today.
- Migration tail across core + both plugin dirs is `1875000002000`; this plan
  uses the next synthetic step **`1875000003000`**.

---

## 3. Design

### 3.1 #2704 — the semantics decision: a routing decision is a REQUIREMENT

**Decided: HOLD. No fallback ships.** Recorded here and in the code.

1. **The issue defers the semantics by name**: *"Deciding it needs the router's
   own semantics, which is `@openlinker/oms` territory (#2408) rather than the
   fan-out's."* `OrderSyncService`'s header states it *"resolves NO router and
   imports nothing from `@openlinker/core/fulfillment`"* — the ids arrive as
   caller-supplied data. Choosing a substitute destination here would BE a
   routing decision taken by the fan-out, inverting that layering (ADR-053's
   no-injection direction).
2. **The issue's own criterion forbids the silent form**: *"a silent
   substitution of destination is worse than the failure it replaces."* A correct
   fallback needs a defined, observable fallback ORDER — a router rule that does
   not exist.
3. **Holding is already right for the interchangeable-topology worry.** An
   install with no router passes `undefined` and keeps the unfiltered fan-out
   verbatim; the regression exists only once a router positively names ids.
4. **The retry ladder is doing useful work** on (c): a disabled connection can be
   re-enabled and the next attempt succeeds with no manual step.

#2704 is therefore delivered as criteria **1** (semantics decided + documented),
**2** and **3** (an operator can see that a *named destination was unreachable*,
distinctly from "nothing configured"). The "if fallback ships, every
substitution is recorded" clause is vacuous — nothing is substituted.

### 3.2 #2703 — a persisted, order-level reason (NOT a `syncStatus` arm)

The issue says "most likely a distinct `syncStatus` arm" and then, two
paragraphs later, "the #2100 precedent is the closer match". **This plan takes
#2100.** Deviation from the issue's first suggestion is deliberate and recorded:

1. **(b) has no destination to attach a row to.** A `syncStatus` row is keyed by
   `destinationConnectionId`; the whole content of (b) is that there is none, and
   `syncOrder` returns `[]` with no ids to key rows on.
2. **A `syncStatus` arm is exactly what a consumer could route into a retry** —
   the property #2397 bought and #2703's own AC 3 requires preserving.
3. `OrderSyncStatusFilterValues` is documented as the single source of truth for
   the persisted payload **and** `GET /orders?syncStatus=` (`order-record.types.ts:14-33`),
   so widening it deliberately widens the public query vocabulary for a value
   that can never appear on a real destination row.
4. `updateSyncStatus` is a per-destination **drop-then-append** upsert
   (`order-record.repository.ts:2768-2845`); a destination-less row is a poor fit
   and risks the `externalOrderId` clobber #2588 fixed.

### 3.3 Why not `omsAttention` / `fulfillmentBlockReason`

- `omsAttention`'s `AuthorityAttentionReason` is a closed union about **who
  decides what**. Destination-mirror narrowing is not an authority question — the
  architecture doc is explicit that destination-mirror creation is *"a
  commercial/catalogue act, distinct from fulfilment assignment"*.
- `fulfillmentBlockReason` records that the intercept **HELD the order so
  `syncOrder` was never called**. This records what happened **inside**
  `syncOrder`. Mutually exclusive by construction (§3.5) ⇒ **no double-counting**,
  the failure mode `fulfillment-block-reason.types.ts` warns about at length.

A third peer column pair on `order_records` is the consistent shape.

### 3.4 The vocabulary

`libs/core/src/orders/domain/types/destination-routing-block.types.ts`

```
DestinationRoutingBlockReasonValues = [
  'routed-to-no-destination',                   // (b) a DECISION, not a fault
  'routed-destinations-unavailable',            // (c) named ids, none eligible
  'routed-destinations-partially-unavailable',  // partial — the silent gap
  'routed-to-source-only',                      // every named id WAS the source
]
```

- `routed-to-source-only` is **reachable and already distinguished by the current
  code**: a non-empty request whose unresolved set is empty (the source is
  excluded from both `eligible` and `unresolved`). The existing comment calls it
  "a distinct router misconfiguration"; it now gets a value, and
  `buildMessage`'s third arm already renders exactly that sentence.
- **The counted subset excludes `routed-to-no-destination`**, derived by
  `.filter` from the full list (never hand-listed) so the two cannot drift. That
  value is a working router making a decision: neutral badge, never aggregated,
  never in the attention count. This is #2100's `trigger-model-manual` treatment
  verbatim, and it is what stops a red "Routing blocked N" on a healthy install
  that legitimately routes some orders nowhere.
- `isDestinationRoutingBlockReason` coerces on read (plain column, no CHECK), so
  a value written by a newer release and rolled back reads as "nothing
  recognised" rather than widening the union at runtime.

### 3.5 Where it is written — exactly one write per ingestion

**A single write point in `syncOrder`, immediately after `resolveDestinations`,
before every branch**, so the cancelled / held / dispatched / thrown paths all
get exactly one write and cannot drift.

**Plus one clear in `OrderIngestionService` on the `routing.held` branch.**
Load-bearing, not symmetry: when the fulfilment intercept holds, `syncOrder` is
**never called** (`order-ingestion.service.ts:598-613`), so a single writer
inside `syncOrder` would leave a **stale** routing reason standing beside a fresh
`fulfillmentBlockReason` — the UI would assert "the router sent this nowhere"
about an order that is in fact held. Clearing there restores level-triggering
across both branches and keeps the two columns mutually exclusive, which is what
makes §3.3's no-double-count claim true.

Both call sites go through **one** repository method. Both are **best-effort**
(catch + warn, never fail the sync), mirroring `persistFulfillmentOutcome`; on
the (c) path the persist runs *before* the throw so the reason survives, and a
persist failure must never mask the real error.

### 3.6 `resolveDestinations` return-shape change

Today `unresolvedRequestedIds` is returned **only** when nothing resolved, so
that "the field never has to be read together with `destinations`". The partial
case must read exactly that combination, so the property changes deliberately:

- `undefined` → **no routing filter supplied** (the meaningful distinction, kept)
- `[]` → filter supplied, everything resolved
- non-empty → some or all unresolved

The exception path is **byte-identical** (it is only constructed when
`destinations.length === 0`). The docblock is rewritten to state the new reading.

### 3.7 Detail string

PII-free by construction — connection ids and counts only, never buyer data.
Bounded defensively (cap the rendered id list, carry the total count) so a
malformed router payload cannot write an unbounded value that is rendered
verbatim to an operator.

### 3.8 Index choice — NULL-partial, deliberately not a value list

`salesDocumentBlockReason`'s migration ships a partial index over a **hardcoded
reason list**, and `docs/architecture-overview.md` records that this *"silently
went stale on `IDX_order_records_salesDocumentBlockReason` when #2248 widened
that union and left the index behind"*.

This plan therefore indexes on `WHERE "destinationRoutingBlockReason" IS NOT NULL`
instead: still tiny (it matches only routing-narrowed orders, i.e. **no rows at
all** on every install today), still serves both the counted-subset filter and
the neutral-badge lookup, and **cannot go stale when the union widens**. Recorded
as a deliberate improvement on the precedent rather than a deviation from it.

---

## 4. Step-by-step plan

### CORE — vocabulary
1. **`libs/core/src/orders/domain/types/destination-routing-block.types.ts`** (new)
   `DestinationRoutingBlockReasonValues`, `DestinationRoutingBlockReason`,
   `DestinationRoutingAttentionReasonValues` (derived by `.filter`),
   `isDestinationRoutingBlockReason`, `DestinationRoutingBlock {reason, detail}`.
   Export from the `orders` barrel.
   *AC*: a spec asserts the counted subset is a strict subset and that
   `routed-to-no-destination` is NOT in it.

### CORE — persistence
2. **`order-record.orm-entity.ts`** — two nullable columns
   `destinationRoutingBlockReason` (indexed, §3.8) / `destinationRoutingBlockDetail`,
   documented as sole-writer + level-triggered + not round-tripped.
3. **Migration `1878000000000-add-order-record-destination-routing-block.ts`** —
   `up()` adds both columns + the NULL-partial index; `down()` drops them.
   **The `…3400` offset is deliberate, not the next free slot.**
   `check-migration-timestamps.mjs` compares only against `origin/main`, so it
   cannot see a sibling migration on a concurrent unpushed branch — the
   `1869000000400` template records Wave 3a hitting exactly this and reserving
   spaced offsets in response, and another agent is working #2073 concurrently.
   Verified free and strictly greater than the global max (`1875000002000`).
   Declared on the entity too, because the integration harness builds schema by
   `synchronize` and a migration-only column would silently not exist in tests
   (`docs/lessons.md`).
4. **`order-record-repository.port.ts`** — `updateDestinationRoutingBlock(id, block | null)`.
5. **`order-record.repository.ts`** — guarded UPDATE copying `updateFulfillmentBlock`;
   `toDomain` coercion; **add both columns to the consolidated `toOrm`-exclusion
   comment AND verify they are absent from `upsert()`'s raw tuple and
   `upsertWithLineItems`**; the `IS_DESTINATION_ROUTING_BLOCKED` predicate as
   `COALESCE(rec."destinationRoutingBlockReason", '') IN (…)` over the **counted**
   subset.
   *AC*: unit test asserts the property is `undefined` on the entity handed to
   `save()`; integration test asserts the value survives a second `persistOrder`.
6. **`OrderRecord` domain entity** (new ctor params **appended at the end**, the
   documented positional-ctor convention) + **`IOrderRecordService.markDestinationRoutingBlock`**.

### CORE — the decision
7. **`order-sync.service.ts`** — `resolveDestinations` returns the unresolved ids
   per §3.6; a **pure private mapper** turns `(requested, destinations, unresolved)`
   into `DestinationRoutingBlock | null`; one best-effort write before every
   branch; (c) persists before throwing. Replace the two "KNOWN COST" / "genuine
   NEW regression" comments with the resolution and the recorded semantics
   decision (§3.1).
   *AC*: specs for all six mappings incl. the partial and source-only cases.
8. **`order-ingestion.service.ts`** — clear on the `routing.held` branch (§3.5).

### CORE — read surface
9. `OrderRecordFilters.destinationRoutingBlocked` + the summary aggregate count
   (`COUNT(*) FILTER (WHERE …)`), both reading the ONE predicate constant.
   **Update `order-record.repository.predicate-parity.spec.ts`'s filter fixture** —
   two named `CASES` arms (`=true` / `=false`, beside the `salesDocumentBlocked`
   pair) plus the field on the `'every filter at once'` object.
   **Stated precisely** (the gate corrected an overstatement here): structural
   parity holds *without* the edit, because `findMany` / `findManyRows` /
   `countMany` all route through the one `buildFilteredQuery`. What a named case
   actually buys is three things — a failure that NAMES the filter, inclusion in
   the combined-filters case, and coverage by the time-purity assertion, which
   fails if the predicate binds a per-call `new Date()`. A `static readonly` SQL
   constant satisfies purity; a per-call rebuild would not.
   *AC*: the `false` arm returns rows on an install where nothing is blocked (the
   `COALESCE` NULL-safety trap).

### Interface
10. `OrderRecordResponseDto` fields + `ListOrdersQueryDto` filter param (the
    `'true'/'false'`-only `@Transform`) + `OrderHealthSummaryResponseDto` count.
    `@Roles` unchanged.

### Frontend
11. Mirror the union in `apps/web/src/features/orders/api/orders.types.ts`; one
    copy module in `features/orders/lib/` (code → operator sentence);
    render the badge on the order row **beside**, never inside, the health group;
    a filter chip mounting on `filterActive || count`; and make
    `order-health.ts` render (b) distinctly from "No destinations".
    *AC*: badge, count and filter agree (#2100's rule).
12. **`scripts/check-destination-routing-reason-mirror.mjs`** with `--self-check`,
    chained into `check:invariants` as the standard `--self-check && bare` pair.

### Docs
13. `docs/architecture-overview.md` § Orders — replace the two recorded costs
    with the resolution; add a `docs/lessons.md` entry if a new trap is found.

---

## 5. Validation

- **Architecture**: no new cross-context edge (`orders` → `orders`); no
  `@openlinker/core/fulfillment` import added to `OrderSyncService`; domain layer
  stays framework-free.
- **Naming**: `DestinationRouting*` avoids the `RoutingOutcome` collision.
- **Security**: detail carries connection ids and counts only — no PII; no new
  route; no auth change.
- **Risk register**:
  - *Stale reason on the held branch* → closed by §3.5 + a spec.
  - *Double-counting against `omsAttention` / `fulfillmentBlock`* → closed by §3.3.
  - *Red banner on a healthy install* → closed by the counted-subset exclusion,
    and doubly by Finding 2 (the column is NULL everywhere today).
  - *Negated filter dropping every row* → closed by `COALESCE(…, '')` + a spec.
  - *`persistOrder` stomping the value* → `toOrm` exclusion + unit and int pins.
  - *Partial-index staleness* → closed by §3.8's NULL predicate.
  - *New filter arm uncovered by parity spec* → closed by step 9's fixture edit.

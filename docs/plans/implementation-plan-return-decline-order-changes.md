# Implementation Plan: `return.decline` as an ADR-044 action (lands `order_changes`)

**Issue**: #2333 — OMS Wave 1c, backlog slug `W1c-6`, **named gate for Wave 2** (`order_changes` — reused, never rebuilt)
**Date**: 2026-08-25
**Status**: Ready for Review
**Estimated Effort**: ~1.5 days

---

## 1. Task Summary

**Objective**: Ship the operator action "decline this customer return's refund" in ADR-044's
proposed-then-confirmed shape, and — because that shape has no persistence in the tree today —
**land the `order_changes` table itself**, in its real ADR-044 form, with `kind` scoped to the
return actions this wave ships.

**Context**: ADR-060 states that *authorization is an action, not a state*. Exactly two ADR-044
proposals exist for returns: `return.decline` (the one Allegro write) and `return.authorize`
(operator-authored returns only, Wave 2). OL must never pretend to decide what the marketplace
already decided, so the header's `declinedAt` must be stamped from an **observed** confirmation,
never optimistically at request time.

Wave 2 (#2389) reuses `order_changes` for order amendments rather than inventing a second proposal
mechanism. That is why this issue is a gate: the table's shape, its grain rule and its state
machine are a **contract** other slices build on, not an implementation detail.

**Classification**: CORE + Integration + Infrastructure (**migration-bearing**) + Interface.

---

## 2. Scope & Non-Goals

### In scope
- `order_changes` table + ORM entity + repository + port + migration.
- `OrderChangeKind` / `OrderChangeStatus` vocabularies and their coercion guards.
- A **leaf** `OrderChangesModule` inside the `orders` context (see §3 for why it is not `OrdersModule`).
- `ReturnDecliner`, a new **write** sub-capability of `OrderSourcePort`, with its `is*` guard.
- `ReturnDeclineService` in the `returns` context — the proposal → adapter → confirm → apply cycle.
- The Allegro implementation (`POST /order/customer-returns/{id}/rejection`).
- One operator endpoint: `POST /returns/:returnId/decline`.
- Unit tests throughout; an integration spec for the schema + the double-call property.

### Out of scope (deliberate, with reasons)
- **`return.authorize`** — ADR-060 reserves it for operator-authored returns, which do not exist
  until Wave 2. Shipping the kind now would be a vocabulary with no writer.
- **Wave-2 amendment kinds** (`OrderAmendmentKind`, #2305) — the column accepts them by
  construction (see §6, "no CHECK constraint"), but nothing in this slice writes one.
- **A background expiry sweeper.** ADR-044 makes `EXPIRED` mandatory *because* an unanswered
  request would lock its target forever. This slice satisfies that requirement with a **lazy TTL**
  instead of a sweeper — see §6.4. ADR-044 itself names the lazy path's precondition ("a mutation
  requested outside a job … needs an explicit TTL before that path ships"); this is that TTL.
- **Migrating existing mutation paths** onto `order_changes`. ADR-044's migration path is explicitly
  one call site at a time, and the two conditional-with-release shipping claims stay as they are.
- **Frontend.** The operator UX for returns is a separate spec
  (`docs/specs/product-spec-oms-returns-operator-ux.md`); this slice ships the API only.

### Constraints
- CORE must learn no Allegro vocabulary. `REFUND_REJECTED` and its six siblings never appear in
  `libs/core`.
- `orders` must never import `returns` back (`ReturnRepositoryPort`'s standing note).
- Sibling agent on #2332 is editing the returns core concurrently — keep the returns-side surface
  additive and narrow.

---

## 3. Architecture Mapping

| Layer | What lands |
|---|---|
| CORE / `orders` domain | `order-change.entity.ts`, `order-change.types.ts`, `order-change-repository.port.ts`, `return-decliner.capability.ts` |
| CORE / `orders` application | `IOrderChangeService` + `OrderChangeService` |
| CORE / `orders` infrastructure | `order-change.orm-entity.ts`, `order-change.repository.ts` |
| CORE / `returns` application | `IReturnDeclineService` + `ReturnDeclineService` |
| CORE / `returns` domain | three refusal exceptions; one repository-port method |
| Integration / `allegro` | `declineReturn` on `AllegroOrderSourceAdapter`; manifest capability |
| App / `apps/api` | `POST /returns/:returnId/decline` |
| App / `apps/api/src/migrations` | `1847000000000-create-order-changes.ts` |

### Why `order_changes` lives in `orders`, but not in `OrdersModule`

The issue names `libs/core/src/orders/infrastructure/persistence/entities/order-change.orm-entity.ts`,
and ADR-044 is an *order*-mutation decision, so the files belong to the `orders` context. But
`OrdersModule` imports Integrations, IdentifierMapping, Sync, Products, Mappings, Customers,
Invoicing and Currency. Having `ReturnsModule` import that graph to reach one repository would
couple the returns context to seven siblings it has no business knowing, and would make a future
`orders → returns` edge a real cycle rather than a documented rule.

So `order_changes` gets its **own NestJS module** — `OrderChangesModule` at
`libs/core/src/orders/order-changes.module.ts` — which imports **nothing but
`TypeOrmModule.forFeature`**. It is a leaf. `ReturnsModule` imports *that*, never `OrdersModule`.
The precedent is `@openlinker/core/listings/services`: one context, more than one module, split so
a consumer takes only the seam it needs.

Note a fact already true and unchanged by this plan: `returns` already value-imports
`isReturnSourceReader` from the **main** `@openlinker/core/orders` barrel, so the module-load edge
`returns → orders` exists today. This adds no new one.

### Why a new capability rather than a method on `ReturnSourceReader`

The issue leaves this open ("or a dedicated decline guard if the write turns out not to belong on
that sub-capability — resolve during implementation and record"). **Resolved: a dedicated
capability, `ReturnDecliner`.**

`ReturnSourceReader`'s first line is "Read-only, cursor-capable ingestion of returns"; its guard
tests exactly its two read methods. Adding a write would (a) falsify that contract, (b) force every
present and future implementer to grow a write it may not have — Erli mints no return id and has no
rejection endpoint at all — and (c) silently reclassify such an adapter as decline-capable, because
the guard would have to grow a third method test or stop meaning what it says. The sub-capability
family's rule is one capability per method-set; this is that rule applied.

It lives beside its sibling in `libs/core/src/orders/domain/ports/capabilities/`, keeping the
`OrderSourcePort` capability family in one directory, and is **advertised-without-dispatch** like
every other member: declared in the manifest for discovery, resolved only by narrowing the
dispatched `OrderSource` adapter with `isReturnDecliner`.

---

## 4. External research — Allegro (verified against the live spec)

Fetched from `https://developer.allegro.pl/swagger.yaml` on 2026-08-25 (lines 20273-20345, 22631-22656).

```
POST /order/customer-returns/{customerReturnId}/rejection
  Accept / Content-Type: application/vnd.allegro.beta.v1+json
  scope: allegro:api:orders:write
  body (CustomerReturnRefundRejectionRequest, `rejection` REQUIRED):
    { "rejection": { "code": <enum, required>, "reason": <string 1..250, required iff code == REFUND_REJECTED> } }
  code enum: REFUND_REJECTED | NEW_ITEM_SENT | ITEM_FIXED | MISSING_PART_SENT
             | ITEM_MISMATCH | BUSINESS_PURCHASE | NO_RETURN_RIGHT
  200 -> the full CustomerReturn, whose `rejection.createdAt` is the AUTHORITATIVE decline instant
  400 / 403 / 406 -> ErrorsHolder
  422 -> "Might occur when customer return has already been rejected"
```

Three consequences shape the design and are not incidental:

1. **The 200 body carries `rejection.createdAt`.** The proposed-then-confirmed cycle therefore
   completes inside one call, and `declinedAt` is a *source-reported* timestamp — the strongest
   possible reading of "observed confirmation", better than OL's own clock.
2. **422 means "already rejected", not "failed".** Treating it as a failure would make a retry
   permanently red on a return that is, in fact, declined. The adapter therefore catches 422,
   re-reads the return through its own `getReturn`, and — if the re-read shows a `rejection` —
   returns a normal success carrying that observed timestamp. If the re-read shows no rejection,
   it rethrows: a 422 we cannot explain is still a failure.
3. **`code` is required and its vocabulary is Allegro's.** Core cannot pick one. The command
   carries an **opaque** `reasonCode: string` the operator chose, and the adapter publishes its
   own vocabulary through an optional `declineReasonCodes` array — the exact shape and the exact
   opacity contract `ReturnSourceReader.terminalRawStatuses` already established (#2330).

Rate limit: 25 req/s per user. Irrelevant here — this is one call per operator click.

---

## 5. THE `order_changes` CONTRACT (the Wave-2 gate)

This section is the deliverable other slices bind against. Everything in it is stable; Wave 2
widens `kind` and nothing else.

### 5.1 Table

**`id` is a plain uuid, deliberately — not an `ol_orderchange_*` internal id.** The sibling `returns`
mints `ol_return_*` via `formatInternalId` because it is an aggregate root an operator names; a change
proposal is an internal audit row that no external system names and that is never mapped through
`identifier_mappings`, so it takes the `return_lines` shape instead. There is no
`CoreEntityTypeValues` member and no `ENTITY_TYPE_ID_PREFIX` override, and a later reader should not
"fix" the omission.

**`payload` carries no buyer data.** Unlike `returns.rawPayload` (which has a named, inherited PII
gap), this column holds only an operator-chosen code and operator free text. The neighbouring caveat
does not transfer.

```sql
CREATE TABLE "order_changes" (
  "id"              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  "internalOrderId" text        NOT NULL,
  "kind"            varchar(64) NOT NULL,
  "targetRef"       text        NOT NULL,
  "status"          varchar(16) NOT NULL,
  "payload"         jsonb           NULL,
  "requestedBy"     text            NULL,
  "requestedAt"     timestamptz NOT NULL,
  "confirmedBy"     text            NULL,
  "confirmedAt"     timestamptz     NULL,
  "declinedReason"  text            NULL,
  "appliedAt"       timestamptz     NULL,
  "createdAt"       timestamptz NOT NULL DEFAULT now(),
  "updatedAt"       timestamptz NOT NULL DEFAULT now()
);
```

### 5.2 The five rules a consumer may rely on

**R1 — `kind` names the verb OL ASKS FOR; `status` names what happened to the ASKING.**
These read confusingly together exactly once, and it is this slice: a `kind = 'return.decline'`
row whose `status = 'declined'` means *the marketplace refused OL's request to decline the buyer's
refund*. Getting this backwards inverts a legal-ish outcome, so it is stated at the top of the
contract and repeated in both docblocks.

**R2 — the grain is `(internalOrderId, targetRef)`, never the order alone** (ADR-044's own
correction). `targetRef` names the thing being mutated: for `return.decline` it is the
`ReturnRecord.id`; for Wave 2 it will be a shipment id, a destination connection id, a document id.
Uniqueness is enforced by a **partial** index over the OPEN statuses only:

```sql
CREATE UNIQUE INDEX "UQ_order_changes_open_target"
  ON "order_changes" ("internalOrderId", "targetRef")
  WHERE "status" IN ('pending', 'requested');
```

`kind` is deliberately **absent** from that key. Two different kinds open against one target are a
contradiction, not a parallelism — a `return.decline` and a future `return.authorize` against the
same return must not race.

**R3 — `internalOrderId` is NOT NULL, and that is what makes the orphan refusal structural.**
An unattributed return (`ReturnRecord.internalOrderId IS NULL`) cannot produce a row here, so the
"refuse the action for an orphan" acceptance criterion is enforced by the schema as well as by the
service. Every ADR-044 change is a change *to an order*; a change with no order is not one.

**R4 — the state machine.**

```
pending ──▶ requested ──▶ confirmed  (the authority applied it)
                      ├─▶ declined   (the authority refused it; `declinedReason` set)
                      ├─▶ canceled   (the requester withdrew it)
                      └─▶ expired    (unanswered past its TTL — releases the index)
```

`pending` and `requested` are OPEN; the other four are TERMINAL. `OrderChangeStatusValues` and
`OPEN_ORDER_CHANGE_STATUSES` are exported so a consumer never hand-lists them. This slice writes
`requested` directly (the adapter call is synchronous, so there is no queued-but-not-sent window);
`pending` exists for a Wave-2 kind whose remote call is a job.

Confirmation is **idempotent**: `requested → confirmed` is a narrow conditional UPDATE on the
current status (`WHERE status = 'requested'`), so a second confirmation affects zero rows and is a
no-op rather than a second application.

**R5 — `appliedAt` guards APPLICATION, not double-confirm, and it is a timestamp.**
ADR-044 spells it as a boolean `applied`; this lands it as a nullable `timestamptz`, matching every
other at-most-once marker in the tree (`waybillRelayedAt`, `cancelledAt`, `fxStampedAt`) and
carrying strictly more information at the same storage cost. It is claimed conditionally
(`WHERE "appliedAt" IS NULL`). ADR-044's withdrawn claim stands withdrawn: `appliedAt` does **not**
subsume `Shipment.waybillRelayedAt`, which is claim-then-release and stays where it is.

### 5.3 What Wave 2 changes, and what it must not

- **Widening `kind` is a one-line edit** to `OrderChangeKindValues`. There is deliberately **no
  DB `CHECK` constraint and no PG enum** on `kind`: a check would force a migration per new kind
  and would make an out-of-tree kind a hard write failure rather than a coercion miss. The column
  is a plain `varchar(64)`; `isOrderChangeKind` coerces on read and an unrecognised value is
  reported, never silently mapped onto a neighbour (the `isOrderAmendmentKind` precedent, #2305).
- **`order_change_actions`, the action registry and replay stay deferred**, per ADR-044. Every
  mutation OL can perform is a single action against a single reference.
- **Nothing may add a second proposal table.** That is the gate's entire point.

### 5.4 Repository port

```ts
export interface OrderChangeRepositoryPort {
  findOpenByTarget(internalOrderId: string, targetRef: string): Promise<OrderChange | null>;
  findLatestByTarget(internalOrderId: string, targetRef: string, kind: OrderChangeKind): Promise<OrderChange | null>;
  insertRequested(input: CreateOrderChangeInput): Promise<OrderChange>;      // ON CONFLICT DO NOTHING + re-select
  confirm(id: string, at: Date, confirmedBy: string | null): Promise<boolean>;   // WHERE status='requested'
  decline(id: string, at: Date, reason: string): Promise<boolean>;               // WHERE status='requested'
  expire(id: string, at: Date): Promise<boolean>;                                // WHERE status IN (open)
  claimApplied(id: string, at: Date): Promise<boolean>;                          // WHERE "appliedAt" IS NULL
}
```

Every mutator is a narrow conditional UPDATE returning `affected > 0`, per the house discipline.
`insertRequested` recovers from a unique violation by re-selecting the winner
(`IdentifierMappingRepository.insertMapping`'s shape), so a concurrent double-click yields one row
and one adapter call.

**The TTL path is read-then-act, and that is safe — say so rather than adding a lock.** Two concurrent
operators can both observe the same stale open row and both call `expire`; the second `expire`
affects zero rows (`WHERE status IN (open)`), `expired` has left the partial index, and both then
race `insertRequested`, where the index admits exactly one and the loser re-selects the winner. One
row, one adapter call. A per-target lock would buy nothing here and is deliberately not taken.

---

## 6. Implementation plan

### Phase 1 — `order_changes` (CORE / `orders`)

1. **`domain/types/order-change.types.ts`**
   `OrderChangeKindValues = ['return.decline'] as const` (+ `isOrderChangeKind`),
   `OrderChangeStatusValues = ['pending','requested','confirmed','declined','canceled','expired'] as const`
   (+ `isOrderChangeStatus`, `OPEN_ORDER_CHANGE_STATUSES`), `CreateOrderChangeInput`.
   Pure-rule exception applies (the coercion guard is the rule for the union it sits with).
   **Docblock must disambiguate from the existing `OrderAmendmentChange` /
   `OrderAmendmentChangeKind` / `diffOrderAmendment`** (`libs/core/src/orders/domain/order-amendment-diff.ts`):
   that is the ingestion line-diff *observation*, this is an ADR-044 *proposal*. Adjacent names,
   opposite directions.
   *Acceptance*: `pnpm type-check`; no `enum`.
2. **`domain/entities/order-change.entity.ts`** — anemic, readonly, plus one pure derivation
   `isOpen()`. No framework import.
3. **`domain/ports/order-change-repository.port.ts`** — §5.4 verbatim, with R1-R5 in the docblock.
4. **`infrastructure/persistence/entities/order-change.orm-entity.ts`** — class-level `@Index`
   declarations using the **same names** the migration uses (the returns entity's stated rule: the
   int harness builds by `synchronize`, so an unnamed decorator diverges from the migration).
5. **`infrastructure/persistence/repositories/order-change.repository.ts`** — private `toDomain`;
   unique-violation → re-select; `QueryFailedError` never escapes.
6. **`application/services/order-change.service.{interface,ts}`** — `IOrderChangeService`:
   `openOrReuse`, `confirm`, `decline`, `expireIfStale`, `claimApplied`. This is the **only** seam a
   sibling context uses; the repository port stays intra-context.
7. **`order-changes.module.ts`** — leaf module (§3). Add `ORDER_CHANGE_REPOSITORY_TOKEN` and
   `ORDER_CHANGE_SERVICE_TOKEN` to `orders.tokens.ts`; export the module + service interface + types
   from `libs/core/src/orders/index.ts` and the entity from `orm-entities.ts`.
8. **Migration `apps/api/src/migrations/1847000000000-create-order-changes.ts`** — synthetic
   sequential prefix, next free after 1846 (#2327). `up()` creates the table + three indexes;
   `down()` drops them. `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"` guard, matching 1846.
   Register `order_changes` in `apps/api/test/integration/setup.ts` `tablesToTruncate`.

### Phase 2 — the capability (CORE / `orders`)

9. **`libs/core/src/returns/domain/types/return-decline.types.ts`** — the command + result shapes.
   They live in `returns`, not beside the capability, for two reasons that agree: the
   types-in-`*.types.ts` rule, and the `ReturnSourceReader` precedent of a capability file that
   declares only its interface + guard and imports its data types from `@openlinker/core/returns`.
   The returns vocabulary stays owned by `returns`.

10. **`libs/core/src/orders/domain/ports/capabilities/return-decliner.capability.ts`** — interface +
   guard only, importing the two types above.

```ts
export interface ReturnDeclineCommand {
  externalReturnId: string;
  /** ADAPTER-NATIVE and OPAQUE to core. Never parsed, never defaulted here. */
  reasonCode: string;
  /** Operator free text. Some adapters require it for some codes; the ADAPTER enforces that. */
  comment: string | null;
}
export interface ReturnDeclineResult {
  /**
   * The SOURCE's own decline instant. `null` means the source ACCEPTED the
   * request but has not yet reported the decline as a fact — the product spec's
   * `Decline sent` state (§5.6 / US-3: "a 2xx alone never displays as declined
   * by {source}"). Core then leaves `ReturnRecord.declinedAt` NULL and does NOT
   * claim `appliedAt`. There is deliberately no OL-clock fallback.
   */
  declinedAt: Date | null;
  rawStatus: string | null;
  raw?: unknown;
}
export interface ReturnDecliner {
  declineReturn(command: ReturnDeclineCommand): Promise<ReturnDeclineResult>;
  /** OPTIONAL, opaque vocabulary for an operator picker — the `terminalRawStatuses` precedent. */
  readonly declineReasonCodes?: readonly string[];
}
export function isReturnDecliner<T extends object>(a: T): a is T & ReturnDecliner;
```

   The guard tests `declineReturn` only, so the optional vocabulary never gates capability.
   Export from the orders barrel; add the capability name to the Allegro manifest's
   `supportedCapabilities`. **Not** added to `CoreCapabilityValues` (advertised-without-dispatch).

   *Named follow-up, deliberately NOT built here*: nothing yet exposes `declineReasonCodes` or a
   `supported` flag to an operator, so the endpoint requires a code from a vocabulary the UI cannot
   discover, and the product spec's "Decline is visible only where the source supports the write"
   has no backing read. Both belong to the returns **read** API (#2334) — adding a second read
   surface in this slice is exactly the duplication the Phase-5 collision note warns against.

### Phase 3 — the action (CORE / `returns`)

10. **`ReturnRepositoryPort.claimDeclinedAt(id, at): Promise<boolean>`** — conditional UPDATE
    `WHERE id = :id AND "declinedAt" IS NULL`, the `claimWaybillRelay` shape. One method, additive;
    this is the whole returns-side repository widening (kept minimal for #2332 reconciliation).
11. **Three domain exceptions** under `returns/domain/exceptions/`:
    `ReturnNotFoundError`, `ReturnNotAttributedError` (orphan — AC), `ReturnDeclineUnsupportedError`
    (the source declares no decline support — the AC's *distinct* reason).
12. **`ReturnDeclineService`** (`returns/application/services/`), implementing
    `IReturnDeclineService`. The cycle, in order:

    1. Load the return. Absent → `ReturnNotFoundError`.
    2. `internalOrderId === null` → `ReturnNotAttributedError`. **Before** any adapter resolution:
       an orphan must cost nothing.
    3. `declinedAt` already stamped → **idempotent no-op**. Return the existing terminal change (or
       a synthesised already-declined result). No adapter call, no second row.
    4. Resolve the connection's `OrderSource` adapter; narrow with `isReturnDecliner`. Not a
       decliner → `ReturnDeclineUnsupportedError`.
    5. `IOrderChangeService.openOrReuse({ internalOrderId, kind: 'return.decline', targetRef:
       returnId, payload: { reasonCode, comment }, requestedBy })`.
       - An OPEN row that is **older than the TTL** is `expire`d first, then a fresh one opened
         (§6.4).
       - An OPEN row within the TTL is REUSED and the adapter is **not** called again — this is the
         double-call safety the AC asks for, and it is the index doing the work.
    6. `adapter.declineReturn(...)`.
       - Throws a *business* rejection → `IOrderChangeService.decline(changeId, now, reason)`;
         rethrow. The refusal is now a queryable outcome instead of a swallowed error.
       - Throws anything else → leave the change OPEN (in-doubt) and rethrow. The TTL is what stops
         that becoming permanent.
    7. `confirm(changeId, now, 'source:' + connectionId)`.
    8. **Apply — only when the source reported the decline as a fact.**
       `result.declinedAt === null` → stop here: the change is `confirmed`, `appliedAt` stays null,
       `ReturnRecord.declinedAt` stays null, and the return reads `Decline sent`. The product spec
       is explicit that a 2xx alone must never display as "declined by {source}", so there is **no
       OL-clock fallback**, and the stamp is never the request instant.
       `result.declinedAt !== null` → `claimApplied(changeId)`; if claimed,
       `claimDeclinedAt(returnId, result.declinedAt)`.
       *Named gap*: nothing yet re-stamps `declinedAt` from a later feed observation
       (`upsertFromSource` deliberately never writes OL-owned timestamps), so a source that
       confirms without an instant would sit in `Decline sent` indefinitely. **No shipped adapter
       enters that state** — Allegro's 200 body carries `rejection.createdAt` — and the reconciler
       is Wave 2's (#2372 / #2377). It is named in the code rather than papered over.
    **Logging (required, not optional).** Every branch is observable via the shared `Logger`, or a
    409 raised by a background retry is invisible: `warn` on each refusal (orphan, unsupported, not
    found) and on a remote business rejection, `debug` on the idempotent already-declined and
    reuse-open no-ops, `log` on a confirmed-and-applied decline. Each line carries
    `returnId` / `connectionId` / `changeId`; the operator `comment` is never logged.

13. Register in `ReturnsModule`: import `OrderChangesModule`; provide `RETURN_DECLINE_SERVICE_TOKEN`.
    Extend the module docblock's edge inventory (it enumerates every edge and would otherwise lie).

### Phase 4 — Allegro

14. **`AllegroOrderSourceAdapter.declineReturn`** beside the `ReturnSourceReader` block:
    `POST /order/customer-returns/{id}/rejection`, `[BETA]` media type set **per request** via the
    caller-header hook (the existing rule — a client-wide default would retag every other call),
    body `{ rejection: { code, reason? } }` with `reason` omitted when blank.
    - Validates `reasonCode` against `ALLEGRO_RETURN_REJECTION_CODES` and throws
      `AllegroReturnDeclineRejectedException` on a miss — a code Allegro would 400 on should not
      cost a network round trip.
    - Enforces Allegro's own conditional requirement (`reason` required iff
      `code === 'REFUND_REJECTED'`, ≤ 250 chars) locally, for the same reason.
    - Maps 422 → re-read via `this.getReturn`; a `rejection` present means already-declined and
      returns a normal success carrying `rejection.createdAt`; absent means rethrow.
    - `declineReasonCodes = ALLEGRO_RETURN_REJECTION_CODES`.
15. Extend `allegro-customer-return.types.ts` with the rejection request/response shapes and the
    code list. Add `'ReturnDecliner'` to the Allegro manifest.

### Phase 5 — API

16. `apps/api/src/returns/http/return-actions.controller.ts` +
    `apps/api/src/returns/return-actions.module.ts` exporting **`ReturnActionsApiModule`** (the
    `CatalogTrustApiModule` suffix convention), registered in `app.module.ts`. The file and class
    names are pinned so a merge with #2334's likely `ReturnsApiModule` is textual, not semantic.
    `POST /returns/:returnId/decline` (served at `/v1/...` — `apps/api` URI-versions in `main.ts`),
    the global `JwtAuthGuard` plus `@Roles('admin','operator')`,
    `DeclineReturnDto` (`@IsString() @IsNotEmpty() reasonCode`, `@IsOptional() @IsString()
    @MaxLength(500) comment`). `requestedBy` = the authenticated user id — never trusted from the body.
    The three domain exceptions are mapped by a **global filter**
    (`apps/api/src/common/filters/return-decline-exception.filter.ts`, registered in `main.ts`
    beside the five existing ones — the repo convention for a domain exception) to 404 / 409 / 400,
    so a caller can tell an orphan apart from an unsupported source, which the AC requires.
    **`CoreCapabilityValues` is not touched**: `adapter.types.spec.ts` pins its exact 9-element list
    and both connection DTOs `@IsIn` it, so an advertised-without-dispatch name must never appear
    there.
    > **Collision note**: #2334 (`W1c-7`, concurrent) ships the returns *read* API and may create
    > `apps/api/src/returns/returns.module.ts`. The action module is deliberately a separate file
    > with a separate name so the two merge textually; the orchestrator may fold them later.

### Phase 6 — tests

- `order-change.repository.spec.ts` — conditional-update semantics, unique recovery.
- `order-change.service.spec.ts` — openOrReuse / TTL expiry / confirm idempotence.
- `return-decline.service.spec.ts` — the seven-branch table: happy path, orphan, unsupported,
  already-declined no-op, open-proposal reuse, business rejection → `declined`, transport error →
  stays open. Mocks are **ports**, never adapters.
- `allegro-customer-returns.spec.ts` (extend) — request shape, `reason`-required rule, 422 re-read
  branch (both sub-branches), unknown code refused pre-flight.
- `apps/api/test/integration/order-changes-schema.int-spec.ts` — the table, the partial unique
  index actually rejecting a second OPEN row for one target and **accepting** one once the first is
  terminal, and `internalOrderId NOT NULL`. Register `'order_changes'` in
  `apps/api/test/integration/setup.ts` `tablesToTruncate` (beside `'returns'`, line ~127 — it has
  no cascading FK either, so it must be listed explicitly).
- **Run the FULL `pnpm test:integration`**, not only the touched specs: adding a manifest capability
  has previously rippled into routing int-specs. (This audit found no exact-list assertion that
  would break — every Allegro manifest spec uses `expect.arrayContaining` and no integration spec
  references `allegroAdapterManifest` — but the lesson stands.)

### 6.4 The TTL (ADR-044's "explicit TTL", made concrete)

`OL_ORDER_CHANGE_OPEN_TTL_MS`, default **15 min**, clamped `[1 min, 24 h]` (the
`OL_WEBHOOK_SKEW_WINDOW_MS` clamping precedent). Expiry is **lazy**: the next attempt against the
same target expires a stale open row and opens a fresh one. No sweeper ships, and that is a
positive choice — a sweeper is a cron with no other work, whereas the only actor who cares that the
target is locked is the operator who is, by definition, present at the moment it matters. If a
Wave-2 kind acquires a driving sync job, ADR-044's `dead → EXPIRED` rule applies instead and this
lazy path is left untouched.

---

## 7. Alternatives considered

1. **A returns-local `return_decisions` table.** Rejected by the issue and by the gate: Wave 2 would
   have to reconcile or migrate it into `order_changes` within weeks, and the returns action is the
   smallest, safest first `kind` to prove the real shape on.
2. **`declineReturn` on `ReturnSourceReader`.** Rejected — see §3. Records the issue's open question
   as resolved.
3. **Stamping `declinedAt` optimistically and reconciling later.** Rejected outright: ADR-060's
   whole claim is that OL must not pretend to decide what the marketplace decided, and a row that
   says "declined" before the marketplace agreed is exactly that pretence.
4. **`kind` as a PG enum or a `CHECK`.** Rejected — Wave 2 widens `kind`, and a per-kind migration
   is a tax on the gate's own promise.
5. **Making `internalOrderId` nullable so orphan returns could carry a change.** Rejected: it would
   turn the orphan refusal from a schema fact into a service convention, and ADR-044 is about
   *order* mutations.
6. **A background expiry sweeper.** Deferred with reason (§6.4).

---

## 8. Risks & edge cases

| Risk | Handling |
|---|---|
| R1/`kind`-vs-`status` inversion by a later reader | Stated first in the contract, repeated in the entity, port and migration docblocks. |
| Concurrent double-click | Partial unique index + insert-then-re-select; one row, one adapter call. |
| Transport failure after Allegro applied the rejection | Change stays OPEN (in-doubt, honest); TTL releases the target; the retry hits Allegro's 422 path, which re-reads and confirms with the real timestamp. This is the **designed** recovery, not a leftover. |
| Allegro 422 on a return that is not actually rejected | Re-read shows no `rejection` → rethrow. A 422 we cannot explain stays a failure. |
| `#2332` also touching `ReturnRepositoryPort` | One additive method (`claimDeclinedAt`); no existing signature changed. |
| Migration timestamp race with a sibling agent | 1847000000000 claimed; reported to the orchestrator for reconciliation. |
| `synchronize`-built test schema diverging from the migration | Index names declared identically on both sides, per the #2327 rule. |
| PII | `payload` carries only an operator-chosen code and comment. No buyer data. |

**Backward compatibility**: fully additive. New table, new capability (optional, guard-narrowed),
one new repository method, one new endpoint. No existing behaviour changes.

---

## 9. Acceptance criteria (from the issue)

- [ ] `order_changes` exists in its ADR-044 shape, `kind` scoped to return actions
- [ ] `migration:show` reports nothing pending; no `synchronize: true` introduced
- [ ] The proposal row is written **before** the adapter call, never after
- [ ] `declinedAt` stamped only from an observed confirmation
- [ ] A double-call is safe — the proposal row's uniqueness makes the second a no-op
- [ ] Refused for an orphan return
- [ ] Refused with a **distinct** reason where the source declares no decline support
- [ ] Tests added for non-trivial logic
- [ ] No CORE ↔ Integration boundary violation (no Allegro vocabulary in `libs/core`)

---

## 10. Alignment checklist

- [x] Hexagonal layering respected; domain layer framework-free
- [x] CORE ↔ Integration boundary intact (opaque `reasonCode`, adapter-published vocabulary)
- [x] Cross-context contract respected (`I*Service` + tokens; no repository port crosses)
- [x] Existing patterns reused (conditional UPDATE claims, `as const` unions, guard-narrowed
      sub-capability, insert-then-re-select, opaque adapter vocabulary)
- [x] Idempotency: partial unique index, conditional confirm, conditional apply, 422 re-read
- [x] Error handling: three distinct domain exceptions + a business-rejection outcome
- [x] Migration follows the synthetic-sequential convention
- [x] Testing strategy complete
- [x] ADR-044 amended in the same change (see below) rather than a new ADR — this implements an
      existing decision; the amendment records the five deltas in §5.2/§6.4

---

## Related documentation

- [ADR-044](../architecture/adrs/044-order-changeset-proposed-then-confirmed.md)
- [ADR-060](../architecture/adrs/060-returns-aggregate-above-source-projection.md)
- [DESIGN-oms-authority-model](./analysis/DESIGN-oms-authority-model.md) §6.3, §7.3
- [SPIKE-2289-allegro-returns-feed](./analysis/SPIKE-2289-allegro-returns-feed.md)

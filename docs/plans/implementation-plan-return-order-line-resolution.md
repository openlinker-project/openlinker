# Implementation plan — resolve `ReturnLine.resolvedOrderLineId` at ingestion (#3171)

## 1. The goal, restated

Make `ReturnLine.resolvedOrderLineId` hold the `orderSnapshot.items[].id` of the order line a
returned line came from, so the credit-note correction path can stop matching invoice lines by
product name and stop asking the operator to disambiguate a collision core manufactured.

**Layer**: CORE. Domain (a pure resolution rule) + Application (the orchestration) + Infrastructure
(one conditional write).

**Non-goals**, explicitly:

- Consuming the field. Narrowing `return-correction-matching.domain-service.ts` onto
  `resolvedOrderLineId` and retiring the `ambiguous` picker is a follow-up. This slice makes the
  field trustworthy; it changes no existing behaviour.
- Backfilling history. No migration, no re-resolution pass over existing rows.
- Any frontend change.

## 2. Research findings that shape the design

| Finding | Consequence |
|---|---|
| `resolvedOrderLineId` holds `orderSnapshot.items[].id` — stated verbatim at `shipment-line.orm-entity.ts:99-104`, and the same value `reservations.orderLineId` and `FulfillmentWorkLine.orderLineId` already key on | The target is an established address. Nothing is invented. |
| `UpsertReturnLineInput` (`return-upsert.types.ts`) has **no** `resolvedOrderLineId` member, and `return.repository.ts:371` documents the column as *"core-resolved attribution, never adapter-supplied"* | The existing design already says core resolves this SEPARATELY from the source-echo write set. The plan must not add it to the upsert. |
| `IncomingReturnLine.offerId` docblock: *"This is the only line-level linkage a source may supply; resolving it to an OL order line is core's job, not the adapter's."* | The contract already assigns the job. No contract change needed. |
| `OrderItem` (`order.types.ts:236-242`) = `{ id, productId, variantId?, quantity, price, sku? }` — **no `offerId`** | An `offerId` axis needs an offer→variant read in `listings`, which `ReturnsModule` does not have. Deferred; see §5. |
| `claimAttribution` (`return.repository.ts`) is the house idiom: `UPDATE … WHERE <precondition> IS NULL`, `affected > 0` as the answer | The write follows it exactly, giving fill-in-when-NULL monotonicity for free. |
| Both callers of `upsertFromObservation` (`return-ingestion.service.ts:187`, `return-status-sync.service.ts:124`) live **inside** `libs/core/src/returns` | "Let the caller pass the order in" does not avoid an orders edge — it moves it one file. See §3.4. |
| `OrdersModule` imports 14 modules (Integrations, IdentifierMapping, Sync, Products, Mappings, Inventory, Customers, Invoicing, Automation, Currency, OrderHolds, Fulfillment, Fiscalization, SalesDocuments) | Importing it into `ReturnsModule` is acyclic but heavy — 9 are new to returns. |
| `OrderHoldsModule`'s own comment: imported as a leaf *"so `OrderHoldService` … can take it WITHOUT the eight-context graph above"*; and #2712 solved the same shape by having the **worker** do the cross-context write, adding *"zero entries"* to the guard allow-sets | There is an established preference for not taking the fat edge. |

## 3. Design

### 3.1 The pure rule — `returns` domain

New: `libs/core/src/returns/domain/domain-services/return-order-line-resolution.domain-service.ts`,
beside the `return-correction-matching.domain-service.ts` it mirrors.

```ts
/** The subset of an order line this rule needs. Supplied by the caller. */
export interface ResolvableOrderLine {
  id: string;
  sku?: string;
  variantId?: string;
  quantity: number;
  price: number;
}

export interface ResolvableReturnLine {
  sku: string | null;
  offerId: string | null;
  unitPrice: number | null;
  quantityAdvised: number;
}

export const ReturnOrderLineUnresolvedReasonValues = [
  'no-candidate', // nothing matched on any axis
  'ambiguous',    // several survived every axis — never guessed
  'no-axis',      // the return line carries no sku and no unit price
] as const;
export type ReturnOrderLineUnresolvedReason =
  (typeof ReturnOrderLineUnresolvedReasonValues)[number];

export type ReturnOrderLineResolution =
  | { status: 'resolved'; orderLineId: string; matchedOn: 'sku' | 'sku+price' }
  | { status: 'unresolved'; reason: ReturnOrderLineUnresolvedReason };

export function resolveReturnLineOrderLine(
  line: ResolvableReturnLine,
  orderLines: readonly ResolvableOrderLine[],
): ReturnOrderLineResolution;
```

Rule, strongest axis first, and it **refuses rather than guesses**:

1. **`sku`**, exact after trim, case-sensitive. SKUs are operator-authored identifiers, not prose —
   the case/diacritic-folding argument that applies to product names does not apply here. One
   survivor ⇒ `resolved`, `matchedOn: 'sku'`.
2. **`unitPrice`** as the tie-break among several same-SKU survivors — exactly the duplicate-line
   case the picker exists for. One survivor ⇒ `resolved`, `matchedOn: 'sku+price'`.
3. More than one survivor ⇒ `unresolved / 'ambiguous'`. Zero ⇒ `'no-candidate'`. Neither SKU nor
   unit price on the return line ⇒ `'no-axis'`.

Pure: no I/O, no injected dependency, no argument mutation — asserted by a spec that scans its own
source, the discipline #2359's evaluator already holds.

**Deliberately NOT matched on `name`.** That is the axis whose collisions this issue exists to
remove; reintroducing it as a fallback would reintroduce the ambiguity one layer down.

### 3.2 The write — `returns` infrastructure

`ReturnRepositoryPort` gains:

```ts
/**
 * Fill-in-when-NULL, never a correction. A failed re-resolve must not be able
 * to un-resolve a line, for the same reason `claimAttribution` is monotonic.
 * `false` means the line already carried a resolution — an ordinary outcome.
 */
claimOrderLineResolution(returnLineId: string, orderLineId: string): Promise<boolean>;
```

Implementation copies `claimAttribution` in shape: `UPDATE return_lines SET "resolvedOrderLineId" =
:orderLineId WHERE "id" = :id AND "resolvedOrderLineId" IS NULL`, wrapped in the existing
`ReturnPersistenceError`.

`upsertFromSource`'s write set is **untouched**, and a spec is added so a future edit cannot let the
source echo the column.

### 3.3 The orchestration

`IReturnsService` gains one method that takes the order's lines **as an argument** (ADR-053's
"order data enters as arguments" discipline):

```ts
resolveOrderLinesForReturn(
  returnId: string,
  orderLines: readonly ResolvableOrderLine[],
): Promise<ReturnOrderLineResolutionSummary>; // { resolved, unresolved, byReason }
```

It reads the return's lines, applies the pure rule per line, claims each resolution, and returns a
summary. An unresolved line leaves the column `null` and is counted — never defaulted.

### 3.4 Where the order is read — the open question

Two defensible wirings. The plan does not pick unilaterally, because the cost is architectural
rather than local.

**Option A — `returns` reads the order itself.** `ReturnsService` injects
`ORDER_RECORD_SERVICE_TOKEN`, calls `getOrderRecord(internalOrderId)` at the end of
`upsertFromObservation`, and resolves. `ReturnsModule` imports `OrdersModule`.

- *For*: resolution happens on every ingestion path automatically, including
  `return-status-sync.service.ts`; one place; nothing for a caller to forget.
- *Against*: pulls 9 new modules into `ReturnsModule`'s graph. Against the `OrderHoldsModule` /
  #2712 grain. Needs an architecture-doc edge entry and a boot int-spec.

**Option B — the worker composes it.** The `marketplace.return.*` handlers in `apps/worker` (which
already compose `OrdersModule`) read the order after ingestion and call
`resolveOrderLinesForReturn`. `returns` takes no new edge at all.

- *For*: zero new module edges and zero guard allow-set entries — the repo's own stated
  evidence-of-correctness test (#2712). Keeps `ReturnsModule` light for both hosts.
- *Against*: two call sites to wire; a third ingestion path added later must remember to call it —
  mitigated by the returned summary being logged, so a missing call reads as "never resolved".

**Recommendation: Option B.** The repo has solved this exact shape twice and chose the worker both
times. `returns` is already the second-most-coupled context in the tree; a 9-module edge for one
read is the expensive way to buy it.

Needed under either option: a narrowing accessor for the items. `orderSnapshot` is
`Record<string, unknown>`, and `OrderRecord` already centralises exactly this kind of key +
narrowing (`readPaymentStatus`, `readCustomerEmail`, `readCodToCollect`, `readShippingMethodId`).
Add `readOrderLines(): ResolvableOrderLine[]` in the same shape — a pure ADR-011 derivation on the
entity, so no consumer re-parses the jsonb.

## 4. Steps

| # | File | Change | Done when |
|---|---|---|---|
| 1 | `libs/core/src/returns/domain/domain-services/return-order-line-resolution.domain-service.ts` | the pure rule + its types | unit spec covers resolved-by-sku, price tie-break, ambiguous, no-candidate, no-axis |
| 2 | `libs/core/src/returns/index.ts` | export the rule + types | barrel-purity spec still passes |
| 3 | `libs/core/src/returns/domain/ports/return-repository.port.ts` | `claimOrderLineResolution` | — |
| 4 | `libs/core/src/returns/infrastructure/persistence/repositories/return.repository.ts` | the conditional write | int-spec: two overlapping claims, exactly one wins |
| 5 | `libs/core/src/orders/domain/entities/order-record.entity.ts` | `readOrderLines()` narrowing accessor | unit spec incl. a malformed snapshot returning `[]` |
| 6 | `libs/core/src/returns/application/services/returns.service{.interface,}.ts` | `resolveOrderLinesForReturn` | unit spec with a fake repository |
| 7 | `apps/worker/src/returns/*` (Option B) **or** `returns.service.ts` + `returns.module.ts` (Option A) | the wiring | int-spec: an ingested return with a matching order gets its lines resolved |
| 8 | `libs/core/src/returns/__tests__/` | assert `upsertFromSource` never writes the column | spec fails if the column enters either half |
| 9 | `docs/architecture-overview.md` § Returns | record the resolution + (Option A only) the new edge | — |

## 5. Validation

- **Architecture**: no CORE↔Integration breach; no `*RepositoryPort` crosses a context;
  `check-cross-context-imports.mjs` and `barrel-purity.spec.ts` unaffected under Option B.
- **Naming**: `*.domain-service.ts` for the pure rule, `*.port.ts` for the contract, `as const` +
  union for the reason vocabulary — all per `engineering-standards.md`.
- **Security**: nothing new reaches an operator or a wire; `unitPrice` is already persisted.
- **Deferred, and stated rather than silent**: the `offerId` axis (needs an offer→variant read in
  `listings`); the operator-authored `recordReturn` path (holds a known order and can reuse the same
  rule — a short follow-up, called out rather than left silently `null`).

## 6. Risks

1. **A genuinely ambiguous order.** Two order lines identical in SKU *and* price resolve to
   `unresolved`, which is correct and leaves today's behaviour in place for that case. The picker's
   removal therefore cannot be claimed as universal — the follow-up must keep an unresolved path.
2. **`sku` is optional on both sides.** A source reporting no SKU resolves nothing. Expected, and
   reported as `'no-axis'` rather than silently skipped.
3. **Option A's module graph.** If chosen, the boot int-spec is not optional.

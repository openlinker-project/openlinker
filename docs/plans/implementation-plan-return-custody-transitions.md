# Implementation plan — drive the return custody union (#2367, `W2-30`)

## 1. Problem

Wave 1c shipped `ReturnCustodyStateValues` (`advised | in_transit | received | disposed | not_returned`)
as a column defaulted to `advised` and **never written**. #2370 (`W2-33`) is the receive/dispose write
path and lists this issue as a blocker: it must call a named transition rather than assigning the
column itself, or the rule ends up restated once per write path.

## 2. Boundary against #2370 (the consumer)

| Owned here (#2367) | Owned by #2370 |
|---|---|
| The custody transition rules (pure) | The repository write methods + their transaction |
| Quantity-awareness of each transition | Persisting counters, `restock_blocked` column + migration |
| The refusal vocabulary for an illegal/impossible transition | Mapping that refusal to HTTP 409 |
| Terminality (`isReturnCustodyFinished`) | `adjustInventory`, automation triggers T6/T7 |

**No migration.** The union shipped in its final five-member shape in Wave 1c and this slice adds no
column. The wave-allocated timestamp `1852000000000` is therefore left unused.

## 3. Shape — pure functions, no application service

The issue's classification names `application/services/`. **Declined, with the house precedent
stated:** every shipped pure rule in this tree is a plain exported function consumed directly —
`applyPricingRule`, `applyStockSafetyBuffer`, `checkRequiredToSell`, `applyDescriptionFormat`,
`splitShippingAcrossRates`, `resolveSalesDocumentRouting`, and — in this very programme —
`deriveOrderLifecyclePhase` under `domain/domain-services/`. An `@Injectable` that forwards to a
pure function with no injected dependency is ceremony, and #2370 needs the computation *inside* the
transaction it already holds the row in; a service method would invite a read-then-write race by
re-reading. `evaluateSalesDocumentRules` got a service only because it needed a database — this
does not.

Home: `libs/core/src/returns/domain/domain-services/return-custody-transitions.ts`, the
`derive-order-lifecycle-phase.ts` shape, rather than `domain/types/` — the file is a rule engine,
not the union's own coercion, and `return-line.types.ts` already carries three vocabularies.

## 4. The four named transitions

Input is a `ReturnCustodyLineFacts` projection of the line's persisted custody columns and counters
(never a `ReturnLine`, so #2370 can call it with an in-transaction row and the FE mirror later has
one shape to mirror). Output is `ReturnCustodyOutcome` = the resulting `custodyState`, the two
timestamps, and the resulting counters. **No ids, no persistence, no clock of its own.**

1. `advanceReturnCustodyToInTransit(facts, { observedAt })` → `in_transit`. Legal from `advised`
   only. `observedAt` is **the source's own instant** — `in_transit` is the one custody fact OL
   cannot witness (the buyer handed the parcel to a carrier), so the house rule that a 2xx must not
   stand in for a channel-reported fact applies exactly. It is required, and a caller with no source
   instant has no business making this transition.
2. `applyReturnCustodyReceipt(facts, { quantity, at })` → `received`. Legal from `advised`,
   `in_transit` and `received` (a second partial receipt). `receivedAt` is stamped **at most once**
   — the first receipt is when the parcel arrived. `at` is OL's own clock legitimately: the operator
   pressed the button in OL, so OL is the actor and the authority.
3. `applyReturnCustodyDisposition(facts, { quantity, disposition, at })` → stays `received` while
   `restocked + scrapped < received`, becomes `disposed` when they meet. `disposedAt` stamps only on
   reaching `disposed`, and is cleared by nothing (a later receipt re-opens the line to `received`
   and clears it, since the line is demonstrably not finished).
4. `markReturnCustodyNotReturned(facts, { at })` → `not_returned`. Legal from `advised`/`in_transit`
   with `quantityReceived === 0` only, and always an operator act — never a timeout (spec §5.2).

Plus `isReturnCustodyFinished(state)` — the "All open" segment's custody half — as an exhaustive
switch over all five values closed with `assertNever`.

## 5. Refusals

One domain error, `ReturnCustodyTransitionError`, carrying `{ from, attempted, reason }` with a
closed `ReturnCustodyRefusalReason` union so #2370/#2376 map to distinguishable codes rather than
matching on a message. Reasons: `illegal-transition`, `non-positive-quantity`, `over-receipt`,
`over-disposition`, `partially-received` (the `not_returned` case below).

## 6. The one thing this slice refuses to invent

Spec §5.2's *"Mark remainder not returned"* on a **partially received** line has no home in the
shipped model: custody is single-valued per line, the line still holds units needing disposition, and
there is no `quantityNotReturned` counter to move the shortfall into. Rather than fabricate a
meaning, `markReturnCustodyNotReturned` refuses a partially-received line with the distinct
`partially-received` reason, and the docblock records that the shortfall on such a line is already
expressed by `quantityAdvised - quantityReceived` staying visible after the line reaches `disposed`.
Adding a counter is a model change and needs #2370's migration plus a spec amendment, not a guess
here.

## 7. Files

- NEW `libs/core/src/returns/domain/domain-services/return-custody-transitions.ts`
- NEW `libs/core/src/returns/domain/domain-services/return-custody-transitions.spec.ts`
- NEW `libs/core/src/returns/domain/exceptions/return-custody-transition.error.ts`
- EDIT `libs/core/src/returns/domain/types/return-line.types.ts` — re-confirm the reversal gate,
  name `ReturnReceiver`, point at the new module
- EDIT `libs/core/src/returns/index.ts` — export the transitions, their types and the error
- EDIT `docs/architecture-overview.md` § 22 Returns — one bullet
- EDIT `docs/plans/oms-progress-ledger.md`

## 8. Gates

`pnpm lint`, `pnpm type-check`, `pnpm test`, `pnpm check:invariants`. No integration blast radius
(no schema, no module, no HTTP), so no int-spec is targeted; the returns int-specs are re-run as a
sanity check only if the barrel export changes their resolution.

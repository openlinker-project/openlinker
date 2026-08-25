/**
 * Return Downstream Trigger Types
 *
 * The named downstream flows a return can drive, and the vocabulary the attribution
 * guard refuses them by (#2332, ADR-060).
 *
 * Three members are the flows `DESIGN-oms-authority-model.md` § 7.3 names, all of them
 * Wave 2:
 *
 *  - `restock` — an adjustment against the `InventoryMaster` for a received, restockable
 *    line.
 *  - `refund` — OL holding the refund TRIGGER while the marketplace/PSP executes.
 *  - `invoice_correction` — proposing a correction through the existing `CorrectionIssuer`
 *    / `issuedLineSnapshot` seam.
 *
 * The fourth, `decline`, is a different SHAPE of flow — an OL→source write (#2333's
 * ADR-044 `return.decline` proposal) rather than a §7.3 downstream consequence — and it
 * is a member anyway, because this union is not a taxonomy of flows: it is *the
 * vocabulary the attribution guard refuses by*, and a decline is refused by that guard
 * on the same grounds. #2333's own contract states it structurally (R3): an ADR-044
 * proposal has a NOT NULL `internalOrderId`, so there is not even a row an orphan
 * decline could record itself as. Leaving it out would have left `ReturnDeclineService`
 * spelling its own `internalOrderId === null` check — exactly the second orphan rule the
 * paragraph below exists to forbid, and the one that produced two rival
 * `ReturnNotAttributedError` classes when #2332 and #2333 were built in parallel.
 *
 * **The rule this vocabulary exists to carry**: a new downstream flow adds a value here
 * and calls `IReturnsService.assertAttributedForTrigger`. It does **not** write its own
 * orphan check. Four call sites each free to spell `internalOrderId === null` are four
 * chances to forget, and forgetting is silent — a restock against a phantom order moves
 * real stock and is not recoverable by a later log line.
 *
 * The value is carried on `ReturnNotAttributedError` so the refusal names WHICH flow was
 * refused; an operator reading "restock blocked" and "refund blocked" needs to tell them
 * apart.
 *
 * Domain-only: no framework dependencies.
 *
 * @module domain/types
 * @see docs/architecture/adrs/060-returns-aggregate-above-source-projection.md
 */

export const ReturnDownstreamTriggerValues = [
  'restock',
  'refund',
  'invoice_correction',
  'decline',
] as const;

export type ReturnDownstreamTrigger = (typeof ReturnDownstreamTriggerValues)[number];

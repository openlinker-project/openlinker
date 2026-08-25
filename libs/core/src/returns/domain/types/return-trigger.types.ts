/**
 * Return Downstream Trigger Types
 *
 * The named downstream flows a return can drive, and the vocabulary the attribution
 * guard refuses them by (#2332, ADR-060).
 *
 * Each member is one of the three flows `DESIGN-oms-authority-model.md` § 7.3 names, all
 * of them Wave 2:
 *
 *  - `restock` — an adjustment against the `InventoryMaster` for a received, restockable
 *    line.
 *  - `refund` — OL holding the refund TRIGGER while the marketplace/PSP executes.
 *  - `invoice_correction` — proposing a correction through the existing `CorrectionIssuer`
 *    / `issuedLineSnapshot` seam.
 *
 * **The rule this vocabulary exists to carry**: a new downstream flow adds a value here
 * and calls `IReturnsService.assertAttributedForTrigger`. It does **not** write its own
 * orphan check. Three call sites each free to spell `internalOrderId === null` are three
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

export const ReturnDownstreamTriggerValues = ['restock', 'refund', 'invoice_correction'] as const;

export type ReturnDownstreamTrigger = (typeof ReturnDownstreamTriggerValues)[number];

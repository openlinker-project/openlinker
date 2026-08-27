/**
 * Return Line Event Types (#2370, `W2-33`, ADR-060)
 *
 * The vocabulary of the per-line ACT LEDGER — the append-only record of what an
 * operator actually did to a return line, sitting beside the counters rather
 * than replacing them.
 *
 * ## Why acts exist at all, when the counters were the model
 *
 * `quantityReceived` is a COUNTER, not an ACT, and a counter cannot key an
 * idempotent firing. #2360 requires that a return arriving in three parcels
 * fires `return.received` three times; a counter going `1 -> 2 -> 3` carries no
 * per-arrival identity to key on and is **indistinguishable from a correction**
 * (someone fixing a miscount from 3 down to 2 and back up). Three parcels are
 * three rows here, so three firings with three distinct keys.
 *
 * It also gives the idempotency key #2368 already specified something to name:
 * `return:{returnId}:{lineId}:{seq}` presupposes a per-line sequence, and under
 * a counters-only model there is no natural `seq` at all.
 *
 * ## The counters remain the invariant — this is history BESIDE it
 *
 * `CHK_return_lines_quantity_ordering` still guards `return_lines`, so no
 * caller (including one bypassing this context) can persist an impossible line.
 * The acts are written in the SAME transaction as the counters they explain,
 * and a spec asserts they sum back to them. They are deliberately NOT a source
 * the counters are recomputed from at read time: that would put an aggregate on
 * the hottest path and move the invariant out of the CHECK's reach.
 *
 * @module domain/types
 * @see docs/architecture/adrs/060-returns-aggregate-above-source-projection.md
 * @see docs/specs/product-spec-oms-returns-operator-ux.md § 5.2, § 5.3, § 5.4
 */
import type { ReturnDisposition } from './return-line.types';

/**
 * What kind of act this row records.
 *
 * `stock_attestation` is an act rather than a flag on a disposition because it
 * is a separate thing a separate human did at a separate time — spec § 5.4 asks
 * the timeline to carry BOTH *"Restock blocked"* and *"Stock handled manually"*,
 * and it says the attestation is *"permanent in the timeline and on the line;
 * only the attention clears"*. Folding it into the blocked act would erase the
 * first of those two entries.
 *
 * `not_returned` (#2380) is likewise an act rather than a bare state flip: the
 * operator asserting *"this parcel is not coming"* is a decision by a named
 * human at a known time, and the timeline is where that belongs. It carries the
 * shortfall as its quantity.
 *
 * **Nothing in the tree branches on this union, and nothing checks it.** There
 * is no `assertNever` switch, no exhaustive `Record`, and the persistence read
 * reaches it through a cast — so adding a member here breaks no build and warns
 * no author. Find the consumers by grep, deliberately; the compiler will not.
 */
export const ReturnLineEventKindValues = [
  'receive',
  'dispose',
  'stock_attestation',
  'not_returned',
] as const;

export type ReturnLineEventKind = (typeof ReturnLineEventKindValues)[number];

/**
 * What became of the master stock write this act implied.
 *
 * `not_applicable` covers every act that never had a book write to make — a
 * receipt, and a `scrap` disposition (spec § 5.3: *"Writes the units off. Stock
 * is not changed."*).
 *
 * `in_doubt` is the honest state for a crossing whose outcome OL did not
 * observe — the act is persisted BEFORE the adapter call (the ADR-056
 * attempted-predicate ordering), so a process that dies mid-call leaves this
 * rather than silence. It **never auto-retries**: OL does not know whether the
 * units reached the master's book, and guessing in either direction moves real
 * stock. Its remediation is the same operator attestation a block gets.
 *
 * `deduplicated` is a SUCCESS (#2368) — the adapter recognised a repeated
 * idempotency key and applied nothing because the units are already in the
 * master's book. Counting them twice is the defect that value exists to prevent.
 *
 * `handled_manually` is only ever carried by a `stock_attestation` act.
 *
 * Note the deliberate spelling parallel with `ReturnMoneyState.in_doubt`: both
 * mean *boundary crossed, outcome unobserved*. They are never compared — one is
 * about goods, the other about money, and ADR-060 keeps those axes orthogonal.
 */
export const ReturnRestockStateValues = [
  'not_applicable',
  'in_doubt',
  'applied',
  'deduplicated',
  'blocked',
  'handled_manually',
] as const;

export type ReturnRestockState = (typeof ReturnRestockStateValues)[number];

/**
 * The states an operator still has to do something about.
 *
 * Spec § 5.4: *"The segment counts UNHANDLED blocks, not historical ones"* — an
 * operator who resolves twelve blocked lines and still reads `Restock blocked 12`
 * learns the number is decoration. Exported as the one definition so the line
 * badge, the list segment and the attestation's own eligibility check cannot
 * disagree about what "outstanding" means.
 */
export const OUTSTANDING_RESTOCK_STATES: readonly ReturnRestockState[] = ['blocked', 'in_doubt'];

export function isOutstandingRestockState(state: ReturnRestockState): boolean {
  return OUTSTANDING_RESTOCK_STATES.includes(state);
}

/**
 * Why the master write did not land — the CLOSED half of the refusal.
 *
 * Deliberately paired with a free-text detail (see
 * {@link ReturnLineEvent.restockBlockedDetail}) rather than being widened to
 * cover every adapter's reasons: #2369 alone distinguishes four PrestaShop
 * refusals, and a union that tried to enumerate them would have to grow for
 * every future master while still failing to carry the one sentence an operator
 * can act on.
 */
export const ReturnRestockBlockReasonValues = [
  /** The master's own `adjustInventory` refused — see the detail for its words. */
  'master-refused',
  /** The neutral `MasterProductNotFoundError` (#1688, widened to the write path by #2369). */
  'master-product-not-found',
  /** No connection with `InventoryMaster` resolved — there is no book to write to. */
  'no-inventory-master',
  /**
   * The line names no product OpenLinker holds, so there is no inventory row to
   * adjust. A real state rather than an error: a marketplace can report a return
   * line whose sku was never catalogued here, and the parcel still arrived.
   */
  'unresolved-product',
  /**
   * The line's sku matches several variants. Never a silent pick, for the same
   * reason `ambiguous-inventory-master` is not: restocking the wrong variant
   * moves real stock and no later log line recovers it.
   */
  'ambiguous-product',
  /**
   * More than one `InventoryMaster` connection resolved. Never a silent pick:
   * a wrong pick moves real stock in the wrong book, which is the #2047
   * discipline applied to inventory instead of fiscal documents.
   */
  'ambiguous-inventory-master',
  /** The connection resolved but its adapter could not be built (disabled, credentials). */
  'adapter-unresolved',
  /** Anything else the adapter threw. Never swallowed, never assumed benign. */
  'unknown',
] as const;

export type ReturnRestockBlockReason = (typeof ReturnRestockBlockReasonValues)[number];

/**
 * Who put the units back on the shelf, in the book that counts.
 *
 * `operator_out_of_band` is the same honesty device the refund trigger uses
 * (ADR-060): OL records that a human did it, and never claims it wrote the
 * stock itself.
 */
export const RestockedByValues = ['inventory_master', 'operator_out_of_band'] as const;

export type RestockedBy = (typeof RestockedByValues)[number];

/**
 * Create-input for one act. `seq` is allocated by the repository inside the
 * write, never by a caller — it is the value the idempotency key is built from,
 * so two callers computing it independently is the one thing that must not
 * happen.
 */
export interface CreateReturnLineEventInput {
  returnId: string;
  returnLineId: string;
  kind: ReturnLineEventKind;
  /** Units this act is about. Always positive — a correction is its own act. */
  quantity: number;
  /** Only ever set on a `dispose` act. */
  disposition: ReturnDisposition | null;
  restockState: ReturnRestockState;
  restockBlockedReason: ReturnRestockBlockReason | null;
  /** The adapter's own sentence, verbatim. Null when nothing was refused. */
  restockBlockedDetail: string | null;
  restockedBy: RestockedBy | null;
  /**
   * WHICH inventory master this attempt was made against.
   *
   * Persisted on the act rather than resolved at read time because the block is
   * a fact about one attempt: spec § 5.4's remediation copy names the system
   * that refused (*"Add {n} × {sku} in {connection name} yourself"*), and an
   * operator who has since reconfigured their master must still be told which
   * book the units are missing from. `null` when the refusal happened before any
   * connection was chosen (nothing configured, or several claimed the role).
   */
  masterConnectionId: string | null;
  note: string | null;
  /** The operator. Nullable so a future non-interactive writer is expressible. */
  actorUserId: string | null;
  /**
   * When the act happened. **OL's own clock is authoritative here** — receiving
   * a parcel, disposing of goods and attesting to a manual restock are all acts
   * an operator performs inside OpenLinker, with OL as the sensor. That is the
   * other side of #2367's `in_transit` rule, where the fact belongs to the
   * outside world and OL's clock may not stand in for it.
   */
  occurredAt: Date;
  /** Set only on a `stock_attestation`: the act it resolves. */
  attestedByEventId: string | null;
}

/** Fields settled onto an already-persisted act once its outcome is known. */
export interface SettleReturnLineEventInput {
  restockState: ReturnRestockState;
  /** See {@link CreateReturnLineEventInput.masterConnectionId}. */
  masterConnectionId?: string | null;
  restockBlockedReason: ReturnRestockBlockReason | null;
  restockBlockedDetail: string | null;
  restockedBy: RestockedBy | null;
}

/**
 * Return Line Types
 *
 * The per-line vocabulary of the `returns` context (#2327, ADR-060): the two
 * ORTHOGONAL per-line machines and the disposition a disposed line records.
 *
 * **Declared in #2327, undriven until Wave 2.** Every column backed by these
 * unions landed with a DEFAULT and nothing in that slice transitioned it.
 * Custody is now driven by #2367's transition rules (see
 * `domain/domain-services/return-custody-transitions.domain-service.ts`);
 * `ReturnMoneyState` and `ReturnDisposition` remain undriven here — money is
 * #2371 and the disposition is written by #2370's dispose path.
 *
 * **Custody and money are never collapsed** (ADR-060). Marketplaces routinely
 * refund before the goods arrive, so a single "return state" would have to lie
 * about one axis or the other on the most common path there is.
 *
 * @module domain/types
 */
import type { RefundReason } from '@openlinker/core/orders/types';

/**
 * Custody — "where is the parcel?". EXACTLY FIVE values, and `inspected` is
 * deliberately ABSENT.
 *
 * ADR-060's original list carried `inspected`; #2327 collapsed it into
 * `received` and the ADR was amended to match. Nothing in the tree writes it
 * and no shipped surface distinguishes an inspected parcel from a received one,
 * so it would be a value that exists only to be skipped. The reversal gate is
 * named in the returns product spec § 3.1 — a `ReturnReceiver`/3PL receiving
 * flow, where the receiving party and the inspecting party genuinely differ,
 * re-admits it. Until then, adding it back is a decision, not a fix.
 *
 * **DRIVEN SINCE #2367**, and the gate now has teeth. The transitions live in
 * `return-custody-transitions.domain-service.ts` and every switch over this
 * union is closed with `assertNever`, so re-admitting `inspected` makes each
 * consumer a compile error rather than a silent fallthrough — which is what
 * spec § 3.1's *\"before any downstream consumer branches on custody, never
 * after\"* asks for. The gate itself is unchanged: a `ReturnReceiver` that can
 * report an inspection OUTCOME, not merely a receipt.
 */
export const ReturnCustodyStateValues = [
  'advised',
  'in_transit',
  'received',
  'disposed',
  'not_returned',
] as const;

export type ReturnCustodyState = (typeof ReturnCustodyStateValues)[number];

/**
 * Money — "what happened to the buyer's money?". Six values.
 *
 * `in_doubt` is the honest one: OL ships no refund WRITE, so a triggered refund
 * whose execution OL cannot observe must be recordable as unknown rather than
 * silently reported as `refunded`. `refunded` is entered only on OBSERVATION.
 *
 * **DRIVEN SINCE #2371** by `ReturnRefundService`. Two rules govern it, and both
 * are stated as code below: which states permit a fresh attempt
 * ({@link isRefundAttemptable}), and the fact that `in_doubt` is only ever
 * written where a provider boundary was ACTUALLY crossed — on the no-executor
 * path (the only one reachable today) the claim settles straight to `triggered`,
 * because claiming to be unsure about a call that never happened is a false
 * statement about the operator's money.
 */
export const ReturnMoneyStateValues = [
  'not_refundable',
  'pending',
  'triggered',
  'refunded',
  'denied',
  'in_doubt',
] as const;

export type ReturnMoneyState = (typeof ReturnMoneyStateValues)[number];

/**
 * The money states from which a refund may be ATTEMPTED (#2371, ADR-056).
 *
 * Exported as the ONE definition — the repository's claim predicate and the
 * service's refusal both read it, so they cannot disagree about what "already
 * attempted" means. The complement is what BLOCKS: `triggered`, `refunded` and
 * `in_doubt` all mean a boundary was crossed or a settlement stands, and a
 * second attempt against any of them risks refunding the buyer twice.
 *
 * **`not_refundable` is in the attemptable set because it is the column's
 * DEFAULT, not because the name says so.** #2327 landed `moneyState` defaulted
 * and undriven, so every line in every install carries it; excluding it would
 * make no return refundable at all. When a later slice sets `pending` at
 * ingestion, this set narrows to `pending | denied` with no change at either
 * call site — which is the point of it being one function.
 *
 * Only a TERMINAL `denied` re-admits a blocked line: the ADR-042 discipline by
 * name — the provider is known to have moved nothing, so another attempt is
 * safe. An `in_doubt` line is never re-admitted automatically; it needs an
 * OBSERVATION (see `IReturnRefundService.recordRefundObservation`).
 */
export const REFUND_ATTEMPTABLE_MONEY_STATES: readonly ReturnMoneyState[] = [
  'not_refundable',
  'pending',
  'denied',
];

export function isRefundAttemptable(state: ReturnMoneyState): boolean {
  return REFUND_ATTEMPTABLE_MONEY_STATES.includes(state);
}

export function blocksRefundAttempt(state: ReturnMoneyState): boolean {
  return !isRefundAttemptable(state);
}

/**
 * What the operator did with the goods. `restock | scrap` ONLY.
 *
 * `refurbish` / RTV imply downstream processes OL has no entity for — a
 * disposition whose consequence nobody executes is precisely the Wave-4 failure
 * mode ADR-060 exists to avoid.
 */
export const ReturnDispositionValues = ['restock', 'scrap'] as const;

export type ReturnDisposition = (typeof ReturnDispositionValues)[number];

/**
 * Create-input for one return line.
 *
 * Every attribution field is nullable because attribution routinely fails, and
 * a line OL cannot attribute is still a real parcel arriving at a real
 * building. The counters the DB CHECK constrains are the ones that are not.
 */
export interface CreateReturnLineInput {
  /** Positional index within the source's own line list; also the display sort. */
  lineIndex: number;
  externalLineId: string | null;
  /**
   * Nullable BY DESIGN. `order_records` has NO lines table — items live inside
   * the `orderSnapshot` jsonb document — so this is a by-value reference INTO
   * that document and a foreign key is not merely undesirable here, it is
   * impossible. A line that cannot be attributed still persists and still
   * blocks the downstream triggers that need attribution.
   */
  resolvedOrderLineId: string | null;
  /** Best-effort provenance, never authority. */
  offerId: string | null;
  sku: string | null;
  /** Display fallback for when attribution fails and there is no product to name. */
  name: string | null;
  /**
   * `RefundReason` reused VERBATIM (ADR-060) so returns-by-reason and
   * refunds-by-reason report on ONE axis rather than two vocabularies an
   * analyst has to reconcile. The type is imported from the
   * `@openlinker/core/orders/types` cycle-breaker sub-barrel, not the
   * module-bearing main `orders` barrel.
   */
  reason: RefundReason;
  /**
   * What the source says is coming back. Erli spells this `quentity`; that
   * typo is normalised AT THE ADAPTER (#2329), never in core.
   */
  quantityAdvised: number;
  note: string | null;
}

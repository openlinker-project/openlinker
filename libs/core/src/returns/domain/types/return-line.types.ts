/**
 * Return Line Types
 *
 * The per-line vocabulary of the `returns` context (#2327, ADR-060): the two
 * ORTHOGONAL per-line machines and the disposition a disposed line records.
 *
 * **Declared now, undriven until Wave 2.** Every column backed by these unions
 * lands with a DEFAULT and nothing in this slice transitions it — there is no
 * state machine, no transition guard and no derived stage here. Declaring the
 * vocabulary early is what lets #2329's ingestion and the Wave-2 receive/dispose
 * flows adopt one spelling instead of inventing two.
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

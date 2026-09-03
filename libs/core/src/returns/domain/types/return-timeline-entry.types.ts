/**
 * Return Timeline Entry Types
 *
 * The neutral projection an order-scoped read of return activity returns
 * (#2383), so the order timeline can show that a return happened and what has
 * been done about it without the operator leaving for `/returns`.
 *
 * **The `source` discriminator is about WHERE the entry came from, not what
 * kind of act it was.** The four in-scope facts live in three different places
 * — the custody act ledger, header columns on `returns`, and a `RefundRecord`
 * in the `orders` context — and each carries a different set of fields. A
 * consumer must never have to infer provenance from which fields happen to be
 * populated.
 *
 * That is also why this union stays separate from `ReturnLineEventKindValues`
 * rather than being flattened into one: those four values name ACTS, these
 * three name SOURCES, and a mapper's unrecognised-kind arm must not quietly
 * absorb an unrecognised source as well.
 *
 * @module domain/types
 */
import type { ReturnOrigin } from './return.types';
import type { ReturnRestockState } from './return-line-event.types';

export const ReturnTimelineSourceValues = ['custody_act', 'record_status', 'refund'] as const;

export type ReturnTimelineSource = (typeof ReturnTimelineSourceValues)[number];

/**
 * What happened, in the vocabulary of whichever source reported it.
 *
 * Deliberately a plain `string` on the wire rather than a closed union: a
 * consumer that does not recognise a value must render it rather than drop it
 * (a silent drop is the disappearance defect this programme keeps closing), and
 * a closed type would invite the opposite. The values OL writes today are
 * `receive | dispose | stock_attestation | not_returned` (custody acts),
 * `opened | declined` (record status) and `refund_confirmed`.
 */
export interface ReturnTimelineEntry {
  /** Stable within one read — used as the timeline row key. */
  id: string;
  source: ReturnTimelineSource;
  kind: string;
  /**
   * Never null. Every in-scope source supplies an instant — the custody ledger
   * its `occurredAt`, the header its `openedAt` / `declinedAt`, the refund its
   * `recordedAt`. A dateless entry on a surface whose whole job is *when things
   * happened* would be wrong rather than merely degraded, so a source that
   * cannot supply one does not belong on this read.
   */
  occurredAt: Date;
  returnId: string;
  /** The source's own id for the return, for operator-facing reference. */
  externalReturnId: string | null;
  /** Whether the return itself was ingested from a channel or authored in OL. */
  returnOrigin: ReturnOrigin;
  /**
   * Display name of the return's SOURCE connection, resolved server-side.
   *
   * `null` when the connection could not be resolved (deleted, or the registry
   * could not answer) — the frontend renders its unknown-connection copy and
   * never an id. Never resolved in the browser.
   */
  sourceConnectionName: string | null;
  /** The operator who performed an OL-owned act. Null on every source claim. */
  actorUserId: string | null;
  /** Custody acts only. */
  quantity: number | null;
  /** Custody acts only — `blocked` / `in_doubt` is what makes an act notable. */
  restockState: ReturnRestockState | null;
  /** Custody `dispose` acts only. */
  disposition: string | null;
  /**
   * Refund entries only: WHAT moved the money (ADR-056), never who.
   * `RefundRecord` carries no actor column, and inventing one would let OL
   * claim to have moved money it did not move.
   */
  refundExecutedBy: string | null;
  /** Refund entries only. Decimal string, paired with {@link currency}. */
  amount: string | null;
  /** Refund entries only. ISO 4217. */
  currency: string | null;
}

/**
 * What the repository half of the order-scoped read returns.
 *
 * The connection ids ride BESIDE the entries rather than on them, deliberately:
 * `sourceConnectionName` is the operator-facing fact and an id is not, so an id
 * on the entry would be one `...spread` away from reaching the browser. The map
 * carries EVERY return on the order — including one with no acts and no
 * timestamps yet — so it is also the correct key set for the refund fan-out,
 * which the entries alone would under-report.
 */
export interface ReturnTimelineEntriesForOrder {
  entries: ReturnTimelineEntry[];
  /** `returnId` → the return's source connection id. */
  sourceConnectionIdByReturn: Map<string, string>;
  /**
   * Every return on the order, entry-producing or not — see
   * {@link ReturnTimelineContext} for why a caller must never default these.
   */
  contexts: Array<ReturnTimelineContext & { sourceConnectionId: string }>;
}

/**
 * The per-return facts every entry needs, whatever source it came from.
 *
 * Carried ALONGSIDE the entries, and covering every return on the order —
 * including one that has produced no entry at all yet. That is what lets a
 * caller compose in an entry from another bounded context (a refund) without
 * DEFAULTING these fields: a defaulted `returnOrigin` would state that a
 * channel opened a return the operator authored, which is a claim, not a gap.
 *
 * The reachable case is not hypothetical: `openedAt` is persisted as `null`
 * when a source reports an unparseable `createdAt`, so a refunded return can
 * legitimately have no entry of its own.
 */
export interface ReturnTimelineContext {
  returnId: string;
  externalReturnId: string | null;
  returnOrigin: ReturnOrigin;
  sourceConnectionName: string | null;
}

/** What {@link ReturnTimelineEntry}'s order-scoped read returns. */
export interface ReturnTimelineForOrder {
  entries: ReturnTimelineEntry[];
  /** Every return on the order, entry-producing or not. */
  returns: ReturnTimelineContext[];
}

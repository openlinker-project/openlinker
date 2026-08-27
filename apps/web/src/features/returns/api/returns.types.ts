/**
 * Returns Feature Types
 *
 * Frontend transport types for the returns read API (#2334), consumed by the
 * returns list (#2335). Hand-written per the FE contract strategy; field names
 * mirror `ReturnListItemResponseDto` verbatim. All date fields are ISO 8601
 * strings, and every one of them is genuinely nullable — a null date means the
 * source reported no such instant, never "now" and never an empty string.
 *
 * @module apps/web/src/features/returns/api
 */
import type { ReturnStage } from '../lib/return-stage.types';
import type { ReturnSegment, ReturnSegmentCounts } from '../lib/return-segments';

/**
 * The attribution partition. FE mirror of the backend `ReturnBucketValues`
 * (`libs/core/src/returns/domain/types/return-bucket.types.ts`).
 *
 * `orphan` is not a soft "unmatched": it means OpenLinker could not name the
 * order the return belongs to, so every downstream trigger is blocked for it.
 * The copy module says so in the operator's words; this file only carries the
 * vocabulary.
 */
export const RETURN_BUCKET_VALUES = ['orphan', 'attributed'] as const;
export type ReturnBucket = (typeof RETURN_BUCKET_VALUES)[number];

/**
 * Coercion for an UNTRUSTED string — a hand-edited search param, not a value
 * that has already been through the backend's validator. An unrecognised value
 * must be ignored rather than forwarded: the API validates `bucket` with
 * `@IsIn`, so passing a junk value through would 400 the whole page over a
 * typo in the URL bar.
 */
export function isReturnBucket(value: string | null | undefined): value is ReturnBucket {
  return value !== null && value !== undefined
    && (RETURN_BUCKET_VALUES as readonly string[]).includes(value);
}

/**
 * FE mirror of the backend `ReturnOriginValues`. Not on the feature barrel:
 * nothing outside the schema's own `z.enum` reads the runtime array, and
 * publishing a vocabulary no consumer uses invites one to be added without the
 * mirror discipline that would keep it in step with core.
 */
export const RETURN_ORIGIN_VALUES = ['source_ingested', 'operator_authored'] as const;
export type ReturnOrigin = (typeof RETURN_ORIGIN_VALUES)[number];

/**
 * Page size for `/returns`. The backend caps `limit` at 100 (`@Max(100)` on
 * `ListReturnsQueryDto`); a higher value is an HTTP 400, so the cap is mirrored
 * here rather than discovered at runtime.
 */
export const RETURNS_PAGE_SIZE = 20;
export const RETURNS_MAX_LIMIT = 100;

/**
 * One list row.
 *
 * Carries no `lines` — the backend list read hydrates none, deliberately, so a
 * `lines: []` here would be a promise the query never fills and a consumer
 * would render it as "this return has no lines".
 */
/**
 * The per-return counter rollup the derived stage is computed from (#2377).
 *
 * Mirrors `ReturnCountersDto`. Always present on a parsed row — a server that
 * omits it yields zeroes rather than dropping the return, because losing a row
 * over a missing projection is worse than showing it as `Awaiting parcel`.
 */
export interface ReturnCounters {
  lineCount: number;
  notReturnedLineCount: number;
  quantityAdvised: number;
  /** Advised units on lines written off as never arriving. Subtracted to give "still expected". */
  notReturnedQuantityAdvised: number;
  quantityReceived: number;
  quantityRestocked: number;
  quantityScrapped: number;
}

export interface ReturnListItem {
  id: string;
  sourceConnectionId: string;
  externalReturnId: string | null;
  /** The order this return belongs to. Null exactly when `bucket` is `orphan`. */
  internalOrderId: string | null;
  /** The source's own order reference, verbatim. */
  externalOrderId: string | null;
  origin: ReturnOrigin;
  bucket: ReturnBucket;
  /** The SOURCE's own status word, verbatim. Null means the source said nothing. */
  rawStatus: string | null;
  openedAt: string | null;
  authorizedAt: string | null;
  declinedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** The rollup `deriveReturnStage` reads. See {@link ReturnCounters}. */
  counters: ReturnCounters;
  /**
   * Does this return hold a restock the master refused that nobody attested
   * (#2381)?
   *
   * A SIBLING of `counters`, never a member — the derived stage computes from
   * counters alone (#2377). **`null` means NOT REPORTED**, and is the only
   * honest third state: `false` asserts the operator's stock is fine, and
   * `true` would cry wolf on every row of an unreadable page. `null` renders no
   * badge and is counted through the list's `droppedCount`.
   */
  restockBlocked: boolean | null;
}

/**
 * How many returns sit in each derived stage (#2377), scoped with `stage`
 * REMOVED from the caller's filters — the same rule {@link ReturnBucketCounts}
 * states for `bucket`, so the chip for the stage you are not looking at stays
 * truthful.
 */
export interface ReturnStageCounts {
  total: number;
  byStage: Record<ReturnStage, number>;
}

/**
 * The attribution partition over the caller's filters with `bucket` REMOVED.
 * This — never {@link PaginatedReturns.total} — is what the filter chips read,
 * so the chip for the bucket you are not looking at stays truthful.
 */
export interface ReturnBucketCounts {
  total: number;
  orphan: number;
  attributed: number;
}

export interface PaginatedReturns {
  items: ReturnListItem[];
  /**
   * Rows matching this request's filters, `bucket` INCLUDED — the number the
   * page paginates against. Deliberately distinct from `counts.total`; see
   * {@link ReturnBucketCounts}.
   */
  total: number;
  limit: number;
  offset: number;
  counts: ReturnBucketCounts;
  stageCounts: ReturnStageCounts | null;
  segmentCounts: ReturnSegmentCounts | null;
}

/**
 * Whether ANY connection's adapter declares returns ingestion. Resolved from
 * adapter manifests server-side — it is a fact about the deployment's
 * configuration, not about the operator's data.
 */
export interface ReturnIngestionAvailability {
  configured: boolean;
  connectionIds: string[];
}

/** Every field optional; an absent field does not filter. */
export interface ReturnFilters {
  sourceConnectionId?: string;
  bucket?: ReturnBucket;
  createdFrom?: string;
  createdTo?: string;
  /** #2378 — the worklist strip. One dimension; never translated into `bucket`. */
  segment?: ReturnSegment;
  stage?: ReturnStage;
  money?: ReturnMoneyState;
  reason?: ReturnLineReason;
  /** The SOURCE's own opened instant — never OpenLinker's ingestion clock. */
  openedFrom?: string;
  openedTo?: string;
}

/** Coercion for an UNTRUSTED money-state param. */
export function isReturnMoneyState(
  value: string | null | undefined
): value is ReturnMoneyState {
  return (
    value !== null &&
    value !== undefined &&
    (RETURN_MONEY_STATE_VALUES as readonly string[]).includes(value)
  );
}

/**
 * Coercion for an UNTRUSTED reason param.
 *
 * Reuses `RETURN_LINE_REASON_VALUES` — the vocabulary already mirrored for the
 * line chips — rather than declaring a second copy. Returns-by-reason and
 * refunds-by-reason report on ONE axis by construction, and two FE copies of it
 * would be exactly the drift that promise exists to prevent.
 */
export function isReturnLineReason(
  value: string | null | undefined
): value is ReturnLineReason {
  return (
    value !== null &&
    value !== undefined &&
    (RETURN_LINE_REASON_VALUES as readonly string[]).includes(value)
  );
}

export interface ReturnPagination {
  limit?: number;
  offset?: number;
}

/**
 * Per-line vocabulary. FE mirrors of the core unions
 * (`libs/core/src/returns/domain/types/return-line.types.ts`) and of
 * `RefundReasonValues` (`@openlinker/core/orders/types`), which the returns
 * context reuses verbatim so returns-by-reason and refunds-by-reason report on
 * one axis rather than two an analyst has to reconcile.
 *
 * **Declared but undriven in Wave 1c.** Nothing writes a custody or money
 * transition yet, so every line arrives at its default. The detail renders the
 * chips anyway, saying they are not tracked yet — hiding them would mean Wave 2
 * has to add a column rather than light one up, and would also hide from the
 * operator that OpenLinker is not yet following the parcel.
 */
export const RETURN_CUSTODY_STATE_VALUES = [
  'advised',
  'in_transit',
  'received',
  'disposed',
  'not_returned',
] as const;
export type ReturnCustodyState = (typeof RETURN_CUSTODY_STATE_VALUES)[number];

export const RETURN_MONEY_STATE_VALUES = [
  'not_refundable',
  'pending',
  'triggered',
  'refunded',
  'denied',
  'in_doubt',
] as const;
export type ReturnMoneyState = (typeof RETURN_MONEY_STATE_VALUES)[number];

export const RETURN_DISPOSITION_VALUES = ['restock', 'scrap'] as const;
export type ReturnDisposition = (typeof RETURN_DISPOSITION_VALUES)[number];

export const RETURN_LINE_REASON_VALUES = [
  'withdrawal',
  'defective',
  'not_as_described',
  'wrong_item',
  'other',
] as const;
export type ReturnLineReason = (typeof RETURN_LINE_REASON_VALUES)[number];

/**
 * One returned line.
 *
 * `resolvedOrderLineId` is nullable BY DESIGN and null is a real state: OL has
 * no order-lines table to point at, so a line it could not match still
 * describes a real parcel. A consumer renders that explicitly, never as a
 * blank.
 *
 * The three union-typed fields widen to `| string` because a value this build
 * does not recognise must still render — dropping the whole line over an
 * unfamiliar chip would hide a parcel. See `parseReturnDetail`.
 */
export interface ReturnLine {
  id: string;
  lineIndex: number;
  externalLineId: string | null;
  resolvedOrderLineId: string | null;
  offerId: string | null;
  sku: string | null;
  name: string | null;
  reason: ReturnLineReason | string;
  quantityAdvised: number;
  quantityReceived: number;
  quantityRestocked: number;
  quantityScrapped: number;
  custodyState: ReturnCustodyState | string;
  moneyState: ReturnMoneyState | string;
  disposition: ReturnDisposition | string | null;
  receivedAt: string | null;
  disposedAt: string | null;
  note: string | null;
}

/**
 * Why the source cannot be asked to decline — mirror of core's
 * `ReturnDeclineUnsupportedReasonValues`.
 *
 * Deliberately does NOT carry the orphan case: that is `bucket`, and a second
 * spelling here would be a second definition of orphan.
 */
export const RETURN_DECLINE_UNSUPPORTED_REASON_VALUES = [
  'no-source-return-id',
  'source-declares-no-decline',
] as const;
export type ReturnDeclineUnsupportedReason =
  (typeof RETURN_DECLINE_UNSUPPORTED_REASON_VALUES)[number];

/**
 * Whether the decline write may be offered, resolved SERVER-side.
 *
 * Never re-derived in the browser: deriving it here fails in the wrong
 * direction — offering an action the source cannot perform. `supported: true`
 * is a declaration read from adapter metadata, not a promise; the 400 from the
 * write remains the authority, so the mutation's error path still handles it.
 *
 * `reason` widens to `| string` so a value this build predates is reported as
 * unrecognised rather than collapsing into "no reason given".
 */
export interface ReturnDeclineAvailability {
  supported: boolean;
  reason: ReturnDeclineUnsupportedReason | string | null;
}

/** The hydrated aggregate: the list header, its lines, and the decline fact. */
/**
 * Where a restock WOULD land, mirror of core's `ReturnRestockTargetStatus`.
 *
 * The three non-resolved values are the same vocabulary a blocked restock
 * records, deliberately. `ambiguous-inventory-master` means the restock will be
 * BLOCKED, not routed to a first candidate — so it must never be rendered as a
 * destination.
 */
export const RETURN_RESTOCK_TARGET_STATUS_VALUES = [
  'resolved',
  'ambiguous-inventory-master',
  'no-inventory-master',
  'adapter-unresolved',
] as const;
export type ReturnRestockTargetStatus = (typeof RETURN_RESTOCK_TARGET_STATUS_VALUES)[number];

export interface ReturnRestockTarget {
  status: ReturnRestockTargetStatus;
  /** Set only when `status` is `resolved`. `null` is "not reported", never a name. */
  connectionId: string | null;
  connectionName: string | null;
  /** Set only on `ambiguous-inventory-master`. */
  candidateCount: number | null;
}

/** A refused restock, keyed to its LINE — see `returnLineId`. */
export interface ReturnRestockBlock {
  eventId: string;
  /**
   * NOT derivable from `sku`: two lines of one return can share one, and keying
   * a per-line notice by sku would render one line's block under another's.
   */
  returnLineId: string;
  quantity: number;
  sku: string | null;
  reason: string;
  detail: string | null;
  connectionId: string | null;
  connectionName: string | null;
  state: string;
}

/**
 * A recorded operator attestation.
 *
 * `actorUserId` is an ID and must never render as a name — nothing resolves one.
 * A surface says "by you" when it matches the session user, "by another
 * operator" otherwise.
 */
export interface ReturnRestockAttestation {
  eventId: string;
  returnLineId: string;
  quantity: number;
  actorUserId: string | null;
  occurredAt: string;
  note: string | null;
}

export interface ReturnDetail extends ReturnListItem {
  lines: ReturnLine[];
  declineAvailability: ReturnDeclineAvailability;
  /**
   * Where a restock would land (#2380). Never derived client-side: the
   * resolver's candidate ordering is not reproducible here, so a local pick
   * could name a connection the write never touches.
   */
  restockTarget: ReturnRestockTarget;
  /**
   * Refused restocks nobody has attested yet (#2381). The source for the
   * persistent per-line notice — NOT the dispose response, which describes an
   * ACTION and vanishes on reload.
   */
  restockBlocks: ReturnRestockBlock[];
  /**
   * Attestations already recorded — the terminal state of the remediation loop.
   *
   * Disjoint from `restockBlocks` by construction: attesting flips the act out
   * of the blocked set, so a line appears in at most one at a time.
   */
  restockAttestations: ReturnRestockAttestation[];
  /** Lines the server sent that this build could not read. Reported, never hidden. */
  droppedLineCount: number;
}

/** The counters and states a custody write reports back for the line it moved. */
export interface ReturnLineCounters {
  id: string;
  quantityAdvised: number;
  quantityReceived: number;
  quantityRestocked: number;
  quantityScrapped: number;
  custodyState: string;
  moneyState: string;
  disposition: string | null;
  receivedAt: string | null;
  disposedAt: string | null;
}

export interface ReceiveReturnLineInput {
  quantity: number;
  note?: string;
}

export interface DisposeReturnLineInput {
  quantity: number;
  disposition: ReturnDisposition;
  note?: string;
}

export interface AttestReturnLineStockInput {
  note?: string;
}

export interface AttestReturnLineStockResult {
  line: ReturnLineCounters;
  /** One attestation act per outstanding act it resolved. */
  eventIds: string[];
}

export interface MarkReturnLineNotReturnedInput {
  note?: string;
}

/**
 * What the master write did, when it did not land.
 *
 * **Never an error** — the disposition succeeded and is recorded; it is the
 * stock write that did not. Present only on a refused or unobserved restock,
 * `null` on every scrap and every applied one.
 */
export interface ReturnRestockBlocked {
  eventId: string;
  quantity: number;
  sku: string | null;
  reason: string;
  detail: string | null;
  connectionId: string | null;
  connectionName: string | null;
  state: string;
}

export interface ReceiveReturnLineResult {
  line: ReturnLineCounters;
  eventId: string;
}

export interface DisposeReturnLineResult {
  line: ReturnLineCounters;
  eventId: string;
  restockBlocked: ReturnRestockBlocked | null;
}

export interface MarkReturnLineNotReturnedResult {
  line: ReturnLineCounters;
  eventId: string;
}

/**
 * How a decline attempt ended — mirror of core's `DeclineReturnOutcomeValues`.
 *
 * `decline-sent` is the one that must never render as "declined": the source
 * accepted the request and reported no instant, so `declinedAt` stays null
 * (returns spec §5.6 / US-3 — a 2xx alone never displays as declined by the
 * source).
 */
export const DECLINE_RETURN_OUTCOME_VALUES = [
  'declined',
  'decline-sent',
  'already-declined',
  'in-flight',
  'refused',
] as const;
export type DeclineReturnOutcome = (typeof DECLINE_RETURN_OUTCOME_VALUES)[number];

export interface DeclineReturnInput {
  /**
   * The SOURCE's own rejection code, opaque to OpenLinker. No endpoint
   * publishes the accepted vocabulary, so this is operator-entered and the
   * adapter's refusal — which names what it accepts — is the feedback loop.
   */
  reasonCode: string;
  comment?: string;
}

export interface DeclineReturnResult {
  outcome: DeclineReturnOutcome | string;
  changeId: string | null;
  /** The SOURCE's own instant, or null — never OpenLinker's clock. */
  declinedAt: string | null;
  /** Present only for `refused`. The source's own words, rendered verbatim. */
  refusalReason: string | null;
}

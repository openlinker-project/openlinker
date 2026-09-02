/**
 * Return Query Types
 *
 * The filter, the bucket partition and the source-capability facts the returns
 * READ API (#2334) is expressed in.
 *
 * Three rules are recorded here because both halves of each one — the type and
 * the query or projection that honours it — have to change together, and a
 * consumer that re-derives any of them will eventually derive it differently.
 *
 *  1. **A filter field that is absent does not filter.** Not "matches
 *     everything by default", not "falls back to a bucket": the arm is simply
 *     not added to the query. `bucket: undefined` therefore returns orphans and
 *     attributed returns alike, which is what the FE's "All" chip is.
 *  2. **{@link ReturnBucketCounts} is computed over the filter scope with
 *     `bucket` REMOVED.** An operator looking at the `orphan` chip must still be
 *     told how many `attributed` returns the same connection and date scope
 *     holds — counted under the caller's own bucket, the other chip would
 *     render either the number they are already looking at or a zero, and a
 *     chip row whose numbers describe different scopes is worse than no chip
 *     row. Same rule `GET /orders/status-summary` follows.
 *  3. **`attributed` is DERIVED, never separately queried.** The partition is
 *     exhaustive by construction — `ReturnRecord.isOrphan()` reads one nullable
 *     column, so every row is on exactly one side — and a second query could
 *     only introduce a way for the two numbers to disagree under a concurrent
 *     write. The repository reads `total` and `orphan` from ONE scan with a
 *     `FILTER (WHERE ...)` aggregate and subtracts.
 *
 * Domain-only: no framework dependencies.
 *
 * @module domain/types
 * @see docs/architecture/adrs/060-returns-aggregate-above-source-projection.md
 */
import type { ReturnBucket } from './return-bucket.types';
import type { ReturnStage } from './return-stage.types';
import type { ReturnSegment } from './return-segment.types';
import type { ReturnMoneyState } from './return-line.types';
import type { RefundReason } from '@openlinker/core/orders/types';

/**
 * What a returns list read is narrowed by. Every field is optional; see rule 1.
 *
 * Deliberately carries no sort axis. Both reads are `createdAt DESC, id ASC`,
 * which is the orphan bucket's existing order and the only one any Wave-1c
 * surface asks for; an operator-chosen sort is additive later and would need a
 * closed `as const` vocabulary of its own rather than a free string here.
 */
export interface ReturnListFilter {
  /** One source connection. Absent = every connection. */
  sourceConnectionId?: string;
  /** Which side of the attribution partition. Absent = both. */
  bucket?: ReturnBucket;
  /** Inclusive lower bound on `createdAt`. */
  createdFrom?: Date;
  /** Inclusive upper bound on `createdAt`. */
  createdTo?: Date;
  /**
   * One derived operator stage (#2377, spec § 4.3). Absent = every stage.
   *
   * Matched against `RETURN_STAGE_EXPR` — the SAME single expression the stage
   * counts bucket on, so no per-arm predicate can drift from its own count.
   */
  stage?: ReturnStage;
  /**
   * One operator-facing segment (#2378, spec § 4.1). Absent = every segment.
   *
   * A SEPARATE dimension from `bucket`, deliberately. `orphans` is an ordinary
   * segment predicate here — it is NOT translated into `bucket: 'orphan'` at any
   * boundary, because the segment counts strip the `segment` dimension and a
   * translated value would leave `bucket` applied, making the orphans card report
   * the count of the scope it is already in. `bucket` remains independently
   * usable behind the existing bucket chips; a segment click never writes it.
   */
  segment?: ReturnSegment;
  /** One money state (#2378, spec § 4.3). Absent = every state. */
  money?: ReturnMoneyState;
  /** One return reason (#2378, spec § 4.3). Absent = every reason. */
  reason?: RefundReason;
  /**
   * Inclusive lower bound on `openedAt` — the SOURCE's own instant.
   *
   * Deliberately NOT `createdAt`, which is OpenLinker's ingestion clock. Wiring
   * the spec's `openedFrom` to the existing `createdFrom` arm would answer a
   * question about the marketplace's timeline with OL's.
   */
  openedFrom?: Date;
  /** Inclusive upper bound on `openedAt`. See {@link ReturnListFilter.openedFrom}. */
  openedTo?: Date;
}

/**
 * How many returns sit in each derived stage, over one filter scope (#2377).
 *
 * Read from ONE scan alongside the total, so the six numbers and the total
 * cannot disagree because of a concurrent write.
 *
 * **Scoping rule, and it is the easy thing to get wrong**: these are computed
 * with `stage` REMOVED from the caller's filter (and every other dimension
 * applied), for the reason `ReturnBucketCounts` states about `bucket` — the
 * count for the dimension you are NOT looking at must stay truthful. Applied
 * with `stage` still in the filter, every chip would show the count of the
 * stage already selected.
 */
export interface ReturnStageCounts {
  total: number;
  byStage: Record<ReturnStage, number>;
}

/**
 * The attention number and its complement, over one filter scope.
 *
 * Invariant: `total === orphan + attributed`. It holds because the three are
 * read from one scan (rules 2 and 3), not because a caller checks it.
 */
export interface ReturnBucketCounts {
  total: number;
  orphan: number;
  attributed: number;
}

/**
 * Whether ANY connection can ingest returns at all (#2334, for #2335).
 *
 * This exists to let an empty returns list say something true. "You have no
 * returns" and "nothing in this deployment is configured to fetch returns" look
 * identical on screen and mean opposite things — the first is good news, the
 * second is an unconfigured integration silently reporting success — and the
 * frontend cannot tell them apart on its own, because the fact lives in an
 * adapter manifest it has no access to.
 *
 * **Resolved from the adapter MANIFEST, never by constructing an adapter and
 * never from `Connection.enabledCapabilities`.** The manifest is the
 * declaration and reading it costs nothing; constructing would resolve
 * credentials once per connection to answer a question no network call is
 * needed for. `enabledCapabilities` is stamped at connection create and never
 * retro-filled, so gating on it would report "not configured" for every
 * connection that predates #2330 while it ingests returns perfectly well — the
 * #2085 failure shape, landed on the one screen whose job is to tell an
 * operator whether they are configured.
 *
 * Note precisely which half that applies to. The discovery lists `OrderSource`
 * connections, and that listing requires `OrderSource` itself to be BOTH
 * manifest-declared and enabled on the connection — which is correct, since a
 * connection with `OrderSource` disabled ingests nothing at all. Only the
 * `ReturnSourceReader` sub-capability is read manifest-side, because only it is
 * the advertised-without-dispatch name `enabledCapabilities` never learned.
 */
export interface ReturnIngestionAvailability {
  /** True iff at least one connection's adapter declares `ReturnSourceReader`. */
  configured: boolean;
  /**
   * The connections that declare it. Empty iff `configured` is false.
   *
   * Returned rather than just the boolean so a future surface can name them;
   * the FE resolves display names from the connections list it already holds.
   */
  connectionIds: string[];
}

/**
 * Why the source cannot be asked to decline this return — or `null` if it can.
 *
 * The reason vocabulary mirrors `ReturnDeclineUnsupportedError.detail`'s two
 * record-and-declaration cases so the disabled button and the 400 it would have
 * received cannot tell an operator different stories. It deliberately does NOT
 * include the orphan case: that is `ReturnRecord.isOrphan()`, already on the
 * response as `bucket`, and duplicating it here would be the second definition
 * of orphan the entity's docblock forbids.
 *
 * `no-source-return-id` — the return carries no source-native id (an
 * operator-authored return), so there is nothing to ask the source about.
 * `source-declares-no-decline` — the platform publishes no rejection endpoint
 * at all (Erli).
 */
export const ReturnDeclineUnsupportedReasonValues = [
  'no-source-return-id',
  'source-declares-no-decline',
] as const;

export type ReturnDeclineUnsupportedReason =
  (typeof ReturnDeclineUnsupportedReasonValues)[number];

/**
 * Whether the decline write is available for one return, and why not if it is not.
 *
 * **`supported: true` is a DECLARATION, not a promise.** It is read from the
 * manifest, so it says the platform publishes the write and this return has an
 * id to name — it cannot say the connection will resolve at call time (a
 * disabled connection, a credential failure). The 400 from
 * `POST /returns/:id/decline` remains the authority on that, and the frontend
 * must keep handling it. `supported: false` is the reliable direction: those
 * two causes are properties of the record and the platform, and no retry
 * changes either.
 *
 * **When the adapter metadata cannot be resolved at all, this reports
 * `supported: true`.** That looks like the wrong default and is the right one.
 * The two states are not symmetric: reporting `false` on a registry or
 * credential hiccup renders a permanently disabled button captioned "this
 * source does not support decline" — a false statement about the operator's
 * own configuration, indistinguishable from the real thing, with no path back.
 * Reporting `true` costs at most one request, which fails with the specific,
 * actionable 400 `ReturnDeclineUnsupportedError` already produces. An unknown
 * is not a "no"; this is `catalog-trust`'s `'unknown'` lesson — never let an
 * infrastructure failure assert a fact about the operator's configuration.
 *
 * Deliberately NOT derived frontend-side from the connection's
 * `supportedCapabilities`. That list is served EMPTY when adapter metadata
 * fails to resolve, so a frontend deriving from it lands in exactly the
 * false-`false` state above — and it could not see `no-source-return-id` at
 * all, which is a property of the return, not of the connection.
 */
export interface ReturnDeclineAvailability {
  supported: boolean;
  reason: ReturnDeclineUnsupportedReason | null;
}

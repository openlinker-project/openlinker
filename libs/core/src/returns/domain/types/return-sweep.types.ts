/**
 * Return Sweep Types
 *
 * The query contract pass 2 (`marketplace.returns.statusSync`, #2330) reads
 * OL's own candidate returns through — the returns counterpart of the
 * offer-status and shipment-status scan-offset sweeps.
 *
 * Domain-only: no framework dependencies.
 *
 * @module libs/core/src/returns/domain/types
 * @see docs/plans/analysis/SPIKE-2289-allegro-returns-feed.md
 */

/**
 * Which of a connection's returns are worth re-reading right now.
 *
 * Three filters, and each one is load-bearing rather than a convenience.
 */
export interface ReturnSourceSweepFilter {
  /** The observing connection. A sweep never crosses connections. */
  sourceConnectionId: string;

  /**
   * Only `source_ingested` rows are candidates.
   *
   * An `operator_authored` return has no source to re-read — asking the
   * marketplace about a return OL invented would 404 on every run forever, and
   * the notFound counter would report a fault that is really a category error.
   */
  origin: 'source_ingested';

  /**
   * The source's own terminal status vocabulary, as the adapter declares it
   * (`ReturnSourceReader.terminalRawStatuses`). Applied as an OPAQUE `NOT IN`
   * over the stored `rawStatus` — core never interprets a member.
   *
   * An EMPTY list is meaningful and legal: it means the adapter declared no
   * terminal vocabulary, so no status-based exclusion is applied and the sweep
   * leans entirely on the age bound and the page budget below. It is a degraded
   * mode, not a broken one.
   */
  terminalRawStatuses: readonly string[];

  /**
   * Only returns opened (or, absent an `openedAt`, created) at or after this
   * instant are candidates.
   *
   * **Non-optional, deliberately.** The status exclusion above is only as good
   * as the adapter's vocabulary, and a source that adds a status OL's adapter
   * has not learned yet would otherwise pin those returns in the candidate set
   * PERMANENTLY — the sweep's cost growing with the connection's whole history
   * rather than with its open work, silently, and worst on the oldest and
   * busiest installs. The age bound is the backstop that makes an unrecognised
   * status a temporary cost instead of a permanent one.
   */
  openedSince: Date;
}

/** One page of the sweep, plus the total it wraps against. */
export interface ReturnSourceSweepPage {
  /** Candidate rows, headers only — the sweep re-reads by id and needs no lines. */
  items: ReturnSweepCandidate[];
  /** Total rows matching the filter, for cursor wrap. */
  total: number;
}

/**
 * The minimum a sweep needs to re-read one return: its OL id (for logging and
 * correlation) and the source-native id it re-reads by.
 *
 * `externalReturnId` is non-nullable here even though the column is nullable —
 * the filter excludes NULL keys, because a return with no external id has
 * nothing to re-read BY.
 */
export interface ReturnSweepCandidate {
  id: string;
  externalReturnId: string;
  rawStatus: string;
}

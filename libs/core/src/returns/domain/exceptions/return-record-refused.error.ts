/**
 * Return Record Refused Error (#2372, ADR-060)
 *
 * The refusal specific to `recordReturn` — an operator opening a return in OL
 * because the source has no returns surface at all.
 *
 * Two of the four reasons are input validation and two are attribution facts.
 * They share one class because they share one caller and one HTTP route (#2376),
 * and a caller branches on the closed `reason` value rather than on the message.
 *
 * @module domain/exceptions
 */

export const ReturnRecordRefusalReasonValues = [
  /**
   * No lines were supplied. A return with no line is not a return — there is
   * nothing to receive, restock or refund, which is why `CreateReturnRecordInput`
   * carries its lines with the header in the first place.
   */
  'no-lines',
  /** A line's `quantityAdvised` is not a positive integer. */
  'invalid-quantity',
  /**
   * OpenLinker has never minted an internal id for that order. Same rule as the
   * orphan-match refusal: OL will not attribute to a phantom.
   */
  'unknown-order',
  /**
   * The order exists, but OL holds no mapping for it on the connection the
   * operator named. Refused rather than silently recorded against the wrong
   * channel: `sourceConnectionId` is what a later re-attribution pass, and every
   * operator reading the row, take the return's provenance from — and it is the
   * mapping on THAT connection which supplies `externalOrderId`.
   */
  'order-not-on-connection',
  /**
   * The line exists at the channel but an OpenLinker order edit lowered it to
   * quantity 0 (E-14, #3542). Refused up front: the credit-note correction would
   * refuse it later anyway, so accepting it only strands a return whose goods
   * the operator then has nothing to credit against. Returns INGESTED from a
   * channel are facts and are never refused for this.
   */
  'line-removed-by-edit',
] as const;

export type ReturnRecordRefusalReason = (typeof ReturnRecordRefusalReasonValues)[number];

const REASON_DETAIL: Record<ReturnRecordRefusalReason, string> = {
  'no-lines': 'a return must carry at least one line',
  'invalid-quantity': 'every line must advise a positive whole quantity',
  'unknown-order': 'OpenLinker has not ingested that order',
  'order-not-on-connection': 'OpenLinker holds no mapping for that order on the named connection',
  'line-removed-by-edit':
    'the order was edited in OpenLinker and that line was removed (quantity 0), so it cannot be returned',
};

export class ReturnRecordRefusedError extends Error {
  constructor(
    public readonly reason: ReturnRecordRefusalReason,
    /** The offending line, named for the operator (set for `line-removed-by-edit`). */
    public readonly lineLabel: string | null = null
  ) {
    super(
      `Cannot record the return: ${REASON_DETAIL[reason]}` +
        (lineLabel === null ? '' : ` (line: ${lineLabel})`)
    );
    this.name = 'ReturnRecordRefusedError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Return Custody Transition Error
 *
 * The single refusal of the custody rules (#2367, ADR-060). Raised when a
 * caller asks for a custody move the line cannot make — an illegal edge, a
 * non-positive quantity, or a quantity that would break the counter ordering
 * the DB `CHK_return_lines_quantity_ordering` also enforces.
 *
 * It carries a CLOSED `reason` union rather than only a message, because the
 * consumers refuse in different ways: #2370's write path maps `over-receipt` to
 * its own actionable code and #2376 answers 409 with a code the frontend can
 * branch on. Matching on a message string would make that mapping break
 * silently the first time the copy is reworded.
 *
 * A domain error, not a Nest exception — core never constructs HTTP.
 *
 * @module domain/exceptions
 */
import type { ReturnCustodyState } from '../types/return-line.types';

export const ReturnCustodyRefusalReasonValues = [
  /** The edge does not exist in the machine (e.g. `disposed` -> `in_transit`). */
  'illegal-transition',
  /** A receipt or disposition of zero or fewer units, or a non-integer. */
  'non-positive-quantity',
  /** The receipt would take `quantityReceived` past `quantityAdvised`. */
  'over-receipt',
  /** The disposition would take `restocked + scrapped` past `quantityReceived`. */
  'over-disposition',
  /**
   * `not_returned` was asked of a line that has already received units. See
   * `markReturnCustodyNotReturned` — the shortfall on a partially received line
   * has no counter to move into, and inventing one is a model change.
   */
  'partially-received',
  /**
   * `not_returned` was asked of a line the source advised ZERO units of.
   *
   * Named rather than left to the database because the act this transition
   * mints carries the shortfall as its quantity, and
   * `CHK_return_line_events_quantity_positive` would refuse a zero — surfacing
   * a raw driver error as a 500 for a state the domain is perfectly able to
   * name. Every other refusal on this path already carries a closed reason the
   * #2376 filter maps to a 409, and a consistent refusal vocabulary is cheaper
   * than establishing whether a zero-advised line is reachable at all.
   */
  'nothing-advised',
] as const;

export type ReturnCustodyRefusalReason = (typeof ReturnCustodyRefusalReasonValues)[number];

export class ReturnCustodyTransitionError extends Error {
  constructor(
    public readonly from: ReturnCustodyState,
    public readonly attempted: ReturnCustodyState,
    public readonly reason: ReturnCustodyRefusalReason,
    detail?: string
  ) {
    super(
      `Return custody transition refused (${from} -> ${attempted}): ${reason}` +
        (detail ? ` — ${detail}` : '')
    );
    this.name = 'ReturnCustodyTransitionError';
    Error.captureStackTrace(this, this.constructor);
  }
}

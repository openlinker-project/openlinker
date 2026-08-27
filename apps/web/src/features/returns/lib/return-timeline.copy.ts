/**
 * Return-activity timeline copy (#2383)
 *
 * The single home for every string the order timeline's returns half renders.
 * Beside the `restock-blocked.copy.ts` precedent, and for the same reason: a
 * sentence interpolated at a call site is a sentence that drifts.
 *
 * **The `by` strings are the honesty axis.** `actorUserId` resolves to no
 * display name anywhere in the tree, and `RefundRecord` carries no actor column
 * at all (ADR-056) — so these say what is actually known and never invent a
 * person. An act whose actor is unknown gets NO eyebrow rather than a guessed
 * one: an omitted attribution is silent, a wrong one is a claim.
 *
 * @module apps/web/src/features/returns/lib
 */
export const RETURN_TIMELINE_COPY = {
  /** Titles, keyed by the reporting source's own `kind`. */
  opened: 'Return opened',
  declined: 'Return declined',
  receive: 'Return received',
  dispose: 'Returned goods disposed',
  stock_attestation: 'Stock handled manually',
  not_returned: 'Marked as not returned',
  refund_confirmed: 'Refund confirmed',

  /**
   * An act this build does not recognise. Rendered rather than dropped — a
   * silent drop is the disappearance defect this programme keeps closing.
   */
  unknownKind: (kind: string): string => `Return activity: ${kind}`,

  /** Eyebrows. */
  byYou: 'you',
  byAnotherOperator: 'another operator',
  byOperator: 'an operator',
  byUnknownConnection: 'an unrecognised source',
  byOpenLinker: 'OpenLinker',

  /** Descriptions. */
  restockBlocked: 'The stock write was refused — the units are not back in the book yet.',
  quantityUnits: (quantity: number): string => `${quantity} ${quantity === 1 ? 'unit' : 'units'}`,
  disposedAs: (disposition: string): string => `Disposition: ${disposition}`,
  refundAmount: (amount: string, currency: string): string => `${amount} ${currency}`,
  refundRecordedOnly:
    'Recorded by an operator — OpenLinker did not move the money and does not claim to have.',
  refundExecuted: 'Executed by OpenLinker against the source.',
  returnReference: (externalReturnId: string): string => `Return ${externalReturnId}`,
} as const;

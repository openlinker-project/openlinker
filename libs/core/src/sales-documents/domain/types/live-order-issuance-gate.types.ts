/**
 * Live Order Issuance Gate (#1596, DEF-26)
 *
 * The one rule every sales-document path asks immediately before issuing: is
 * the order still something to document? Before DEF-26 only the
 * `invoicing.issue` worker asked, so a manual issue, a bulk issue and a fiscal
 * receipt registration documented cancelled orders; and a PrestaShop "Refunded"
 * label - which the shop also prints for a PARTIAL refund - skipped the whole
 * invoice.
 *
 * Pure and primitive-typed on purpose: this is a zero-sibling-edge leaf, so the
 * caller reads the order and its refunds and hands the facts in.
 *
 * Three answers:
 *  - `allow`: issue as usual;
 *  - `allow-with-attention`: issue the full sale, and flag that a refund
 *    happened, so the operator can correct it (a partial refund is not a
 *    reason to leave the sale undocumented);
 *  - `block`: the order is cancelled or fully refunded. The automatic paths
 *    skip it; a person issuing by hand may still decide otherwise, because
 *    OpenLinker suggests and the operator decides.
 *
 * @module libs/core/src/sales-documents/domain/types
 */

export const LiveOrderIssuanceBlockReasonValues = ['order-cancelled', 'order-fully-refunded'] as const;
export type LiveOrderIssuanceBlockReason = (typeof LiveOrderIssuanceBlockReasonValues)[number];

export type LiveOrderIssuanceDecision =
  | { kind: 'allow' }
  | { kind: 'allow-with-attention'; attention: 'order-partially-refunded' }
  | { kind: 'block'; reason: LiveOrderIssuanceBlockReason };

export interface LiveOrderIssuanceFacts {
  /** The durable cancellation marker (`OrderRecord.isCancelled`). */
  cancelled: boolean;
  /** The source's own status word, when it reported one. */
  status?: string;
  /** Sum of recorded refunds, when any were recorded. */
  refundedTotal?: number;
  /** The order's gross total, when known. */
  orderTotal?: number;
}

/** Small allowance so a refund rounded to the grosz still counts as the whole sale. */
const FULL_REFUND_EPSILON = 0.005;

export function decideLiveOrderIssuance(facts: LiveOrderIssuanceFacts): LiveOrderIssuanceDecision {
  if (facts.cancelled || facts.status === 'cancelled') {
    return { kind: 'block', reason: 'order-cancelled' };
  }
  const refunded = facts.refundedTotal ?? 0;
  const total = facts.orderTotal;
  if (refunded > 0 && total !== undefined && total > 0) {
    return refunded + FULL_REFUND_EPSILON >= total
      ? { kind: 'block', reason: 'order-fully-refunded' }
      : { kind: 'allow-with-attention', attention: 'order-partially-refunded' };
  }
  // A "refunded" label with no refund amount to weigh is read the way it always
  // was: as the whole sale. The amounts, when recorded, decide instead.
  if (facts.status === 'refunded') {
    return { kind: 'block', reason: 'order-fully-refunded' };
  }
  return { kind: 'allow' };
}

/**
 * Why an order that already HAS a sales document may need the operator's eye
 * (DEF-26): the sale changed after the document was made. Derived on every
 * read from the same gate, never stored, so it clears itself the moment the
 * facts no longer support it.
 */
export const SalesDocumentAfterIssueAttentionValues = [
  'order-cancelled-after-issue',
  'order-fully-refunded-after-issue',
  'order-partially-refunded-after-issue',
] as const;
export type SalesDocumentAfterIssueAttention = (typeof SalesDocumentAfterIssueAttentionValues)[number];

/**
 * The attention a live decision implies for an order with a document.
 * `null` when there is no document to correct, or nothing changed.
 */
export function deriveAfterIssueAttention(
  decision: LiveOrderIssuanceDecision,
  hasDocument: boolean,
): SalesDocumentAfterIssueAttention | null {
  if (!hasDocument) {
    return null;
  }
  switch (decision.kind) {
    case 'allow':
      return null;
    case 'allow-with-attention':
      return 'order-partially-refunded-after-issue';
    case 'block':
      return decision.reason === 'order-cancelled'
        ? 'order-cancelled-after-issue'
        : 'order-fully-refunded-after-issue';
  }
}

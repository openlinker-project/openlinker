/**
 * Operator copy for a destination-routing block (#2703 / #2704).
 *
 * ONE copy source, so the row badge and any later surface cannot drift — the
 * `stock-at-risk-copy.ts` precedent, where byte-identity is structural because a
 * second copy of the sentence cannot exist without deleting an import.
 *
 * ## Two tones, and the split is the whole point of #2703
 *
 * `'routed-to-no-destination'` is a **working router making a decision** — it is
 * rendered NEUTRALLY and is never counted. Every other reason names a
 * destination the router asked for that OpenLinker could not reach, which is
 * outstanding work and renders as a warning. Collapsing the two would restore
 * exactly the ambiguity #2703 exists to remove, one surface down: an operator
 * could not tell a router deciding from a configuration failing.
 *
 * The reason an order has no destination is READ from the persisted column,
 * never re-derived here from the sync-status rollup — #2100's rule, and the one
 * a draft that inferred it got wrong by printing a cause the backend had not
 * recorded.
 */
import {
  DestinationRoutingBlockReasonValues,
  type DestinationRoutingBlockReasonValue,
} from '../api/orders.types';

/** How a reason should read — a decision the router took, or work to do. */
export type DestinationRoutingTone = 'decision' | 'attention';

export interface DestinationRoutingCopy {
  /** Short badge label. */
  readonly label: string;
  /** One sentence naming the cause and, where there is one, the remedy. */
  readonly hint: string;
  readonly tone: DestinationRoutingTone;
}

/**
 * `satisfies Record<…>` rather than a bare object: a value added to the mirrored
 * union without copy here becomes a COMPILE error rather than an unlabelled
 * badge. That is the guard the mirror script explicitly does NOT provide — it
 * compares arrays and says so.
 */
export const DESTINATION_ROUTING_REASON_COPY = {
  'routed-to-no-destination': {
    label: 'Routed nowhere',
    hint: 'Fulfilment routing decided this order needs no destination shop. This is a routing decision, not a failure — nothing is waiting on you.',
    tone: 'decision',
  },
  'routed-destinations-unavailable': {
    label: 'Routed destination unavailable',
    hint: 'Fulfilment routing chose a destination OpenLinker could not reach — it is disabled, unknown, or cannot create orders. Re-enable it and the order will be retried automatically.',
    tone: 'attention',
  },
  'routed-destinations-partially-unavailable': {
    label: 'Some routed destinations unavailable',
    hint: 'This order reached some of the destinations routing chose, but not all of them. The rest are disabled, unknown, or cannot create orders.',
    tone: 'attention',
  },
  'routed-to-source-only': {
    label: 'Routed back to its own channel',
    hint: 'Fulfilment routing named only the channel this order came from, so there was no destination to send it to. Check the routing rules for this connection.',
    tone: 'attention',
  },
} as const satisfies Record<DestinationRoutingBlockReasonValue, DestinationRoutingCopy>;

/**
 * The counted subset, DERIVED from the copy table's own `tone` rather than
 * hand-listed — mirroring how core derives its attention list by `.filter`, so
 * the two answers to "is this attention-worthy?" cannot disagree.
 */
export const DESTINATION_ROUTING_ATTENTION_REASONS: readonly DestinationRoutingBlockReasonValue[] =
  DestinationRoutingBlockReasonValues.filter(
    (reason) => DESTINATION_ROUTING_REASON_COPY[reason].tone === 'attention'
  );

/**
 * Resolve copy for a persisted reason.
 *
 * Returns `null` for an unrecognised value rather than inventing a label: a
 * reason written by a newer release and then rolled back must render as nothing
 * rather than as a confident wrong sentence.
 */
export const resolveDestinationRoutingCopy = (
  reason: string | null | undefined
): DestinationRoutingCopy | null => {
  if (!reason) {
    return null;
  }
  return (
    DESTINATION_ROUTING_REASON_COPY[reason as DestinationRoutingBlockReasonValue] ?? null
  );
};

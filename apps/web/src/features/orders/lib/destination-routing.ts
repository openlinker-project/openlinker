/**
 * Destination-routing block reasons (#2703 / #2704).
 *
 * ONE place that says how each persisted reason reads, so the row badge, the
 * sync cell and the detail callout cannot drift. The words live in the
 * `orders.destinationRouting` namespace; this module owns the tone and the
 * resolution rules.
 *
 * ## Two tones, and the split is the whole point of #2703
 *
 * `'routed-to-no-destination'` is a **working router making a decision** and
 * `'no-destination-configured'` (#3959) a shop with nothing to copy its orders
 * to - both are rendered NEUTRALLY and never counted. Every other reason is
 * outstanding work (a destination OpenLinker could not reach) and renders as a
 * warning. Collapsing the two would restore
 * exactly the ambiguity #2703 exists to remove, one surface down: an operator
 * could not tell a router deciding from a configuration failing.
 *
 * The reason an order has no destination is READ from the persisted column,
 * never re-derived here from the sync-status rollup - #2100's rule, and the one
 * a draft that inferred it got wrong by printing a cause the backend had not
 * recorded.
 *
 * @module apps/web/src/features/orders/lib
 */
import type { Messages, ResolvedCopy } from '../../../shared/i18n';
import {
  DestinationRoutingBlockReasonValues,
  type DestinationRoutingBlockReasonValue,
} from '../api/orders.types';

type OrdersCopy = ResolvedCopy<Messages['orders']>;

/** How a reason should read - a decision the router took, or work to do. */
export type DestinationRoutingTone = 'decision' | 'attention';

export interface DestinationRoutingCopy {
  /** Short badge label. */
  readonly label: string;
  /** One sentence naming the cause and, where there is one, the remedy. */
  readonly hint: string;
  readonly tone: DestinationRoutingTone;
}

/**
 * `satisfies Record<…>`: a value added to the mirrored union without a tone here
 * is a COMPILE error rather than an unlabelled badge. The words are typed from
 * en.json, so a reason with no copy fails the lookup below at compile time too;
 * `check-destination-routing-reason-mirror.mjs` ties the copy keys to core.
 */
export const DESTINATION_ROUTING_REASON_TONE = {
  'routed-to-no-destination': 'decision',
  'routed-destinations-unavailable': 'attention',
  'routed-destinations-partially-unavailable': 'attention',
  'routed-to-source-only': 'attention',
  // #3959 - true of every order on a single-shop install, so it must stay
  // neutral; a warning here would sit on every row of a healthy install.
  'no-destination-configured': 'decision',
  'no-active-destination': 'attention',
} as const satisfies Record<DestinationRoutingBlockReasonValue, DestinationRoutingTone>;

/**
 * The counted subset, DERIVED from the tone table rather than hand-listed -
 * mirroring how core derives its attention list by `.filter`, so the two
 * answers to "is this attention-worthy?" cannot disagree.
 */
export const DESTINATION_ROUTING_ATTENTION_REASONS: readonly DestinationRoutingBlockReasonValue[] =
  DestinationRoutingBlockReasonValues.filter(
    (reason) => DESTINATION_ROUTING_REASON_TONE[reason] === 'attention'
  );

/** Narrowing guard, so consumers need no `as` cast after a copy lookup. */
export const isDestinationRoutingBlockReason = (
  reason: string | null | undefined
): reason is DestinationRoutingBlockReasonValue =>
  typeof reason === 'string' &&
  (DestinationRoutingBlockReasonValues as readonly string[]).includes(reason);

/**
 * Resolve copy for a persisted reason.
 *
 * Returns `null` for an unrecognised value rather than inventing a label: a
 * reason written by a newer release and then rolled back must render as nothing
 * rather than as a confident wrong sentence.
 */
export const resolveDestinationRoutingCopy = (
  reason: string | null | undefined,
  copy: OrdersCopy
): DestinationRoutingCopy | null => {
  if (!isDestinationRoutingBlockReason(reason)) return null;
  const words = copy.destinationRouting.reasons[reason];
  return { label: words.label, hint: words.hint, tone: DESTINATION_ROUTING_REASON_TONE[reason] };
};

/**
 * The Sync-cell hint a routing reason contributes, or `null` when it contributes
 * none and the cell keeps its own wording.
 *
 * With no destination rows the reason replaces "No destinations configured": an
 * attention reason gets a short pointer (its full sentence and the unreachable
 * ids are in the detail-page callout, so repeating it here would say it twice),
 * while the neutral decision keeps its own hint because no callout renders for
 * it. With destination rows only the PARTIAL reason contributes, since
 * "All destinations reconciled" would contradict it; an unavailable reason
 * beside rows from an earlier run leaves the callout to say so.
 */
export const resolveDestinationRoutingSyncHint = (
  reason: string | null | undefined,
  hasDestinationRows: boolean,
  copy: OrdersCopy
): string | null => {
  const resolved = resolveDestinationRoutingCopy(reason, copy);
  if (resolved === null) return null;
  if (!hasDestinationRows) {
    return resolved.tone === 'attention' ? copy.destinationRouting.attentionSyncHint : resolved.hint;
  }
  return reason === 'routed-destinations-partially-unavailable'
    ? copy.destinationRouting.partialSyncHint
    : null;
};

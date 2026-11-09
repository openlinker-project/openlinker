/**
 * View-model for an order OpenLinker handles itself (#3482).
 *
 * Pure. Everything here is READ from what the backend persisted or projected -
 * the packing stage from `handledInOpenLinker`, the waiting reason from
 * `fulfillmentBlockReason`. Nothing is inferred from the sync rollup or computed
 * from the order (#2100: a surface must not state a cause the backend never
 * recorded). The words live in `orders.handledInOpenLinker`; each function takes
 * the namespace, defaulting to the active language when called outside React.
 *
 * @module apps/web/src/features/orders/lib
 */
import { getMessages, type Messages, type ResolvedCopy } from '../../../shared/i18n';
import type {
  OrderHandledInOpenLinker,
  OrderRecord,
  OrderWorkStageValue,
  WaitingFulfillmentBlockReasonValue,
} from '../api/orders.types';

type OrdersCopy = ResolvedCopy<Messages['orders']>;

/**
 * The packing position's glyph, in time order. The label and hint live in
 * `orders.handledInOpenLinker.workStages`; `satisfies` makes a new stage a
 * compile error here, and `check-handled-in-openlinker-mirror.mjs` ties the
 * copy keys to core.
 */
export const ORDER_WORK_STAGE_MARK = {
  'to-pack': '○',
  'packing': '◐',
  'packed': '✓',
} as const satisfies Record<OrderWorkStageValue, string>;

/**
 * A held order's tone, keyed by the BACKEND's persisted value (`satisfies` ties
 * the keys to the frontend mirror, and `check-fulfillment-reason-mirror.mjs`
 * ties the copy keys to core); the three #3485 states. The other held states
 * (`routing-in-doubt`, `routing-contended`, `routing-already-live-elsewhere`)
 * are deliberately absent: they are transient guards, not an order waiting on
 * the operator, so they render no badge rather than a misleading one.
 */
export const WAITING_REASON_TONE = {
  'routing-refused': 'warning',
  'routing-no-shipping-address': 'warning',
  'routing-failed': 'error',
} as const satisfies Record<WaitingFulfillmentBlockReasonValue, 'warning' | 'error'>;

function hasOwn<K extends string>(table: Readonly<Record<K, unknown>>, key: string): key is K {
  return Object.prototype.hasOwnProperty.call(table, key);
}

export interface PackingStageView {
  readonly stage: OrderHandledInOpenLinker['stage'];
  readonly label: string;
  readonly mark: string;
  readonly hint: string;
}

/** The packing position for a row, or `null` when OpenLinker found no live work. */
export function derivePackingStage(
  handled: OrderHandledInOpenLinker | undefined,
  copy: OrdersCopy = getMessages('orders')
): PackingStageView | null {
  if (!handled) return null;
  const stage: string = handled.stage;
  // An unknown stage (a newer API) renders nothing rather than a guess.
  if (!hasOwn(ORDER_WORK_STAGE_MARK, stage)) return null;
  const words = copy.handledInOpenLinker.workStages[stage];
  return { stage: handled.stage, label: words.label, hint: words.hint, mark: ORDER_WORK_STAGE_MARK[stage] };
}

export interface WaitingView {
  readonly label: string;
  /** The short cause for the mobile card's "Waiting on" fact. */
  readonly fact: string;
  readonly hint: string;
  readonly tone: 'warning' | 'error';
}

/**
 * The "Waiting: ..." badge for an order OpenLinker holds, or `null`.
 *
 * `null` for an absent reason AND for one this build does not recognise: a held
 * state written by a newer release must render as nothing, not as a wrong label.
 */
export function deriveWaiting(
  order: Pick<OrderRecord, 'fulfillmentBlockReason'>,
  copy: OrdersCopy = getMessages('orders')
): WaitingView | null {
  const reason = order.fulfillmentBlockReason;
  if (!reason || !hasOwn(WAITING_REASON_TONE, reason)) return null;
  const words = copy.handledInOpenLinker.waitingReasons[reason];
  return { label: words.label, fact: words.fact, hint: words.hint, tone: WAITING_REASON_TONE[reason] };
}

/**
 * Should the row render the packing-stage marker?
 *
 * Not for a PACKED order that already carries `packedAt`: the existing
 * "✓ Packed <age>" tick says the same thing and also says WHEN, so rendering both
 * put two "Packed" lines under each other. The tick IS the Packed stage (mockup
 * annotation 4). Every other handled order shows the marker.
 */
export function showsPackingStage(
  order: Pick<OrderRecord, 'handledInOpenLinker' | 'packedAt'>
): boolean {
  const view = derivePackingStage(order.handledInOpenLinker);
  if (!view) return false;
  return !(view.stage === 'packed' && Boolean(order.packedAt));
}

/**
 * Who packs it, for the line under "To pack" / "Packing" (#3482, mockup:
 * "To pack · Unassigned", "Packing · <name>"), or `null` when there is nothing
 * to say: no work, a packed parcel (its tick says when instead), or a response
 * from before the assignment was projected.
 *
 * `nameById` is the packers roster, or `null` while that roster is not usable -
 * still loading, failed, or never fetched. A name-dependent label then renders
 * NOTHING: "Assigned" is a claim that this id does not resolve, and a roster
 * that has not answered (or errored) has made no such statement. Only a roster
 * that LOADED can say an id is unknown, and it reads "Assigned", never a raw id.
 * "Unassigned" and "Several packers" need no roster and are unaffected.
 */
export function derivePackerLabel(
  handled: OrderHandledInOpenLinker | undefined,
  nameById: ReadonlyMap<string, string> | null,
  copy: OrdersCopy = getMessages('orders')
): string | null {
  const view = derivePackingStage(handled, copy);
  if (!view || view.stage === 'packed' || !handled?.assignment) return null;
  const words = copy.handledInOpenLinker;
  if (handled.assignment === 'mixed') return words.severalPackers;
  if (!handled.assignedToUserId) return words.unassigned;
  if (nameById === null) return null;
  return nameById.get(handled.assignedToUserId) ?? words.assignedUnknown;
}

/** Does any row on the page need a packer's NAME (so the roster is worth fetching)? */
export function needsPackerNames(
  orders: ReadonlyArray<Pick<OrderRecord, 'handledInOpenLinker'>>
): boolean {
  return orders.some((order) => {
    const handled = order.handledInOpenLinker;
    return (
      handled?.assignment === 'single' &&
      Boolean(handled.assignedToUserId) &&
      handled.stage !== 'packed'
    );
  });
}

/** Is the order handled in OpenLinker (it has live pack-bench work)? */
export function isHandledInOpenLinker(
  order: Pick<OrderRecord, 'handledInOpenLinker'>
): boolean {
  return derivePackingStage(order.handledInOpenLinker) !== null;
}

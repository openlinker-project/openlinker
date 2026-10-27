/**
 * View-model for an order OpenLinker handles itself (#3482).
 *
 * Pure. Everything here is READ from what the backend persisted or projected -
 * the packing stage from `handledInOpenLinker`, the waiting reason from
 * `fulfillmentBlockReason`. Nothing is inferred from the sync rollup or computed
 * from the order (#2100: a surface must not state a cause the backend never
 * recorded).
 *
 * @module apps/web/src/features/orders/lib
 */
import type { OrderHandledInOpenLinker, OrderRecord } from '../api/orders.types';
import {
  HANDLED_IN_OPENLINKER_COPY,
  ORDER_WORK_STAGE_COPY,
  WAITING_REASON_COPY,
} from './handled-in-openlinker.copy';

export interface PackingStageView {
  readonly stage: OrderHandledInOpenLinker['stage'];
  readonly label: string;
  readonly mark: string;
  readonly hint: string;
}

/** The packing position for a row, or `null` when OpenLinker found no live work. */
export function derivePackingStage(
  handled: OrderHandledInOpenLinker | undefined
): PackingStageView | null {
  if (!handled) return null;
  const copy = ORDER_WORK_STAGE_COPY[handled.stage] as
    | (typeof ORDER_WORK_STAGE_COPY)[keyof typeof ORDER_WORK_STAGE_COPY]
    | undefined;
  // An unknown stage (a newer API) renders nothing rather than a guess.
  if (!copy) return null;
  return { stage: handled.stage, ...copy };
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
  order: Pick<OrderRecord, 'fulfillmentBlockReason'>
): WaitingView | null {
  const reason = order.fulfillmentBlockReason;
  if (!reason) return null;
  const copy = (WAITING_REASON_COPY as Record<string, WaitingView | undefined>)[reason];
  return copy ?? null;
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
  nameById: ReadonlyMap<string, string> | null
): string | null {
  const view = derivePackingStage(handled);
  if (!view || view.stage === 'packed' || !handled?.assignment) return null;
  if (handled.assignment === 'mixed') return HANDLED_IN_OPENLINKER_COPY.severalPackers;
  if (!handled.assignedToUserId) return HANDLED_IN_OPENLINKER_COPY.unassigned;
  if (nameById === null) return null;
  return nameById.get(handled.assignedToUserId) ?? HANDLED_IN_OPENLINKER_COPY.assignedUnknown;
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

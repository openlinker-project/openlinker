/**
 * Bulk order actions - operator-facing copy and pure rules (#3619, mockup M3 `bulk`)
 *
 * One place for every sentence the bulk action bar's Cancel, Tags and "Mark
 * buyer message read" actions say, plus the pure rules choosing which selected
 * orders each action applies to.
 *
 * @module apps/web/src/features/orders/lib
 */
import {
  BULK_ORDER_ACTION_MAX,
  type BulkBuyerNoteOutcome,
  type BulkCancelOutcome,
  type BulkOrderTagOutcome,
} from '../api/order-bulk-actions.types';
import type { OrderRecord } from '../api/orders.types';
import type { StatusBadgeTone } from '../../../shared/ui/status-badge';

export { BULK_ORDER_ACTION_MAX };

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export function noun(count: number): string {
  return `${count} ${plural(count, 'order', 'orders')}`;
}

/** Why a bulk action is unavailable for this selection, or null when it is available. */
export function bulkSelectionBlockReason(count: number): string | null {
  return count > BULK_ORDER_ACTION_MAX
    ? `Select at most ${BULK_ORDER_ACTION_MAX} orders for this action.`
    : null;
}

/** Orders the buyer-note action applies to: a note is present and not yet marked read. */
export function splitBuyerNoteCandidates(orders: readonly OrderRecord[]): {
  candidates: OrderRecord[];
  noNote: OrderRecord[];
  alreadyRead: OrderRecord[];
} {
  const candidates: OrderRecord[] = [];
  const noNote: OrderRecord[] = [];
  const alreadyRead: OrderRecord[] = [];
  for (const order of orders) {
    const hasNote = order.buyerNoteState === 'present' || order.hasBuyerNote === true;
    if (!hasNote) noNote.push(order);
    else if (order.buyerNoteReadAt) alreadyRead.push(order);
    else candidates.push(order);
  }
  return { candidates, noNote, alreadyRead };
}

export interface BulkRowView {
  tone: StatusBadgeTone;
  label: string;
}

export const BULK_CANCEL_ROW: Record<BulkCancelOutcome, BulkRowView> = {
  cancelled: { tone: 'success', label: 'Cancelled' },
  pending: { tone: 'warning', label: 'Waiting for the channel' },
  'correction-proposed': { tone: 'info', label: 'Cancelled, correction to review' },
  refused: { tone: 'error', label: 'Refused' },
  failed: { tone: 'error', label: 'Failed' },
};

export const BULK_NOTE_ROW: Record<BulkBuyerNoteOutcome, BulkRowView> = {
  marked: { tone: 'success', label: 'Marked read' },
  'already-read': { tone: 'neutral', label: 'Skipped: already read' },
  'no-note': { tone: 'neutral', label: 'Skipped: no buyer message' },
  'not-found': { tone: 'error', label: 'Order not found' },
  failed: { tone: 'error', label: 'Failed' },
};

export const BULK_TAG_ROW: Record<BulkOrderTagOutcome, BulkRowView> = {
  added: { tone: 'success', label: 'Tag added' },
  'already-tagged': { tone: 'neutral', label: 'Already had it' },
  removed: { tone: 'success', label: 'Tag removed' },
  'not-tagged': { tone: 'neutral', label: 'Did not have it' },
  failed: { tone: 'error', label: 'Failed' },
};

export const BULK_ACTIONS_COPY = {
  cancel: {
    trigger: (count: number) => `Cancel ${count}`,
    title: (count: number) => `Cancel ${noun(count)}?`,
    description:
      'OpenLinker asks each sales channel to cancel its order. Each order is handled on its own, so one refusal never stops the others.',
    reasonLabel: 'Reason',
    reasonHelp: 'One reason for the whole batch. Sales channels receive the reason code only, never your note.',
    noteLabel: 'Note',
    noteOptionalLabel: 'Note (optional)',
    noteHelp: 'Anything the next person needs to know. Never buyer details.',
    ackLabel: 'I have told the packers to stop on orders that are already on the pack bench',
    ackHelp: 'Orders on the pack bench are refused unless you tick this.',
    submit: (count: number) => `Cancel ${noun(count)}`,
    submitting: 'Cancelling…',
    keep: 'Keep orders',
    resultTitle: 'Cancellation finished',
    resultSummary: (done: number, total: number) => `${done} of ${total} handled`,
    requestError: 'OpenLinker could not start the cancellation. Nothing was cancelled.',
    correctionLink: 'Review correction',
    openOrder: 'Open order',
  },
  read: {
    trigger: 'Mark message read',
    title: (count: number) => `Mark buyer message read on ${noun(count)}?`,
    description:
      'Only orders with an unread buyer message are changed. The rest are listed as skipped afterwards.',
    summary: (apply: number, skip: number) =>
      `${apply} ${plural(apply, 'order has', 'orders have')} an unread message` +
      (skip > 0 ? `, ${skip} will be skipped.` : '.'),
    nothingToDo: 'None of the selected orders has an unread buyer message.',
    submit: 'Mark read',
    submitting: 'Marking…',
    cancel: 'Cancel',
    resultTitle: 'Buyer messages updated',
    requestError: 'OpenLinker could not mark the messages read. Try again.',
  },
  tags: {
    removeOpen: (count: number) => `Remove a tag from ${noun(count)}…`,
    removeHeading: (count: number) => `Remove tag from ${noun(count)}`,
    removeBack: 'Back to adding tags',
    removeNone: 'None of the selected orders has a tag.',
    removeResultTitle: 'Tag removed',
    removeResultDescription: (name: string, removed: number, notTagged: number) =>
      `${name} removed from ${noun(removed)}.` + (notTagged > 0 ? ` ${notTagged} did not have it.` : ''),
    removeErrorTitle: 'Tag not removed',
    removeErrorFallback: 'OpenLinker could not remove the tag. Try again.',
    partialTitle: (name: string) => `${name}: some orders failed`,
    partialDescription: (failed: number) => `${failed} ${plural(failed, 'order', 'orders')} could not be updated. See details.`,
    detailsTitle: (name: string) => `Tag ${name}`,
    detailsDescription: (ok: number, failed: number) => `${ok} updated, ${failed} failed.`,
    detailsOpen: 'Details',
    detailsClose: 'Close',
  },
  /** Dispatch keeps its own rules (#1109); the bar says how many selected orders it leaves out. */
  dispatchHint: (dispatchable: number, selected: number, shipped: number, overCap: number, cap: number) => {
    const parts: string[] = [];
    if (shipped > 0) parts.push(`${shipped} already shipped`);
    if (overCap > 0) parts.push(`${overCap} over the ${cap} per source limit`);
    return `Dispatch ${dispatchable} of ${selected}: ${parts.join(', ')}`;
  },
  dispatchDefaultHint: (cap: number) => `Dispatch: max ${cap} per source`,
  selectionCapTooltip: `Max ${BULK_ORDER_ACTION_MAX} selected`,
} as const;

/**
 * Bulk order actions - pure rules (#3619, mockup M3 `bulk`)
 *
 * The rules choosing which selected orders each bulk action applies to, the
 * tone of each per-row outcome, and the plain-language note for a cancel
 * warning code. Every word lives in `orders.bulkActions`; the functions here
 * take that copy so a test can pin the language.
 *
 * @module apps/web/src/features/orders/lib
 */
import { interpolate } from '../../../shared/i18n';
import {
  BULK_ORDER_ACTION_MAX,
  type BulkBuyerNoteOutcome,
  type BulkCancelOutcome,
  type BulkOrderTagOutcome,
} from '../api/order-bulk-actions.types';
import type { OrderRecord } from '../api/orders.types';
import type { StatusBadgeTone } from '../../../shared/ui/status-badge';
import type { BulkActionsCopy, BulkRowView } from './bulk-order-actions.types';

export { BULK_ORDER_ACTION_MAX };

/** Why a bulk action is unavailable for this selection, or null when it is available. */
export function bulkSelectionBlockReason(count: number, copy: BulkActionsCopy): string | null {
  return count > BULK_ORDER_ACTION_MAX
    ? interpolate(copy.selectionCap, { max: BULK_ORDER_ACTION_MAX })
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

const BULK_CANCEL_TONE: Record<BulkCancelOutcome, StatusBadgeTone> = {
  cancelled: 'success',
  pending: 'warning',
  'correction-proposed': 'info',
  refused: 'error',
  failed: 'error',
};

const BULK_NOTE_TONE: Record<BulkBuyerNoteOutcome, StatusBadgeTone> = {
  marked: 'success',
  'already-read': 'neutral',
  'no-note': 'neutral',
  'not-found': 'error',
  failed: 'error',
};

const BULK_TAG_TONE: Record<BulkOrderTagOutcome, StatusBadgeTone> = {
  added: 'success',
  'already-tagged': 'neutral',
  removed: 'success',
  'not-tagged': 'neutral',
  failed: 'error',
};

export function bulkCancelRow(outcome: BulkCancelOutcome, copy: BulkActionsCopy): BulkRowView {
  return { tone: BULK_CANCEL_TONE[outcome], label: copy.rows.cancel[outcome] };
}

export function bulkNoteRow(outcome: BulkBuyerNoteOutcome, copy: BulkActionsCopy): BulkRowView {
  return { tone: BULK_NOTE_TONE[outcome], label: copy.rows.note[outcome] };
}

export function bulkTagRow(outcome: BulkOrderTagOutcome, copy: BulkActionsCopy): BulkRowView {
  return { tone: BULK_TAG_TONE[outcome], label: copy.rows.tag[outcome] };
}

/** Plain-language note for one backend warning code on a cancelled row. */
export function describeCancelWarning(
  code: string,
  connectionName: (id: string) => string | undefined,
  copy: BulkActionsCopy
): string {
  const words = copy.warnings;
  if (code.startsWith('stock-restored-only:')) {
    const name = connectionName(code.slice('stock-restored-only:'.length));
    return name
      ? interpolate(words.stockRestoredOnly, { channel: name })
      : words.stockRestoredOnlyUnknown;
  }
  if (code.startsWith('participant-not-informed:')) {
    const name = connectionName(code.slice('participant-not-informed:'.length));
    return name
      ? interpolate(words.participantNotInformed, { channel: name })
      : words.participantNotInformedUnknown;
  }
  if (code.startsWith('correction-unavailable:')) {
    const reason = code.slice('correction-unavailable:'.length);
    return reason
      ? interpolate(words.correctionUnavailableReason, { reason })
      : words.correctionUnavailable;
  }
  if (code === 'destination-not-notified') return words.destinationNotNotified;
  if (code === 'stock-restore-not-queued') return words.stockRestoreNotQueued;
  return code;
}

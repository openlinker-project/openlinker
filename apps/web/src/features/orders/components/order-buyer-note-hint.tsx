/**
 * OrderBuyerNoteHint (#3539, mockup M2 `list`)
 *
 * The orders list's buyer-note indicator: a speech-bubble icon and a label in
 * the Customer group - deliberately not a badge, since a badge would join the
 * status vocabulary and the list's one-badge-per-concern rule.
 *
 * The list payload carries `hasBuyerNote` and NO text (the note is detail
 * only, for data minimisation), so this renders the label rather than the
 * mockup's ellipsised first line; the full text is in the row expansion.
 * Renders nothing without a note: `hasBuyerNote: false` covers both "none" and
 * "unknown" on this surface, and neither earns a mark.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';

import { BUYER_NOTE_COPY as COPY } from '../lib/buyer-note.copy';
import { BuyerNoteIcon } from './buyer-note-icon';

export interface OrderBuyerNoteHintProps {
  hasBuyerNote: boolean | undefined;
  /** `row` for the desktop Customer cell, `card` for the mobile fact. */
  layout?: 'row' | 'card';
}

export function OrderBuyerNoteHint({
  hasBuyerNote,
  layout = 'row',
}: OrderBuyerNoteHintProps): ReactElement | null {
  if (hasBuyerNote !== true) return null;
  return (
    <span
      className="buyer-note-hint"
      title={COPY.listIndicatorTitle}
      data-testid={layout === 'row' ? 'order-buyer-note-hint' : 'order-buyer-note-hint-card'}
    >
      <BuyerNoteIcon size={12} />
      <span className="buyer-note-hint__text">{COPY.listIndicator}</span>
    </span>
  );
}

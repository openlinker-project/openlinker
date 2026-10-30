/**
 * OrderBuyerNoteHint (#3539, mockup M2 `list`)
 *
 * The orders list's buyer-note indicator: a speech-bubble icon and a label in
 * the Customer group - deliberately not a badge, since a badge would join the
 * status vocabulary and the list's one-badge-per-concern rule.
 *
 * The list payload carries `buyerNotePreview` - the first line, bounded
 * server-side - and never the whole text; the full text is in the row
 * expansion. Without a preview (text not stored) it falls back to the label.
 * Renders nothing without a note: "none" and "unknown" earn no mark here.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';

import { BUYER_NOTE_COPY as COPY } from '../lib/buyer-note.copy';
import { BuyerNoteIcon } from './buyer-note-icon';

export interface OrderBuyerNoteHintProps {
  hasBuyerNote: boolean | undefined;
  /** First line of the note from the list read, or `null`/absent when none is stored. */
  preview?: string | null;
  /** `row` for the desktop Customer cell, `card` for the mobile fact. */
  layout?: 'row' | 'card';
}

export function OrderBuyerNoteHint({
  hasBuyerNote,
  preview = null,
  layout = 'row',
}: OrderBuyerNoteHintProps): ReactElement | null {
  if (hasBuyerNote !== true) return null;
  return (
    <span
      className="buyer-note-hint"
      title={preview ?? COPY.listIndicatorTitle}
      data-testid={layout === 'row' ? 'order-buyer-note-hint' : 'order-buyer-note-hint-card'}
    >
      <BuyerNoteIcon size={12} />
      {/* One line, ellipsised by CSS. `lang="und"`: the buyer's language is not the UI's. */}
      <span
        className={layout === 'card' ? 'buyer-note-clamp-2' : 'buyer-note-hint__text'}
        lang={preview === null ? undefined : 'und'}
      >
        {preview === null ? null : <span className="sr-only">{COPY.listIndicator}: </span>}
        {preview ?? COPY.listIndicator}
      </span>
    </span>
  );
}

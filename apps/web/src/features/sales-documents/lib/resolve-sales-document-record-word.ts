/**
 * Sales-Document Record Word (#3307, extracted from #2552/ADR-065)
 *
 * The "given an existing record, what's the single most actionable word"
 * rule — the half of `resolveSalesDocumentCellState` that runs once a
 * document actually exists. Extracted here so it has exactly ONE definition,
 * shared between:
 *
 *   - `features/orders/lib/sales-document-cell-state.ts`, whose own "no
 *     document yet" branches stay local to it (those are genuinely
 *     order/routing-specific — a merged document LIST has no such state,
 *     because a row on it always has a record by construction); and
 *   - the merged `/sales-documents` list (this feature), whose rows are
 *     `SalesDocumentListItem`s that likewise always carry a `document`.
 *
 * No platform name ever leaks into the word ("Rejected at clearance", not "KSeF
 * rejected") — the vocabulary here is the SAME neutral one `libs/core`
 * enforces for the wire shape; a specific authority's name belongs on
 * identity facts (`providerType`), never on the word.
 *
 * @module apps/web/src/features/sales-documents/lib
 */
import type { SalesDocumentRecordView } from '../../orders';
import { getMessages } from '../../../shared/i18n';

export type SalesDocumentRecordTone = 'idle' | 'progress' | 'done' | 'warning' | 'error';

export interface SalesDocumentRecordWord {
  readonly word: string;
  readonly tone: SalesDocumentRecordTone;
}

export function resolveSalesDocumentRecordWord(
  document: SalesDocumentRecordView,
): SalesDocumentRecordWord {
  const copy = getMessages('sales-documents').recordWord;
  if (document.kind === 'fiscal-receipt') {
    if (document.status === 'pending') return { word: copy.queued, tone: 'progress' };
    if (document.status === 'registering') return { word: copy.registering, tone: 'progress' };
    if (document.status === 'registered') return { word: copy.registered, tone: 'done' };
    if (document.status === 'failed') {
      return document.failureMode === 'rejected'
        ? { word: copy.rejected, tone: 'error' }
        : { word: copy.unconfirmed, tone: 'warning' };
    }
    // A status this build does not recognise — a newer backend answering an
    // FE compiled against an older union. Reported as needing a look rather
    // than silently rendering nothing.
    return { word: copy.unrecognised, tone: 'warning' };
  }

  // document.kind === 'invoice'. Clearance takes precedence over issuance —
  // "issued, then rejected by the authority" is the state a flattened status
  // could not express (ADR-065), and it is more actionable than "Issued".
  if (document.regulatoryStatus === 'rejected') {
    return { word: copy.clearanceRejected, tone: 'error' };
  }
  if (
    document.regulatoryStatus === 'submitted' ||
    document.regulatoryStatus === 'pending-submission'
  ) {
    return { word: copy.atClearance, tone: 'progress' };
  }
  if (document.status === 'issued') return { word: copy.issued, tone: 'done' };
  if (document.status === 'issuing' || document.status === 'pending') {
    return { word: copy.issuing, tone: 'progress' };
  }
  if (document.status === 'failed') {
    return document.failureMode === 'rejected'
      ? { word: copy.failed, tone: 'error' }
      : { word: copy.needsReview, tone: 'warning' };
  }
  // A status this build does not recognise.
  return { word: copy.unrecognised, tone: 'warning' };
}

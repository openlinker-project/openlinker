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
 * No platform name ever leaks into the word ("Authority rejected", not "KSeF
 * rejected") — the vocabulary here is the SAME neutral one `libs/core`
 * enforces for the wire shape; a specific authority's name belongs on
 * identity facts (`providerType`), never on the word.
 *
 * @module apps/web/src/features/sales-documents/lib
 */
import type { SalesDocumentRecordView } from '../../orders';

export type SalesDocumentRecordTone = 'idle' | 'progress' | 'done' | 'warning' | 'error';

export interface SalesDocumentRecordWord {
  readonly word: string;
  readonly tone: SalesDocumentRecordTone;
}

export function resolveSalesDocumentRecordWord(
  document: SalesDocumentRecordView,
): SalesDocumentRecordWord {
  if (document.kind === 'fiscal-receipt') {
    if (document.status === 'pending') return { word: 'Queued', tone: 'progress' };
    if (document.status === 'registering') return { word: 'Registering', tone: 'progress' };
    if (document.status === 'registered') return { word: 'Registered', tone: 'done' };
    if (document.status === 'failed') {
      return document.failureMode === 'rejected'
        ? { word: 'Rejected', tone: 'error' }
        : { word: 'Unconfirmed', tone: 'warning' };
    }
    // A status this build does not recognise — a newer backend answering an
    // FE compiled against an older union. Reported as needing a look rather
    // than silently rendering nothing.
    return { word: 'Unrecognised status', tone: 'warning' };
  }

  // document.kind === 'invoice'. Clearance takes precedence over issuance —
  // "issued, then rejected by the authority" is the state a flattened status
  // could not express (ADR-065), and it is more actionable than "Issued".
  if (document.regulatoryStatus === 'rejected') {
    return { word: 'Authority rejected', tone: 'error' };
  }
  if (
    document.regulatoryStatus === 'submitted' ||
    document.regulatoryStatus === 'pending-submission'
  ) {
    return { word: 'At authority', tone: 'progress' };
  }
  if (document.status === 'issued') return { word: 'Issued', tone: 'done' };
  if (document.status === 'issuing' || document.status === 'pending') {
    return { word: 'Issuing', tone: 'progress' };
  }
  if (document.status === 'failed') {
    return document.failureMode === 'rejected'
      ? { word: 'Failed', tone: 'error' }
      : { word: 'Needs review', tone: 'warning' };
  }
  // A status this build does not recognise.
  return { word: 'Unrecognised status', tone: 'warning' };
}

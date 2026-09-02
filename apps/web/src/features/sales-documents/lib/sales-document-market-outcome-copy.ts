/**
 * Sales-Document Market Outcome Copy (#2540/#2541/#2542)
 *
 * Turns one `SalesDocumentMarketRow.outcome` into the words a market-list row
 * or a section summary sentence needs — "what does this market's orders get"
 * and, when the answer is nothing, why. Derived from the backend's own
 * resolved outcome, never re-derived from country/connection state client
 * side (the #2534 rule that `sales-document-reason-copy.ts` also follows).
 *
 * `'acknowledged'` is rendered as a settled, neutral state — not a decision
 * needing attention — because the whole point of an acknowledgment (#2186)
 * is that an operator already decided "no document here, by design".
 *
 * @module apps/web/src/features/sales-documents/lib
 */
import { SALES_DOCUMENT_UNRESOLVED_REASON_COPY } from './sales-document-reason-copy';
import type { SalesDocumentMarketOutcome } from '../api/sales-document-markets.types';
import type { DocumentKind } from '../../../shared/ui/document-kind-glyph';

export interface SalesDocumentMarketOutcomeCopy {
  /** What this market's orders get, in a couple of words. */
  headline: string;
  /** The document glyph kind, or `null` for "nothing". */
  glyphKind: DocumentKind | null;
  /** True only for `outcome.kind === 'route'` naming a real document. */
  isIssuing: boolean;
  /** True when this row needs an operator decision (unresolved, not acknowledged). */
  needsDecision: boolean;
  /** The short "why nothing" reason, set only when `needsDecision` is true. */
  reasonShort: string | null;
}

function isKnownDocumentKind(kind: string | null | undefined): kind is DocumentKind {
  return kind === 'invoice' || kind === 'fiscal-receipt';
}

export function describeSalesDocumentMarketOutcome(
  outcome: SalesDocumentMarketOutcome,
): SalesDocumentMarketOutcomeCopy {
  if (outcome.kind === 'route') {
    const glyphKind = isKnownDocumentKind(outcome.documentKind) ? outcome.documentKind : null;
    return {
      headline: glyphKind === 'fiscal-receipt' ? 'Fiscal receipt' : 'Invoice',
      glyphKind,
      isIssuing: true,
      needsDecision: false,
      reasonShort: null,
    };
  }

  if (outcome.kind === 'aggregate') {
    return {
      headline: 'Collected, not yet issued',
      glyphKind: null,
      isIssuing: false,
      needsDecision: false,
      reasonShort: null,
    };
  }

  if (outcome.kind === 'acknowledged') {
    return {
      headline: 'No document, by choice',
      glyphKind: null,
      isIssuing: false,
      needsDecision: false,
      reasonShort: null,
    };
  }

  // 'unresolved' — the reason travels on the row itself, resolved against the
  // same routing-reason vocabulary the order-level surfaces already use. The
  // backend DTO types `reason` as a bare `string` (not the narrow union), so
  // this cast is an honest acknowledgment of an untyped wire boundary value,
  // not a bypass of a type we could otherwise have kept.
  const reasonCopy = outcome.reason
    ? (SALES_DOCUMENT_UNRESOLVED_REASON_COPY as Record<string, { short: string }>)[outcome.reason]
    : undefined;
  return {
    headline: 'Nothing issued',
    glyphKind: null,
    isIssuing: false,
    needsDecision: true,
    reasonShort: reasonCopy?.short ?? 'Not set up',
  };
}

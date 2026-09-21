/**
 * Describe a dry-run result back to the operator (#3191)
 *
 * "Test with a sample order" answers one question — what would THIS order
 * get, right now, if the rule being drafted were saved — and this pure
 * function turns the backend's `SalesDocumentDryRunResult` into the one
 * sentence a caller renders. Reuses `SALES_DOCUMENT_UNRESOLVED_REASON_COPY`
 * (the SAME map the market rows and the readback's neighbouring surfaces
 * read) rather than inventing a second explanation of the same reason
 * vocabulary — the #2534 rule that a surface never re-derives a fact the
 * backend persists applies here too: the reason is the backend's, verbatim.
 *
 * @module apps/web/src/features/sales-documents/lib
 */
import type { SalesDocumentDryRunResult } from '../api/sales-document-rules.types';
import { SALES_DOCUMENT_UNRESOLVED_REASON_COPY } from './sales-document-reason-copy';

const DOCUMENT_KIND_LABEL: Record<string, string> = {
  invoice: 'an invoice',
  'fiscal-receipt': 'a fiscal receipt',
};

export function describeSalesDocumentDryRunResult(
  result: SalesDocumentDryRunResult,
  connectionName: (connectionId: string) => string | null,
): string {
  if (result.kind === 'route') {
    const kind =
      result.documentKind === null
        ? 'a document its own destination decides'
        : (DOCUMENT_KIND_LABEL[result.documentKind ?? ''] ?? `a ${result.documentKind ?? 'document'}`);
    const where = result.connectionId ? (connectionName(result.connectionId) ?? result.connectionId) : '(unknown)';
    const via = result.matchedByCandidateRule
      ? 'via the rule you are drafting'
      : `via an already-saved rule at ${where}`;
    return `This order would get ${kind} through ${where} — ${via}.`;
  }

  if (result.kind === 'aggregate') {
    return 'This order would be collected into a periodic batch, not issued a document immediately.';
  }

  // 'unresolved' — the backend types `reason` as a bare string (the same
  // untyped-wire-boundary shape `describeSalesDocumentMarketOutcome` already
  // accepts), so an unrecognised value falls back to a neutral statement
  // rather than throwing or rendering nothing.
  const reasonCopy = result.reason
    ? (SALES_DOCUMENT_UNRESOLVED_REASON_COPY as Record<string, { detail: string }>)[result.reason]
    : undefined;
  return reasonCopy?.detail ?? 'This order would be held — nothing could decide a document for it.';
}
